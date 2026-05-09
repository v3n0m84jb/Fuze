import { ethers } from "ethers";
import "dotenv/config";

const POOL_ADDRESS = "0x4BED26352407b38e63B648B2C1e32BDCa1c6F909";
const TOKEN_ADDRESS = "0xDdc1ff63418f8789f6cC0E53eA557B139F6bEf2b";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY ontbreekt");
  }

  const provider = new ethers.JsonRpcProvider(
    "https://testnet-rpc.monad.xyz"
  );

  const wallet = new ethers.Wallet(`0x${privateKey}`, provider);

  console.log("=================================");
  console.log("FUZE BUY TEST V2");
  console.log("=================================");
  console.log("Buyer:", wallet.address);

  const poolAbi = [
    "function buy(uint256 minTokensOut) payable",
    "function getBuyQuote(uint256 monAmount) view returns (uint256)",
    "function currentPrice() view returns (uint256)",
    "function reserveMON() view returns (uint256)",
    "function tokensSold() view returns (uint256)",
    "function ignited() view returns (bool)"
  ];

  const tokenAbi = [
    "function balanceOf(address) view returns (uint256)",
    "function symbol() view returns (string)"
  ];

  const pool = new ethers.Contract(POOL_ADDRESS, poolAbi, wallet);
  const token = new ethers.Contract(TOKEN_ADDRESS, tokenAbi, wallet);

  const buyAmount = ethers.parseEther("0.02");

  const symbol = await token.symbol();
  const priceBefore = await pool.currentPrice();
  const quote = await pool.getBuyQuote(buyAmount);

  console.log("Buy amount:", ethers.formatEther(buyAmount), "MON");
  console.log("Current price:", ethers.formatUnits(priceBefore, 18), "MON");
  console.log("Expected tokens:", ethers.formatUnits(quote, 18), symbol);

  const tx = await pool.buy(0, {
    value: buyAmount
  });

  console.log("Buy tx:", tx.hash);

  await tx.wait();

  const balance = await token.balanceOf(wallet.address);
  const reserve = await pool.reserveMON();
  const sold = await pool.tokensSold();
  const priceAfter = await pool.currentPrice();
  const ignited = await pool.ignited();

  console.log("=================================");
  console.log("BUY COMPLETE ✅");
  console.log("=================================");
  console.log("Token balance:", ethers.formatUnits(balance, 18), symbol);
  console.log("Reserve MON:", ethers.formatEther(reserve));
  console.log("Tokens sold:", ethers.formatUnits(sold, 18));
  console.log("New price:", ethers.formatUnits(priceAfter, 18), "MON");
  console.log("Ignited:", ignited);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});