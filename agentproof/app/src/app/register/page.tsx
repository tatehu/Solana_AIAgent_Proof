"use client";
import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { PROGRAM_ID, RISK_MONITOR_URL } from "@/lib/solana";
import { TASK_TYPES } from "@/lib/task-types";
import Link from "next/link";
import { Shield, Zap, Trophy, Lock, CheckCircle, ExternalLink } from "lucide-react";

const REGISTER_AGENT_DISC = Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]);

function encodeU64LE(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

/**
 * Build register_agent instruction.
 * Account order matches the new Rust struct:
 *   0. agent_record PDA  (writable, not signer)
 *   1. agent             (readonly, not signer — just a pubkey being registered)
 *   2. payer             (writable, signer — the connected wallet that pays)
 *   3. stake_vault PDA   (writable, not signer)
 *   4. system_program
 */
function buildRegisterAgentIx(
  agentPubkey: PublicKey,
  payerPubkey: PublicKey,
  capabilityHash: Uint8Array,
  stakeLamports: number
): TransactionInstruction {
  const [agentRecord] = PublicKey.findProgramAddressSync(
    [Buffer.from("agent"), agentPubkey.toBuffer()],
    PROGRAM_ID
  );
  const [stakeVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("stake_vault"), agentPubkey.toBuffer()],
    PROGRAM_ID
  );
  const data = Buffer.concat([
    REGISTER_AGENT_DISC,
    Buffer.from(capabilityHash),
    encodeU64LE(stakeLamports),
  ]);
  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: agentRecord,            isSigner: false, isWritable: true  },
      { pubkey: agentPubkey,            isSigner: false, isWritable: false },
      { pubkey: payerPubkey,            isSigner: true,  isWritable: true  },
      { pubkey: stakeVault,             isSigner: false, isWritable: true  },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function formatError(e: unknown): string {
  if (e instanceof Error) {
    // Anchor / Solana errors often embed JSON logs — surface them
    const msg = e.message;
    // Try to extract anchor error message from logs
    const anchorMatch = msg.match(/AnchorError[^"]*"([^"]+)"/);
    if (anchorMatch) return anchorMatch[1];
    // Simulation failure with logs
    const simMatch = msg.match(/Transaction simulation failed: (.*)/);
    if (simMatch) return `Simulation failed: ${simMatch[1]}`;
    return msg;
  }
  if (typeof e === "object" && e !== null) {
    const obj = e as Record<string, unknown>;
    // SendTransactionError exposes logs
    if (Array.isArray(obj["logs"])) {
      const logs = (obj["logs"] as string[]).filter(
        (l) => l.includes("Error") || l.includes("failed") || l.includes("AnchorError")
      );
      if (logs.length > 0) return logs.join("\n");
    }
    if (typeof obj["message"] === "string") return obj["message"];
    return JSON.stringify(e);
  }
  return String(e);
}

export default function RegisterPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  // Agent to register — any pubkey, not necessarily the connected wallet
  const [agentPubkeyInput, setAgentPubkeyInput] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDesc, setAgentDesc] = useState("");
  const [agentFramework, setAgentFramework] = useState("unknown");
  const [agentExternalUrl, setAgentExternalUrl] = useState("");
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [selectedTypes, setSelectedTypes] = useState<string[]>(["SOLANA_SWAP", "DATA_ANALYSIS"]);

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");

  const [auditResult, setAuditResult] = useState<{
    credit_score: number; safety_index: number; risk_flags: string[];
    audit_summary: string; tx_count: number;
  } | null>(null);

  function toggleType(t: string) {
    setSelectedTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
  }

  async function handleRegister() {
    if (!publicKey) { setError("Please connect your wallet — it pays the transaction fee and stake"); return; }

    const agentKeyStr = agentPubkeyInput.trim() || publicKey.toBase58();
    let agentKey: PublicKey;
    try { agentKey = new PublicKey(agentKeyStr); }
    catch { setError("Invalid agent wallet address — must be a valid Solana public key"); return; }

    if (!agentName.trim()) { setError("Agent name is required"); return; }
    if (!agentDesc.trim()) { setError("Description is required"); return; }
    if (selectedTypes.length === 0) { setError("Select at least one capability"); return; }

    setStatus("loading");
    setError("");

    try {
      const stakeSOL = parseFloat(stakeAmount);
      if (isNaN(stakeSOL) || stakeSOL < 0.1) throw new Error("Minimum stake is 0.1 SOL");

      // Check if agent already registered on-chain — skip chain tx if so
      const [agentRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentKey.toBuffer()],
        PROGRAM_ID
      );
      const existingAccount = await connection.getAccountInfo(agentRecordPda);

      const capabilityList = selectedTypes.map((t) => ({
        task_type: t,
        description: TASK_TYPES.find((tt) => tt.value === t)?.label ?? t,
      }));
      const manifest = {
        agent_pubkey: agentKey.toBase58(),
        name: agentName.trim(),
        description: agentDesc.trim(),
        capabilities: capabilityList,
        version: "1.0",
        framework: agentFramework,
        external_url: agentExternalUrl.trim(),
        owner_wallet: publicKey.toBase58(),
      };

      if (existingAccount) {
        // Already registered — just update manifest
        try {
          await fetch(`${RISK_MONITOR_URL}/manifest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(manifest),
          });
        } catch (e) { console.warn("Manifest save failed:", e); }
        setTxSig("already-registered");
        setStatus("success");
        return;
      }

      // Check payer balance
      const balance = await connection.getBalance(publicKey);
      const stakeLamports = Math.floor(stakeSOL * LAMPORTS_PER_SOL);
      const estimatedFee = 10_000; // ~0.00001 SOL tx fee
      if (balance < stakeLamports + estimatedFee) {
        throw new Error(
          `Insufficient balance. Need ${(stakeLamports + estimatedFee) / LAMPORTS_PER_SOL} SOL, ` +
          `but connected wallet only has ${(balance / LAMPORTS_PER_SOL).toFixed(4)} SOL.`
        );
      }

      const encoded = new TextEncoder().encode(JSON.stringify(manifest));
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoded.buffer as ArrayBuffer);
      const capabilityHash = new Uint8Array(hashBuffer);

      const ix = buildRegisterAgentIx(agentKey, publicKey, capabilityHash, stakeLamports);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      tx.add(ix);

      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
      setTxSig(sig);

      try {
        await fetch(`${RISK_MONITOR_URL}/manifest`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(manifest),
        });
      } catch (e) { console.warn("Manifest save failed (non-critical):", e); }

      try {
        const auditRes = await fetch(`${RISK_MONITOR_URL}/audit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ agent_pubkey: agentKey.toBase58(), capability_manifest: manifest }),
        });
        if (auditRes.ok) setAuditResult(await auditRes.json());
      } catch (e) { console.warn("Audit failed (non-critical):", e); }

      setStatus("success");
    } catch (e: unknown) {
      setError(formatError(e));
      setStatus("error");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">

      {/* Header */}
      <div className="relative">
        <div className="pointer-events-none absolute -top-8 left-0 w-64 h-48 bg-violet-600/10 blur-3xl rounded-full -z-10" />
        <h1 className="text-3xl font-extrabold text-white">Register an Agent</h1>
        <p className="text-slate-400 mt-2 text-sm leading-relaxed">
          Register any AI agent on-chain. Your connected wallet pays the stake — the agent&apos;s pubkey gets the on-chain record.
          Perfect for marketplace operators registering multiple agents at once.
        </p>
      </div>

      {/* Value props */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { icon: <Trophy className="h-4 w-4" />, title: "On-chain Reputation", desc: "Every verified task raises your trust score" },
          { icon: <Lock className="h-4 w-4" />,   title: "Insurance Eligibility",  desc: "Staked agents qualify for protocol insurance coverage" },
          { icon: <CheckCircle className="h-4 w-4" />, title: "Tamper-proof Proof",   desc: "Immutable task history verified by 3 witness nodes" },
        ].map(({ icon, title, desc }) => (
          <div key={title} className="glass-card rounded-2xl p-4 text-center">
            <div className="inline-flex p-2 rounded-lg bg-violet-500/10 text-violet-400 mb-2">{icon}</div>
            <div className="font-semibold text-sm text-white">{title}</div>
            <div className="text-xs text-slate-500 mt-0.5">{desc}</div>
          </div>
        ))}
      </div>

      {/* Registration form */}
      <div className="glass-card rounded-2xl p-7 space-y-6">

        {/* Audit pipeline notice */}
        <div className="bg-violet-500/8 border border-violet-500/20 rounded-xl p-4 text-xs text-slate-400 space-y-1.5">
          <div className="font-semibold text-violet-300 flex items-center gap-1.5 text-sm">
            <Zap className="h-4 w-4 text-violet-400" />
            Registration triggers a 3-step security audit
          </div>
          <div className="pl-5 space-y-1">
            <div>1. <span className="text-white font-medium">Helius</span> pulls your full on-chain transaction history for behavioral analysis</div>
            <div>2. <span className="text-white font-medium">Claude Opus</span> audits behavior, assigns a credit score and safety index</div>
            <div>3. Verified agents with staked collateral become <span className="text-white font-medium">insurance-eligible</span></div>
          </div>
        </div>

        <div className="space-y-4">
          {/* Agent pubkey */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">
              Agent Wallet Address <span className="text-rose-400">*</span>
              <span className="text-slate-500 ml-2 text-xs">— any agent pubkey; your wallet pays the stake</span>
            </label>
            <input
              type="text"
              value={agentPubkeyInput}
              onChange={(e) => setAgentPubkeyInput(e.target.value)}
              placeholder={publicKey ? `Leave blank to register your own wallet: ${publicKey.toBase58().slice(0, 20)}...` : "Paste agent wallet address (Solana pubkey)"}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 font-mono focus:outline-none focus:border-violet-500/50 transition-colors"
            />
          </div>

          {/* Name */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Agent Name <span className="text-rose-400">*</span></label>
            <input
              type="text"
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder="e.g. SwapBot Alpha"
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Description <span className="text-rose-400">*</span></label>
            <textarea
              value={agentDesc}
              onChange={(e) => setAgentDesc(e.target.value)}
              placeholder="Describe what this agent does — used for intent recognition (e.g. 'Swaps SOL to USDC at best price using Jupiter, max 1 SOL per trade')"
              rows={3}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors resize-none"
            />
          </div>

          {/* External URL */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">
              Agent Page URL
              <span className="text-slate-500 ml-2 text-xs">— optional: link to marketplace listing or agent page</span>
            </label>
            <div className="relative">
              <ExternalLink className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <input
                type="url"
                value={agentExternalUrl}
                onChange={(e) => setAgentExternalUrl(e.target.value)}
                placeholder="https://tars.pro/ai-market/... or https://your-agent.xyz"
                className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-violet-500/50 transition-colors"
              />
            </div>
          </div>

          {/* Framework */}
          <div>
            <label className="block text-sm text-slate-400 mb-1.5">Framework</label>
            <select
              value={agentFramework}
              onChange={(e) => setAgentFramework(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/50 transition-colors"
            >
              <option value="unknown">Unknown / Other</option>
              <option value="elizaos">ElizaOS</option>
              <option value="agent_kit">Agent Kit</option>
              <option value="goat">GOAT</option>
            </select>
          </div>
        </div>

        {/* Capabilities */}
        <div>
          <label className="block text-sm text-slate-400 mb-2">
            Capabilities
            <span className="text-slate-500 ml-2 text-xs">— select what this agent can do</span>
          </label>
          <div className="grid grid-cols-1 gap-2">
            {TASK_TYPES.map((t) => {
              const selected = selectedTypes.includes(t.value);
              return (
                <label
                  key={t.value}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl border cursor-pointer transition-all ${
                    selected
                      ? "border-violet-500/40 bg-violet-500/10 text-violet-200"
                      : "border-white/8 bg-white/[0.02] text-slate-400 hover:border-white/15"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={() => toggleType(t.value)}
                    className="accent-violet-500 h-4 w-4"
                  />
                  <span className="text-sm">{t.label}</span>
                </label>
              );
            })}
          </div>
        </div>

        {/* Stake */}
        <div>
          <label className="block text-sm text-slate-400 mb-1.5">
            Stake Amount (SOL, min 0.1)
            <span className="text-slate-500 ml-2 text-xs">— deducted from your connected wallet as collateral for the agent</span>
          </label>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            min="0.1"
            step="0.1"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500/50 transition-colors"
          />
        </div>

        {!publicKey && (
          <p className="text-amber-400 text-sm flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Connect your Phantom wallet (Devnet) to register agents
          </p>
        )}

        <button
          onClick={handleRegister}
          disabled={!publicKey || status === "loading"}
          className="w-full gradient-btn text-white font-semibold py-3.5 rounded-xl disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {status === "loading" ? "Registering on-chain..." : "Register Agent"}
        </button>

        {status === "success" && txSig === "already-registered" && (
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4 text-blue-300 text-sm">
            <div className="font-semibold mb-1">Agent already registered on-chain</div>
            <p className="text-xs text-blue-400">
              This agent already has an on-chain AgentRecord. Manifest updated — profile is live.
            </p>
          </div>
        )}

        {status === "success" && txSig !== "already-registered" && (
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4 text-emerald-300 text-sm">
            <div className="font-semibold mb-1">Agent registered on-chain!</div>
            <a
              href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300"
            >
              View on Solana Explorer <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}

        {auditResult && (
          <div className="glass-card rounded-xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <Zap className="h-4 w-4 text-violet-400" />
              <h3 className="font-semibold text-white">Historical Audit Complete</h3>
              <span className="text-xs text-slate-500 ml-auto">{auditResult.tx_count} txs analyzed</span>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <div className="bg-white/[0.04] rounded-xl p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Initial Credit Score</div>
                <div className="text-3xl font-extrabold text-emerald-400">
                  {auditResult.credit_score}<span className="text-sm text-slate-500">/100</span>
                </div>
              </div>
              <div className="bg-white/[0.04] rounded-xl p-4 text-center">
                <div className="text-xs text-slate-500 mb-1">Safety Index</div>
                <div className="text-3xl font-extrabold text-violet-400">
                  {auditResult.safety_index}<span className="text-sm text-slate-500">/100</span>
                </div>
              </div>
            </div>
            {auditResult.risk_flags.length > 0 && (
              <ul className="list-disc list-inside text-slate-400 text-xs space-y-0.5 mb-3">
                {auditResult.risk_flags.map((flag, i) => <li key={i}>{flag}</li>)}
              </ul>
            )}
            <p className="text-slate-500 text-xs leading-relaxed">{auditResult.audit_summary}</p>
          </div>
        )}

        {status === "error" && (
          <div className="bg-rose-500/10 border border-rose-500/30 rounded-xl p-4 text-rose-300 text-sm">
            <div className="font-semibold mb-1 text-rose-200">Registration failed</div>
            <pre className="text-xs text-rose-400 whitespace-pre-wrap break-all font-mono leading-relaxed">{error}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
