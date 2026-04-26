import dotenv from "dotenv";
dotenv.config();

import { initApp } from "./api";
import { ChainClient } from "./chain-client";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL ?? "";
const WITNESS_PRIVATE_KEY = process.env.WITNESS_PRIVATE_KEY ?? "";
const AGENTPROOF_PROGRAM_ID = process.env.AGENTPROOF_PROGRAM_ID ?? "";

if (!HELIUS_RPC_URL || !WITNESS_PRIVATE_KEY || !AGENTPROOF_PROGRAM_ID) {
  console.error(
    "Missing required environment variables: HELIUS_RPC_URL, WITNESS_PRIVATE_KEY, AGENTPROOF_PROGRAM_ID"
  );
  process.exit(1);
}

const app = initApp(HELIUS_RPC_URL, WITNESS_PRIVATE_KEY, AGENTPROOF_PROGRAM_ID);

app.listen(PORT, async () => {
  console.log(`🔍 AgentProof Witness Node running on port ${PORT}`);
  console.log(`   RPC: ${HELIUS_RPC_URL.substring(0, 50)}...`);
  console.log(`   Program: ${AGENTPROOF_PROGRAM_ID}`);

  // Startup: airdrop SOL to derived witness keypairs and ensure WitnessPool exists
  try {
    const startupClient = new ChainClient(
      HELIUS_RPC_URL,
      WITNESS_PRIVATE_KEY,
      AGENTPROOF_PROGRAM_ID
    );
    const keys = startupClient.getWitnessPublicKeys();
    console.log(`   Witness[0] (primary): ${keys.primary}`);
    console.log(`   Witness[1]: ${keys.secondary1}`);
    console.log(`   Witness[2]: ${keys.secondary2}`);

    await startupClient.airdropWitnessKeypairs();
    await startupClient.ensureWitnessPool();
  } catch (e) {
    console.warn("[Startup] Chain initialization warning:", e instanceof Error ? e.message : e);
  }
});
