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
  const [loading, setLoading] = useState(false);
  const [tokens, setTokens] = useState([]);

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

      if (data && data.length > 0) {
        setTokens(
          data.map((item) => ({
            token: item.token_address,
            pool: item.pool_address,
            creator: item.creator_address,
            name: item.name,
            symbol: item.symbol
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
          symbol: item.symbol,
          createdAt: item.createdAt
        });
      }

      setTokens(loaded);
    } catch (err) {
      console.error(err);
    }
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
        {
          value: ethers.parseEther(CREATE_FEE)
        }
      );

      const receipt = await tx.wait();

      let created = null;

      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);

          if (parsed && parsed.name === "TokenCreated") {
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
          symbol: created.symbol
        });

        if (error) {
          console.error(error);
        }
      }

      setTokenName("");
      setTokenSymbol("");
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

  return (
    <main style={pageStyle}>
      <div style={containerStyle}>
        <Header />

        <section style={heroStyle}>
          <h2 style={heroTitleStyle}>Launch memes on Monad</h2>

          <p style={heroTextStyle}>
            Create and trade meme coins in seconds.
          </p>

          <button
            onClick={() => setShowCreate(true)}
            style={heroButtonStyle}
          >
            Create Token
          </button>
        </section>

        {showCreate && (
          <section style={createBoxStyle}>
            <h3 style={createTitleStyle}>Create new token</h3>

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

            <button
              onClick={createToken}
              disabled={loading}
              style={{
                ...primaryButtonStyle,
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? "Creating..." : `Launch Token (${CREATE_FEE} MON)`}
            </button>
          </section>
        )}

        <section>
          <h3 style={sectionTitleStyle}>Live Tokens</h3>

          <div style={gridStyle}>
            {tokens.map((token, index) => (
              <article
                key={index}
                onClick={() => navigate(`/token/${token.pool}`)}
                style={cardStyle}
              >
                <h4 style={cardSymbolStyle}>{token.symbol}</h4>

                <p style={cardNameStyle}>{token.name}</p>

                <p style={cardAddressStyle}>
                  Pool: {token.pool.slice(0, 6)}...{token.pool.slice(-4)}
                </p>
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

const heroStyle = {
  textAlign: "center",
  padding: "60px 0"
};

const heroTitleStyle = {
  fontSize: "72px",
  marginBottom: "20px"
};

const heroTextStyle = {
  fontSize: "22px",
  opacity: 0.7,
  marginBottom: "40px"
};

const heroButtonStyle = {
  background: "#7c3aed",
  border: "none",
  color: "white",
  padding: "18px 32px",
  borderRadius: "16px",
  fontSize: "18px",
  cursor: "pointer",
  fontWeight: "bold"
};

const createBoxStyle = {
  maxWidth: "460px",
  margin: "0 auto 60px",
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: "24px",
  padding: "28px"
};

const createTitleStyle = {
  fontSize: "28px",
  marginBottom: "20px"
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

const sectionTitleStyle = {
  fontSize: "32px",
  marginBottom: "24px"
};

const gridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
  gap: "20px"
};

const cardStyle = {
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "20px",
  padding: "24px",
  cursor: "pointer"
};

const cardSymbolStyle = {
  fontSize: "24px",
  marginBottom: "8px"
};

const cardNameStyle = {
  opacity: 0.7,
  marginBottom: "20px"
};

const cardAddressStyle = {
  fontSize: "14px",
  opacity: 0.6
};