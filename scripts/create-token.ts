import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

const FACTORY_ADDRESS = "0xBE22daf903Fa799AC1EfdCAA2880abe865692Ffe";

async function main() {

  const privateKey = process.env.PRIVATE_KEY;

  if (!privateKey) {
    throw new Error("PRIVATE_KEY ontbreekt");
  }

  const provider = new ethers.JsonRpcProvider(
    "https://testnet-rpc.monad.xyz"
  );

  const wallet = new ethers.Wallet(
    `0x${privateKey}`,
    provider
  );

  const artifactPath = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    "FuzeFactory.sol",
    "FuzeFactory.json"
  );

  const artifact = JSON.parse(
    fs.readFileSync(artifactPath, "utf8")
  );

  const factory = new ethers.Contract(
    FACTORY_ADDRESS,
    artifact.abi,
    wallet
  );

  console.log("=================================");
  console.log("FUZE TOKEN CREATION");
  console.log("=================================");
  console.log("Creator:", wallet.address);

  const tx = await factory.createToken(
    "Fuze Dog",
    "FDOG",
    {
      value: ethers.parseEther("1")
    }
  );

  console.log("Create tx:", tx.hash);

  const receipt = await tx.wait();

  console.log("=================================");
  console.log("TOKEN CREATED ✅");
  console.log("=================================");
  console.log("Block:", receipt.blockNumber);

  for (const log of receipt.logs) {

    try {

      const parsed = factory.interface.parseLog(log);

      if (parsed && parsed.name === "TokenCreated") {

        console.log("Token address:", parsed.args.token);
        console.log("Pool address:", parsed.args.pool);
        console.log("Creator:", parsed.args.creator);
        console.log("Name:", parsed.args.name);
        console.log("Symbol:", parsed.args.symbol);
      }

    } catch {}
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});