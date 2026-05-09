import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

import Header from "../components/Header";
import { supabase } from "../lib/supabase";

import {
  FACTORY_ADDRESS,
  FACTORY_ABI,
  FACTORY_READ_ABI,
  CREATE_FEE
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

  useEffect(() => {
    loadTokens();
  }, []);

  async function loadTokens() {
    try {
      const { data, error } = await supabase
        .from("tokens")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data?.length) {
        setTokens(
          data.map((item) => ({
            token: item.token_address,
            pool: item.pool_address,
            creator: item.creator_address,
            name: item.name,
            symbol: item.symbol,
            description: item.description,
            imageUrl: item.image_url,
            website: item.website,
            telegram: item.telegram,
            twitter: item.twitter
          }))
        );
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
          symbol: item.symbol
        });
      }

      setTokens(loaded);
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

  const filteredTokens = tokens.filter((token) => {
    const q = search.toLowerCase();
    return (
      token.name?.toLowerCase().includes(q) ||
      token.symbol?.toLowerCase().includes(q)
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
            <button style={ghostButtonStyle}>Explore</button>
            <button style={ghostButtonStyle}>Trending</button>
            <button onClick={() => setShowCreate(true)} style={launchButtonStyle}>
              Launch Token
            </button>
          </div>
        </nav>

        <section style={heroStyle}>
          <div>
            <div style={badgeStyle}>⚡ MONAD TESTNET LIVE</div>

            <h1 style={heroTitleStyle}>
              Launch. Trade. <span style={purpleTextStyle}>Ignite.</span>
            </h1>

            <p style={heroTextStyle}>
              A high-voltage meme launchpad for Monad. Create tokens, build momentum,
              and push them through bonding.
            </p>

            <div style={heroButtonsStyle}>
              <button onClick={() => setShowCreate(true)} style={mainCtaStyle}>
                Create Token
              </button>

              <button
                onClick={() =>
                  document
                    .getElementById("tokens")
                    ?.scrollIntoView({ behavior: "smooth" })
                }
                style={secondaryCtaStyle}
              >
                View Live Tokens
              </button>
            </div>
          </div>

          <div style={heroCardStyle}>
            <img src="/logo.jpg" alt="Fuze" style={heroLogoStyle} />

            <div style={statRowStyle}>
              <div>
                <strong>{tokens.length}</strong>
                <span>Live Tokens</span>
              </div>
              <div>
                <strong>1 MON</strong>
                <span>Create Fee</span>
              </div>
              <div>
                <strong>0.2</strong>
                <span>Ignite MON</span>
              </div>
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
              <h2 style={sectionTitleStyle}>Live Tokens</h2>
              <p style={sectionSubStyle}>Fresh launches on FUZE.</p>
            </div>

            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search token..."
              style={searchStyle}
            />
          </div>

          <div style={gridStyle}>
            {filteredTokens.map((token, index) => (
              <article
                key={index}
                onClick={() => navigate(`/token/${token.pool}`)}
                style={cardStyle}
              >
                <div style={cardTopStyle}>
                  <div style={imageWrapStyle}>
                    {token.imageUrl ? (
                      <img src={token.imageUrl} alt={token.symbol} style={imageStyle} />
                    ) : (
                      <span style={fallbackStyle}>{token.symbol?.slice(0, 2)}</span>
                    )}
                  </div>

                  <span style={statusBadgeStyle}>BONDING</span>
                </div>

                <h3 style={cardSymbolStyle}>{token.symbol}</h3>
                <p style={cardNameStyle}>{token.name}</p>

                {token.description && (
                  <p style={descriptionStyle}>{token.description}</p>
                )}

                <div style={miniProgressOuterStyle}>
                  <div style={miniProgressInnerStyle} />
                </div>

                <div style={cardFooterStyle}>
                  <span>Pool</span>
                  <strong>
                    {token.pool.slice(0, 6)}...{token.pool.slice(-4)}
                  </strong>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

const pageStyle = {
  minHeight: "100vh",
  position: "relative",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, #2b0b4f 0%, #08070d 35%, #030305 100%)",
  color: "white",
  fontFamily: "Inter, Arial, sans-serif",
  padding: "28px"
};

const bgGlowOne = {
  position: "fixed",
  width: "520px",
  height: "520px",
  top: "-160px",
  right: "-100px",
  background: "rgba(168,85,247,0.28)",
  filter: "blur(120px)",
  pointerEvents: "none"
};

const bgGlowTwo = {
  position: "fixed",
  width: "420px",
  height: "420px",
  bottom: "-140px",
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
  boxShadow: "0 0 40px rgba(168,85,247,0.12)"
};

const brandStyle = {
  display: "flex",
  alignItems: "center",
  gap: "14px"
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
  color: "#c4b5fd",
  marginTop: "2px"
};

const navActionsStyle = {
  display: "flex",
  alignItems: "center",
  gap: "10px"
};

const ghostButtonStyle = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.1)",
  color: "#ddd6fe",
  padding: "12px 16px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "700"
};

const launchButtonStyle = {
  background: "linear-gradient(135deg, #7c3aed, #c084fc)",
  border: "none",
  color: "white",
  padding: "13px 18px",
  borderRadius: "14px",
  cursor: "pointer",
  fontWeight: "900",
  boxShadow: "0 0 24px rgba(168,85,247,0.45)"
};

const heroStyle = {
  display: "grid",
  gridTemplateColumns: "1.1fr 0.9fr",
  gap: "44px",
  alignItems: "center",
  padding: "80px 0 70px"
};

const badgeStyle = {
  display: "inline-block",
  color: "#e9d5ff",
  background: "rgba(168,85,247,0.14)",
  border: "1px solid rgba(192,132,252,0.25)",
  borderRadius: "999px",
  padding: "10px 14px",
  fontSize: "13px",
  fontWeight: "900",
  marginBottom: "22px"
};

const heroTitleStyle = {
  fontSize: "82px",
  lineHeight: "0.95",
  margin: 0,
  letterSpacing: "-4px",
  fontWeight: "1000"
};

const purpleTextStyle = {
  color: "#c084fc",
  textShadow: "0 0 40px rgba(192,132,252,0.9)"
};

const heroTextStyle = {
  maxWidth: "650px",
  color: "#b8b4c7",
  fontSize: "20px",
  lineHeight: "1.55",
  margin: "28px 0 0"
};

const heroButtonsStyle = {
  display: "flex",
  gap: "14px",
  marginTop: "34px"
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

const secondaryCtaStyle = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.14)",
  color: "#ddd6fe",
  padding: "16px 24px",
  borderRadius: "16px",
  fontSize: "16px",
  cursor: "pointer",
  fontWeight: "800"
};

const heroCardStyle = {
  background:
    "linear-gradient(180deg, rgba(168,85,247,0.18), rgba(255,255,255,0.04))",
  border: "1px solid rgba(192,132,252,0.24)",
  borderRadius: "32px",
  padding: "26px",
  boxShadow: "0 0 80px rgba(168,85,247,0.18)"
};

const heroLogoStyle = {
  width: "100%",
  borderRadius: "26px",
  objectFit: "cover",
  boxShadow: "0 0 70px rgba(168,85,247,0.35)"
};

const statRowStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "12px",
  marginTop: "16px"
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
  paddingBottom: "80px"
};

const sectionHeaderStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "end",
  gap: "20px",
  marginBottom: "24px"
};

const sectionTitleStyle = {
  fontSize: "38px",
  margin: 0
};

const sectionSubStyle = {
  color: "#a5a0b8",
  margin: "8px 0 0"
};

const searchStyle = {
  width: "320px",
  padding: "15px 16px",
  borderRadius: "16px",
  border: "1px solid rgba(192,132,252,0.18)",
  background: "rgba(255,255,255,0.055)",
  color: "white",
  outline: "none"
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "20px"
};

const cardStyle = {
  background:
    "linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035))",
  border: "1px solid rgba(192,132,252,0.16)",
  borderRadius: "26px",
  padding: "22px",
  cursor: "pointer",
  transition: "0.2s ease",
  boxShadow: "0 0 40px rgba(168,85,247,0.08)"
};

const cardTopStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "20px"
};

const imageWrapStyle = {
  width: "72px",
  height: "72px",
  borderRadius: "20px",
  overflow: "hidden",
  background: "rgba(168,85,247,0.16)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  boxShadow: "0 0 24px rgba(168,85,247,0.24)"
};

const imageStyle = {
  width: "100%",
  height: "100%",
  objectFit: "cover"
};

const fallbackStyle = {
  fontWeight: "900",
  fontSize: "22px",
  color: "#e9d5ff"
};

const statusBadgeStyle = {
  fontSize: "11px",
  fontWeight: "900",
  color: "#d8b4fe",
  border: "1px solid rgba(192,132,252,0.2)",
  background: "rgba(168,85,247,0.12)",
  padding: "8px 10px",
  borderRadius: "999px"
};

const cardSymbolStyle = {
  fontSize: "30px",
  margin: "0 0 6px",
  fontWeight: "950"
};

const cardNameStyle = {
  color: "#d6d3e4",
  margin: "0 0 12px"
};

const descriptionStyle = {
  color: "#918ba3",
  fontSize: "14px",
  lineHeight: "1.45",
  minHeight: "40px"
};

const miniProgressOuterStyle = {
  height: "8px",
  background: "rgba(255,255,255,0.08)",
  borderRadius: "999px",
  overflow: "hidden",
  margin: "18px 0"
};

const miniProgressInnerStyle = {
  width: "18%",
  height: "100%",
  background: "linear-gradient(90deg, #7c3aed, #c084fc)"
};

const cardFooterStyle = {
  display: "flex",
  justifyContent: "space-between",
  color: "#8f8a9f",
  fontSize: "13px"
};