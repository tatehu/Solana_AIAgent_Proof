"use client";
import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  X, Shield, CheckCircle, Zap, Package, ExternalLink,
} from "lucide-react";
import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { RISK_MONITOR_URL } from "@/lib/solana";

// Treasury wallet that receives insurance premiums (platform operator)
const TREASURY_PUBKEY = new PublicKey("71MW7PhDSehYup5GDbvceZeyuyYBYuEUvk2Sfc12cMM2");

const WalletMultiButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false }
);

interface InsuranceAgent {
  agent_id: string;
  name: string | null;
  grade: string;
  total_score: number;
  premium_multiplier: number | null;
}

interface InsuranceModalProps {
  agent: InsuranceAgent;
  onClose: () => void;
}

const POLICY_TYPES = [
  {
    id: 0,
    label: "Fund Safety",
    icon: <Shield className="h-4 w-4" />,
    desc: "Covers financial loss up to coverage amount",
    baseRate: 0.01,
    color: "blue",
  },
  {
    id: 1,
    label: "Execution",
    icon: <Zap className="h-4 w-4" />,
    desc: "Full refund if the agent's task fails",
    baseRate: 0.02,
    color: "purple",
  },
  {
    id: 2,
    label: "Bundle",
    icon: <Package className="h-4 w-4" />,
    desc: "Fund Safety + Execution · Save 20%",
    // (0.01 + 0.02) * 0.8 = 0.024
    baseRate: 0.024,
    color: "emerald",
    badge: "Best Value",
  },
] as const;

const COVERAGE_OPTIONS = [1, 2, 3, 5];

const DURATION_OPTIONS = [
  { id: "once", label: "One-time", days: 0,  multiplier: 0.08, desc: "Single task" },
  { id: "7d",   label: "7 Days",   days: 7,  multiplier: 0.28, desc: "Weekly" },
  { id: "30d",  label: "30 Days",  days: 30, multiplier: 1.0,  desc: "Monthly" },
  { id: "90d",  label: "90 Days",  days: 90, multiplier: 2.7,  desc: "Quarterly · −10%" },
] as const;

type DurationId = (typeof DURATION_OPTIONS)[number]["id"];

const COLOR_MAP = {
  blue:    { ring: "border-blue-500 bg-blue-500/10",    icon: "text-blue-400 bg-blue-500/10 border-blue-500/20",    badge: "" },
  purple:  { ring: "border-purple-500 bg-purple-500/10", icon: "text-purple-400 bg-purple-500/10 border-purple-500/20", badge: "" },
  emerald: { ring: "border-emerald-500 bg-emerald-500/10", icon: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", badge: "bg-emerald-500/20 text-emerald-400" },
};

export function InsuranceModal({ agent, onClose }: InsuranceModalProps) {
  const { publicKey, connected, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [selectedType, setSelectedType] = useState(2);
  const [coverageSol, setCoverage] = useState(2);
  const [selectedDuration, setSelectedDuration] = useState<DurationId>("30d");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ policyId: number; premiumSol: number } | null>(null);
  const [error, setError] = useState("");

  const multiplier = agent.premium_multiplier ?? 1.0;
  const policy = POLICY_TYPES[selectedType];
  const duration = DURATION_OPTIONS.find((d) => d.id === selectedDuration)!;
  const premium = +(coverageSol * policy.baseRate * multiplier * duration.multiplier).toFixed(4);

  // Show individual rates for comparison in bundle view
  const fundSafetyPremium = +(coverageSol * 0.01 * multiplier * duration.multiplier).toFixed(4);
  const executionPremium  = +(coverageSol * 0.02 * multiplier * duration.multiplier).toFixed(4);
  const bundleSavings     = +(fundSafetyPremium + executionPremium - premium).toFixed(4);

  const handleBuy = async () => {
    if (!connected || !publicKey) return;
    setLoading(true);
    setError("");
    try {
      // Step 1: send SOL premium to treasury via Phantom
      const lamports = Math.round(premium * LAMPORTS_PER_SOL);
      if (lamports <= 0) throw new Error("Premium amount too small");

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      tx.add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: TREASURY_PUBKEY,
          lamports,
        })
      );

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

      // Step 2: create policy on backend (verified against tx_sig)
      const resp = await fetch(`${RISK_MONITOR_URL}/api/v1/insurance/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          buyer_wallet: publicKey.toString(),
          agent_wallet: agent.agent_id,
          policy_type: selectedType,
          coverage_sol: coverageSol,
          duration_days: duration.days,
          tx_sig: sig,
        }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      setResult({ policyId: data.policy_id, premiumSol: data.premium_sol });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Purchase failed, please retry";
      // Surface Anchor / simulation errors
      const clean = msg.replace(/\{.*\}/s, "").trim();
      setError(clean || msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="glass-card border border-white/10 rounded-3xl p-6 w-full max-w-md shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="h-8 w-8 rounded-xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center">
                <Shield className="h-4 w-4 text-emerald-400" />
              </div>
              <h2 className="text-lg font-bold text-white">Buy Insurance</h2>
            </div>
            <p className="text-slate-500 text-xs">
              {agent.name ?? agent.agent_id.slice(0, 14) + "…"} · Grade {agent.grade} · Risk ×{multiplier}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-white transition-colors p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {result ? (
          /* ── Success state ── */
          <div className="text-center py-6">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/15 border border-emerald-500/25 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-8 w-8 text-emerald-400" />
            </div>
            <p className="font-bold text-lg text-white mb-1">Policy Active</p>
            <p className="text-slate-400 text-sm mb-1">
              Policy #{result.policyId}
            </p>
            <p className="text-emerald-400 font-semibold mb-4">
              {result.premiumSol} SOL paid
            </p>
            <p className="text-xs text-slate-500 mb-6">
              {duration.id === "once"
                ? "Valid for a single task execution."
                : `Valid for ${duration.days} days.`}{" "}
              Submit a claim if the agent fails your task.
            </p>
            <Link
              href="/insurance"
              onClick={onClose}
              className="w-full flex items-center justify-center gap-1.5 py-2.5 border border-violet-500/30 bg-violet-500/8 hover:bg-violet-500/15 text-violet-300 rounded-xl text-sm font-medium transition-all mb-3"
            >
              <ExternalLink className="h-4 w-4" />
              View My Policies &amp; File Claims
            </Link>
            <button
              onClick={onClose}
              className="w-full py-2.5 border border-white/10 hover:border-white/20 rounded-2xl text-sm text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
        ) : (
          <>
            {/* ── Policy type selection ── */}
            <div className="grid grid-cols-3 gap-2 mb-5">
              {POLICY_TYPES.map((pt) => {
                const c = COLOR_MAP[pt.color];
                const active = selectedType === pt.id;
                return (
                  <button
                    key={pt.id}
                    onClick={() => setSelectedType(pt.id)}
                    className={`relative p-3 rounded-2xl text-left border transition-all ${
                      active ? c.ring : "border-white/8 bg-white/3 hover:border-white/15"
                    }`}
                  >
                    {"badge" in pt && pt.badge && (
                      <span className={`absolute -top-2 left-1/2 -translate-x-1/2 text-[10px] font-bold px-2 py-0.5 rounded-full ${c.badge}`}>
                        {pt.badge}
                      </span>
                    )}
                    <div className={`w-7 h-7 rounded-lg border flex items-center justify-center mb-2 ${c.icon}`}>
                      {pt.icon}
                    </div>
                    <div className="text-white font-semibold text-xs mb-0.5">{pt.label}</div>
                    <div className="text-slate-500 text-[11px] leading-tight">{pt.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* ── Coverage amount ── */}
            <div className="mb-5">
              <label className="text-xs text-slate-500 mb-2 block uppercase tracking-wider font-semibold">
                Coverage Amount
              </label>
              <div className="grid grid-cols-4 gap-2">
                {COVERAGE_OPTIONS.map((v) => (
                  <button
                    key={v}
                    onClick={() => setCoverage(v)}
                    className={`py-2 rounded-xl text-sm font-semibold transition-all ${
                      coverageSol === v
                        ? "gradient-btn text-white"
                        : "border border-white/8 text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {v} SOL
                  </button>
                ))}
              </div>
            </div>

            {/* ── Duration ── */}
            <div className="mb-5">
              <label className="text-xs text-slate-500 mb-2 block uppercase tracking-wider font-semibold">
                Coverage Period
              </label>
              <div className="grid grid-cols-4 gap-2">
                {DURATION_OPTIONS.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => setSelectedDuration(d.id)}
                    className={`py-2 px-1 rounded-xl text-center transition-all relative ${
                      selectedDuration === d.id
                        ? "gradient-btn text-white"
                        : "border border-white/8 text-slate-400 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {d.id === "90d" && (
                      <span className="absolute -top-2 left-1/2 -translate-x-1/2 text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 whitespace-nowrap">
                        Save 10%
                      </span>
                    )}
                    <div className="text-xs font-semibold">{d.label}</div>
                    <div className="text-[10px] text-current opacity-60 mt-0.5">{d.desc}</div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Premium summary ── */}
            <div className="bg-white/3 border border-white/8 rounded-2xl p-4 mb-5 space-y-2.5">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Coverage</span>
                <span className="text-white font-medium">
                  {coverageSol} SOL · {duration.id === "once" ? "One-time" : `${duration.days} days`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Risk multiplier</span>
                <span className={`font-medium ${multiplier > 1.2 ? "text-rose-400" : multiplier > 1.0 ? "text-amber-400" : "text-emerald-400"}`}>
                  ×{multiplier}
                </span>
              </div>
              {selectedType === 2 && (
                <>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Fund Safety ({(0.01 * 100).toFixed(0)}%)</span>
                    <span>{fundSafetyPremium} SOL</span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-600">
                    <span>Execution ({(0.02 * 100).toFixed(0)}%)</span>
                    <span>{executionPremium} SOL</span>
                  </div>
                  <div className="flex justify-between text-xs text-emerald-400">
                    <span>Bundle discount (−20%)</span>
                    <span>−{bundleSavings} SOL</span>
                  </div>
                </>
              )}
              <div className="border-t border-white/8 pt-2.5 flex justify-between items-baseline">
                <span className="text-white font-semibold">Premium</span>
                <div className="text-right">
                  <span className="text-xl font-bold text-emerald-400">{premium} SOL</span>
                  <div className="text-[10px] text-slate-600">+ ~0.000005 SOL network fee</div>
                </div>
              </div>
            </div>

            {error && (
              <p className="text-rose-400 text-xs mb-3 px-1">{error}</p>
            )}

            {/* ── Action ── */}
            {!connected ? (
              <div className="w-full flex justify-center">
                <WalletMultiButton
                  style={{
                    background: "linear-gradient(135deg, #2563eb 0%, #7c3aed 50%, #db2777 100%)",
                    borderRadius: "16px",
                    width: "100%",
                    height: "48px",
                    fontSize: "14px",
                    fontWeight: 600,
                  }}
                />
              </div>
            ) : (
              <button
                onClick={handleBuy}
                disabled={loading}
                className="gradient-btn w-full py-3.5 text-white font-bold rounded-2xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
              >
                {loading ? "Processing payment…" : `Pay ${premium} SOL · Activate Policy`}
              </button>
            )}

            <p className="text-xs text-slate-700 text-center mt-3">
              Premium is paid to the AgentProof treasury via Phantom and verified on-chain before policy activation.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
