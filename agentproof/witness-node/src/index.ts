import dotenv from "dotenv";
dotenv.config();

import { initApp } from "./api";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL ?? "";
const WITNESS_PRIVATE_KEY = process.env.WITNESS_PRIVATE_KEY ?? "";

if (!HELIUS_RPC_URL || !WITNESS_PRIVATE_KEY) {
  console.error(
    "Missing required environment variables: HELIUS_RPC_URL, WITNESS_PRIVATE_KEY"
  );
  process.exit(1);
}

const app = initApp(HELIUS_RPC_URL, WITNESS_PRIVATE_KEY);

app.listen(PORT, () => {
  console.log(`🔍 AgentProof Witness Node running on port ${PORT}`);
  console.log(`   RPC: ${HELIUS_RPC_URL.substring(0, 50)}...`);
});
