import { ethers } from "ethers";
import "dotenv/config";

const POOL_ADDRESS = "0x4BED26352407b38e63B648B2C1e32BDCa1c6F909";
const TOKEN_ADDRESS = "0xDdc1ff63418f8789f6cC0E53eA557B139F6bEf2b";

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY ontbreekt");

  const provider = new ethers.JsonRpcProvider("https://testnet-rpc.monad.xyz");
  const wallet = new ethers.Wallet(`0x${privateKey}`, provider);

  const tokenAbi = [
    "function approve(address spender, uint256 amount) returns (bool)",
    "function balanceOf(address account) view returns (uint256)",
    "function symbol() view returns (string)"
  ];

  const poolAbi = [
    "function sell(uint256 tokenAmount, uint256 minMonOut)",
    "function getSellQuote(uint256 tokenAmount) view returns (uint256)",
    "function currentPrice() view returns (uint256)",
    "function reserveMON() view returns (uint256)",
    "function tokensSold() view returns (uint256)",
    "function ignited() view returns (bool)"
  ];

  const token = new ethers.Contract(TOKEN_ADDRESS, tokenAbi, wallet);
  const pool = new ethers.Contract(POOL_ADDRESS, poolAbi, wallet);

  const symbol = await token.symbol();
  const sellAmount = ethers.parseUnits("100", 18);

  const quote = await pool.getSellQuote(sellAmount);
  const priceBefore = await pool.currentPrice();

  console.log("=================================");
  console.log("FUZE SELL TEST V2");
  console.log("=================================");
  console.log("Seller:", wallet.address);
  console.log("Selling:", ethers.formatUnits(sellAmount, 18), symbol);
  console.log("Current price:", ethers.formatUnits(priceBefore, 18), "MON");
  console.log("Expected MON:", ethers.formatEther(quote));

  const approveTx = await token.approve(POOL_ADDRESS, sellAmount);
  console.log("Approve tx:", approveTx.hash);
  await approveTx.wait();

  const sellTx = await pool.sell(sellAmount, 0);
  console.log("Sell tx:", sellTx.hash);
  await sellTx.wait();

  const balance = await token.balanceOf(wallet.address);
  const reserve = await pool.reserveMON();
  const sold = await pool.tokensSold();
  const priceAfter = await pool.currentPrice();
  const ignited = await pool.ignited();

  console.log("=================================");
  console.log("SELL COMPLETE ✅");
  console.log("=================================");
  console.log("Token balance:", ethers.formatUnits(balance, 18), symbol);
  console.log("Reserve MON:", ethers.formatEther(reserve));
  console.log("Tokens sold:", ethers.formatUnits(sold, 18));
  console.log("Current price:", ethers.formatUnits(priceAfter, 18), "MON");
  console.log("Ignited:", ignited);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});