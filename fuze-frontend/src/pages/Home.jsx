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
      if (sortBy === "marketCap") return Number(b.marketCap || 0) - Number(a.marketCap || 0);
      if (sortBy === "newest") return getTime(b.createdAt) - getTime(a.createdAt);
      if (sortBy === "oldest") return getTime(a.createdAt) - getTime(b.createdAt);

      return getTime(b.lastTradeAt || b.createdAt) - getTime(a.lastTradeAt || a.createdAt);
    });

  const totalVolume = tokens.reduce(
    (sum, token) => sum + Number(token.volume || 0),
    0
  );

  const totalTrades = tokens.reduce(
    (sum, token) => sum + Number(token.trades || 0),
    0
  );

  return (
    <main style={pageStyle}>
      <div style={bgGlowOne} />
      <div style={bgGlowTwo} />
      <div style={gridOverlayStyle} />

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
            <button
              onClick={() =>
                document
                  .getElementById("tokens")
                  ?.scrollIntoView({ behavior: "smooth" })
              }
              style={ghostButtonStyle}
            >
              Terminal
            </button>

            <button style={ghostButtonStyle}>Leaderboard</button>

            <button onClick={() => setShowCreate(true)} style={launchButtonStyle}>
              Create
            </button>

            <button style={connectButtonStyle}>Connect</button>
          </div>
        </nav>

        <section style={bannerStyle}>
          <div>
            <div style={badgeStyle}>⚡ MONAD TESTNET LIVE</div>

            <h1 style={heroTitleStyle}>
              Launch tokens. Trade early. <span style={purpleTextStyle}>Ignite.</span>
            </h1>

            <p style={heroTextStyle}>
              A clean meme launchpad for Monad testnet. Create, discover and trade
              tokens before ignition.
            </p>
          </div>

          <div style={marketBoxStyle}>
            <div style={marketBoxTopStyle}>
              <span>FUZE MARKET</span>
              <strong>LIVE</strong>
            </div>

            <div style={marketStatsRowStyle}>
              <HeroStat label="Launches" value={tokens.length} />
              <HeroStat label="Volume" value={`${shortNum(totalVolume)} MON`} />
              <HeroStat label="Trades" value={shortNum(totalTrades)} />
            </div>
          </div>
        </section>

        {showCreate && (
          <section style={modalOverlayStyle}>
            <div style={modalStyle}>
              <div style={modalHeaderStyle}>
                <div>
                  <h2 style={modalTitleStyle}>Launch a token</h2>
                  <p style={modalTextStyle}>Create your meme coin on Monad.</p>
                </div>

                <button
                  onClick={() => setShowCreate(false)}
                  style={closeButtonStyle}
                >
                  ✕
                </button>
              </div>

              <input
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                placeholder="Token name"
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
                style={fileInputStyle}
              />

              <input
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="Website URL"
                style={inputStyle}
              />

              <input
                value={telegram}
                onChange={(e) => setTelegram(e.target.value)}
                placeholder="Telegram URL"
                style={inputStyle}
              />

              <input
                value={twitter}
                onChange={(e) => setTwitter(e.target.value)}
                placeholder="X / Twitter URL"
                style={inputStyle}
              />

              <button
                onClick={createToken}
                disabled={loading}
                style={{
                  ...mainCtaStyle,
                  width: "100%",
                  opacity: loading ? 0.55 : 1
                }}
              >
                {loading ? "Launching..." : `Launch Token (${CREATE_FEE} MON)`}
              </button>
            </div>
          </section>
        )}

        <section id="tokens" style={tokensSectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>Trending Now</h2>
              <p style={sectionSubStyle}>Fresh FUZE launches ranked by market activity.</p>
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search token..."
              style={searchStyle}
            />
          </div>

          <div style={tabsRowStyle}>
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

          <div style={gridStyle}>
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
                <div style={cardImageWrapStyle}>
                  {token.imageUrl ? (
                    <img src={token.imageUrl} alt={token.symbol} style={cardImageStyle} />
                  ) : (
                    <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                  )}

                  <div style={cardStatusStyle}>
                    {token.ignited ? "IGNITED" : `${token.progress.toFixed(1)}%`}
                  </div>
                </div>

                <div style={cardBodyStyle}>
                  <div style={cardTopLineStyle}>
                    <div>
                      <h3 style={cardSymbolStyle}>{token.symbol}</h3>
                      <p style={cardNameStyle}>{token.name}</p>
                    </div>

                    <span style={rankStyle}>#{index + 1}</span>
                  </div>

                  {token.description && (
                    <p style={descriptionStyle}>{token.description}</p>
                  )}

                  <div style={cardMetricsStyle}>
                    <Metric label="MCap" value={`${shortNum(token.marketCap)} MON`} />
                    <Metric label="Vol" value={`${shortNum(token.volume)} MON`} />
                  </div>

                  <div style={progressInfoStyle}>
                    <span>Bonding</span>
                    <strong>{token.progress.toFixed(2)}%</strong>
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
          </div>
        </section>
      </div>
    </main>
  );
}

function HeroStat({ label, value }) {
  return (
    <div style={heroStatStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={metricStyle}>
      <span>{label}</span>
      <strong>{value}</strong>
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

function getTime(value) {
  if (!value) return 0;

  if (typeof value === "number") {
    if (value < 10_000_000_000) return value * 1000;
    return value;
  }

  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

const pageStyle = {
  minHeight: "100vh",
  position: "relative",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, #251044 0%, #08070d 34%, #030305 100%)",
  color: "white",
  fontFamily: "Inter, Arial, sans-serif",
  padding: "24px"
};

const bgGlowOne = {
  position: "fixed",
  width: "520px",
  height: "520px",
  top: "-170px",
  right: "-110px",
  background: "rgba(168,85,247,0.24)",
  filter: "blur(120px)",
  pointerEvents: "none"
};

const bgGlowTwo = {
  position: "fixed",
  width: "420px",
  height: "420px",
  bottom: "-150px",
  left: "-120px",
  background: "rgba(124,58,237,0.18)",
  filter: "blur(120px)",
  pointerEvents: "none"
};

const gridOverlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
  backgroundSize: "54px 54px",
  maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.65), transparent 70%)",
  pointerEvents: "none"
};

const containerStyle = {
  maxWidth: "1240px",
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const navStyle = {
  height: "68px",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  background: "rgba(10,10,18,0.76)",
  border: "1px solid rgba(192,132,252,0.16)",
  borderRadius: "22px",
  padding: "9px 14px",
  backdropFilter: "blur(18px)",
  boxShadow: "0 0 34px rgba(168,85,247,0.10)"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px"
};

const logoStyle = {
  width: "48px",
  height: "48px",
  borderRadius: "15px",
  objectFit: "cover",
  boxShadow: "0 0 24px rgba(168,85,247,0.45)"
};

const brandNameStyle = {
  fontSize: "23px",
  fontWeight: "950",
  letterSpacing: "1px"
};

const brandSubStyle = {
  fontSize: "11px",
  color: "#c4b5fd",
  marginTop: "1px"
};

const navActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "8px"
};

const ghostButtonStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.09)",
  color: "#ddd6fe",
  padding: "11px 14px",
  borderRadius: "13px",
  cursor: "pointer",
  fontWeight: "800"
};

const launchButtonStyle = {
  background: "linear-gradient(135deg, #7c3aed, #c084fc)",
  border: "none",
  color: "white",
  padding: "12px 16px",
  borderRadius: "13px",
  cursor: "pointer",
  fontWeight: "950",
  boxShadow: "0 0 22px rgba(168,85,247,0.42)"
};

const connectButtonStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(192,132,252,0.18)",
  color: "#e9d5ff",
  padding: "12px 16px",
  borderRadius: "13px",
  cursor: "pointer",
  fontWeight: "900"
};

const bannerStyle = {
  marginTop: "24px",
  background:
    "linear-gradient(135deg, rgba(168,85,247,0.16), rgba(255,255,255,0.045))",
  border: "1px solid rgba(192,132,252,0.2)",
  borderRadius: "30px",
  padding: "34px",
  display: "grid",
  gridTemplateColumns: "1.25fr 0.75fr",
  gap: "28px",
  alignItems: "center",
  boxShadow: "0 0 70px rgba(168,85,247,0.12)"
};

const badgeStyle = {
  display: "inline-block",
  color: "#e9d5ff",
  background: "rgba(168,85,247,0.14)",
  border: "1px solid rgba(192,132,252,0.25)",
  borderRadius: "999px",
  padding: "9px 13px",
  fontSize: "12px",
  fontWeight: "950",
  marginBottom: "18px"
};

const heroTitleStyle = {
  fontSize: "58px",
  lineHeight: "0.96",
  margin: 0,
  letterSpacing: "-3px",
  fontWeight: "1000"
};

const purpleTextStyle = {
  color: "#c084fc",
  textShadow: "0 0 34px rgba(192,132,252,0.75)"
};

const heroTextStyle = {
  maxWidth: "640px",
  color: "#b8b4c7",
  fontSize: "18px",
  lineHeight: "1.55",
  margin: "22px 0 0"
};

const marketBoxStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "24px",
  padding: "20px"
};

const marketBoxTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  color: "#c4b5fd",
  fontSize: "12px",
  fontWeight: "950",
  marginBottom: "14px"
};

const marketStatsRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "10px"
};

const heroStatStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.07)",
  borderRadius: "17px",
  padding: "13px",
  display: "flex",
  flexDirection: "column",
  gap: "7px"
};

const mainCtaStyle = {
  background: "linear-gradient(135deg, #7c3aed, #a855f7, #c084fc)",
  border: "none",
  color: "white",
  padding: "16px 24px",
  borderRadius: "16px",
  fontSize: "16px",
  cursor: "pointer",
  fontWeight: "900",
  boxShadow: "0 0 30px rgba(168,85,247,0.45)"
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.72)",
  zIndex: 50,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "24px"
};

const modalStyle = {
  width: "100%",
  maxWidth: "560px",
  maxHeight: "90vh",
  overflow: "auto",
  background: "rgba(12,10,20,0.96)",
  border: "1px solid rgba(192,132,252,0.25)",
  borderRadius: "28px",
  padding: "28px",
  boxShadow: "0 0 90px rgba(168,85,247,0.35)"
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  marginBottom: "22px"
};

const modalTitleStyle = {
  margin: 0,
  fontSize: "32px"
};

const modalTextStyle = {
  margin: "6px 0 0",
  color: "#a5a0b8"
};

const closeButtonStyle = {
  width: "42px",
  height: "42px",
  borderRadius: "14px",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "white",
  cursor: "pointer"
};

const inputStyle = {
  width: "100%",
  padding: "15px 16px",
  marginBottom: "14px",
  borderRadius: "16px",
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};

const fileInputStyle = {
  ...inputStyle,
  cursor: "pointer"
};

const tokensSectionStyle = {
  paddingTop: "36px",
  paddingBottom: "90px"
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: "20px",
  marginBottom: "16px"
};

const sectionTitleStyle = {
  fontSize: "36px",
  margin: 0,
  letterSpacing: "-1px"
};

const sectionSubStyle = {
  color: "#a5a0b8",
  margin: "7px 0 0"
};

const searchStyle = {
  width: "320px",
  padding: "14px 15px",
  borderRadius: "15px",
  border: "1px solid rgba(192,132,252,0.18)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};

const tabsRowStyle = {
  display: "flex",
  gap: "10px",
  flexWrap: "wrap",
  marginBottom: "20px"
};

const tabButtonStyle = {
  background: "rgba(255,255,255,0.045)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#a5a0b8",
  padding: "11px 14px",
  borderRadius: "999px",
  cursor: "pointer",
  fontWeight: "850"
};

const activeTabStyle = {
  color: "#fff",
  background: "rgba(168,85,247,0.18)",
  border: "1px solid rgba(192,132,252,0.28)",
  boxShadow: "0 0 18px rgba(168,85,247,0.18)"
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(255px, 1fr))",
  gap: "18px"
};

const cardStyle = {
  overflow: "hidden",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.032))",
  border: "1px solid rgba(192,132,252,0.14)",
  borderRadius: "24px",
  cursor: "pointer",
  transition: "0.22s ease",
  boxShadow: "0 0 34px rgba(168,85,247,0.07)",
  transform: "translateY(0)"
};

const cardHoverStyle = {
  transform: "translateY(-4px)",
  border: "1px solid rgba(216,180,254,0.32)",
  boxShadow: "0 20px 60px rgba(168,85,247,0.18)"
};

const cardImageWrapStyle = {
  position: "relative",
  height: "185px",
  background: "rgba(168,85,247,0.12)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center"
};

const cardImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const fallbackStyle = {
  fontWeight: "1000",
  fontSize: "32px",
  color: "#e9d5ff"
};

const cardStatusStyle = {
  position: "absolute",
  top: "12px",
  right: "12px",
  background: "rgba(8,7,13,0.72)",
  border: "1px solid rgba(192,132,252,0.24)",
  color: "#e9d5ff",
  padding: "8px 10px",
  borderRadius: "999px",
  fontSize: "11px",
  fontWeight: "950",
  backdropFilter: "blur(12px)"
};

const cardBodyStyle = {
  padding: "16px"
};

const cardTopLineStyle = {
  display: "flex",
  justifyContent: "space-between",
  gap: "12px",
  alignItems: "flex-start"
};

const cardSymbolStyle = {
  fontSize: "28px",
  margin: "0 0 5px",
  fontWeight: "1000",
  letterSpacing: "-0.8px"
};

const cardNameStyle = {
  color: "#cfc9de",
  margin: 0,
  fontSize: "14px",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  maxWidth: "175px"
};

const rankStyle = {
  color: "#c084fc",
  fontSize: "12px",
  fontWeight: "950"
};

const descriptionStyle = {
  color: "#918ba3",
  fontSize: "13px",
  lineHeight: "1.45",
  minHeight: "36px",
  marginTop: "12px",
  marginBottom: 0,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden"
};

const cardMetricsStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(2, 1fr)",
  gap: "9px",
  marginTop: "14px"
};

const metricStyle = {
  background: "rgba(0,0,0,0.2)",
  border: "1px solid rgba(255,255,255,0.065)",
  borderRadius: "14px",
  padding: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "5px",
  minWidth: 0
};

const progressInfoStyle = {
  marginTop: "14px",
  marginBottom: "8px",
  display: "flex",
  justifyContent: "space-between",
  color: "#bdb7cd",
  fontSize: "13px"
};

const progressOuterStyle = {
  height: "8px",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "999px",
  overflow: "hidden"
};

const progressInnerStyle = {
  height: "100%",
  background: "linear-gradient(90deg, #7c3aed, #c084fc)",
  boxShadow: "0 0 18px rgba(192,132,252,0.75)"
};