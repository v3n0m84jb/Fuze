import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ethers } from "ethers";

import Header from "../components/Header";

import {
  FACTORY_ADDRESS,
  FACTORY_READ_ABI,
  POOL_ABI,
  TOKEN_ABI,
  IGNITION_TARGET_MON
} from "../lib/contracts";

const RPC_URL = "https://testnet-rpc.monad.xyz";

export default function TokenPage() {
  const { poolAddress } = useParams();

  const [token, setToken] = useState(null);
  const [poolStats, setPoolStats] = useState(null);

  const [buyAmount, setBuyAmount] = useState("0.01");
  const [sellAmount, setSellAmount] = useState("");

  const [buyLoading, setBuyLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);

  const [wallet, setWallet] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");

  useEffect(() => {
    loadTokenAndStats();
  }, [poolAddress]);

  async function loadTokenAndStats() {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);

      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_READ_ABI,
        provider
      );

      const total = await factory.totalTokens();
      let found = null;

      for (let i = 0; i < Number(total); i++) {
        const item = await factory.allTokens(i);

        if (item.pool.toLowerCase() === poolAddress.toLowerCase()) {
          found = {
            token: item.token,
            pool: item.pool,
            creator: item.creator,
            name: item.name,
            symbol: item.symbol,
            createdAt: item.createdAt
          };
          break;
        }
      }

      if (!found) {
        setToken(null);
        return;
      }

      setToken(found);

      const pool = new ethers.Contract(found.pool, POOL_ABI, provider);

      const price = await pool.currentPrice();
      const reserve = await pool.reserveMON();
      const sold = await pool.tokensSold();
      const ignited = await pool.ignited();

      const reserveNumber = Number(ethers.formatEther(reserve));
      const progress = Math.min(
        (reserveNumber / IGNITION_TARGET_MON) * 100,
        100
      );

      setPoolStats({
        price: ethers.formatUnits(price, 18),
        reserve: ethers.formatEther(reserve),
        sold: ethers.formatUnits(sold, 18),
        ignited,
        progress
      });

      if (wallet) {
        await loadTokenBalance(found, wallet);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function connectAndLoadWallet() {
    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);

    setWallet(accounts[0]);

    if (token) {
      await loadTokenBalance(token, accounts[0]);
    }
  }

  async function loadTokenBalance(tokenItem, walletAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);

      const tokenContract = new ethers.Contract(
        tokenItem.token,
        TOKEN_ABI,
        provider
      );

      const balance = await tokenContract.balanceOf(walletAddress);

      setTokenBalance(ethers.formatUnits(balance, 18));
    } catch (err) {
      console.error(err);
      setTokenBalance("0");
    }
  }

  async function buyToken() {
    if (!token) return;

    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    if (!buyAmount || Number(buyAmount) <= 0) {
      alert("Vul een geldig MON bedrag in");
      return;
    }

    try {
      setBuyLoading(true);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const address = await signer.getAddress();
      setWallet(address);

      const pool = new ethers.Contract(token.pool, POOL_ABI, signer);

      const tx = await pool.buy(0, {
        value: ethers.parseEther(buyAmount)
      });

      await tx.wait();

      await loadTokenAndStats();
      await loadTokenBalance(token, address);

      alert("Buy complete!");
    } catch (err) {
      console.error(err);
      alert(err?.reason || err?.message || "Buy failed");
    } finally {
      setBuyLoading(false);
    }
  }

  async function sellToken() {
    if (!token) return;

    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    if (!sellAmount || Number(sellAmount) <= 0) {
      alert("Vul een geldig token bedrag in");
      return;
    }

    try {
      setSellLoading(true);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const address = await signer.getAddress();
      setWallet(address);

      const tokenContract = new ethers.Contract(
        token.token,
        TOKEN_ABI,
        signer
      );

      const pool = new ethers.Contract(token.pool, POOL_ABI, signer);

      const amount = ethers.parseUnits(sellAmount, 18);

      const approveTx = await tokenContract.approve(token.pool, amount);
      await approveTx.wait();

      const sellTx = await pool.sell(amount, 0);
      await sellTx.wait();

      setSellAmount("");

      await loadTokenAndStats();
      await loadTokenBalance(token, address);

      alert("Sell complete!");
    } catch (err) {
      console.error(err);
      alert(err?.reason || err?.message || "Sell failed");
    } finally {
      setSellLoading(false);
    }
  }

  return (
    <main style={pageStyle}>
      <div style={containerStyle}>
        <Header />

        {!token && (
          <div style={boxStyle}>
            <h2>Token not found</h2>
            <p style={{ opacity: 0.7 }}>Pool address: {poolAddress}</p>
          </div>
        )}

        {token && (
          <div style={layoutStyle}>
            <section style={panelStyle}>
              <h2 style={titleStyle}>{token.symbol}</h2>

              <p style={subtitleStyle}>{token.name}</p>

              <div style={{ marginTop: "32px" }}>
                <p style={{ opacity: 0.7 }}>Bonding progress</p>

                <div style={progressOuterStyle}>
                  <div
                    style={{
                      ...progressInnerStyle,
                      width: `${poolStats?.progress || 0}%`
                    }}
                  />
                </div>

                <p style={{ marginTop: "10px" }}>
                  {poolStats
                    ? `${poolStats.progress.toFixed(2)}% bonded`
                    : "Loading..."}
                </p>
              </div>

              <div style={statsGridStyle}>
                <Stat
                  label="Price"
                  value={`${poolStats?.price || "-"} MON`}
                />

                <Stat
                  label="Reserve"
                  value={`${poolStats?.reserve || "-"} MON`}
                />

                <Stat
                  label="Tokens Sold"
                  value={poolStats?.sold || "-"}
                />

                <Stat
                  label="Status"
                  value={poolStats?.ignited ? "IGNITED 🔥" : "Bonding"}
                />
              </div>
            </section>

            <aside style={panelStyle}>
              <button onClick={connectAndLoadWallet} style={smallButtonStyle}>
                {wallet
                  ? wallet.slice(0, 6) + "..." + wallet.slice(-4)
                  : "Connect Wallet"}
              </button>

              <p style={{ marginTop: "16px", opacity: 0.7 }}>
                Balance: {Number(tokenBalance).toLocaleString()} {token.symbol}
              </p>

              <div style={tradeBoxStyle}>
                <h3 style={buyTitleStyle}>Buy {token.symbol}</h3>

                <input
                  value={buyAmount}
                  onChange={(e) => setBuyAmount(e.target.value)}
                  placeholder="0.01"
                  style={inputStyle}
                />

                <button
                  onClick={buyToken}
                  disabled={buyLoading || poolStats?.ignited}
                  style={{
                    ...primaryButtonStyle,
                    opacity: buyLoading || poolStats?.ignited ? 0.5 : 1
                  }}
                >
                  {poolStats?.ignited
                    ? "Bonding finished"
                    : buyLoading
                    ? "Buying..."
                    : "Buy with MON"}
                </button>
              </div>

              <div style={tradeBoxStyle}>
                <h3 style={buyTitleStyle}>Sell {token.symbol}</h3>

                <input
                  value={sellAmount}
                  onChange={(e) => setSellAmount(e.target.value)}
                  placeholder={`Amount ${token.symbol}`}
                  style={inputStyle}
                />

                <button
                  onClick={sellToken}
                  disabled={sellLoading || poolStats?.ignited}
                  style={{
                    ...sellButtonStyle,
                    opacity: sellLoading || poolStats?.ignited ? 0.5 : 1
                  }}
                >
                  {poolStats?.ignited
                    ? "Bonding finished"
                    : sellLoading
                    ? "Selling..."
                    : "Sell for MON"}
                </button>
              </div>

              <div style={addressBoxStyle}>
                <p>Pool:</p>
                <span>{token.pool}</span>

                <p>Token:</p>
                <span>{token.token}</span>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div style={statStyle}>
      <p style={{ opacity: 0.6, marginBottom: "8px" }}>{label}</p>
      <strong>{value}</strong>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top, #24123a 0%, #0b0b0f 60%)",
  color: "white",
  fontFamily: "Arial",
  padding: "40px"
};

const containerStyle = {
  maxWidth: "1200px",
  margin: "0 auto"
};

const layoutStyle = {
  display: "grid",
  gridTemplateColumns: "1.4fr 0.8fr",
  gap: "24px"
};

const panelStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "24px",
  padding: "28px"
};

const boxStyle = {
  ...panelStyle
};

const titleStyle = {
  fontSize: "48px",
  marginBottom: "8px"
};

const subtitleStyle = {
  opacity: 0.7,
  fontSize: "20px"
};

const progressOuterStyle = {
  height: "16px",
  background: "rgba(255,255,255,0.1)",
  borderRadius: "999px",
  overflow: "hidden",
  marginTop: "10px"
};

const progressInnerStyle = {
  height: "100%",
  background: "#7c3aed"
};

const statsGridStyle = {
  marginTop: "32px",
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "16px"
};

const statStyle = {
  background: "rgba(0,0,0,0.25)",
  borderRadius: "16px",
  padding: "18px"
};

const buyTitleStyle = {
  fontSize: "24px",
  marginBottom: "16px"
};

const inputStyle = {
  width: "100%",
  padding: "14px",
  marginBottom: "16px",
  borderRadius: "12px",
  border: "none",
  background: "#111118",
  color: "white"
};

const primaryButtonStyle = {
  width: "100%",
  background: "#7c3aed",
  border: "none",
  color: "white",
  padding: "16px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "bold"
};

const sellButtonStyle = {
  width: "100%",
  background: "#ef4444",
  border: "none",
  color: "white",
  padding: "16px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "bold"
};

const smallButtonStyle = {
  width: "100%",
  background: "#7c3aed",
  border: "none",
  color: "white",
  padding: "12px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "bold"
};

const tradeBoxStyle = {
  marginTop: "24px",
  paddingTop: "24px",
  borderTop: "1px solid rgba(255,255,255,0.12)"
};

const addressBoxStyle = {
  marginTop: "24px",
  fontSize: "13px",
  opacity: 0.65,
  wordBreak: "break-all"
};