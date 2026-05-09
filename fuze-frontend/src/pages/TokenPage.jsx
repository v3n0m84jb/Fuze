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
      .filter((trade) => trade.price_after !== null && trade.price_after !== undefined)
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
        .limit(60);

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

      const priceNumber = Number(ethers.formatUnits(price, 18));
      const reserveNumber = Number(ethers.formatEther(reserve));
      const soldNumber = Number(ethers.formatUnits(sold, 18));

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
      setTokenBalance("0");
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

          <div style={navActionsStyle}>
            <button onClick={() => navigate("/")} style={navButtonStyle}>
              Terminal
            </button>

            <button onClick={connectWallet} style={createButtonStyle}>
              {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect"}
            </button>
          </div>
        </nav>

        <button onClick={() => navigate("/")} style={backButtonStyle}>
          ← Back to launches
        </button>

        <section style={layoutStyle}>
          <div style={mainColumnStyle}>
            <div style={tokenHeroStyle}>
              <div style={tokenImageBoxStyle}>
                {token.imageUrl ? (
                  <img src={token.imageUrl} alt={token.symbol} style={tokenImageStyle} />
                ) : (
                  <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                )}
              </div>

              <div style={tokenInfoStyle}>
                <div style={badgeRowStyle}>
                  <span style={symbolBadgeStyle}>{token.symbol}</span>

                  <span style={statusBadgeStyle}>
                    {poolStats?.ignited ? "IGNITED" : "BONDING"}
                  </span>
                </div>

                <h1 style={titleStyle}>{token.name}</h1>

                {token.description && (
                  <p style={descStyle}>{token.description}</p>
                )}

                <div style={linkRowStyle}>
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
                      X
                    </a>
                  )}
                </div>
              </div>

              <div style={priceBoxStyle}>
                <span>PRICE</span>
                <strong>{shortNum(poolStats?.price)} MON</strong>
                <small>MC {shortNum(poolStats?.marketCap)} MON</small>
              </div>
            </div>

            <div style={statsGridStyle}>
              <Stat label="Market Cap" value={`${shortNum(poolStats?.marketCap)} MON`} />
              <Stat label="Reserve" value={`${shortNum(poolStats?.reserve)} MON`} />
              <Stat label="Tokens Sold" value={shortNum(poolStats?.sold)} />
              <Stat label="Trades" value={trades.length} />
            </div>

            <div style={bondingPanelStyle}>
              <div style={bondingTopStyle}>
                <span>Bonding Progress</span>
                <strong>{poolStats?.progress?.toFixed(2) || "0.00"}%</strong>
              </div>

              <div style={progressOuterStyle}>
                <div
                  style={{
                    ...progressInnerStyle,
                    width: `${poolStats?.progress || 0}%`
                  }}
                />
              </div>

              <div style={bondingBottomStyle}>
                <span>0 MON</span>
                <span>{IGNITION_TARGET_MON} MON ignition</span>
              </div>
            </div>

            <div style={addressPanelStyle}>
              <Address label="CA" value={token.token} />
              <Address label="Pool" value={token.pool} />
              <Address label="Creator" value={token.creator} />
            </div>

            <div style={chartPanelStyle}>
              <div style={panelHeaderStyle}>
                <h2>Price Chart</h2>
                <span>LIVE</span>
              </div>

              {chartData.length === 0 ? (
                <p style={emptyTextStyle}>No chart data yet.</p>
              ) : (
                <div style={{ width: "100%", height: 390 }}>
                  <ResponsiveContainer>
                    <AreaChart data={chartData}>
                      <XAxis dataKey="trade" stroke="#777" />
                      <YAxis stroke="#777" domain={["auto", "auto"]} />

                      <Tooltip
                        formatter={(value) => [`${value} MON`, "Price"]}
                        contentStyle={{
                          background: "#08080a",
                          border: "1px solid rgba(192,132,252,0.25)",
                          borderRadius: "10px",
                          color: "white"
                        }}
                      />

                      <Area
                        type="monotone"
                        dataKey="price"
                        stroke="#8b5cf6"
                        fill="rgba(139,92,246,0.18)"
                        strokeWidth={3}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            <div style={tradesPanelStyle}>
              <div style={panelHeaderStyle}>
                <h2>Recent Trades</h2>
                <span>{trades.length}</span>
              </div>

              {trades.length === 0 && (
                <p style={emptyTextStyle}>No trades yet.</p>
              )}

              {trades.map((trade) => (
                <div key={trade.id} style={tradeRowStyle}>
                  <div style={tradeLeftStyle}>
                    <div
                      style={{
                        ...tradeDotStyle,
                        background: trade.trade_type === "buy" ? "#22c55e" : "#ef4444"
                      }}
                    />

                    <div>
                      <strong
                        style={{
                          color: trade.trade_type === "buy" ? "#22c55e" : "#ef4444"
                        }}
                      >
                        {trade.trade_type === "buy" ? "BUY" : "SELL"}
                      </strong>

                      <p>
                        {trade.wallet_address.slice(0, 6)}...
                        {trade.wallet_address.slice(-4)}
                      </p>
                    </div>
                  </div>

                  <div style={tradeRightStyle}>
                    <strong>
                      {trade.trade_type === "buy"
                        ? `${shortNum(trade.mon_amount)} MON`
                        : `${shortNum(trade.token_amount)} ${token.symbol}`}
                    </strong>

                    <p>{shortNum(trade.price_after)} MON</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <aside style={tradePanelStyle}>
            <h2 style={tradeTitleStyle}>Trade {token.symbol}</h2>

            <button onClick={connectWallet} style={walletButtonStyle}>
              {wallet ? `${wallet.slice(0, 6)}...${wallet.slice(-4)}` : "Connect Wallet"}
            </button>

            <div style={balanceStyle}>
              <span>Your Balance</span>
              <strong>
                {Number(tokenBalance).toLocaleString()} {token.symbol}
              </strong>
            </div>

            <div style={boxStyle}>
              <div style={labelStyle}>Buy with MON</div>

              <div style={presetGridStyle}>
                {["0.1", "0.5", "1", "2"].map((amount) => (
                  <button
                    key={amount}
                    onClick={() => setBuyAmount(amount)}
                    style={presetButtonStyle}
                  >
                    {amount}
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
                  opacity: buyLoading || poolStats?.ignited ? 0.55 : 1
                }}
              >
                {poolStats?.ignited ? "Bonding Finished" : buyLoading ? "Buying..." : "Buy"}
              </button>
            </div>

            <div style={boxStyle}>
              <div style={labelStyle}>Sell tokens</div>

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
                  opacity: sellLoading || poolStats?.ignited ? 0.55 : 1
                }}
              >
                {poolStats?.ignited ? "Bonding Finished" : sellLoading ? "Selling..." : "Sell"}
              </button>
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
        <span>{label}</span>
        <strong>{value}</strong>
      </div>

      <button onClick={copyAddress} style={copyButtonStyle}>
        Copy
      </button>
    </div>
  );
}

function shortNum(value) {
  if (!value) return "0";

  const n = Number(value);

  if (!Number.isFinite(n)) return value;

  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 0.000001 && n > 0) return n.toExponential(2);

  return n.toLocaleString(undefined, {
    maximumFractionDigits: 8
  });
}

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, #170627 0%, #050507 34%, #030304 100%)",
  padding: "22px 30px 60px",
  color: "white",
  position: "relative",
  overflow: "hidden",
  fontFamily: "Inter, Arial, sans-serif"
};

const bgGlowOne = {
  position: "fixed",
  width: "620px",
  height: "620px",
  top: "-220px",
  right: "-160px",
  background: "rgba(168,85,247,0.2)",
  filter: "blur(130px)",
  pointerEvents: "none"
};

const bgGlowTwo = {
  position: "fixed",
  width: "520px",
  height: "520px",
  bottom: "-180px",
  left: "-160px",
  background: "rgba(124,58,237,0.16)",
  filter: "blur(130px)",
  pointerEvents: "none"
};

const containerStyle = {
  maxWidth: "1840px",
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const navStyle = {
  height: "66px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "18px"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  cursor: "pointer"
};

const logoStyle = {
  width: "46px",
  height: "46px",
  borderRadius: "14px",
  objectFit: "cover"
};

const brandNameStyle = {
  fontSize: "26px",
  fontWeight: "1000",
  letterSpacing: "1px"
};

const brandSubStyle = {
  color: "#a7a1b8",
  fontSize: "12px",
  marginTop: "1px"
};

const navActionsStyle = {
  display: "flex",
  gap: "10px",
  alignItems: "center"
};

const navButtonStyle = {
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#d8d4e5",
  padding: "11px 15px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "800"
};

const createButtonStyle = {
  background: "linear-gradient(135deg,#7c3aed,#c084fc)",
  border: "none",
  color: "white",
  padding: "12px 17px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "950"
};

const backButtonStyle = {
  marginBottom: "18px",
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#d8d4e5",
  padding: "11px 15px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "800"
};

const layoutStyle = {
  display: "grid",
  gridTemplateColumns: "1fr 390px",
  gap: "22px",
  alignItems: "start"
};

const mainColumnStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "18px"
};

const tokenHeroStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "18px",
  padding: "16px",
  display: "grid",
  gridTemplateColumns: "150px 1fr auto",
  gap: "18px",
  alignItems: "center"
};

const tokenImageBoxStyle = {
  width: "150px",
  height: "150px",
  borderRadius: "14px",
  overflow: "hidden",
  background: "#151515",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const tokenImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const fallbackStyle = {
  fontSize: "42px",
  fontWeight: "1000",
  color: "#e9d5ff"
};

const tokenInfoStyle = {
  minWidth: 0
};

const badgeRowStyle = {
  display: "flex",
  gap: "8px",
  alignItems: "center",
  marginBottom: "10px"
};

const symbolBadgeStyle = {
  display: "inline-block",
  background: "rgba(148,163,184,0.38)",
  color: "#eef2ff",
  borderRadius: "5px",
  padding: "3px 7px",
  fontSize: "13px",
  fontWeight: "950"
};

const statusBadgeStyle = {
  display: "inline-block",
  background: "rgba(139,92,246,0.22)",
  color: "#e9d5ff",
  border: "1px solid rgba(192,132,252,0.25)",
  borderRadius: "999px",
  padding: "5px 9px",
  fontSize: "11px",
  fontWeight: "950"
};

const titleStyle = {
  fontSize: "44px",
  margin: 0,
  lineHeight: 1,
  fontWeight: "1000",
  letterSpacing: "-1px"
};

const descStyle = {
  color: "#aaa",
  margin: "10px 0 0",
  fontSize: "15px",
  lineHeight: "1.45",
  maxWidth: "720px"
};

const linkRowStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: "8px",
  marginTop: "12px"
};

const linkButtonStyle = {
  textDecoration: "none",
  color: "#ddd6fe",
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.1)",
  padding: "8px 10px",
  borderRadius: "10px",
  fontWeight: "800",
  fontSize: "13px"
};

const priceBoxStyle = {
  minWidth: "210px",
  background: "#262626",
  borderRadius: "14px",
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "6px"
};

const statsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "12px"
};

const statStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "8px"
};

const bondingPanelStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "14px"
};

const bondingTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  color: "#bdbdbd",
  fontSize: "14px",
  fontWeight: "800",
  marginBottom: "8px"
};

const bondingBottomStyle = {
  display: "flex",
  justifyContent: "space-between",
  color: "#777",
  fontSize: "12px",
  marginTop: "8px"
};

const progressOuterStyle = {
  height: "10px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden"
};

const progressInnerStyle = {
  height: "100%",
  background: "#8b5cf6",
  borderRadius: "999px"
};

const addressPanelStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "12px",
  display: "grid",
  gap: "8px"
};

const addressRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  background: "#151515",
  borderRadius: "10px",
  padding: "10px"
};

const copyButtonStyle = {
  background: "rgba(139,92,246,0.22)",
  border: "1px solid rgba(192,132,252,0.25)",
  color: "#e9d5ff",
  padding: "8px 10px",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: "900"
};

const chartPanelStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "16px"
};

const panelHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "14px"
};

const emptyTextStyle = {
  color: "#888"
};

const tradesPanelStyle = {
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "14px",
  padding: "16px"
};

const tradeRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  borderTop: "1px solid rgba(255,255,255,0.08)",
  padding: "12px 0"
};

const tradeLeftStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px"
};

const tradeDotStyle = {
  width: "12px",
  height: "12px",
  borderRadius: "999px"
};

const tradeRightStyle = {
  textAlign: "right"
};

const tradePanelStyle = {
  position: "sticky",
  top: "20px",
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "18px",
  padding: "16px"
};

const tradeTitleStyle = {
  margin: "0 0 14px",
  fontSize: "26px"
};

const walletButtonStyle = {
  width: "100%",
  background: "linear-gradient(135deg,#7c3aed,#c084fc)",
  border: "none",
  color: "white",
  padding: "13px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "950"
};

const balanceStyle = {
  marginTop: "12px",
  background: "#151515",
  borderRadius: "12px",
  padding: "12px",
  display: "flex",
  justifyContent: "space-between",
  gap: "10px"
};

const boxStyle = {
  marginTop: "18px",
  paddingTop: "18px",
  borderTop: "1px solid rgba(255,255,255,0.08)"
};

const labelStyle = {
  marginBottom: "10px",
  fontWeight: "900",
  color: "#d8d4e5"
};

const presetGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "8px",
  marginBottom: "10px"
};

const presetButtonStyle = {
  background: "#151515",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "white",
  padding: "9px",
  borderRadius: "10px",
  cursor: "pointer",
  fontWeight: "800"
};

const inputStyle = {
  width: "100%",
  padding: "13px 14px",
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "#151515",
  color: "white",
  marginBottom: "10px",
  outline: "none"
};

const buyButtonStyle = {
  width: "100%",
  background: "#22c55e",
  border: "none",
  color: "#031007",
  padding: "13px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "1000"
};

const sellButtonStyle = {
  width: "100%",
  background: "#ef4444",
  border: "none",
  color: "white",
  padding: "13px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "1000"
};