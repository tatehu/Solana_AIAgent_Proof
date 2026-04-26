"use client";
import { useState, useEffect, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Shield, AlertTriangle, CheckCircle, Clock, XCircle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { RISK_MONITOR_URL } from "@/lib/solana";

interface ClaimRecord {
  failed_tx_sig: string;
  net_loss_sol: number;
  payout_sol: number;
  loss_ratio: number;
  description: string;
  claimed_at: number;
}

interface Policy {
  id: number;
  agent_wallet: string;
  buyer_wallet: string;
  policy_type: number;
  coverage_sol: number;
  premium_sol: number;
  multiplier: number;
  status: "active" | "claimed" | "expired";
  created_at: number;
  expires_at: number;
  one_time?: boolean;
  claimed_sol?: number;
  claims?: ClaimRecord[];
}

interface ClaimResult {
  approved: boolean;
  payout_sol?: number;
  loss_ratio?: number;
  reason: string;
}

const POLICY_TYPE_LABELS = ["Fund Safety", "Execution", "Bundle"];

const STATUS_CONFIG = {
  active:  { label: "Active",  icon: <CheckCircle className="h-3.5 w-3.5" />, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" },
  claimed: { label: "Claimed", icon: <CheckCircle className="h-3.5 w-3.5" />, cls: "text-blue-400 bg-blue-500/10 border-blue-500/30" },
  expired: { label: "Expired", icon: <XCircle    className="h-3.5 w-3.5" />, cls: "text-slate-500 bg-white/5 border-white/10" },
};

interface TxPreview {
  agentOut: number;   // SOL sent from agent wallet (what agent received from user)
  agentIn: number;    // SOL returned to buyer (what buyer got back)
  net: number;        // agentOut - agentIn = loss
  ok: boolean;
}

function ClaimForm({ policy, onDone }: { policy: Policy; onDone: (result: ClaimResult) => void }) {
  const { publicKey } = useWallet();
  const [failedTxSig, setFailedTxSig] = useState("");
  const [txPreview, setTxPreview] = useState<TxPreview | null>(null);
  const [txLookupLoading, setTxLookupLoading] = useState(false);
  const [txLookupError, setTxLookupError] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Lookup tx on-chain when user pastes a signature
  async function lookupTx(sig: string) {
    const s = sig.trim();
    setFailedTxSig(s);
    setTxPreview(null);
    setTxLookupError("");
    if (s.length < 80) return; // too short to be a valid sig
    setTxLookupLoading(true);
    try {
      const resp = await fetch(`${RISK_MONITOR_URL}/api/v1/insurance/tx_preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tx_sig: s, agent_wallet: policy.agent_wallet, buyer_wallet: publicKey?.toString() ?? "" }),
      });
      const data = await resp.json();
      if (!resp.ok) { setTxLookupError(data.detail ?? "Could not read transaction"); return; }
      setTxPreview(data as TxPreview);
    } catch {
      setTxLookupError("RPC lookup failed — check your connection");
    } finally {
      setTxLookupLoading(false);
    }
  }

  const loss = txPreview ? txPreview.net : 0;
  const coverageSol = policy.coverage_sol;
  const claimedSoFar = policy.claimed_sol ?? 0;
  const remaining = Math.max(0, coverageSol - claimedSoFar);
  const estimatedPayout = loss > 0 ? +(Math.min(loss, remaining)).toFixed(4) : null;
  const lossRatio = txPreview && txPreview.agentOut > 0 ? txPreview.net / txPreview.agentOut : 0;

  async function handleSubmit() {
    if (!publicKey) return;
    if (!failedTxSig.trim()) { setError("Paste the failed transaction signature"); return; }
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${RISK_MONITOR_URL}/api/v1/insurance/claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          policy_id:      policy.id,
          buyer_wallet:   publicKey.toString(),
          failed_tx_sig:  failedTxSig.trim(),
          description:    description.trim(),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.detail ?? JSON.stringify(data));
      onDone(data as ClaimResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-4 space-y-4 border-t border-white/8 pt-4">
      {/* Step 1 — Failed tx */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">
          Failed Task Transaction <span className="text-rose-400">*</span>
        </label>
        <div className="relative">
          <input
            type="text"
            value={failedTxSig}
            onChange={(e) => lookupTx(e.target.value)}
            placeholder="Paste the Solana tx signature where the agent failed…"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 pr-8 font-mono"
          />
          {txLookupLoading && (
            <div className="absolute right-3 top-2.5 h-4 w-4 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <p className="text-[11px] text-slate-600 mt-1">
          The on-chain tx where the agent received funds but failed to deliver the task or return the SOL.
        </p>
        {txLookupError && (
          <p className="text-rose-400 text-[11px] mt-1">{txLookupError}</p>
        )}
      </div>

      {/* Tx preview — auto-filled from chain */}
      {txPreview && (
        <div className={`rounded-xl p-3 border text-xs space-y-2 ${txPreview.ok ? "bg-rose-500/8 border-rose-500/20" : "bg-white/3 border-white/10"}`}>
          <p className="text-slate-400 font-semibold uppercase tracking-wider text-[10px]">On-chain Evidence</p>
          <div className="grid grid-cols-3 gap-2">
            <div className="text-center">
              <div className="text-slate-500 mb-0.5">Sent to agent</div>
              <div className="text-white font-semibold">{txPreview.agentOut.toFixed(4)} SOL</div>
            </div>
            <div className="text-center">
              <div className="text-slate-500 mb-0.5">Returned to you</div>
              <div className="text-white font-semibold">{txPreview.agentIn.toFixed(4)} SOL</div>
            </div>
            <div className="text-center">
              <div className="text-slate-500 mb-0.5">Net loss</div>
              <div className="text-rose-400 font-bold">{txPreview.net.toFixed(4)} SOL</div>
            </div>
          </div>
          {estimatedPayout !== null && lossRatio >= 0.1 && (
            <div className="flex items-center justify-between pt-1 border-t border-white/8">
              <span className="text-slate-400">Estimated payout (full net loss, capped at {remaining.toFixed(4)} SOL remaining)</span>
              <span className="text-emerald-400 font-bold">{estimatedPayout} SOL</span>
            </div>
          )}
          {lossRatio > 0 && lossRatio < 0.1 && (
            <p className="text-amber-400 pt-1 border-t border-white/8">
              Loss ratio {(lossRatio * 100).toFixed(1)}% is below the 10% minimum — claim may be rejected.
            </p>
          )}
          {txPreview.net <= 0 && (
            <p className="text-amber-400 pt-1 border-t border-white/8">
              No loss detected in this transaction — agent appears to have returned the full amount.
            </p>
          )}
        </div>
      )}

      {/* Step 2 — Description */}
      <div>
        <label className="block text-xs text-slate-500 mb-1.5">What happened? <span className="text-slate-600">(optional but helps)</span></label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Agent accepted a swap task for 1 SOL, executed it on-chain, but only returned 0.05 SOL — the rest disappeared."
          rows={3}
          className="w-full bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 resize-none"
        />
      </div>

      {error && (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-3 text-rose-300 text-xs">
          {error}
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !failedTxSig.trim()}
        className="w-full gradient-btn text-white font-semibold py-3 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {loading ? "Submitting claim…" : "Submit Claim"}
      </button>
      <p className="text-[10px] text-slate-700 text-center">
        Loss is verified directly from the Solana ledger — no self-reported amounts needed.
      </p>
    </div>
  );
}

function useCountdown(expiresAt: number) {
  const [remaining, setRemaining] = useState(Math.max(0, expiresAt - Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setRemaining(Math.max(0, expiresAt - Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (remaining <= 0) return "Expired";
  const d = Math.floor(remaining / 86400);
  const h = Math.floor((remaining % 86400) / 3600);
  const m = Math.floor((remaining % 3600) / 60);
  const s = Math.floor(remaining % 60);
  if (d > 0) return `${d}d ${h}h ${m}m ${s}s`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  return `${m}m ${s}s`;
}

function PolicyCard({ policy, onRefresh }: { policy: Policy; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [claimResult, setClaimResult] = useState<ClaimResult | null>(null);
  const status = STATUS_CONFIG[policy.status];
  const isExpired = Date.now() / 1000 > policy.expires_at;
  const isOneTime = policy.one_time || (policy.expires_at - policy.created_at) < 90000;
  const countdown = useCountdown(policy.expires_at);

  // Derive duration label from window length
  const durationSec = policy.expires_at - policy.created_at;
  const durationLabel = isOneTime
    ? "One-time"
    : durationSec > 80 * 86400 ? "90 Days"
    : durationSec > 25 * 86400 ? "30 Days"
    : durationSec > 3 * 86400  ? "7 Days"
    : "Custom";

  const durationColor = isOneTime
    ? "bg-amber-500/15 text-amber-400 border-amber-500/20"
    : "bg-violet-500/15 text-violet-400 border-violet-500/20";

  const remainingCoverage = policy.coverage_sol - (policy.claimed_sol ?? 0);
  const coverageExhausted = remainingCoverage <= 0;
  const canClaim = policy.status === "active" && !isExpired && !coverageExhausted && !claimResult;

  return (
    <div className="glass-card rounded-2xl p-5">
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-white font-semibold text-sm">
              {POLICY_TYPE_LABELS[policy.policy_type] ?? "Policy"} #{policy.id}
            </span>
            <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full border ${status.cls}`}>
              {status.icon}{status.label}
            </span>
            {/* Duration type badge — shown for both one-time and periodic */}
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${durationColor}`}>
              {durationLabel}
            </span>
          </div>
          <p className="text-slate-500 text-xs font-mono">
            Agent: {policy.agent_wallet.slice(0, 12)}…{policy.agent_wallet.slice(-6)}
          </p>
        </div>
        <div className="text-right">
          <div className="text-white font-bold">{policy.coverage_sol} SOL</div>
          <div className="text-slate-500 text-xs">coverage</div>
        </div>
      </div>

      {/* Stats row — identical layout for all policy types */}
      <div className="grid grid-cols-4 gap-2 mb-3 text-xs">
        <div className="bg-white/[0.03] rounded-xl p-2.5 text-center">
          <div className="text-slate-500 mb-0.5">Premium paid</div>
          <div className="text-white font-medium">{policy.premium_sol} SOL</div>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-2.5 text-center">
          <div className="text-slate-500 mb-0.5">Remaining</div>
          <div className={`font-medium ${coverageExhausted ? "text-slate-500" : "text-emerald-400"}`}>
            {remainingCoverage.toFixed(3)} SOL
          </div>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-2.5 text-center">
          <div className="text-slate-500 mb-0.5">Risk ×</div>
          <div className={`font-medium ${policy.multiplier > 1.2 ? "text-rose-400" : policy.multiplier > 1 ? "text-amber-400" : "text-emerald-400"}`}>
            {policy.multiplier}
          </div>
        </div>
        <div className="bg-white/[0.03] rounded-xl p-2.5 text-center">
          <div className="text-slate-500 mb-0.5">Expires in</div>
          <div className={`font-medium tabular-nums ${
            policy.status !== "active" || isExpired
              ? "text-slate-500"
              : isOneTime ? "text-amber-400" : "text-amber-400"
          }`}>
            {policy.status !== "active" || isExpired ? policy.status : countdown}
          </div>
        </div>
      </div>

      {/* Policy notice — shown for all active non-expired policies */}
      {policy.status === "active" && !isExpired && (() => {
        if (isOneTime) return (
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2 mb-3 text-xs text-amber-400 flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>One-time policy · <strong>1 claim</strong> allowed within 24h · any submission (approved or rejected) closes this policy</span>
          </div>
        );
        const days = Math.round((policy.expires_at - policy.created_at) / 86400);
        return (
          <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2 mb-3 text-xs text-amber-400 flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            <span>
              {days}-day policy · <strong>multiple claims</strong> allowed within the period ·
              total payout capped at <strong>{policy.coverage_sol} SOL</strong> ·
              remaining <strong>{remainingCoverage.toFixed(3)} SOL</strong>
            </span>
          </div>
        );
      })()}

      {/* Claim result */}
      {claimResult && (
        <div className={`rounded-xl p-4 mb-3 ${claimResult.approved ? "bg-emerald-500/10 border border-emerald-500/30" : "bg-rose-500/10 border border-rose-500/30"}`}>
          <div className={`font-semibold text-sm mb-1 ${claimResult.approved ? "text-emerald-300" : "text-rose-300"}`}>
            {claimResult.approved ? "Claim Approved" : "Claim Rejected"}
          </div>
          {claimResult.approved && (
            <div className="text-2xl font-bold text-emerald-400 mb-1">
              +{claimResult.payout_sol} SOL
            </div>
          )}
          <p className="text-xs text-slate-400">{claimResult.reason}</p>
        </div>
      )}

      {/* Claim button */}
      {canClaim && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-violet-500/30 bg-violet-500/8 hover:bg-violet-500/15 text-violet-300 hover:text-violet-200 rounded-xl text-sm font-medium transition-all"
        >
          <AlertTriangle className="h-4 w-4" />
          File a Claim
          {expanded ? <ChevronUp className="h-4 w-4 ml-auto" /> : <ChevronDown className="h-4 w-4 ml-auto" />}
        </button>
      )}

      {expanded && !claimResult && (
        <ClaimForm
          policy={policy}
          onDone={(result) => {
            setClaimResult(result);
            setExpanded(false);
            onRefresh();
          }}
        />
      )}

      {/* Claim history */}
      {policy.claims && policy.claims.length > 0 && (
        <div className="mt-4 border-t border-white/8 pt-4 space-y-2">
          <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2">Claim History</p>
          {policy.claims.map((c, i) => {
            const isAutoRejected = c.description?.startsWith("[Auto-rejected]");
            const displayDesc = isAutoRejected ? c.description.replace("[Auto-rejected] ", "") : c.description;
            const statusColor = c.payout_sol > 0 ? "bg-emerald-500/5 border-emerald-500/20" : "bg-rose-500/5 border-rose-500/20";
            const labelColor = c.payout_sol > 0 ? "text-emerald-400" : "text-rose-400";
            const label = c.payout_sol > 0 ? `+${c.payout_sol} SOL paid` : "Rejected";
            return (
              <div key={i} className={`rounded-xl p-3 text-xs border ${statusColor}`}>
                <div className="flex items-center justify-between mb-1.5">
                  <span className={`font-semibold ${labelColor}`}>{label}</span>
                  <span className="text-slate-600 tabular-nums">
                    {new Date(c.claimed_at * 1000).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                {!isAutoRejected && (
                  <div className="flex gap-3 text-slate-500 mb-1">
                    <span>Net loss <span className="text-slate-400">{c.net_loss_sol.toFixed(4)} SOL</span></span>
                    <span>Loss ratio <span className="text-slate-400">{(c.loss_ratio * 100).toFixed(1)}%</span></span>
                  </div>
                )}
                <p className="font-mono text-[10px] text-slate-700 truncate">{c.failed_tx_sig}</p>
                {displayDesc && <p className="text-slate-500 mt-1 text-[11px]">{displayDesc}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function InsurancePage() {
  const { publicKey, connected } = useWallet();
  const [policies, setPolicies] = useState<Policy[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchPolicies = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    setError("");
    try {
      const resp = await fetch(`${RISK_MONITOR_URL}/api/v1/insurance/policies/${publicKey.toString()}`);
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setPolicies((data.policies ?? []).slice().sort((a: Policy, b: Policy) => b.created_at - a.created_at));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  }, [publicKey]);

  useEffect(() => { fetchPolicies(); }, [fetchPolicies]);

  const active  = policies.filter((p) => p.status === "active" && Date.now() / 1000 <= p.expires_at);
  const past    = policies.filter((p) => p.status !== "active" || Date.now() / 1000 > p.expires_at);

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      {/* Header */}
      <div className="relative">
        <div className="pointer-events-none absolute -top-8 left-0 w-64 h-48 bg-emerald-600/10 blur-3xl rounded-full -z-10" />
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
            <Shield className="h-5 w-5 text-emerald-400" />
          </div>
          <h1 className="text-3xl font-extrabold text-white">My Insurance</h1>
          <button
            onClick={fetchPolicies}
            disabled={loading}
            className="ml-auto flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
        <p className="text-slate-400 text-sm leading-relaxed">
          View your active policies and submit claims when an agent fails to deliver.
        </p>
      </div>

      {!connected ? (
        <div className="glass-card rounded-2xl p-10 text-center">
          <Shield className="h-12 w-12 text-slate-600 mx-auto mb-4" />
          <p className="text-slate-400 text-sm">Connect your wallet to view your insurance policies.</p>
        </div>
      ) : loading ? (
        <div className="glass-card rounded-2xl p-10 text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-violet-500 border-t-transparent mb-4" />
          <p className="text-slate-500 text-sm">Loading policies…</p>
        </div>
      ) : error ? (
        <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-5 text-rose-300 text-sm">
          {error}
        </div>
      ) : policies.length === 0 ? (
        <div className="glass-card rounded-2xl p-10 text-center">
          <Shield className="h-12 w-12 text-slate-700 mx-auto mb-4" />
          <p className="text-white font-semibold mb-1">No policies yet</p>
          <p className="text-slate-500 text-sm">
            Buy insurance from an agent&apos;s profile page on the{" "}
            <a href="/leaderboard" className="text-violet-400 hover:text-violet-300">Reputation Board</a>.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Active policies */}
          {active.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-emerald-400" />
                <h2 className="text-sm font-semibold text-emerald-400 uppercase tracking-wider">
                  Active ({active.length})
                </h2>
              </div>
              {active.map((p) => <PolicyCard key={p.id} policy={p} onRefresh={fetchPolicies} />)}
            </section>
          )}

          {/* Past policies */}
          {past.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-slate-500" />
                <h2 className="text-sm font-semibold text-slate-500 uppercase tracking-wider">
                  Past ({past.length})
                </h2>
              </div>
              {past.map((p) => <PolicyCard key={p.id} policy={p} onRefresh={fetchPolicies} />)}
            </section>
          )}
        </div>
      )}
    </div>
  );
}
