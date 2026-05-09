import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ethers } from "ethers";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer
} from "recharts";

import {
  FACTORY_ADDRESS,
  FACTORY_READ_ABI,
  POOL_ABI,
  TOKEN_ABI,
  IGNITION_TARGET_MON
} from "../lib/contracts";

import { supabase } from "../lib/supabase";

const RPC_URL = "https://testnet-rpc.monad.xyz";

export default function TokenPage() {
  const { poolAddress } = useParams();
  const navigate = useNavigate();

  const [token, setToken] = useState(null);
  const [poolStats, setPoolStats] = useState(null);
  const [wallet, setWallet] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [trades, setTrades] = useState([]);

  const [buyAmount, setBuyAmount] = useState("0.01");
  const [sellAmount, setSellAmount] = useState("");

  const [buyLoading, setBuyLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);

  const chartData = [...trades]
    .reverse()
    .map((trade, index) => ({
      name: `${index + 1}`,
      volume:
        trade.trade_type === "buy"
          ? Number(trade.mon_amount || 0)
          : Number(trade.token_amount || 0) / 100000,
      type: trade.trade_type
    }));

  useEffect(() => {
    loadTokenAndStats();
    loadTrades();

    const interval = setInterval(() => {
      loadTokenAndStats();
      loadTrades();
    }, 5000);

    return () => clearInterval(interval);
  }, [poolAddress]);

  async function loadTrades() {
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("pool_address", poolAddress)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      setTrades(data || []);
    } catch (err) {
      console.error(err);
    }
  }

  async function loadTokenAndStats() {
    try {
      let found = null;

      const { data } = await supabase
        .from("tokens")
        .select("*")
        .eq("pool_address", poolAddress)
        .maybeSingle();

      if (data) {
        found = {
          token: data.token_address,
          pool: data.pool_address,
          creator: data.creator_address,
          name: data.name,
          symbol: data.symbol,
          description: data.description,
          imageUrl: data.image_url,
          website: data.website,
          telegram: data.telegram,
          twitter: data.twitter
        };
      }

      if (!found) {
        const provider = new ethers.JsonRpcProvider(RPC_URL);
        const factory = new ethers.Contract(
          FACTORY_ADDRESS,
          FACTORY_READ_ABI,
          provider
        );

        const total = await factory.totalTokens();

        for (let i = 0; i < Number(total); i++) {
          const item = await factory.allTokens(i);

          if (item.pool.toLowerCase() === poolAddress.toLowerCase()) {
            found = {
              token: item.token,
              pool: item.pool,
              creator: item.creator,
              name: item.name,
              symbol: item.symbol
            };
            break;
          }
        }
      }

      if (!found) {
        setToken(null);
        return;
      }

      setToken(found);

      const provider = new ethers.JsonRpcProvider(RPC_URL);
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

  async function connectWallet() {
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

      const receipt = await tx.wait();

      await supabase.from("trades").insert({
        token_address: token.token,
        pool_address: token.pool,
        wallet_address: address,
        trade_type: "buy",
        mon_amount: buyAmount,
        tx_hash: receipt.hash
      });

      await loadTokenAndStats();
      await loadTokenBalance(token, address);
      await loadTrades();

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
      const receipt = await sellTx.wait();

      await supabase.from("trades").insert({
        token_address: token.token,
        pool_address: token.pool,
        wallet_address: address,
        trade_type: "sell",
        token_amount: sellAmount,
        tx_hash: receipt.hash
      });

      setSellAmount("");

      await loadTokenAndStats();
      await loadTokenBalance(token, address);
      await loadTrades();

      alert("Sell complete!");
    } catch (err) {
      console.error(err);
      alert(err?.reason || err?.message || "Sell failed");
    } finally {
      setSellLoading(false);
    }
  }

  if (!token) {
    return (
      <main style={pageStyle}>
        <div style={containerStyle}>
          <TopNav
            navigate={navigate}
            wallet={wallet}
            connectWallet={connectWallet}
          />
          <section style={panelStyle}>
            <h1>Token not found</h1>
            <p style={{ color: "#a5a0b8" }}>{poolAddress}</p>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={glowOne} />
      <div style={glowTwo} />

      <div style={containerStyle}>
        <TopNav
          navigate={navigate}
          wallet={wallet}
          connectWallet={connectWallet}
        />

        <button onClick={() => navigate("/")} style={backButtonStyle}>
          ← Back to launches
        </button>

        <section style={heroGridStyle}>
          <div style={leftPanelStyle}>
            <div style={tokenHeaderStyle}>
              <div style={tokenImageWrapStyle}>
                {token.imageUrl ? (
                  <img
                    src={token.imageUrl}
                    alt={token.symbol}
                    style={tokenImageStyle}
                  />
                ) : (
                  <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                )}
              </div>

              <div>
                <div style={statusBadgeStyle}>
                  {poolStats?.ignited ? "IGNITED 🔥" : "BONDING ⚡"}
                </div>

                <h1 style={tokenTitleStyle}>{token.symbol}</h1>
                <p style={tokenNameStyle}>{token.name}</p>
              </div>
            </div>

            {token.description && (
              <p style={descriptionStyle}>{token.description}</p>
            )}

            <div style={progressBlockStyle}>
              <div style={progressTopStyle}>
                <span>Bonding progress</span>
                <strong>
                  {poolStats ? `${poolStats.progress.toFixed(2)}%` : "-"}
                </strong>
              </div>

              <div style={progressOuterStyle}>
                <div
                  style={{
                    ...progressInnerStyle,
                    width: `${poolStats?.progress || 0}%`
                  }}
                />
              </div>
            </div>

            <div style={statsGridStyle}>
              <Stat label="Price" value={`${shortNum(poolStats?.price)} MON`} />
              <Stat
                label="Reserve"
                value={`${shortNum(poolStats?.reserve)} MON`}
              />
              <Stat label="Tokens Sold" value={shortNum(poolStats?.sold)} />
              <Stat
                label="Ignition Target"
                value={`${IGNITION_TARGET_MON} MON`}
              />
            </div>

            <div style={linksRowStyle}>
              {token.website && (
                <a
                  href={token.website}
                  target="_blank"
                  rel="noreferrer"
                  style={linkButtonStyle}
                >
                  Website
                </a>
              )}
              {token.telegram && (
                <a
                  href={token.telegram}
                  target="_blank"
                  rel="noreferrer"
                  style={linkButtonStyle}
                >
                  Telegram
                </a>
              )}
              {token.twitter && (
                <a
                  href={token.twitter}
                  target="_blank"
                  rel="noreferrer"
                  style={linkButtonStyle}
                >
                  X / Twitter
                </a>
              )}
            </div>

            <div style={addressPanelStyle}>
              <Address label="Token" value={token.token} />
              <Address label="Pool" value={token.pool} />
              <Address label="Creator" value={token.creator} />
            </div>

            <div style={chartPanelStyle}>
              <div style={tradesHeaderStyle}>
                <h2 style={tradesTitleStyle}>Live Activity Chart</h2>
                <span style={tradesCountStyle}>LIVE</span>
              </div>

              {chartData.length === 0 ? (
                <p style={emptyTradesStyle}>No chart data yet.</p>
              ) : (
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData}>
                      <XAxis dataKey="name" stroke="#8f8a9f" />
                      <YAxis stroke="#8f8a9f" />
                      <Tooltip
                        contentStyle={{
                          background: "#111118",
                          border: "1px solid rgba(192,132,252,0.25)",
                          borderRadius: "12px",
                          color: "white"
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="volume"
                        stroke="#c084fc"
                        fill="rgba(192,132,252,0.22)"
                        strokeWidth={3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div style={tradesPanelStyle}>
              <div style={tradesHeaderStyle}>
                <h2 style={tradesTitleStyle}>Recent Trades</h2>
                <span style={tradesCountStyle}>{trades.length}</span>
              </div>

              {trades.length === 0 && (
                <p style={emptyTradesStyle}>No trades yet.</p>
              )}

              {trades.map((trade) => (
                <div key={trade.id} style={tradeRowStyle}>
                  <div>
                    <strong
                      style={{
                        color:
                          trade.trade_type === "buy" ? "#86efac" : "#fca5a5"
                      }}
                    >
                      {trade.trade_type.toUpperCase()}
                    </strong>
                    <p style={tradeWalletStyle}>
                      {trade.wallet_address.slice(0, 6)}...
                      {trade.wallet_address.slice(-4)}
                    </p>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <strong>
                      {trade.trade_type === "buy"
                        ? `${trade.mon_amount} MON`
                        : `${trade.token_amount} ${token.symbol}`}
                    </strong>
                    <p style={tradeWalletStyle}>
                      {new Date(trade.created_at).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside style={tradePanelStyle}>
            <div style={tradeHeaderStyle}>
              <div>
                <h2 style={tradeTitleStyle}>Trade {token.symbol}</h2>
                <p style={tradeSubStyle}>Buy or sell through the FUZE pool.</p>
              </div>
            </div>

            <button onClick={connectWallet} style={walletButtonStyle}>
              {wallet
                ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
                : "Connect Wallet"}
            </button>

            <div style={balanceBoxStyle}>
              <span>Your balance</span>
              <strong>
                {Number(tokenBalance).toLocaleString()} {token.symbol}
              </strong>
            </div>

            <div style={tradeBoxStyle}>
              <div style={tradeLabelStyle}>Buy with MON</div>

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
                  ...buyButtonStyle,
                  opacity: buyLoading || poolStats?.ignited ? 0.5 : 1
                }}
              >
                {poolStats?.ignited
                  ? "Bonding finished"
                  : buyLoading
                    ? "Buying..."
                    : "Buy"}
              </button>
            </div>

            <div style={tradeBoxStyle}>
              <div style={tradeLabelStyle}>Sell tokens</div>

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
                    : "Sell"}
              </button>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function TopNav({ navigate, wallet, connectWallet }) {
  return (
    <nav style={navStyle}>
      <div onClick={() => navigate("/")} style={brandStyle}>
        <img src="/logo.jpg" alt="Fuze" style={logoStyle} />
        <div>
          <div style={brandNameStyle}>FUZE</div>
          <div style={brandSubStyle}>Monad Launchpad</div>
        </div>
      </div>

      <button onClick={connectWallet} style={navWalletStyle}>
        {wallet
          ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}`
          : "Connect Wallet"}
      </button>
    </nav>
  );
}

function Stat({ label, value }) {
  return (
    <div style={statStyle}>
      <span>{label}</span>
      <strong>{value || "-"}</strong>
    </div>
  );
}

function Address({ label, value }) {
  async function copy() {
    await navigator.clipboard.writeText(value);
    alert(`${label} copied`);
  }

  return (
    <div style={addressRowStyle}>
      <span>{label}</span>
      <button onClick={copy} style={addressButtonStyle}>
        {value.slice(0, 8)}...{value.slice(-6)}
      </button>
    </div>
  );
}

function shortNum(value) {
  if (!value) return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n < 0.000001 && n > 0) return n.toExponential(2);
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

const pageStyle = {
  minHeight: "100vh",
  position: "relative",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, #2b0b4f 0%, #08070d 34%, #030305 100%)",
  color: "white",
  fontFamily: "Inter, Arial, sans-serif",
  padding: "28px"
};

const glowOne = {
  position: "fixed",
  width: "520px",
  height: "520px",
  top: "-140px",
  right: "-120px",
  background: "rgba(168,85,247,0.28)",
  filter: "blur(120px)",
  pointerEvents: "none"
};

const glowTwo = {
  position: "fixed",
  width: "440px",
  height: "440px",
  bottom: "-150px",
  left: "-120px",
  background: "rgba(124,58,237,0.22)",
  filter: "blur(120px)",
  pointerEvents: "none"
};

const containerStyle = {
  maxWidth: "1280px",
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const navStyle = {
  height: "76px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "rgba(10,10,18,0.72)",
  border: "1px solid rgba(192,132,252,0.18)",
  borderRadius: "24px",
  padding: "10px 18px",
  backdropFilter: "blur(18px)",
  boxShadow: "0 0 40px rgba(168,85,247,0.12)",
  marginBottom: "28px"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "14px",
  cursor: "pointer"
};

const logoStyle = {
  width: "52px",
  height: "52px",
  borderRadius: "16px",
  objectFit: "cover",
  boxShadow: "0 0 28px rgba(168,85,247,0.55)"
};

const brandNameStyle = {
  fontSize: "24px",
  fontWeight: "900",
  letterSpacing: "1px"
};

const brandSubStyle = {
  fontSize: "12px",
  color: "#c4b5fd"
};

const navWalletStyle = {
  background: "linear-gradient(135deg, #7c3aed, #c084fc)",
  border: "none",
  color: "white",
  padding: "13px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "900",
  boxShadow: "0 0 24px rgba(168,85,247,0.45)"
};

const backButtonStyle = {
  marginBottom: "20px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#ddd6fe",
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "800"
};

const heroGridStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 420px",
  gap: "24px",
  alignItems: "start"
};

const panelStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(192,132,252,0.16)",
  borderRadius: "28px",
  padding: "28px"
};

const leftPanelStyle = {
  ...panelStyle,
  minHeight: "620px"
};

const tradePanelStyle = {
  ...panelStyle,
  position: "sticky",
  top: "24px",
  boxShadow: "0 0 70px rgba(168,85,247,0.13)"
};

const tokenHeaderStyle = {
  display: "flex",
  alignItems: "center",
  gap: "22px"
};

const tokenImageWrapStyle = {
  width: "116px",
  height: "116px",
  borderRadius: "28px",
  overflow: "hidden",
  background: "rgba(168,85,247,0.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 0 36px rgba(168,85,247,0.3)"
};

const tokenImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const fallbackStyle = {
  fontWeight: "950",
  fontSize: "34px",
  color: "#e9d5ff"
};

const statusBadgeStyle = {
  display: "inline-block",
  fontSize: "12px",
  fontWeight: "900",
  color: "#d8b4fe",
  border: "1px solid rgba(192,132,252,0.22)",
  background: "rgba(168,85,247,0.14)",
  padding: "8px 10px",
  borderRadius: "999px",
  marginBottom: "12px"
};

const tokenTitleStyle = {
  fontSize: "64px",
  lineHeight: "0.95",
  margin: 0,
  fontWeight: "1000",
  letterSpacing: "-3px"
};

const tokenNameStyle = {
  color: "#c7c2d5",
  fontSize: "20px",
  marginTop: "10px"
};

const descriptionStyle = {
  marginTop: "28px",
  maxWidth: "760px",
  color: "#aaa4bc",
  fontSize: "18px",
  lineHeight: "1.55"
};

const progressBlockStyle = {
  marginTop: "34px",
  padding: "22px",
  borderRadius: "22px",
  background: "rgba(0,0,0,0.22)",
  border: "1px solid rgba(255,255,255,0.08)"
};

const progressTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "12px",
  color: "#ddd6fe"
};

const progressOuterStyle = {
  height: "18px",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "999px",
  overflow: "hidden"
};

const progressInnerStyle = {
  height: "100%",
  background: "linear-gradient(90deg, #7c3aed, #a855f7, #c084fc)",
  boxShadow: "0 0 24px rgba(192,132,252,0.8)"
};

const statsGridStyle = {
  marginTop: "22px",
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "14px"
};

const statStyle = {
  background: "rgba(0,0,0,0.24)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "20px",
  padding: "18px",
  display: "flex",
  flexDirection: "column",
  gap: "8px"
};

const linksRowStyle = {
  display: "flex",
  gap: "12px",
  marginTop: "24px",
  flexWrap: "wrap"
};

const linkButtonStyle = {
  textDecoration: "none",
  color: "#ddd6fe",
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(192,132,252,0.18)",
  padding: "12px 14px",
  borderRadius: "14px",
  fontWeight: "800"
};

const addressPanelStyle = {
  marginTop: "24px",
  display: "grid",
  gap: "10px"
};

const addressRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "12px 14px",
  color: "#9993aa"
};

const addressButtonStyle = {
  background: "transparent",
  border: "none",
  color: "#c084fc",
  cursor: "pointer",
  fontWeight: "900"
};

const chartPanelStyle = {
  marginTop: "24px",
  background: "rgba(0,0,0,0.22)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "22px",
  padding: "18px"
};

const tradesPanelStyle = {
  marginTop: "24px",
  background: "rgba(0,0,0,0.22)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "22px",
  padding: "18px"
};

const tradesHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "14px"
};

const tradesTitleStyle = {
  margin: 0,
  fontSize: "24px"
};

const tradesCountStyle = {
  color: "#c084fc",
  fontWeight: "900"
};

const emptyTradesStyle = {
  color: "#9993aa"
};

const tradeRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)"
};

const tradeWalletStyle = {
  color: "#9993aa",
  marginTop: "4px",
  fontSize: "13px"
};

const tradeHeaderStyle = {
  marginBottom: "18px"
};

const tradeTitleStyle = {
  fontSize: "30px",
  margin: 0
};

const tradeSubStyle = {
  color: "#9993aa",
  marginTop: "6px"
};

const walletButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg, #7c3aed, #c084fc)",
  border: "none",
  color: "white",
  padding: "15px",
  borderRadius: "16px",
  cursor: "pointer",
  fontWeight: "900",
  boxShadow: "0 0 24px rgba(168,85,247,0.35)"
};

const balanceBoxStyle = {
  marginTop: "16px",
  background: "rgba(0,0,0,0.22)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "16px",
  display: "flex",
  justifyContent: "space-between",
  gap: "10px",
  color: "#bdb7cd"
};

const tradeBoxStyle = {
  marginTop: "18px",
  paddingTop: "18px",
  borderTop: "1px solid rgba(255,255,255,0.1)"
};

const tradeLabelStyle = {
  fontWeight: "900",
  marginBottom: "10px",
  color: "#e9d5ff"
};

const inputStyle = {
  width: "100%",
  padding: "15px 16px",
  marginBottom: "12px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};

const buyButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg, #7c3aed, #a855f7)",
  border: "none",
  color: "white",
  padding: "15px",
  borderRadius: "16px",
  cursor: "pointer",
  fontWeight: "900"
};

const sellButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg, #ef4444, #f97316)",
  border: "none",
  color: "white",
  padding: "15px",
  borderRadius: "16px",
  cursor: "pointer",
  fontWeight: "900"
};