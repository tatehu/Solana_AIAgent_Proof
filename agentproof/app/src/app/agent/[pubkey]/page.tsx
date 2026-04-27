"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { Connection, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, RPC_URL, RISK_MONITOR_URL } from "@/lib/solana";
import { agentProof, type AgentInfo, type RiskScore } from "@/lib/agentproof-sdk";
import Link from "next/link";
import {
  Shield,
  CheckCircle,
  AlertTriangle,
  Activity,
  ExternalLink,
  Clock,
  TrendingUp,
  Zap,
  AlertOctagon,
  ArrowLeft,
} from "lucide-react";

import { TASK_TYPES } from "@/lib/task-types";
import { ScoreBadge } from "@/components/ScoreBadge";
import { ScoreTrendChart } from "@/components/ScoreTrendChart";
import { InsuranceModal } from "@/components/InsuranceModal";
import { getProofsByAgent } from "@/lib/proof-store";

interface AgentManifest {
  name: string;
  description: string;
  capabilities: { task_type: string; description: string }[];
  version: string;
  external_url?: string;
  framework?: string;
}

interface ReputationScore {
  agent_id: string;
  total_score: number;
  grade: string;
  behavior_safety: number;
  completion_rate: number;
  fund_risk: number;
  compliance: number;
  activity_decay: number;
  premium_multiplier: number | null;
  has_manifest: boolean;
  framework: string | null;
  external_url: string | null;
  tx_count: number;
  anomaly_count: number;
  max_single_sol: number;
}

interface ScoreHistoryPoint {
  scored_at: number;
  total_score: number;
}

async function fetchManifest(pubkey: string): Promise<AgentManifest | null> {
  try {
    const res = await fetch(`${RISK_MONITOR_URL}/manifest/pubkey/${pubkey}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.manifest ?? null;
  } catch {
    return null;
  }
}

async function fetchReputationScore(pubkey: string): Promise<ReputationScore | null> {
  try {
    const res = await fetch(`${RISK_MONITOR_URL}/api/v1/reputation/${pubkey}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchScoreHistory(pubkey: string): Promise<ScoreHistoryPoint[]> {
  try {
    const res = await fetch(`${RISK_MONITOR_URL}/api/v1/reputation/${pubkey}/history`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.history ?? [];
  } catch {
    return [];
  }
}

const TASK_PROOF_DISC = Buffer.from([217, 208, 14, 234, 191, 204, 81, 220]);

interface TaskProof {
  task_id: string;
  output_hash: string;
  input_hash: string;
  tx_signature: string;
  slot: number;
  task_type: number;
  signature_count: number;
  status: 0 | 1 | 2;
  submitted_at: number;
  settled_at: number;
}

function parseTaskProof(data: Buffer): TaskProof | null {
  try {
    let o = 8;
    const task_id = data.slice(o, o + 32).toString("hex"); o += 32;
    o += 32;
    o += 32;
    const input_hash = data.slice(o, o + 32).toString("hex"); o += 32;
    const output_hash = data.slice(o, o + 32).toString("hex"); o += 32;
    const tx_signature = data.slice(o, o + 64).toString("hex"); o += 64;
    const slot = Number(data.readBigUInt64LE(o)); o += 8;
    const task_type = data[o]; o += 1;
    o += 96 + 192 + 3;
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
  try {
    const connection = new Connection(RPC_URL, "confirmed");
    const agentKey = new PublicKey(agentPubkey);

    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: Buffer.from(TASK_PROOF_DISC).toString("base64"), encoding: "base64" as never } },
        { memcmp: { offset: 40, bytes: agentKey.toBase58() } },
      ],
    });

    const proofs = accounts
      .map(({ account }) => parseTaskProof(account.data as unknown as Buffer))
      .filter((p): p is TaskProof => p !== null);

    proofs.sort((a, b) => b.submitted_at - a.submitted_at);
    return proofs;
  } catch {
    return [];
  }
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

const STATUS_LABEL: Record<number, string> = { 0: "Pending", 1: "Verified", 2: "Rejected" };
const STATUS_COLOR: Record<number, string> = {
  0: "text-amber-400 bg-amber-500/15 border-amber-500/30",
  1: "text-emerald-400 bg-emerald-500/15 border-emerald-500/30",
  2: "text-rose-400 bg-rose-500/15 border-rose-500/30",
};

/** Unified proof entry for display — merges on-chain PDAs and localStorage records. */
interface DisplayProof {
  task_id: string;
  tx_signature: string;
  slot: number;
  task_type: string;
  status: 0 | 1 | 2; // 0=pending, 1=verified, 2=rejected
  submitted_at: number;
  signature_count: number;
  source: "chain" | "local";
}

function taskProofToDisplay(p: TaskProof): DisplayProof {
  const taskTypeKey = Object.keys({ SOLANA_SWAP: 1, DATA_ANALYSIS: 2, REPORT_GENERATION: 3, DEFI_OPERATION: 4, CUSTOM: 5 })[p.task_type - 1] ?? "CUSTOM";
  return {
    task_id: p.task_id,
    tx_signature: p.tx_signature,
    slot: p.slot,
    task_type: taskTypeKey,
    status: p.status,
    submitted_at: p.submitted_at,
    signature_count: p.signature_count,
    source: "chain",
  };
}

const SCORE_DIMENSIONS = [
  { key: "behavior_safety" as const, label: "Behavior Safety", max: 35, color: "from-emerald-500 to-teal-500" },
  { key: "completion_rate" as const, label: "Completion Rate", max: 25, color: "from-blue-500 to-cyan-500" },
  { key: "fund_risk" as const, label: "Fund Risk", max: 20, color: "from-amber-500 to-yellow-500" },
  { key: "compliance" as const, label: "SDK Compliance", max: 12, color: "from-violet-500 to-purple-500" },
  { key: "activity_decay" as const, label: "Activity", max: 8, color: "from-pink-500 to-rose-500" },
];

export default function AgentDetailPage() {
  const { pubkey } = useParams<{ pubkey: string }>();
  const [agent, setAgent] = useState<(AgentInfo & { capability_hash?: string }) | null>(null);
  const [manifest, setManifest] = useState<AgentManifest | null>(null);
  const [proofs, setProofs] = useState<DisplayProof[]>([]);
  const [risk, setRisk] = useState<RiskScore | null>(null);
  const [reputation, setReputation] = useState<ReputationScore | null>(null);
  const [scoreHistory, setScoreHistory] = useState<ScoreHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showInsurance, setShowInsurance] = useState(false);

  useEffect(() => {
    if (!pubkey) return;
    setLoading(true);
    Promise.all([
      fetchAgentOnChain(pubkey),
      fetchTaskProofs(pubkey),
      agentProof.analyzeAgent(pubkey).catch(() => null),
      fetchManifest(pubkey),
      fetchReputationScore(pubkey),
      fetchScoreHistory(pubkey),
    ])
      .then(([a, chainProofs, r, m, rep, hist]) => {
        setAgent(a);

        // Merge on-chain PDAs with localStorage records, deduped by task_id
        const localRecords = getProofsByAgent(pubkey);
        const chainDisplay = chainProofs.map(taskProofToDisplay);
        const chainIds = new Set(chainDisplay.map((p) => p.task_id));
        const localDisplay: DisplayProof[] = localRecords
          .filter((lr) => !chainIds.has(lr.task_id))
          .map((lr) => ({
            task_id: lr.task_id,
            tx_signature: lr.tx_signature,
            slot: lr.slot,
            task_type: lr.task_type,
            status: lr.status === "verified" ? 1 : lr.status === "rejected" ? 2 : 0,
            submitted_at: lr.submitted_at,
            signature_count: lr.witness_count,
            source: "local" as const,
          }));
        const merged = [...chainDisplay, ...localDisplay].sort((a, b) => b.submitted_at - a.submitted_at);
        setProofs(merged);

        setRisk(r);
        setManifest(m);
        setReputation(rep);
        // If history is empty or only 1 point, pad with current score so the chart renders
        if (rep) {
          const now = Math.floor(Date.now() / 1000);
          const base: ScoreHistoryPoint[] = hist.length > 0 ? hist : [];
          const hasNow = base.some((h) => Math.abs(h.scored_at - now) < 3600);
          setScoreHistory(hasNow ? base : [...base, { scored_at: now, total_score: rep.total_score }]);
        } else {
          setScoreHistory(hist);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [pubkey]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto space-y-4 py-12">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-6 h-24 animate-pulse" />
        ))}
      </div>
    );
  }
  if (error) return <div className="text-rose-400 py-10">Error: {error}</div>;

  // Only render if agent exists on-chain (manifest-only/metaplex agents are disabled)
  if (!agent && !reputation) {
    return <div className="text-slate-400 py-10">Agent not found.</div>;
  }

  const stakedSOL = agent ? (agent.staked_lamports / 1e9).toFixed(3) : "—";
  const registeredDate = agent && (agent.registered_at as number) > 0
    ? new Date((agent.registered_at as number) * 1000).toLocaleString()
    : null;
  const externalUrl = manifest?.external_url ?? reputation?.external_url;
  const framework = manifest?.framework ?? reputation?.framework;
  const isOnChain = !!agent;

  return (
    <div className="max-w-3xl mx-auto space-y-5">

      {/* ── Hero header ── */}
      <div className="relative glass-card rounded-2xl p-6 overflow-hidden">
        <div className="pointer-events-none absolute top-0 right-0 w-64 h-40 bg-violet-600/10 blur-3xl rounded-full -z-10" />

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Avatar */}
            <div className={`h-14 w-14 rounded-2xl shrink-0 flex items-center justify-center ${
              agent?.is_frozen ? "bg-rose-500/20" : "bg-violet-500/20"
            }`}>
              <Shield className={`h-7 w-7 ${agent?.is_frozen ? "text-rose-400" : "text-violet-400"}`} />
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <h1 className="text-2xl font-extrabold text-white">
                  {manifest?.name ?? "Agent Detail"}
                </h1>
                {reputation && <ScoreBadge grade={reputation.grade} score={reputation.total_score} />}
                {agent?.is_frozen && (
                  <span className="bg-rose-500/20 text-rose-300 border border-rose-500/30 px-3 py-0.5 rounded-lg text-sm font-semibold">
                    FROZEN
                  </span>
                )}
                {framework && framework !== "unknown" && (
                  <span className="bg-white/8 text-slate-400 border border-white/10 px-2 py-0.5 rounded-lg text-xs">
                    {framework}
                  </span>
                )}
              </div>
              {manifest?.description && (
                <p className="text-slate-400 text-sm mb-1.5">{manifest.description}</p>
              )}
              <p className="font-mono text-xs text-slate-600 break-all">{agent?.agent_pubkey ?? pubkey}</p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex flex-col gap-2 shrink-0">
            {reputation && reputation.grade !== "C" && !agent?.is_frozen && (
              <button
                onClick={() => setShowInsurance(true)}
                className="gradient-btn text-white text-sm font-semibold px-4 py-2 rounded-xl flex items-center gap-2"
              >
                <Shield className="h-4 w-4" /> Insure Agent
              </button>
            )}
            {externalUrl && (
              <a
                href={externalUrl}
                target="_blank"
                rel="noreferrer"
                className="px-4 py-2 bg-white/8 hover:bg-white/12 border border-white/10 rounded-xl text-sm font-medium text-slate-300 hover:text-white transition-colors flex items-center gap-2"
              >
                <Zap className="h-4 w-4" /> Use Now
              </a>
            )}
          </div>
        </div>

        {/* Capabilities */}
        {manifest?.capabilities && manifest.capabilities.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-white/5">
            {manifest.capabilities.map((cap) => {
              const label = TASK_TYPES.find((t) => t.value === cap.task_type)?.label ?? cap.task_type;
              return (
                <span
                  key={cap.task_type}
                  className="bg-violet-500/15 border border-violet-500/25 text-violet-300 text-xs px-3 py-1 rounded-lg"
                >
                  {label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Reputation Score ── */}
      {reputation && (
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-violet-400" />
              <span className="font-semibold text-white">Reputation Score</span>
            </div>
            <div className="flex items-center gap-2">
              <ScoreBadge grade={reputation.grade} score={reputation.total_score} />
              {reputation.premium_multiplier !== null ? (
                <span className="text-xs text-blue-400 bg-blue-500/15 border border-blue-500/25 px-2.5 py-0.5 rounded-lg">
                  Insurance ×{reputation.premium_multiplier}
                </span>
              ) : (
                <span className="text-xs text-slate-500 bg-white/5 border border-white/8 px-2.5 py-0.5 rounded-lg">
                  Not insurable
                </span>
              )}
            </div>
          </div>
          <div className="space-y-4">
            {SCORE_DIMENSIONS.map((dim) => {
              const val = reputation[dim.key] ?? 0;
              const pct = (val / dim.max) * 100;
              return (
                <div key={dim.key}>
                  <div className="flex justify-between text-sm mb-1.5">
                    <span className="text-slate-400">{dim.label}</span>
                    <span className="font-mono text-white">
                      {val}<span className="text-slate-600">/{dim.max}</span>
                    </span>
                  </div>
                  <div className="h-2 bg-white/8 rounded-full overflow-hidden">
                    <div
                      className={`h-full bg-gradient-to-r ${dim.color} rounded-full transition-all`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Score history chart ── */}
      {reputation && (
        <div className="glass-card rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <span className="font-semibold text-white">Score History</span>
          </div>
          <ScoreTrendChart data={scoreHistory} />
        </div>
      )}

      {/* ── On-chain stats (only shown when agent has on-chain record) ── */}
      {agent && (() => {
        const localVerified = proofs.filter((p) => p.source === "local" && p.status === 1).length;
        const localRejected = proofs.filter((p) => p.source === "local" && p.status === 2).length;
        const totalDone = agent.tasks_completed + localVerified;
        const totalFailed = agent.tasks_failed + localRejected;
        const totalAttempted = totalDone + totalFailed;
        const localSuccessRate = totalAttempted > 0 ? ((totalDone / totalAttempted) * 100).toFixed(1) : agent.success_rate.toFixed(1);
        return (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              { label: "Credit Score", value: String(agent.credit_score), unit: "/ 100", color: "text-violet-400", sub: null },
              { label: "Safety Index", value: String(agent.safety_index), unit: "/ 100", color: "text-blue-400", sub: null },
              { label: "Staked", value: stakedSOL, unit: "SOL", color: "text-emerald-400", sub: null },
              {
                label: "Tasks Done",
                value: String(totalDone),
                unit: "",
                color: "text-white",
                sub: localVerified > 0 ? `${agent.tasks_completed} on-chain + ${localVerified} local` : null,
              },
              {
                label: "Tasks Failed",
                value: String(totalFailed),
                unit: "",
                color: totalFailed > 0 ? "text-rose-400" : "text-white",
                sub: localRejected > 0 ? `${agent.tasks_failed} on-chain + ${localRejected} local` : null,
              },
              { label: "Success Rate", value: localSuccessRate, unit: "%", color: "text-white", sub: null },
            ].map(({ label, value, unit, color, sub }) => (
              <div key={label} className="glass-card rounded-2xl p-4">
                <div className="text-xs text-slate-500 mb-1">{label}</div>
                <div className={`text-2xl font-extrabold ${color}`}>
                  {value}
                  {unit && <span className="text-sm font-normal text-slate-500 ml-1">{unit}</span>}
                </div>
                {sub && <div className="text-xs text-slate-600 mt-1">{sub}</div>}
              </div>
            ))}
          </div>
        );
      })()}

      {/* [DISABLED] Manifest-only badge (no on-chain record) — metaplex-sourced agents hidden */}
      {/* {!agent && (manifest || reputation) && (
        <div className="glass-card rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-slate-400 border border-amber-500/20">
          <span className="text-amber-400">ℹ</span>
          This agent is registered via manifest (tars.pro / Metaplex) but has not yet registered on-chain with a stake deposit.
        </div>
      )} */}

      {/* Registered date */}
      {registeredDate && (
        <div className="glass-card rounded-2xl px-5 py-3 flex items-center gap-2 text-sm text-slate-500">
          <Clock className="h-3.5 w-3.5" />
          Registered {registeredDate}
        </div>
      )}

      {/* ── Tx stats ── */}
      {reputation && (reputation.tx_count > 0 || reputation.anomaly_count > 0) && (
        <div className="glass-card rounded-2xl p-5 grid grid-cols-3 gap-4">
          <div>
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <Activity className="h-3 w-3" /> Transactions
            </div>
            <div className="text-2xl font-extrabold text-white">{reputation.tx_count}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
              <AlertOctagon className="h-3 w-3 text-rose-400" /> Anomalies
            </div>
            <div className={`text-2xl font-extrabold ${reputation.anomaly_count > 0 ? "text-rose-400" : "text-emerald-400"}`}>
              {reputation.anomaly_count}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500 mb-1">Max Single SOL</div>
            <div className="text-2xl font-extrabold text-white">{reputation.max_single_sol.toFixed(3)}</div>
          </div>
        </div>
      )}

      {/* ── Risk Score ── */}
      {risk && (
        <div className={`glass-card rounded-2xl border p-5 flex items-start justify-between gap-4 ${
          risk.level === "danger" ? "border-rose-500/30 bg-rose-500/5" :
          risk.level === "warning" ? "border-amber-500/30 bg-amber-500/5" :
          "border-emerald-500/30 bg-emerald-500/5"
        }`}>
          <div>
            <div className="text-xs text-slate-500 mb-1">Risk Score</div>
            <div className={`text-5xl font-extrabold ${
              risk.level === "danger" ? "text-rose-400" :
              risk.level === "warning" ? "text-amber-400" : "text-emerald-400"
            }`}>
              {risk.score.toFixed(0)}
            </div>
            <div className="text-sm uppercase font-semibold text-slate-500 mt-1">{risk.level}</div>
            {risk.reasons.length > 0 && (
              <div className="mt-3 space-y-1">
                {risk.reasons.map((r, i) => (
                  <div key={i} className="text-xs text-slate-300 flex items-center gap-1.5">
                    <span className="text-rose-400">⚠</span> {r}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="space-y-1 text-right shrink-0">
            {Object.entries(risk.breakdown).map(([key, val]) => (
              <div key={key} className="text-xs">
                <span className="text-slate-500 capitalize">{key.replace(/_/g, " ")}: </span>
                <span className={(val as number) > 20 ? "text-rose-400 font-bold" : "text-slate-300"}>
                  {(val as number).toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Capability Hash (only when on-chain) ── */}
      {agent && (
        <div className="glass-card rounded-2xl p-5">
          <div className="text-xs text-slate-500 mb-2 font-medium uppercase tracking-wide">Capability Hash (SHA-256)</div>
          <div className="font-mono text-xs text-violet-300 break-all">
            {(agent as AgentInfo & { capability_hash?: string }).capability_hash}
          </div>
        </div>
      )}

      {/* ── TaskProof History ── */}
      <div className="glass-card rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <Activity className="h-5 w-5 text-violet-400" />
          <h2 className="font-semibold text-lg">TaskProof History</h2>
          <span className="text-sm font-normal text-slate-500">({proofs.length})</span>
          {proofs.length > 0 && (
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-0.5 rounded-lg">
                {proofs.filter((p) => p.status === 1).length} verified
              </span>
              {proofs.filter((p) => p.status === 2).length > 0 && (
                <span className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-0.5 rounded-lg">
                  {proofs.filter((p) => p.status === 2).length} rejected
                </span>
              )}
            </div>
          )}
        </div>
        {proofs.length === 0 ? (
          <div className="text-slate-500 text-sm text-center py-10">
            No TaskProofs found for this agent.
          </div>
        ) : (
          <div className="space-y-3">
            {proofs.map((proof) => {
              const taskLabel = TASK_TYPES.find((t) => t.value === proof.task_type)?.label ?? proof.task_type;
              return (
                <div
                  key={proof.task_id}
                  className="rounded-xl border border-white/8 p-4 hover:border-white/15 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2 flex-wrap">
                        <span className={`text-xs px-2.5 py-0.5 rounded-lg border font-semibold ${STATUS_COLOR[proof.status]}`}>
                          {proof.status === 1 ? <CheckCircle className="h-3 w-3 inline mr-1" /> :
                           proof.status === 2 ? <AlertTriangle className="h-3 w-3 inline mr-1" /> :
                           <Clock className="h-3 w-3 inline mr-1" />}
                          {STATUS_LABEL[proof.status]}
                        </span>
                        <span className="text-xs text-slate-500">
                          {proof.signature_count}/3 witnesses
                        </span>
                        <span className="text-xs text-slate-600 bg-white/5 px-2 py-0.5 rounded-lg">
                          {taskLabel}
                        </span>
                        {proof.source === "local" && (
                          <span className="text-xs text-violet-400 bg-violet-500/10 border border-violet-500/20 px-2 py-0.5 rounded-lg">
                            local
                          </span>
                        )}
                      </div>

                      <div className="space-y-1 text-xs text-slate-400 font-mono">
                        <div className="flex gap-2">
                          <span className="text-slate-600 w-16 shrink-0">task_id</span>
                          <span className="text-slate-300 truncate">{proof.task_id.slice(0, 40)}...</span>
                        </div>
                        <div className="flex gap-2">
                          <span className="text-slate-600 w-16 shrink-0">tx_sig</span>
                          <span className="text-slate-300 truncate">{proof.tx_signature.slice(0, 40)}...</span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 space-y-1">
                      <div className="text-xs text-slate-500">slot {proof.slot.toLocaleString()}</div>
                      <div className="text-xs text-slate-500">
                        {proof.submitted_at > 0
                          ? new Date(proof.submitted_at * 1000).toLocaleString()
                          : "—"}
                      </div>
                      <a
                        href={`https://explorer.solana.com/address/${pubkey}?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 transition-colors"
                      >
                        Explorer <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Back link */}
      <Link
        href="/leaderboard"
        className="inline-flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
      >
        <ArrowLeft className="h-4 w-4" /> Back to Reputationboard
      </Link>

      {/* Insurance modal */}
      {showInsurance && reputation && (
        <InsuranceModal
          agent={{
            agent_id: pubkey ?? "",
            name: manifest?.name ?? null,
            grade: reputation.grade,
            total_score: reputation.total_score,
            premium_multiplier: reputation.premium_multiplier,
          }}
          onClose={() => setShowInsurance(false)}
        />
      )}
    </div>
  );
}
