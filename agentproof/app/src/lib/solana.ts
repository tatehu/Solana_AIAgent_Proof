import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";

export const NETWORK = process.env.NEXT_PUBLIC_SOLANA_NETWORK ?? "devnet";
export const RPC_URL =
  process.env.NEXT_PUBLIC_HELIUS_RPC_URL ?? clusterApiUrl("devnet");

export const connection = new Connection(RPC_URL, "confirmed");

export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_AGENTPROOF_PROGRAM_ID ??
    "AgPr111111111111111111111111111111111111111"
);

export const WITNESS_NODE_URL =
  process.env.NEXT_PUBLIC_WITNESS_NODE_URL ?? "http://localhost:3001";
export const RISK_MONITOR_URL =
  process.env.NEXT_PUBLIC_RISK_MONITOR_URL ?? "http://localhost:8000";

export function getAgentRecordPDA(agentPubkey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentPubkey.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function getTaskProofPDA(taskId: Buffer): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("proof"), taskId],
    PROGRAM_ID
  );
  return pda;
}
