/**
 * localStorage-backed proof record store.
 * Persists proof submissions so they survive page reloads even when
 * the on-chain submit_proof transaction is skipped (e.g. WitnessPool not
 * initialised on devnet).
 */

export interface LocalProofRecord {
  task_id: string;
  agent_pubkey: string;
  tx_signature: string;
  task_type: string;
  slot: number;
  status: "verified" | "rejected" | "pending";
  submitted_at: number; // Unix seconds
  chain_tx?: string;    // set when submit_proof actually landed on-chain
  witness_count: number;
}

const STORAGE_KEY = "agentproof:proofs_v1";
const MAX_RECORDS = 200;

function readAll(): LocalProofRecord[] {
  try {
    if (typeof window === "undefined") return [];
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
  } catch {
    return [];
  }
}

/** Upsert a proof record (deduped by task_id). */
export function saveProof(record: LocalProofRecord): void {
  if (typeof window === "undefined") return;
  const existing = readAll().filter((r) => r.task_id !== record.task_id);
  const updated = [record, ...existing].slice(0, MAX_RECORDS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
}

/** Return all proof records for a given agent, newest-first. */
export function getProofsByAgent(agentPubkey: string): LocalProofRecord[] {
  return readAll()
    .filter((r) => r.agent_pubkey === agentPubkey)
    .sort((a, b) => b.submitted_at - a.submitted_at);
}
