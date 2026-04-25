"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, RPC_URL } from "@/lib/solana";
import { agentProof, type AgentInfo, type RiskScore } from "@/lib/agentproof-sdk";
import Link from "next/link";
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  Activity,
  ExternalLink,
  Clock,
} from "lucide-react";

// ── TaskProof PDA layout ──────────────────────────────────────────────────────
// disc(8) + task_id(32) + agent_pubkey(32) + instruction_hash(32) +
// input_hash(32) + output_hash(32) + tx_signature(64) + slot(8) +
// task_type(1) + witnesses(96) + witness_signatures(192) + witness_status(3) +
// signature_count(1) + status(1) + submitted_at(8) + settled_at(8)

const TASK_PROOF_DISC = Buffer.from([217, 208, 14, 234, 191, 204, 81, 220]);

interface TaskProof {
  task_id: string;
  output_hash: string;
  input_hash: string;
  tx_signature: string;
  slot: number;
  task_type: number;
  signature_count: number;
  status: 0 | 1 | 2; // 0=pending 1=verified 2=rejected
  submitted_at: number;
  settled_at: number;
}

function parseTaskProof(data: Buffer): TaskProof | null {
  try {
    let o = 8; // skip discriminator
    const task_id = data.slice(o, o + 32).toString("hex"); o += 32;
    o += 32; // agent_pubkey
    o += 32; // instruction_hash
    const input_hash = data.slice(o, o + 32).toString("hex"); o += 32;
    const output_hash = data.slice(o, o + 32).toString("hex"); o += 32;
    const tx_signature = data.slice(o, o + 64).toString("hex"); o += 64;
    const slot = Number(data.readBigUInt64LE(o)); o += 8;
    const task_type = data[o]; o += 1;
    o += 96 + 192 + 3; // witnesses, witness_signatures, witness_status
    const signature_count = data[o]; o += 1;
    const status = data[o] as 0 | 1 | 2; o += 1;
    const submitted_at = Number(data.readBigInt64LE(o)); o += 8;
    const settled_at = Number(data.readBigInt64LE(o));
    return { task_id, output_hash, input_hash, tx_signature, slot, task_type, signature_count, status, submitted_at, settled_at };
  } catch {
    return null;
  }
}

async function fetchTaskProofs(agentPubkey: string): Promise<TaskProof[]> {
  const connection = new Connection(RPC_URL, "confirmed");
  const agentKey = new PublicKey(agentPubkey);
  const agentBytes = agentKey.toBuffer();

  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: TASK_PROOF_DISC.toString("base64"), encoding: "base64" } },
      { memcmp: { offset: 40, bytes: agentBytes.toString("base64"), encoding: "base64" } },
    ],
  });

  const proofs = accounts
    .map(({ account }) => parseTaskProof(account.data as unknown as Buffer))
    .filter((p): p is TaskProof => p !== null);

  proofs.sort((a, b) => b.submitted_at - a.submitted_at);
  return proofs;
}

async function fetchAgentOnChain(pubkey: string): Promise<(AgentInfo & { capability_hash: string }) | null> {
  const connection = new Connection(RPC_URL, "confirmed");
  const agent = new PublicKey(pubkey);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agent.toBuffer()],
    PROGRAM_ID
  );
  const info = await connection.getAccountInfo(pda);
  if (!info) return null;
  const d = info.data as unknown as Buffer;
  // Old on-chain accounts (124 bytes) lack the safety_index field added later;
  // new accounts (132 bytes) include it between credit_score and tasks_completed.
  let o = 8;
  const agent_pubkey = new PublicKey(d.slice(o, o + 32)).toBase58(); o += 32;
  const capability_hash = d.slice(o, o + 32).toString("hex"); o += 32;
  const staked_lamports = Number(d.readBigUInt64LE(o)); o += 8;
  const credit_score = Number(d.readBigUInt64LE(o)); o += 8;
  let safety_index = 50;
  if (d.length >= 132) { safety_index = Number(d.readBigUInt64LE(o)); o += 8; }
  const tasks_completed = Number(d.readBigUInt64LE(o)); o += 8;
  const tasks_failed = Number(d.readBigUInt64LE(o)); o += 8;
  const success_rate_bps = d.readUInt16LE(o); o += 2;
  const is_frozen = d[o] === 1; o += 1;
  const registered_at = Number(d.readBigInt64LE(o));
  return {
    agent_pubkey, capability_hash, staked_lamports, credit_score, safety_index,
    tasks_completed, tasks_failed,
    success_rate: success_rate_bps / 100,
    is_frozen, registered_at,
  };
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<number, string> = { 0: "Pending", 1: "Verified", 2: "Rejected" };
const STATUS_COLOR: Record<number, string> = {
  0: "text-yellow-400 bg-yellow-900/30 border-yellow-700",
  1: "text-green-400 bg-green-900/30 border-green-700",
  2: "text-red-400 bg-red-900/30 border-red-700",
};

// ── Page ──────────────────────────────────────────────────────────────────────
export default function AgentDetailPage() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const [agent, setAgent] = useState<(AgentInfo & { capability_hash?: string }) | null>(null);
  const [proofs, setProofs] = useState<TaskProof[]>([]);
  const [risk, setRisk] = useState<RiskScore | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    Promise.all([
      fetchAgentOnChain(pubkey),
      fetchTaskProofs(pubkey),
      agentProof.analyzeAgent(pubkey).catch(() => null),
    ])
      .then(([a, p, r]) => {
        setAgent(a);
        setProofs(p);
        setRisk(r);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [pubkey]);

  if (loading) return <div className="text-center py-20 text-gray-400">Loading...</div>;
  if (error) return <div className="text-red-400 py-10">Error: {error}</div>;
  if (!agent) return <div className="text-gray-400 py-10">Agent not found on-chain.</div>;

  const stakedSOL = (agent.staked_lamports / 1e9).toFixed(3);
  const registeredDate = new Date((agent.registered_at as number) * 1000).toLocaleString();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Shield className={`h-8 w-8 ${agent.is_frozen ? "text-red-400" : "text-purple-400"}`} />
        <div>
          <h1 className="text-2xl font-bold">Agent Detail</h1>
          <p className="font-mono text-sm text-gray-400 break-all">{agent.agent_pubkey}</p>
        </div>
        {agent.is_frozen && (
          <span className="ml-auto bg-red-900/50 text-red-300 border border-red-700 px-3 py-1 rounded-full text-sm">
            FROZEN
          </span>
        )}
      </div>

      {/* Stats */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 grid grid-cols-2 md:grid-cols-3 gap-4">
        <Stat label="Credit Score" value={String(agent.credit_score)} unit="/ 100" />
        <Stat label="Safety Index" value={String(agent.safety_index)} unit="/ 100" />
        <Stat label="Staked" value={stakedSOL} unit="SOL" />
        <Stat label="Tasks Done" value={String(agent.tasks_completed)} />
        <Stat label="Tasks Failed" value={String(agent.tasks_failed)} />
        <Stat label="Success Rate" value={agent.success_rate.toFixed(1)} unit="%" />
        <Stat label="Registered" value={registeredDate} small />
      </div>

      {/* Risk Score */}
      {risk && (
        <div className={`rounded-xl border p-5 flex items-start justify-between gap-4 ${
          risk.level === "danger" ? "bg-red-900/10 border-red-700" :
          risk.level === "warning" ? "bg-yellow-900/10 border-yellow-700" :
          "bg-green-900/10 border-green-700"
        }`}>
          <div>
            <div className="text-sm text-gray-400 mb-1">Risk Score</div>
            <div className={`text-5xl font-bold ${
              risk.level === "danger" ? "text-red-400" :
              risk.level === "warning" ? "text-yellow-400" : "text-green-400"
            }`}>
              {risk.score.toFixed(0)}
            </div>
            <div className="text-sm uppercase font-semibold text-gray-400 mt-1">{risk.level}</div>
            {risk.reasons.length > 0 && (
              <div className="mt-3 space-y-1">
                {risk.reasons.map((r, i) => (
                  <div key={i} className="text-xs text-gray-300 flex items-center gap-1.5">
                    <span className="text-red-400">⚠</span> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1 text-right shrink-0">
            {Object.entries(risk.breakdown).map(([key, val]) => (
              <div key={key} className="text-xs">
                <span className="text-gray-500 capitalize">{key.replace(/_/g, " ")}: </span>
                <span className={val > 20 ? "text-red-400 font-bold" : "text-gray-300"}>
                  {(val as number).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Capability Hash */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
        <div className="text-sm text-gray-400 mb-1">Capability Hash (SHA-256)</div>
        <div className="font-mono text-xs text-purple-300 break-all">
          {(agent as AgentInfo & { capability_hash?: string }).capability_hash}
        </div>
      </div>

      {/* TaskProof History */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Activity className="h-5 w-5 text-purple-400" />
          TaskProof History ({proofs.length})
        </h2>
        {proofs.length === 0 ? (
          <div className="text-gray-500 text-sm text-center py-8">
            No TaskProofs found on-chain for this agent.
          </div>
        ) : (
          <div className="space-y-3">
            {proofs.map((proof) => (
              <div
                key={proof.task_id}
                className="rounded-lg border border-gray-800 p-4 hover:border-gray-700 transition-colors"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${STATUS_COLOR[proof.status]}`}>
                        {proof.status === 1 ? <CheckCircle className="h-3 w-3 inline mr-1" /> :
                         proof.status === 2 ? <AlertTriangle className="h-3 w-3 inline mr-1" /> :
                         <Clock className="h-3 w-3 inline mr-1" />}
                        {STATUS_LABEL[proof.status]}
                      </span>
                      <span className="text-xs text-gray-500">
                        {proof.signature_count}/3 signatures
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-gray-400 font-mono">
                      <div className="flex gap-2">
                        <span className="text-gray-600 w-20 shrink-0">task_id</span>
                        <span className="text-gray-300 truncate">{proof.task_id.slice(0, 40)}...</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-600 w-20 shrink-0">output</span>
                        <span className="text-gray-300 truncate">{proof.output_hash.slice(0, 40)}...</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-gray-600 w-20 shrink-0">input</span>
                        <span className="text-gray-300 truncate">{proof.input_hash.slice(0, 40)}...</span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0 space-y-1">
                    <div className="text-xs text-gray-500">slot {proof.slot.toLocaleString()}</div>
                    <div className="text-xs text-gray-500">
                      {proof.submitted_at > 0
                        ? new Date(proof.submitted_at * 1000).toLocaleString()
                        : "—"}
                    </div>
                    <a
                      href={`https://explorer.solana.com/address/${pubkey}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300"
                    >
                      Explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <Link href="/" className="inline-block text-sm text-gray-400 hover:text-white">
        ← Back to Dashboard
      </Link>
    </div>
  );
}

function Stat({ label, value, unit, small }: { label: string; value: string; unit?: string; small?: boolean }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className={`font-bold ${small ? "text-sm text-gray-300" : "text-2xl"}`}>
        {value}
        {unit && <span className="text-sm font-normal text-gray-400 ml-1">{unit}</span>}
      </div>
    </div>
  );
}
