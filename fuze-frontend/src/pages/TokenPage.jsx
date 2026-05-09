import { useEffect, useMemo, useState } from "react";
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

  const [buyAmount, setBuyAmount] = useState("0.1");
  const [sellAmount, setSellAmount] = useState("");

  const [buyLoading, setBuyLoading] = useState(false);
  const [sellLoading, setSellLoading] = useState(false);

  const [trades, setTrades] = useState([]);

  const chartData = useMemo(() => {
    return [...trades]
      .reverse()
      .filter(
        (trade) =>
          trade.price_after !== null && trade.price_after !== undefined
      )
      .map((trade, index) => ({
        trade: index + 1,
        price: Number(trade.price_after)
      }));
  }, [trades]);

  useEffect(() => {
    loadAll();

    const interval = setInterval(() => {
      loadAll();
    }, 5000);

    return () => clearInterval(interval);
  }, [poolAddress]);

  async function loadAll() {
    await Promise.all([loadTokenAndStats(), loadTrades()]);
  }

  async function loadTrades() {
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("pool_address", poolAddress)
        .order("created_at", { ascending: false })
        .limit(50);

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
      const soldNumber = Number(ethers.formatUnits(sold, 18));
      const priceNumber = Number(ethers.formatUnits(price, 18));

      const progress = Math.min(
        (reserveNumber / IGNITION_TARGET_MON) * 100,
        100
      );

      const marketCap = soldNumber * priceNumber;

      setPoolStats({
        price: priceNumber,
        reserve: reserveNumber,
        sold: soldNumber,
        ignited,
        progress,
        marketCap
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
    }
  }

  async function getPoolPriceAfter(poolContract) {
    const priceAfter = await poolContract.currentPrice();
    return ethers.formatUnits(priceAfter, 18);
  }

  async function buyToken() {
    if (!token) return;

    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    if (!buyAmount || Number(buyAmount) <= 0) {
      alert("Vul geldig bedrag in");
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
      const priceAfter = await getPoolPriceAfter(pool);

      await supabase.from("trades").insert({
        token_address: token.token,
        pool_address: token.pool,
        wallet_address: address,
        trade_type: "buy",
        mon_amount: buyAmount,
        price_after: priceAfter,
        tx_hash: receipt.hash
      });

      await loadAll();
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
      alert("Vul geldig bedrag in");
      return;
    }

    try {
      setSellLoading(true);

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const address = await signer.getAddress();

      setWallet(address);

      const tokenContract = new ethers.Contract(token.token, TOKEN_ABI, signer);
      const pool = new ethers.Contract(token.pool, POOL_ABI, signer);

      const amount = ethers.parseUnits(sellAmount, 18);

      const approveTx = await tokenContract.approve(token.pool, amount);
      await approveTx.wait();

      const sellTx = await pool.sell(amount, 0);
      const receipt = await sellTx.wait();

      const priceAfter = await getPoolPriceAfter(pool);

      await supabase.from("trades").insert({
        token_address: token.token,
        pool_address: token.pool,
        wallet_address: address,
        trade_type: "sell",
        token_amount: sellAmount,
        price_after: priceAfter,
        tx_hash: receipt.hash
      });

      setSellAmount("");

      await loadAll();
      await loadTokenBalance(token, address);

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
          <h1>Loading token...</h1>
        </div>
      </main>
    );
  }

  return (
    <main style={pageStyle}>
      <div style={bgGlowOne} />
      <div style={bgGlowTwo} />

      <div style={containerStyle}>
        <nav style={navStyle}>
          <div onClick={() => navigate("/")} style={brandStyle}>
            <img src="/logo.jpg" alt="Fuze" style={logoStyle} />

            <div>
              <div style={brandNameStyle}>FUZE</div>
              <div style={brandSubStyle}>Monad Launchpad</div>
            </div>
          </div>

          <button onClick={connectWallet} style={walletButtonStyle}>
            {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
          </button>
        </nav>

        <button onClick={() => navigate("/")} style={backButtonStyle}>
          ← Back
        </button>

        <section style={heroStyle}>
          <div style={leftStyle}>
            <div style={topHeaderStyle}>
              <div style={tokenInfoStyle}>
                <div style={tokenImageWrapStyle}>
                  {token.imageUrl ? (
                    <img src={token.imageUrl} alt={token.symbol} style={tokenImageStyle} />
                  ) : (
                    <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                  )}
                </div>

                <div>
                  <div style={statusBadgeStyle}>
                    {poolStats?.ignited ? "IGNITED 🔥" : "LIVE ⚡"}
                  </div>

                  <h1 style={tokenTitleStyle}>{token.symbol}</h1>
                  <p style={tokenNameStyle}>{token.name}</p>
                </div>
              </div>

              <div style={priceBlockStyle}>
                <div style={priceLabelStyle}>PRICE</div>

                <div style={priceValueStyle}>
                  {shortNum(poolStats?.price)} MON
                </div>

                <div style={mcapStyle}>
                  MCAP {shortNum(poolStats?.marketCap)} MON
                </div>
              </div>
            </div>

            {token.description && (
              <p style={descriptionStyle}>{token.description}</p>
            )}

            <div style={progressWrapStyle}>
              <div style={progressTopStyle}>
                <span>Bonding Progress</span>
                <strong>{poolStats?.progress.toFixed(2)}%</strong>
              </div>

              <div style={progressOuterStyle}>
                <div
                  style={{
                    ...progressInnerStyle,
                    width: `${poolStats?.progress}%`
                  }}
                />
              </div>
            </div>

            <div style={statsGridStyle}>
              <Stat label="Reserve" value={`${shortNum(poolStats?.reserve)} MON`} />
              <Stat label="Tokens Sold" value={shortNum(poolStats?.sold)} />
              <Stat label="Ignition" value={`${IGNITION_TARGET_MON} MON`} />
              <Stat label="Trades" value={trades.length} />
            </div>

            <div style={addressPanelStyle}>
              <Address label="CA" value={token.token} />
              <Address label="Pool" value={token.pool} />
              <Address label="Creator" value={token.creator} />
            </div>

            <div style={chartPanelStyle}>
              <div style={chartHeaderStyle}>
                <h2 style={chartTitleStyle}>Live Price Chart</h2>
                <div style={liveBadgeStyle}>LIVE</div>
              </div>

              <div style={{ width: "100%", height: 360 }}>
                <ResponsiveContainer>
                  <AreaChart data={chartData}>
                    <XAxis dataKey="trade" stroke="#8f8a9f" />
                    <YAxis stroke="#8f8a9f" domain={["auto", "auto"]} />

                    <Tooltip
                      formatter={(value) => [`${value} MON`, "Price"]}
                      contentStyle={{
                        background: "#111118",
                        border: "1px solid rgba(192,132,252,0.25)",
                        borderRadius: "12px",
                        color: "white"
                      }}
                    />

                    <Area
                      type="monotone"
                      dataKey="price"
                      stroke="#c084fc"
                      fill="rgba(192,132,252,0.22)"
                      strokeWidth={3}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={tradesPanelStyle}>
              <div style={chartHeaderStyle}>
                <h2 style={chartTitleStyle}>Recent Trades</h2>
                <div style={liveBadgeStyle}>{trades.length}</div>
              </div>

              {trades.length === 0 && (
                <p style={{ color: "#8f8a9f" }}>No trades yet.</p>
              )}

              {trades.map((trade) => (
                <div key={trade.id} style={tradeRowStyle}>
                  <div>
                    <div
                      style={{
                        ...tradeTypeStyle,
                        color: trade.trade_type === "buy" ? "#86efac" : "#fca5a5"
                      }}
                    >
                      {trade.trade_type.toUpperCase()}
                    </div>

                    <div style={walletTextStyle}>
                      {trade.wallet_address.slice(0, 6)}...
                      {trade.wallet_address.slice(-4)}
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div style={tradeAmountStyle}>
                      {trade.trade_type === "buy"
                        ? `${trade.mon_amount} MON`
                        : `${trade.token_amount} ${token.symbol}`}
                    </div>

                    <div style={walletTextStyle}>
                      {shortNum(trade.price_after)} MON
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside style={tradePanelStyle}>
            <div style={tradeTitleWrapStyle}>
              <h2 style={tradeTitleStyle}>Trade {token.symbol}</h2>
              <p style={tradeSubStyle}>Buy and sell instantly.</p>
            </div>

            <div style={balanceBoxStyle}>
              <span>Your Balance</span>
              <strong>
                {Number(tokenBalance).toLocaleString()} {token.symbol}
              </strong>
            </div>

            <div style={tradeBoxStyle}>
              <div style={tradeLabelStyle}>Buy with MON</div>

              <div style={presetWrapStyle}>
                {["0.1", "0.5", "1", "2"].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBuyAmount(amount)}
                    style={presetButtonStyle}
                  >
                    {amount} MON
                  </button>
                ))}
              </div>

              <input
                value={buyAmount}
                onChange={(e) => setBuyAmount(e.target.value)}
                placeholder="0.1"
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
                {buyLoading ? "Buying..." : "Buy"}
              </button>
            </div>

            <div style={tradeBoxStyle}>
              <div style={tradeLabelStyle}>Sell Tokens</div>

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
                {sellLoading ? "Selling..." : "Sell"}
              </button>
            </div>

            <div style={linksWrapStyle}>
              {token.website && (
                <a href={token.website} target="_blank" rel="noreferrer" style={linkButtonStyle}>
                  Website
                </a>
              )}

              {token.telegram && (
                <a href={token.telegram} target="_blank" rel="noreferrer" style={linkButtonStyle}>
                  Telegram
                </a>
              )}

              {token.twitter && (
                <a href={token.twitter} target="_blank" rel="noreferrer" style={linkButtonStyle}>
                  Twitter
                </a>
              )}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value }) {
  return (
    <div style={statStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Address({ label, value }) {
  async function copyAddress() {
    try {
      await navigator.clipboard.writeText(value);
      alert(`${label} copied`);
    } catch {
      alert("Copy failed");
    }
  }

  if (!value) return null;

  return (
    <div style={addressRowStyle}>
      <div>
        <span style={addressLabelStyle}>{label}</span>
        <div style={addressFullStyle}>{value}</div>
      </div>

      <button onClick={copyAddress} style={addressButtonStyle}>
        Copy
      </button>
    </div>
  );
}

function shortNum(value) {
  if (!value) return "0";

  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  if (n < 0.000001 && n > 0) return n.toExponential(2);

  return n.toLocaleString(undefined, {
    maximumFractionDigits: 8
  });
}

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, #2b0b4f 0%, #08070d 35%, #030305 100%)",
  padding: "28px",
  color: "white",
  position: "relative",
  overflow: "hidden"
};

const bgGlowOne = {
  position: "fixed",
  width: "520px",
  height: "520px",
  top: "-160px",
  right: "-100px",
  background: "rgba(168,85,247,0.28)",
  filter: "blur(120px)"
};

const bgGlowTwo = {
  position: "fixed",
  width: "420px",
  height: "420px",
  bottom: "-140px",
  left: "-120px",
  background: "rgba(124,58,237,0.22)",
  filter: "blur(120px)"
};

const containerStyle = {
  maxWidth: "1380px",
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const navStyle = {
  height: "76px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 18px",
  borderRadius: "24px",
  background: "rgba(10,10,18,0.72)",
  border: "1px solid rgba(192,132,252,0.18)",
  backdropFilter: "blur(18px)"
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
  objectFit: "cover"
};

const brandNameStyle = {
  fontSize: "24px",
  fontWeight: "900"
};

const brandSubStyle = {
  fontSize: "12px",
  color: "#c4b5fd"
};

const walletButtonStyle = {
  background: "linear-gradient(135deg, #7c3aed, #c084fc)",
  border: "none",
  color: "white",
  padding: "13px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "900"
};

const backButtonStyle = {
  marginTop: "22px",
  marginBottom: "20px",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.12)",
  color: "#ddd6fe",
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer"
};

const heroStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 390px",
  gap: "24px"
};

const leftStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "22px"
};

const topHeaderStyle = {
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.08), rgba(255,255,255,0.03))",
  border: "1px solid rgba(192,132,252,0.18)",
  borderRadius: "30px",
  padding: "28px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "20px"
};

const tokenInfoStyle = {
  display: "flex",
  alignItems: "center",
  gap: "22px"
};

const tokenImageWrapStyle = {
  width: "120px",
  height: "120px",
  borderRadius: "28px",
  overflow: "hidden",
  background: "rgba(168,85,247,0.16)"
};

const tokenImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const fallbackStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
  fontSize: "34px",
  fontWeight: "900"
};

const statusBadgeStyle = {
  display: "inline-block",
  marginBottom: "12px",
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(168,85,247,0.16)",
  color: "#d8b4fe",
  fontWeight: "900",
  fontSize: "12px"
};

const tokenTitleStyle = {
  fontSize: "68px",
  margin: 0,
  lineHeight: 1,
  fontWeight: "1000"
};

const tokenNameStyle = {
  color: "#a5a0b8",
  marginTop: "10px",
  fontSize: "18px"
};

const priceBlockStyle = {
  textAlign: "right"
};

const priceLabelStyle = {
  color: "#a5a0b8",
  fontSize: "12px",
  marginBottom: "8px"
};

const priceValueStyle = {
  fontSize: "42px",
  fontWeight: "1000"
};

const mcapStyle = {
  marginTop: "10px",
  color: "#c084fc",
  fontWeight: "900"
};

const descriptionStyle = {
  color: "#b8b4c7",
  lineHeight: 1.6,
  fontSize: "17px"
};

const progressWrapStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "24px",
  padding: "22px"
};

const progressTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "12px"
};

const progressOuterStyle = {
  height: "16px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden"
};

const progressInnerStyle = {
  height: "100%",
  background: "linear-gradient(90deg,#7c3aed,#c084fc)",
  boxShadow: "0 0 24px rgba(192,132,252,0.8)"
};

const statsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "16px"
};

const statStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "22px",
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: "10px"
};

const addressPanelStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "24px",
  padding: "18px",
  display: "grid",
  gap: "12px"
};

const addressRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "14px",
  background: "rgba(0,0,0,0.18)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px",
  padding: "12px 14px"
};

const addressLabelStyle = {
  display: "block",
  color: "#c084fc",
  fontSize: "12px",
  fontWeight: "900",
  marginBottom: "5px"
};

const addressFullStyle = {
  color: "#d6d3e4",
  fontSize: "13px",
  wordBreak: "break-all"
};

const addressButtonStyle = {
  background: "rgba(168,85,247,0.14)",
  border: "1px solid rgba(192,132,252,0.22)",
  color: "#e9d5ff",
  padding: "9px 13px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "900",
  flexShrink: 0
};

const chartPanelStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "28px",
  padding: "24px"
};

const chartHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "18px"
};

const chartTitleStyle = {
  margin: 0,
  fontSize: "26px"
};

const liveBadgeStyle = {
  padding: "8px 12px",
  borderRadius: "999px",
  background: "rgba(168,85,247,0.16)",
  color: "#d8b4fe",
  fontWeight: "900",
  fontSize: "12px"
};

const tradesPanelStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "28px",
  padding: "24px"
};

const tradeRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "14px 0",
  borderTop: "1px solid rgba(255,255,255,0.08)"
};

const tradeTypeStyle = {
  fontWeight: "900"
};

const walletTextStyle = {
  color: "#8f8a9f",
  fontSize: "13px",
  marginTop: "5px"
};

const tradeAmountStyle = {
  fontWeight: "800"
};

const tradePanelStyle = {
  position: "sticky",
  top: "24px",
  alignSelf: "start",
  background:
    "linear-gradient(180deg, rgba(168,85,247,0.12), rgba(255,255,255,0.04))",
  border: "1px solid rgba(192,132,252,0.18)",
  borderRadius: "28px",
  padding: "24px",
  boxShadow: "0 0 60px rgba(168,85,247,0.16)"
};

const tradeTitleWrapStyle = {
  marginBottom: "18px"
};

const tradeTitleStyle = {
  fontSize: "32px",
  margin: 0
};

const tradeSubStyle = {
  color: "#9c96af",
  marginTop: "8px"
};

const balanceBoxStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  padding: "18px",
  display: "flex",
  justifyContent: "space-between"
};

const tradeBoxStyle = {
  marginTop: "22px"
};

const tradeLabelStyle = {
  marginBottom: "12px",
  fontWeight: "900"
};

const presetWrapStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4,1fr)",
  gap: "10px",
  marginBottom: "12px"
};

const presetButtonStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "white",
  padding: "10px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "700"
};

const inputStyle = {
  width: "100%",
  padding: "15px 16px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  marginBottom: "12px",
  outline: "none"
};

const buyButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg,#7c3aed,#c084fc)",
  border: "none",
  color: "white",
  padding: "16px",
  borderRadius: "16px",
  fontWeight: "900",
  cursor: "pointer"
};

const sellButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg,#ef4444,#f97316)",
  border: "none",
  color: "white",
  padding: "16px",
  borderRadius: "16px",
  fontWeight: "900",
  cursor: "pointer"
};

const linksWrapStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "10px",
  marginTop: "24px"
};

const linkButtonStyle = {
  textDecoration: "none",
  color: "#ddd6fe",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(192,132,252,0.18)",
  padding: "12px 14px",
  borderRadius: "14px",
  fontWeight: "800"
};