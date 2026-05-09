import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import "dotenv/config";

async function main() {
  const rpcUrl = "https://testnet-rpc.monad.xyz";
  const privateKey = process.env.PRIVATE_KEY;
  const treasury = process.env.TREASURY_WALLET;

  if (!privateKey) throw new Error("PRIVATE_KEY ontbreekt in .env");
  if (!treasury) throw new Error("TREASURY_WALLET ontbreekt in .env");

  const artifactPath = path.join(
    process.cwd(),
    "artifacts",
    "contracts",
    "FuzeFactory.sol",
    "FuzeFactory.json"
  );

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(`0x${privateKey}`, provider);

  console.log("Deploying from:", wallet.address);
  console.log("Treasury:", treasury);

  const factory = new ethers.ContractFactory(
    artifact.abi,
    artifact.bytecode,
    wallet
  );

  const contract = await factory.deploy(treasury);

  console.log("Deploy tx sent:", contract.deploymentTransaction()?.hash);

  await contract.waitForDeployment();

  console.log("=================================");
  console.log("FUZE FACTORY DEPLOYED");
  console.log("=================================");
  console.log("Factory:", await contract.getAddress());
  console.log("Treasury:", treasury);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});