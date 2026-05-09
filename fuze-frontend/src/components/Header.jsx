import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ethers } from "ethers";

export default function Header() {
  const [wallet, setWallet] = useState("");
  const navigate = useNavigate();

  async function connectWallet() {
    if (!window.ethereum) {
      alert("MetaMask niet gevonden");
      return;
    }

    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    setWallet(accounts[0]);
  }

  return (
    <div style={headerStyle}>
      <h1 onClick={() => navigate("/")} style={logoStyle}>
        FUZE 🔥
      </h1>

      <button onClick={connectWallet} style={buttonStyle}>
        {wallet
          ? wallet.slice(0, 6) + "..." + wallet.slice(-4)
          : "Connect Wallet"}
      </button>
    </div>
  );
}

const headerStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "60px"
};

const logoStyle = {
  fontSize: "32px",
  cursor: "pointer"
};

const buttonStyle = {
  background: "#7c3aed",
  border: "none",
  color: "white",
  padding: "12px 20px",
  borderRadius: "12px",
  cursor: "pointer",
  fontWeight: "bold"
};