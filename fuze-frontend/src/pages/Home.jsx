import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

import { supabase } from "../lib/supabase";

import {
  FACTORY_ADDRESS,
  FACTORY_ABI,
  FACTORY_READ_ABI,
  CREATE_FEE,
  POOL_ABI,
  IGNITION_TARGET_MON
} from "../lib/contracts";

const RPC_URL = "https://testnet-rpc.monad.xyz";

export default function Home() {
  const navigate = useNavigate();

  const [showCreate, setShowCreate] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenSymbol, setTokenSymbol] = useState("");
  const [description, setDescription] = useState("");
  const [website, setWebsite] = useState("");
  const [telegram, setTelegram] = useState("");
  const [twitter, setTwitter] = useState("");
  const [imageFile, setImageFile] = useState(null);

  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState([]);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("latestTrade");
  const [hoveredCard, setHoveredCard] = useState(null);

  useEffect(() => {
    loadTokens();

    const interval = setInterval(() => {
      loadTokens();
    }, 8000);

    return () => clearInterval(interval);
  }, []);

  async function getBondingProgress(poolAddress) {
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const pool = new ethers.Contract(poolAddress, POOL_ABI, provider);

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

      const marketCap = priceNumber * soldNumber;

      return {
        price: priceNumber,
        reserve: reserveNumber,
        sold: soldNumber,
        marketCap,
        progress,
        ignited
      };
    } catch (err) {
      console.error(err);
      return {
        price: 0,
        reserve: 0,
        sold: 0,
        marketCap: 0,
        progress: 0,
        ignited: false
      };
    }
  }

  async function getTokenTradeStats(poolAddress) {
    try {
      const { data, error } = await supabase
        .from("trades")
        .select("*")
        .eq("pool_address", poolAddress)
        .order("created_at", { ascending: false })
        .limit(100);

      if (error) throw error;

      const rows = data || [];

      const volume = rows.reduce((sum, trade) => {
        if (trade.trade_type === "buy") {
          return sum + Number(trade.mon_amount || 0);
        }

        return sum;
      }, 0);

      const holders = new Set(
        rows
          .filter((trade) => trade.wallet_address)
          .map((trade) => trade.wallet_address.toLowerCase())
      );

      return {
        trades: rows.length,
        volume,
        holders: holders.size,
        lastTradeAt: rows[0]?.created_at || null
      };
    } catch (err) {
      console.error(err);
      return {
        trades: 0,
        volume: 0,
        holders: 0,
        lastTradeAt: null
      };
    }
  }

  async function enrichToken(item) {
    const poolAddress = item.pool_address || item.pool;

    const [stats, tradeStats] = await Promise.all([
      getBondingProgress(poolAddress),
      getTokenTradeStats(poolAddress)
    ]);

    return {
      token: item.token_address || item.token,
      pool: poolAddress,
      creator: item.creator_address || item.creator,
      name: item.name,
      symbol: item.symbol,
      description: item.description || null,
      imageUrl: item.image_url || null,
      website: item.website || null,
      telegram: item.telegram || null,
      twitter: item.twitter || null,
      createdAt: item.created_at || item.createdAt || null,
      price: stats.price,
      reserve: stats.reserve,
      sold: stats.sold,
      marketCap: stats.marketCap,
      progress: stats.progress,
      ignited: stats.ignited,
      trades: tradeStats.trades,
      volume: tradeStats.volume,
      holders: tradeStats.holders,
      lastTradeAt: tradeStats.lastTradeAt
    };
  }

  async function loadTokens() {
    try {
      const { data, error } = await supabase
        .from("tokens")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data?.length) {
        const enriched = await Promise.all(data.map(enrichToken));
        setTokens(enriched);
        return;
      }

      const provider = new ethers.JsonRpcProvider(RPC_URL);

      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_READ_ABI,
        provider
      );

      const total = await factory.totalTokens();
      const loaded = [];

      for (let i = Number(total) - 1; i >= 0; i--) {
        const item = await factory.allTokens(i);

        loaded.push({
          token: item.token,
          pool: item.pool,
          creator: item.creator,
          name: item.name,
          symbol: item.symbol,
          createdAt: Number(item.createdAt || 0)
        });
      }

      const enriched = await Promise.all(loaded.map(enrichToken));
      setTokens(enriched);
    } catch (err) {
      console.error(err);
    }
  }

  async function uploadTokenImage() {
    if (!imageFile) return null;

    const fileExt = imageFile.name.split(".").pop();
    const fileName = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.${fileExt}`;

    const { error } = await supabase.storage
      .from("token-images")
      .upload(fileName, imageFile);

    if (error) throw error;

    const { data } = supabase.storage
      .from("token-images")
      .getPublicUrl(fileName);

    return data.publicUrl;
  }

  async function createToken() {
    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    if (!tokenName.trim() || !tokenSymbol.trim()) {
      alert("Vul token name en symbol in");
      return;
    }

    try {
      setLoading(true);

      const imageUrl = await uploadTokenImage();

      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();

      const factory = new ethers.Contract(
        FACTORY_ADDRESS,
        FACTORY_ABI,
        signer
      );

      const tx = await factory.createToken(
        tokenName.trim(),
        tokenSymbol.trim().toUpperCase(),
        { value: ethers.parseEther(CREATE_FEE) }
      );

      const receipt = await tx.wait();

      let created = null;

      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);

          if (parsed?.name === "TokenCreated") {
            created = {
              token: parsed.args.token,
              pool: parsed.args.pool,
              creator: parsed.args.creator,
              name: parsed.args.name,
              symbol: parsed.args.symbol
            };
          }
        } catch {}
      }

      if (created) {
        const { error } = await supabase.from("tokens").insert({
          token_address: created.token,
          pool_address: created.pool,
          creator_address: created.creator,
          name: created.name,
          symbol: created.symbol,
          description: description.trim() || null,
          image_url: imageUrl,
          website: website.trim() || null,
          telegram: telegram.trim() || null,
          twitter: twitter.trim() || null
        });

        if (error) throw error;
      }

      setTokenName("");
      setTokenSymbol("");
      setDescription("");
      setWebsite("");
      setTelegram("");
      setTwitter("");
      setImageFile(null);
      setShowCreate(false);

      await loadTokens();

      alert("Token created!");
    } catch (err) {
      console.error(err);
      alert(err?.reason || err?.message || "Create token failed");
    } finally {
      setLoading(false);
    }
  }

  const filteredTokens = tokens
    .filter((token) => {
      const q = search.toLowerCase();

      return (
        token.name?.toLowerCase().includes(q) ||
        token.symbol?.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "marketCap") {
        return Number(b.marketCap || 0) - Number(a.marketCap || 0);
      }

      if (sortBy === "newest") {
        return getTime(b.createdAt) - getTime(a.createdAt);
      }

      if (sortBy === "oldest") {
        return getTime(a.createdAt) - getTime(b.createdAt);
      }

      return (
        getTime(b.lastTradeAt || b.createdAt) -
        getTime(a.lastTradeAt || a.createdAt)
      );
    });

  return (
    <main style={pageStyle}>
      <div style={bgGlowOne} />
      <div style={bgGlowTwo} />

      <div style={containerStyle}>
        <nav style={navStyle}>
          <div style={brandStyle}>
            <img src="/logo.jpg" alt="Fuze" style={logoStyle} />

            <div>
              <div style={brandNameStyle}>FUZE</div>
              <div style={brandSubStyle}>Monad Launchpad</div>
            </div>
          </div>

          <div style={navActionsStyle}>
            <button style={navButtonStyle}>Terminal</button>
            <button style={navButtonStyle}>Leaderboard</button>

            <button onClick={() => setShowCreate(true)} style={createButtonStyle}>
              Create
            </button>
          </div>
        </nav>

        {showCreate && (
          <section style={modalOverlayStyle}>
            <div style={modalStyle}>
              <div style={modalHeaderStyle}>
                <div>
                  <h2 style={modalTitleStyle}>Launch Token</h2>
                  <p style={modalTextStyle}>Create your meme coin on Monad.</p>
                </div>

                <button onClick={() => setShowCreate(false)} style={closeButtonStyle}>
                  ✕
                </button>
              </div>

              <input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Token Name"
                style={inputStyle}
              />

              <input
                value={tokenSymbol}
                onChange={(e) => setTokenSymbol(e.target.value)}
                placeholder="Symbol"
                style={inputStyle}
              />

              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Description"
                style={{ ...inputStyle, minHeight: "90px", resize: "vertical" }}
              />

              <input
                type="file"
                accept="image/*"
                onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                style={inputStyle}
              />

              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="Website"
                style={inputStyle}
              />

              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="Telegram"
                style={inputStyle}
              />

              <input
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="Twitter / X"
                style={inputStyle}
              />

              <button
                onClick={createToken}
                disabled={loading}
                style={{
                  ...createButtonStyle,
                  width: "100%",
                  opacity: loading ? 0.6 : 1
                }}
              >
                {loading ? "Launching..." : `Launch (${CREATE_FEE} MON)`}
              </button>
            </div>
          </section>
        )}

        <section style={topSectionStyle}>
          <div>
            <h1 style={titleStyle}>Trending Now</h1>
            <p style={subtitleStyle}>Discover new FUZE launches on Monad.</p>
          </div>

          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search token..."
            style={searchStyle}
          />
        </section>

        <div style={tabsStyle}>
          <button
            onClick={() => setSortBy("latestTrade")}
            style={{
              ...tabButtonStyle,
              ...(sortBy === "latestTrade" ? activeTabStyle : {})
            }}
          >
            Latest Trade
          </button>

          <button
            onClick={() => setSortBy("marketCap")}
            style={{
              ...tabButtonStyle,
              ...(sortBy === "marketCap" ? activeTabStyle : {})
            }}
          >
            Market Cap
          </button>

          <button
            onClick={() => setSortBy("newest")}
            style={{
              ...tabButtonStyle,
              ...(sortBy === "newest" ? activeTabStyle : {})
            }}
          >
            Newest Created
          </button>

          <button
            onClick={() => setSortBy("oldest")}
            style={{
              ...tabButtonStyle,
              ...(sortBy === "oldest" ? activeTabStyle : {})
            }}
          >
            Oldest Created
          </button>
        </div>

        <section style={gridStyle}>
          {filteredTokens.map((token, index) => (
            <article
              key={token.pool || index}
              onClick={() => navigate(`/token/${token.pool}`)}
              onMouseEnter={() => setHoveredCard(token.pool)}
              onMouseLeave={() => setHoveredCard(null)}
              style={{
                ...cardStyle,
                ...(hoveredCard === token.pool ? cardHoverStyle : {})
              }}
            >
              <div style={imageBoxStyle}>
                {token.imageUrl ? (
                  <img src={token.imageUrl} alt={token.symbol} style={tokenImageStyle} />
                ) : (
                  <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                )}
              </div>

              <div style={cardContentStyle}>
                <div style={symbolBadgeStyle}>{token.symbol}</div>

                <h3 style={nameStyle}>{token.name}</h3>

                <p style={descStyle}>
                  {token.description || "Fresh Monad launch"}
                </p>

                <div style={metaRowStyle}>
                  <span style={tagStyle}>24h</span>
                  <strong style={greenTextStyle}>+{token.progress.toFixed(1)}%</strong>

                  <span style={tagStyle}>Vol</span>
                  <strong>{shortNum(token.volume)} MON</strong>

                  <span style={holderTagStyle}>♙</span>
                  <strong>{shortNum(token.holders)}</strong>
                </div>

                <div style={creatorRowStyle}>
                  <span style={walletDotStyle} />
                  <strong>
                    {token.creator
                      ? `${token.creator.slice(0, 6)}...`
                      : "0x0000..."}
                  </strong>
                  <span>{timeAgo(token.lastTradeAt || token.createdAt)}</span>
                </div>

                <div style={bottomStatsStyle}>
                  <div>
                    <span>MC</span>
                    <strong>{shortNum(token.marketCap)} MON</strong>
                  </div>

                  <div>
                    <span>ATH</span>
                    <strong>{shortNum(Math.max(token.marketCap, token.marketCap * 1.22))} MON</strong>
                  </div>
                </div>

                <div style={progressOuterStyle}>
                  <div
                    style={{
                      ...progressInnerStyle,
                      width: `${token.progress || 0}%`
                    }}
                  />
                </div>
              </div>
            </article>
          ))}
        </section>
      </div>
    </main>
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
    maximumFractionDigits: 4
  });
}

function getTime(value) {
  if (!value) return 0;

  if (typeof value === "number") {
    if (value < 10_000_000_000) return value * 1000;
    return value;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function timeAgo(value) {
  const time = getTime(value);
  if (!time) return "now";

  const diff = Date.now() - time;
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  const months = Math.floor(days / 30);

  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return `${months}mo ago`;
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
  marginBottom: "26px"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px"
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

const topSectionStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: "22px",
  marginBottom: "16px"
};

const titleStyle = {
  fontSize: "38px",
  margin: 0,
  letterSpacing: "-1px",
  fontWeight: "1000"
};

const subtitleStyle = {
  color: "#9f99ad",
  margin: "7px 0 0"
};

const searchStyle = {
  width: "320px",
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "15px",
  padding: "14px 16px",
  color: "white",
  outline: "none"
};

const tabsStyle = {
  display: "flex",
  gap: "12px",
  marginBottom: "22px",
  flexWrap: "wrap"
};

const tabButtonStyle = {
  padding: "12px 18px",
  borderRadius: "999px",
  background: "rgba(255,255,255,0.055)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#aaa4b8",
  cursor: "pointer",
  fontWeight: "900",
  fontSize: "15px"
};

const activeTabStyle = {
  color: "#fff",
  background: "rgba(124,58,237,0.35)",
  border: "1px solid rgba(192,132,252,0.45)"
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(270px, 1fr))",
  gap: "20px"
};

const cardStyle = {
  overflow: "hidden",
  borderRadius: "14px",
  background: "#050505",
  border: "1px solid rgba(255,255,255,0.1)",
  cursor: "pointer",
  transition: "0.18s ease",
  transform: "translateY(0)"
};

const cardHoverStyle = {
  transform: "translateY(-4px)",
  border: "1px solid rgba(192,132,252,0.45)",
  boxShadow: "0 18px 50px rgba(124,58,237,0.22)"
};

const imageBoxStyle = {
  width: "100%",
  aspectRatio: "1 / 1",
  background: "#151515",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden"
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

const cardContentStyle = {
  background: "#050505",
  padding: "10px 10px 12px"
};

const symbolBadgeStyle = {
  display: "inline-block",
  background: "rgba(148,163,184,0.38)",
  color: "#eef2ff",
  borderRadius: "5px",
  padding: "2px 5px",
  fontSize: "13px",
  fontWeight: "950",
  marginBottom: "7px"
};

const nameStyle = {
  margin: 0,
  fontSize: "17px",
  lineHeight: 1.15,
  fontWeight: "950",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis"
};

const descStyle = {
  color: "#aaa",
  margin: "4px 0 0",
  fontSize: "14px",
  lineHeight: "1.28",
  minHeight: "36px",
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden"
};

const metaRowStyle = {
  marginTop: "10px",
  display: "grid",
  gridTemplateColumns: "auto auto auto auto auto auto",
  alignItems: "center",
  gap: "5px",
  fontSize: "14px"
};

const tagStyle = {
  background: "rgba(255,255,255,0.16)",
  color: "#bdbdbd",
  padding: "2px 4px",
  borderRadius: "4px",
  fontSize: "12px",
  fontWeight: "800"
};

const holderTagStyle = {
  background: "rgba(255,255,255,0.16)",
  color: "#bdbdbd",
  padding: "2px 5px",
  borderRadius: "4px",
  fontSize: "12px"
};

const greenTextStyle = {
  color: "#22c55e"
};

const creatorRowStyle = {
  marginTop: "9px",
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  alignItems: "center",
  gap: "6px",
  color: "#bdbdbd",
  fontSize: "12px"
};

const walletDotStyle = {
  width: "16px",
  height: "16px",
  borderRadius: "999px",
  background: "linear-gradient(135deg,#7c3aed,#c084fc)",
  display: "inline-block"
};

const bottomStatsStyle = {
  marginTop: "12px",
  background: "#262626",
  borderRadius: "0 0 10px 10px",
  padding: "10px 8px",
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: "8px"
};

const progressOuterStyle = {
  gridColumn: "1 / -1",
  height: "10px",
  borderRadius: "999px",
  background: "#000",
  overflow: "hidden",
  marginTop: "8px"
};

const progressInnerStyle = {
  height: "100%",
  background: "#8b5cf6",
  borderRadius: "999px"
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.75)",
  zIndex: 50,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px"
};

const modalStyle = {
  width: "100%",
  maxWidth: "560px",
  maxHeight: "90vh",
  overflow: "auto",
  background: "rgba(12,10,20,0.98)",
  border: "1px solid rgba(192,132,252,0.25)",
  borderRadius: "24px",
  padding: "26px"
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "14px",
  marginBottom: "20px"
};

const modalTitleStyle = {
  margin: 0,
  fontSize: "30px"
};

const modalTextStyle = {
  color: "#aaa4b8",
  margin: "6px 0 0"
};

const closeButtonStyle = {
  width: "40px",
  height: "40px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "white",
  cursor: "pointer"
};

const inputStyle = {
  width: "100%",
  padding: "14px 15px",
  marginBottom: "12px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};