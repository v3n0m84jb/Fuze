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

      const pool = new ethers.Contract(
        poolAddress,
        POOL_ABI,
        provider
      );

      const price = await pool.currentPrice();

      const reserve = await pool.reserveMON();

      const sold = await pool.tokensSold();

      const ignited = await pool.ignited();

      const priceNumber = Number(
        ethers.formatUnits(price, 18)
      );

      const reserveNumber = Number(
        ethers.formatEther(reserve)
      );

      const soldNumber = Number(
        ethers.formatUnits(sold, 18)
      );

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
        .order("created_at", {
          ascending: false
        })
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
          .filter(
            (trade) => trade.wallet_address
          )
          .map((trade) =>
            trade.wallet_address.toLowerCase()
          )
      );

      return {
        trades: rows.length,
        volume,
        holders: holders.size,
        lastTradeAt:
          rows[0]?.created_at || null
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
    const poolAddress =
      item.pool_address || item.pool;

    const [stats, tradeStats] =
      await Promise.all([
        getBondingProgress(poolAddress),
        getTokenTradeStats(poolAddress)
      ]);

    return {
      token:
        item.token_address || item.token,

      pool: poolAddress,

      creator:
        item.creator_address ||
        item.creator,

      name: item.name,
      symbol: item.symbol,

      description:
        item.description || null,

      imageUrl:
        item.image_url || null,

      website: item.website || null,
      telegram:
        item.telegram || null,
      twitter: item.twitter || null,

      createdAt:
        item.created_at ||
        item.createdAt ||
        null,

      price: stats.price,
      reserve: stats.reserve,
      sold: stats.sold,

      marketCap: stats.marketCap,

      progress: stats.progress,

      ignited: stats.ignited,

      trades: tradeStats.trades,

      volume: tradeStats.volume,

      holders: tradeStats.holders,

      lastTradeAt:
        tradeStats.lastTradeAt
    };
  }

  async function loadTokens() {
    try {
      const { data, error } =
        await supabase
          .from("tokens")
          .select("*")
          .order("created_at", {
            ascending: false
          });

      if (error) throw error;

      if (data?.length) {
        const enriched =
          await Promise.all(
            data.map(enrichToken)
          );

        setTokens(enriched);

        return;
      }

      const provider =
        new ethers.JsonRpcProvider(
          RPC_URL
        );

      const factory =
        new ethers.Contract(
          FACTORY_ADDRESS,
          FACTORY_READ_ABI,
          provider
        );

      const total =
        await factory.totalTokens();

      const loaded = [];

      for (
        let i = Number(total) - 1;
        i >= 0;
        i--
      ) {
        const item =
          await factory.allTokens(i);

        loaded.push({
          token: item.token,
          pool: item.pool,
          creator: item.creator,
          name: item.name,
          symbol: item.symbol
        });
      }

      const enriched =
        await Promise.all(
          loaded.map(enrichToken)
        );

      setTokens(enriched);
    } catch (err) {
      console.error(err);
    }
  }

  async function uploadTokenImage() {
    if (!imageFile) return null;

    const fileExt =
      imageFile.name.split(".").pop();

    const fileName = `${Date.now()}-${Math.random()
      .toString(16)
      .slice(2)}.${fileExt}`;

    const { error } =
      await supabase.storage
        .from("token-images")
        .upload(fileName, imageFile);

    if (error) throw error;

    const { data } =
      supabase.storage
        .from("token-images")
        .getPublicUrl(fileName);

    return data.publicUrl;
  }

  async function createToken() {
    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    if (
      !tokenName.trim() ||
      !tokenSymbol.trim()
    ) {
      alert(
        "Vul token name en symbol in"
      );

      return;
    }

    try {
      setLoading(true);

      const imageUrl =
        await uploadTokenImage();

      const provider =
        new ethers.BrowserProvider(
          window.ethereum
        );

      const signer =
        await provider.getSigner();

      const factory =
        new ethers.Contract(
          FACTORY_ADDRESS,
          FACTORY_ABI,
          signer
        );

      const tx =
        await factory.createToken(
          tokenName.trim(),
          tokenSymbol
            .trim()
            .toUpperCase(),
          {
            value: ethers.parseEther(
              CREATE_FEE
            )
          }
        );

      const receipt = await tx.wait();

      let created = null;

      for (const log of receipt.logs) {
        try {
          const parsed =
            factory.interface.parseLog(
              log
            );

          if (
            parsed?.name ===
            "TokenCreated"
          ) {
            created = {
              token:
                parsed.args.token,

              pool:
                parsed.args.pool,

              creator:
                parsed.args.creator,

              name:
                parsed.args.name,

              symbol:
                parsed.args.symbol
            };
          }
        } catch {}
      }

      if (created) {
        const { error } =
          await supabase
            .from("tokens")
            .insert({
              token_address:
                created.token,

              pool_address:
                created.pool,

              creator_address:
                created.creator,

              name: created.name,

              symbol:
                created.symbol,

              description:
                description.trim() ||
                null,

              image_url: imageUrl,

              website:
                website.trim() ||
                null,

              telegram:
                telegram.trim() ||
                null,

              twitter:
                twitter.trim() ||
                null
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

      alert(
        err?.reason ||
          err?.message ||
          "Create token failed"
      );
    } finally {
      setLoading(false);
    }
  }

  const filteredTokens = tokens
    .filter((token) => {
      const q = search.toLowerCase();

      return (
        token.name
          ?.toLowerCase()
          .includes(q) ||
        token.symbol
          ?.toLowerCase()
          .includes(q)
      );
    })
    .sort((a, b) => {
      if (sortBy === "marketCap") {
        return (
          Number(b.marketCap || 0) -
          Number(a.marketCap || 0)
        );
      }

      if (sortBy === "newest") {
        return (
          getTime(b.createdAt) -
          getTime(a.createdAt)
        );
      }

      if (sortBy === "oldest") {
        return (
          getTime(a.createdAt) -
          getTime(b.createdAt)
        );
      }

      return (
        getTime(
          b.lastTradeAt ||
            b.createdAt
        ) -
        getTime(
          a.lastTradeAt ||
            a.createdAt
        )
      );
    });

  const totalVolume = tokens.reduce(
    (sum, token) =>
      sum +
      Number(token.volume || 0),
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
            <img
              src="/logo.jpg"
              alt="Fuze"
              style={logoStyle}
            />

            <div>
              <div style={brandNameStyle}>
                FUZE
              </div>

              <div style={brandSubStyle}>
                Monad Launchpad
              </div>
            </div>
          </div>

          <div style={navActionsStyle}>
            <button
              style={ghostButtonStyle}
            >
              Terminal
            </button>

            <button
              style={ghostButtonStyle}
            >
              Leaderboard
            </button>

            <button
              onClick={() =>
                setShowCreate(true)
              }
              style={launchButtonStyle}
            >
              Create
            </button>
          </div>
        </nav>

        <section style={heroStyle}>
          <div>
            <div style={badgeStyle}>
              ⚡ MONAD TESTNET LIVE
            </div>

            <h1 style={heroTitleStyle}>
              Launch. Trade.{" "}
              <span
                style={purpleTextStyle}
              >
                Ignite.
              </span>
            </h1>

            <p style={heroTextStyle}>
              Discover and trade new
              meme launches on Monad.
            </p>
          </div>

          <div style={marketBoxStyle}>
            <div
              style={marketBoxTopStyle}
            >
              <span>
                FUZE MARKET
              </span>

              <strong>LIVE</strong>
            </div>

            <div
              style={marketStatStyle}
            >
              <span>
                Total Volume
              </span>

              <strong>
                {shortNum(
                  totalVolume
                )}{" "}
                MON
              </strong>
            </div>

            <div
              style={marketStatStyle}
            >
              <span>Launches</span>

              <strong>
                {tokens.length}
              </strong>
            </div>
          </div>
        </section>

        {showCreate && (
          <section
            style={
              modalOverlayStyle
            }
          >
            <div style={modalStyle}>
              <div
                style={
                  modalHeaderStyle
                }
              >
                <div>
                  <h2
                    style={
                      modalTitleStyle
                    }
                  >
                    Launch Token
                  </h2>

                  <p
                    style={
                      modalTextStyle
                    }
                  >
                    Create a meme coin
                    on Monad.
                  </p>
                </div>

                <button
                  onClick={() =>
                    setShowCreate(
                      false
                    )
                  }
                  style={
                    closeButtonStyle
                  }
                >
                  ✕
                </button>
              </div>

              <input
                value={tokenName}
                onChange={(e) =>
                  setTokenName(
                    e.target.value
                  )
                }
                placeholder="Token Name"
                style={inputStyle}
              />

              <input
                value={tokenSymbol}
                onChange={(e) =>
                  setTokenSymbol(
                    e.target.value
                  )
                }
                placeholder="Symbol"
                style={inputStyle}
              />

              <textarea
                value={description}
                onChange={(e) =>
                  setDescription(
                    e.target.value
                  )
                }
                placeholder="Description"
                style={{
                  ...inputStyle,
                  minHeight:
                    "90px"
                }}
              />

              <input
                type="file"
                accept="image/*"
                onChange={(e) =>
                  setImageFile(
                    e.target
                      .files?.[0] ||
                      null
                  )
                }
                style={inputStyle}
              />

              <input
                value={website}
                onChange={(e) =>
                  setWebsite(
                    e.target.value
                  )
                }
                placeholder="Website"
                style={inputStyle}
              />

              <input
                value={telegram}
                onChange={(e) =>
                  setTelegram(
                    e.target.value
                  )
                }
                placeholder="Telegram"
                style={inputStyle}
              />

              <input
                value={twitter}
                onChange={(e) =>
                  setTwitter(
                    e.target.value
                  )
                }
                placeholder="Twitter / X"
                style={inputStyle}
              />

              <button
                onClick={
                  createToken
                }
                disabled={loading}
                style={{
                  ...launchButtonStyle,
                  width: "100%",
                  opacity:
                    loading
                      ? 0.6
                      : 1
                }}
              >
                {loading
                  ? "Launching..."
                  : `Launch (${CREATE_FEE} MON)`}
              </button>
            </div>
          </section>
        )}

        <section style={tokensSectionStyle}>
          <div style={sectionHeaderStyle}>
            <div>
              <h2 style={sectionTitleStyle}>
                Trending Now
              </h2>

              <p style={sectionSubStyle}>
                Discover new launches.
              </p>
            </div>

            <input
              value={search}
              onChange={(e) =>
                setSearch(
                  e.target.value
                )
              }
              placeholder="Search token..."
              style={searchStyle}
            />
          </div>

          <div style={tabsStyle}>
            <button
              onClick={() =>
                setSortBy(
                  "latestTrade"
                )
              }
              style={{
                ...tabButtonStyle,
                ...(sortBy ===
                "latestTrade"
                  ? activeTabStyle
                  : {})
              }}
            >
              Latest Trade
            </button>

            <button
              onClick={() =>
                setSortBy(
                  "marketCap"
                )
              }
              style={{
                ...tabButtonStyle,
                ...(sortBy ===
                "marketCap"
                  ? activeTabStyle
                  : {})
              }}
            >
              Market Cap
            </button>

            <button
              onClick={() =>
                setSortBy(
                  "newest"
                )
              }
              style={{
                ...tabButtonStyle,
                ...(sortBy ===
                "newest"
                  ? activeTabStyle
                  : {})
              }}
            >
              Newest Created
            </button>

            <button
              onClick={() =>
                setSortBy(
                  "oldest"
                )
              }
              style={{
                ...tabButtonStyle,
                ...(sortBy ===
                "oldest"
                  ? activeTabStyle
                  : {})
              }}
            >
              Oldest Created
            </button>
          </div>

          <div style={gridStyle}>
            {filteredTokens.map(
              (token, index) => (
                <article
                  key={
                    token.pool ||
                    index
                  }
                  onClick={() =>
                    navigate(
                      `/token/${token.pool}`
                    )
                  }
                  onMouseEnter={() =>
                    setHoveredCard(
                      token.pool
                    )
                  }
                  onMouseLeave={() =>
                    setHoveredCard(
                      null
                    )
                  }
                  style={{
                    ...cardStyle,
                    ...(hoveredCard ===
                    token.pool
                      ? cardHoverStyle
                      : {})
                  }}
                >
                  <div
                    style={
                      cardImageWrapStyle
                    }
                  >
                    {token.imageUrl ? (
                      <img
                        src={
                          token.imageUrl
                        }
                        alt={
                          token.symbol
                        }
                        style={
                          cardImageStyle
                        }
                      />
                    ) : (
                      <span
                        style={
                          fallbackStyle
                        }
                      >
                        {token.symbol?.slice(
                          0,
                          2
                        )}
                      </span>
                    )}

                    <div
                      style={
                        cardStatusStyle
                      }
                    >
                      {token.ignited
                        ? "IGNITED"
                        : `${token.progress.toFixed(
                            1
                          )}%`}
                    </div>
                  </div>

                  <div
                    style={
                      cardBodyStyle
                    }
                  >
                    <div
                      style={
                        cardTopLineStyle
                      }
                    >
                      <div>
                        <h3
                          style={
                            cardSymbolStyle
                          }
                        >
                          {
                            token.symbol
                          }
                        </h3>

                        <p
                          style={
                            cardNameStyle
                          }
                        >
                          {token.name}
                        </p>
                      </div>

                      <span
                        style={
                          rankStyle
                        }
                      >
                        #
                        {index + 1}
                      </span>
                    </div>

                    {token.description && (
                      <p
                        style={
                          descriptionStyle
                        }
                      >
                        {
                          token.description
                        }
                      </p>
                    )}

                    <div
                      style={
                        metricGridStyle
                      }
                    >
                      <Metric
                        label="MCap"
                        value={`${shortNum(
                          token.marketCap
                        )} MON`}
                      />

                      <Metric
                        label="Vol"
                        value={`${shortNum(
                          token.volume
                        )} MON`}
                      />
                    </div>

                    <div
                      style={
                        progressInfoStyle
                      }
                    >
                      <span>
                        Bonding
                      </span>

                      <strong>
                        {token.progress.toFixed(
                          2
                        )}
                        %
                      </strong>
                    </div>

                    <div
                      style={
                        progressOuterStyle
                      }
                    >
                      <div
                        style={{
                          ...progressInnerStyle,
                          width: `${token.progress}%`
                        }}
                      />
                    </div>
                  </div>
                </article>
              )
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

function Metric({
  label,
  value
}) {
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

  if (!Number.isFinite(n))
    return value;

  if (n >= 1_000_000) {
    return `${(
      n / 1_000_000
    ).toFixed(2)}M`;
  }

  if (n >= 1_000) {
    return `${(
      n / 1_000
    ).toFixed(2)}K`;
  }

  if (n < 0.000001 && n > 0) {
    return n.toExponential(2);
  }

  return n.toLocaleString(
    undefined,
    {
      maximumFractionDigits: 8
    }
  );
}

function getTime(value) {
  if (!value) return 0;

  return new Date(value).getTime();
}

const pageStyle = {
  minHeight: "100vh",
  background:
    "radial-gradient(circle at top left, #2b0b4f 0%, #08070d 35%, #030305 100%)",
  padding: "24px",
  color: "white",
  position: "relative",
  overflow: "hidden",
  fontFamily:
    "Inter, Arial, sans-serif"
};

const bgGlowOne = {
  position: "fixed",
  width: "520px",
  height: "520px",
  top: "-180px",
  right: "-120px",
  background:
    "rgba(168,85,247,0.24)",
  filter: "blur(120px)"
};

const bgGlowTwo = {
  position: "fixed",
  width: "420px",
  height: "420px",
  bottom: "-120px",
  left: "-120px",
  background:
    "rgba(124,58,237,0.18)",
  filter: "blur(120px)"
};

const gridOverlayStyle = {
  position: "fixed",
  inset: 0,
  backgroundImage:
    "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
  backgroundSize: "56px 56px",
  pointerEvents: "none"
};

const containerStyle = {
  maxWidth: "1320px",
  margin: "0 auto",
  position: "relative",
  zIndex: 2
};

const navStyle = {
  height: "72px",
  display: "flex",
  alignItems: "center",
  justifyContent:
    "space-between",
  background:
    "rgba(10,10,18,0.72)",
  border:
    "1px solid rgba(192,132,252,0.16)",
  borderRadius: "22px",
  padding: "10px 16px",
  backdropFilter: "blur(18px)"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "12px"
};

const logoStyle = {
  width: "48px",
  height: "48px",
  borderRadius: "14px",
  objectFit: "cover"
};

const brandNameStyle = {
  fontSize: "24px",
  fontWeight: "900"
};

const brandSubStyle = {
  fontSize: "11px",
  color: "#c4b5fd"
};

const navActionsStyle = {
  display: "flex",
  gap: "10px"
};

const ghostButtonStyle = {
  background:
    "rgba(255,255,255,0.05)",
  border:
    "1px solid rgba(255,255,255,0.08)",
  color: "#ddd6fe",
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "800"
};

const launchButtonStyle = {
  background:
    "linear-gradient(135deg,#7c3aed,#c084fc)",
  border: "none",
  color: "white",
  padding: "13px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "900"
};

const heroStyle = {
  display: "grid",
  gridTemplateColumns:
    "1.1fr 0.9fr",
  gap: "30px",
  alignItems: "center",
  padding: "40px 0"
};

const badgeStyle = {
  display: "inline-block",
  padding: "10px 14px",
  borderRadius: "999px",
  background:
    "rgba(168,85,247,0.16)",
  border:
    "1px solid rgba(192,132,252,0.24)",
  fontSize: "12px",
  fontWeight: "900",
  color: "#e9d5ff",
  marginBottom: "18px"
};

const heroTitleStyle = {
  fontSize: "64px",
  margin: 0,
  lineHeight: 0.95,
  letterSpacing: "-3px",
  fontWeight: "1000"
};

const purpleTextStyle = {
  color: "#c084fc"
};

const heroTextStyle = {
  color: "#b8b4c7",
  fontSize: "18px",
  lineHeight: 1.5,
  marginTop: "22px",
  maxWidth: "620px"
};

const marketBoxStyle = {
  background:
    "rgba(255,255,255,0.05)",
  border:
    "1px solid rgba(255,255,255,0.08)",
  borderRadius: "26px",
  padding: "24px"
};

const marketBoxTopStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  marginBottom: "18px",
  color: "#c4b5fd",
  fontWeight: "900",
  fontSize: "12px"
};

const marketStatStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  padding: "14px 0",
  borderTop:
    "1px solid rgba(255,255,255,0.08)"
};

const modalOverlayStyle = {
  position: "fixed",
  inset: 0,
  background:
    "rgba(0,0,0,0.75)",
  zIndex: 50,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  padding: "24px"
};

const modalStyle = {
  width: "100%",
  maxWidth: "560px",
  background:
    "rgba(12,10,20,0.96)",
  border:
    "1px solid rgba(192,132,252,0.25)",
  borderRadius: "28px",
  padding: "28px"
};

const modalHeaderStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  marginBottom: "22px"
};

const modalTitleStyle = {
  margin: 0,
  fontSize: "32px"
};

const modalTextStyle = {
  marginTop: "8px",
  color: "#a5a0b8"
};

const closeButtonStyle = {
  width: "42px",
  height: "42px",
  borderRadius: "14px",
  border:
    "1px solid rgba(255,255,255,0.1)",
  background:
    "rgba(255,255,255,0.05)",
  color: "white",
  cursor: "pointer"
};

const inputStyle = {
  width: "100%",
  padding: "15px 16px",
  marginBottom: "14px",
  borderRadius: "16px",
  border:
    "1px solid rgba(255,255,255,0.1)",
  background:
    "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};

const tokensSectionStyle = {
  paddingBottom: "80px"
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "end",
  gap: "20px",
  marginBottom: "16px"
};

const sectionTitleStyle = {
  fontSize: "42px",
  margin: 0
};

const sectionSubStyle = {
  color: "#a5a0b8",
  marginTop: "8px"
};

const searchStyle = {
  width: "320px",
  padding: "14px 16px",
  borderRadius: "16px",
  border:
    "1px solid rgba(255,255,255,0.08)",
  background:
    "rgba(255,255,255,0.05)",
  color: "white"
};

const tabsStyle = {
  display: "flex",
  gap: "10px",
  marginBottom: "24px",
  flexWrap: "wrap"
};

const tabButtonStyle = {
  padding: "12px 16px",
  borderRadius: "999px",
  border:
    "1px solid rgba(255,255,255,0.08)",
  background:
    "rgba(255,255,255,0.04)",
  color: "#b8b4c7",
  cursor: "pointer",
  fontWeight: "800"
};

const activeTabStyle = {
  background:
    "rgba(168,85,247,0.18)",
  border:
    "1px solid rgba(192,132,252,0.24)",
  color: "white"
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(auto-fit, minmax(340px, 1fr))",
  gap: "20px"
};

const cardStyle = {
  overflow: "hidden",
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.03))",
  border:
    "1px solid rgba(192,132,252,0.14)",
  borderRadius: "28px",
  transition: "0.2s ease",
  cursor: "pointer"
};

const cardHoverStyle = {
  transform: "translateY(-4px)",
  border:
    "1px solid rgba(216,180,254,0.3)"
};

const cardImageWrapStyle = {
  position: "relative",
  height: "230px",
  background:
    "rgba(0,0,0,0.18)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflow: "hidden",
  borderBottom:
    "1px solid rgba(255,255,255,0.06)"
};

const cardImageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "contain",
  padding: "10px"
};

const fallbackStyle = {
  fontSize: "40px",
  fontWeight: "1000",
  color: "#e9d5ff"
};

const cardStatusStyle = {
  position: "absolute",
  top: "12px",
  right: "12px",
  padding: "8px 10px",
  borderRadius: "999px",
  background:
    "rgba(8,7,13,0.75)",
  border:
    "1px solid rgba(192,132,252,0.24)",
  fontSize: "11px",
  fontWeight: "900"
};

const cardBodyStyle = {
  padding: "20px"
};

const cardTopLineStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  alignItems: "flex-start",
  gap: "12px"
};

const cardSymbolStyle = {
  fontSize: "46px",
  margin: "0 0 6px",
  fontWeight: "1000",
  lineHeight: 1
};

const cardNameStyle = {
  color: "#cfc9de",
  margin: 0,
  fontSize: "15px"
};

const rankStyle = {
  color: "#c084fc",
  fontWeight: "900"
};

const descriptionStyle = {
  color: "#918ba3",
  fontSize: "14px",
  lineHeight: 1.5,
  marginTop: "16px"
};

const metricGridStyle = {
  display: "grid",
  gridTemplateColumns:
    "repeat(2,1fr)",
  gap: "10px",
  marginTop: "18px"
};

const metricStyle = {
  background:
    "rgba(0,0,0,0.18)",
  border:
    "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px",
  padding: "14px",
  display: "flex",
  flexDirection: "column",
  gap: "6px"
};

const progressInfoStyle = {
  display: "flex",
  justifyContent:
    "space-between",
  marginTop: "18px",
  marginBottom: "8px",
  color: "#bdb7cd",
  fontSize: "13px"
};

const progressOuterStyle = {
  height: "10px",
  borderRadius: "999px",
  background:
    "rgba(255,255,255,0.08)",
  overflow: "hidden"
};

const progressInnerStyle = {
  height: "100%",
  background:
    "linear-gradient(90deg,#7c3aed,#c084fc)",
  boxShadow:
    "0 0 18px rgba(192,132,252,0.8)"
};