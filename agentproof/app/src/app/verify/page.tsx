"use client";
import { useState, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { agentProof } from "@/lib/agentproof-sdk";
import type { ProofResult } from "@/lib/agentproof-sdk";
import { PROGRAM_ID, WITNESS_NODE_URL } from "@/lib/solana";
import { saveProof } from "@/lib/proof-store";
import { TASK_TYPES } from "@/lib/task-types";
import { CheckCircle, XCircle, Link as LinkIcon, AlertTriangle, Loader2, Shield, Cpu, GitMerge } from "lucide-react";

// Anchor discriminator = sha256("global:submit_proof")[0..8]
async function submitProofDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("global:submit_proof").buffer as ArrayBuffer
  );
  return new Uint8Array(hash).slice(0, 8);
}

const TASK_TYPE_U8: Record<string, number> = {
  SOLANA_SWAP: 1,
  DATA_ANALYSIS: 2,
  REPORT_GENERATION: 3,
  DEFI_OPERATION: 4,
  CUSTOM: 5,
};

function encodeU64LE(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

async function taskIdToBytes(taskId: string): Promise<Uint8Array> {
  if (/^[0-9a-fA-F]{64}$/.test(taskId)) {
    return Buffer.from(taskId, "hex");
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(taskId).buffer as ArrayBuffer
  );
  return new Uint8Array(hash);
}

function txSigToBytes(sig: string): Uint8Array {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const dec = Array.from(sig).reduce((acc, c) => {
    const idx = chars.indexOf(c);
    return acc * 58n + BigInt(idx);
  }, 0n);
  const hex = dec.toString(16).padStart(128, "0");
  return Buffer.from(hex, "hex");
}

async function buildSubmitProofIxData(
  taskIdBytes: Uint8Array,
  txSigBytes: Uint8Array,
  slot: number,
  taskType: number,
  witnesses: PublicKey[]
): Promise<Buffer> {
  const disc = await submitProofDiscriminator();
  const zeros32 = Buffer.alloc(32);

  return Buffer.concat([
    Buffer.from(disc),
    Buffer.from(taskIdBytes),
    zeros32,
    zeros32,
    zeros32,
    Buffer.from(txSigBytes),
    encodeU64LE(slot),
    Buffer.from([taskType]),
    ...witnesses.map((w) => w.toBuffer()),
  ]);
}

type ChainProofStatus = {
  txSig: string;
  status: "submitted" | "error";
  error?: string;
};

export default function VerifyPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();

  const [taskId, setTaskId] = useState(() => crypto.randomUUID());
  const [agentPubkeyInput, setAgentPubkeyInput] = useState("");
  const [txSig, setTxSig] = useState("");
  const [taskType, setTaskType] = useState("SOLANA_SWAP");
  const [slot, setSlot] = useState("");
  const [fetchingSlot, setFetchingSlot] = useState(false);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [chainProof, setChainProof] = useState<ChainProofStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState("");

  const fetchSlotFromTx = useCallback(async (sig: string) => {
    if (!sig || sig.length < 80) return;
    setFetchingSlot(true);
    try {
      const tx = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      if (tx?.slot) setSlot(String(tx.slot));
    } catch {
      // ignore — user can fill manually
    } finally {
      setFetchingSlot(false);
    }
  }, [connection]);

  async function handleVerify() {
    if (!txSig) {
      setError("Please fill in the Tx Signature");
      return;
    }
    if (!publicKey) {
      setError("Please connect your wallet to submit proof");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);
    setChainProof(null);

    try {
      const agentPubkey = agentPubkeyInput || publicKey.toBase58();

      setStep("Fetching witness pubkeys...");
      const pubkeysRes = await fetch(`${WITNESS_NODE_URL}/api/v1/pubkeys`);
      if (!pubkeysRes.ok) throw new Error("Witness node unreachable — is it running?");
      const { witnesses: witnessPubkeyStrs } = await pubkeysRes.json() as { witnesses: string[] };
      const witnesses = witnessPubkeyStrs.map((s) => new PublicKey(s));

      const taskIdBytes = await taskIdToBytes(taskId);
      const txSigBytes = txSigToBytes(txSig);
      const slotNum = slot ? parseInt(slot) : 0;
      const taskTypeU8 = TASK_TYPE_U8[taskType] ?? 5;

      const [taskProofPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("proof"), Buffer.from(taskIdBytes)],
        PROGRAM_ID
      );
      const [agentRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), publicKey.toBuffer()],
        PROGRAM_ID
      );
      const [witnessPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("witness_pool")],
        PROGRAM_ID
      );

      setStep("Checking agent registration...");
      const agentAccountInfo = await connection.getAccountInfo(agentRecordPda);
      if (!agentAccountInfo) {
        setChainProof({
          txSig: "",
          status: "error",
          error: "Your wallet is not registered as an agent — go to Register Agent first.",
        });
      } else {
        setStep("Submitting proof on-chain...");
        const ixData = await buildSubmitProofIxData(taskIdBytes, txSigBytes, slotNum, taskTypeU8, witnesses);

        const submitIx = new TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: taskProofPda, isSigner: false, isWritable: true },
            { pubkey: agentRecordPda, isSigner: false, isWritable: true },
            { pubkey: witnessPoolPda, isSigner: false, isWritable: false },
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: ixData,
        });

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        const tx = new Transaction();
        tx.recentBlockhash = blockhash;
        tx.feePayer = publicKey;
        tx.add(submitIx);

        // Pre-simulate to get real program logs before Phantom swallows them
        setStep("Simulating transaction...");
        const simResult = await connection.simulateTransaction(tx);
        if (simResult.value.err) {
          const logs = simResult.value.logs ?? [];
          const programLine = logs.findLast((l) =>
            l.includes("Error") || l.includes("failed") || l.includes("AnchorError") || l.includes("custom program error")
          );
          const rawMsg = programLine
            ? programLine.replace(/^Program \S+ /, "")
            : JSON.stringify(simResult.value.err);
          const friendlyMsg =
            rawMsg.includes("AccountNotInitialized") || rawMsg.includes("account not found")
              ? "Your wallet is not registered as an agent — go to Register Agent first."
              : rawMsg.includes("already in use")
              ? "This task ID was already submitted. Refresh the page and try again."
              : rawMsg;
          setChainProof({ txSig: "", status: "error", error: `Simulation failed: ${friendlyMsg}` });
        } else {
          setStep("Submitting proof on-chain...");
          try {
            const chainTxSig = await sendTransaction(tx, connection);
            await connection.confirmTransaction({ signature: chainTxSig, blockhash, lastValidBlockHeight }, "confirmed");
            setChainProof({ txSig: chainTxSig, status: "submitted" });
          } catch (chainErr: unknown) {
            const msg = chainErr instanceof Error ? chainErr.message : "Transaction failed";
            const friendlyMsg = msg.includes("User rejected") ? "Transaction cancelled." : msg;
            setChainProof({ txSig: "", status: "error", error: friendlyMsg });
          }
        }
      }

      setStep("Sending to witness node...");
      const proof = await agentProof.verifyProof({
        task_id: taskId,
        agent_pubkey: agentPubkey,
        task_type: taskType,
        tx_signature: txSig,
        input_hash: "0".repeat(64),
        output_hash: "0".repeat(64),
        instruction_hash: "0".repeat(64),
        slot: slotNum,
      });
      setResult(proof);

      saveProof({
        task_id: taskId,
        agent_pubkey: agentPubkey,
        tx_signature: txSig,
        task_type: taskType,
        slot: slotNum,
        status: proof.status === "verified" ? "verified" : "rejected",
        submitted_at: Math.floor(Date.now() / 1000),
        chain_tx: chainProof?.status === "submitted" ? chainProof.txSig : undefined,
        witness_count: proof.signatures.length,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setError(msg);
    } finally {
      setLoading(false);
      setStep("");
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8 py-8">

      {/* ── Page header ── */}
      <div>
        <h1 className="text-4xl font-bold text-white mb-2">Submit Task Proof</h1>
        <p className="text-slate-400">
          Record any agent task on-chain — witnessed, signed, and permanently verifiable.
        </p>
      </div>

      {/* ── Verification pipeline ── */}
      <div className="border border-white/10 rounded-2xl px-5 py-3 flex items-center gap-1 flex-wrap">
        {[
          { icon: <Shield className="h-3.5 w-3.5" />, color: "blue", label: "Chain Verify" },
          { icon: <Cpu className="h-3.5 w-3.5" />, color: "purple", label: "Intent Check" },
          { icon: <GitMerge className="h-3.5 w-3.5" />, color: "emerald", label: "2-of-3 Sign" },
        ].map(({ icon, color, label }, i) => (
          <div key={label} className="flex items-center gap-1">
            {i > 0 && <span className="text-white/20 text-xs mx-1">→</span>}
            <div className={`flex items-center gap-1.5 text-xs font-medium text-${color}-400`}>
              {icon}
              {label}
            </div>
          </div>
        ))}
        <span className="ml-auto text-slate-600 text-xs hidden sm:block">Manual testing mode</span>
      </div>

      {/* ── Form ── */}
      <div className="glass-card rounded-3xl border border-white/10 p-8 space-y-5">

        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-400">
            Agent Pubkey{" "}
            <span className="text-slate-600 font-normal">(leave blank to use connected wallet)</span>
          </label>
          <input
            type="text"
            value={agentPubkeyInput}
            onChange={(e) => setAgentPubkeyInput(e.target.value)}
            className="input-field font-mono"
            placeholder={publicKey?.toBase58() ?? "Connect wallet or paste pubkey"}
          />
        </div>

        <div className="space-y-1">
          <label className="block text-sm font-medium text-slate-400">Tx Signature (base58)</label>
          <input
            type="text"
            value={txSig}
            onChange={(e) => setTxSig(e.target.value)}
            onBlur={(e) => fetchSlotFromTx(e.target.value)}
            className="input-field font-mono"
            placeholder="Solana transaction signature"
          />
          <p className="text-xs text-slate-600">Slot will be auto-filled when you paste a valid signature.</p>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-400 flex items-center gap-2">
              Slot
              {fetchingSlot && <Loader2 className="h-3 w-3 animate-spin text-slate-500" />}
              {!fetchingSlot && <span className="text-slate-600 font-normal">(auto-filled from tx)</span>}
            </label>
            <input
              type="number"
              value={slot}
              onChange={(e) => setSlot(e.target.value)}
              className="input-field font-mono"
              placeholder="e.g. 123456789"
            />
          </div>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-slate-400">Task Type</label>
            <select
              value={taskType}
              onChange={(e) => setTaskType(e.target.value)}
              className="input-field"
            >
              {TASK_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>

        {!publicKey && (
          <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-2xl px-4 py-3 text-amber-400 text-sm">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Connect your Phantom wallet (Devnet) to submit proof on-chain
          </div>
        )}

        <button
          onClick={handleVerify}
          disabled={loading}
          className="gradient-btn w-full text-white font-bold py-4 rounded-2xl flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
        >
          {loading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {step || "Processing..."}
            </>
          ) : (
            "Submit for Verification"
          )}
        </button>

        {/* ── Chain proof result ── */}
        {!loading && chainProof?.status === "submitted" && (
          <div className="rounded-2xl p-4 border text-sm bg-blue-500/10 border-blue-500/20">
            <div className="flex items-center gap-2 font-semibold text-blue-400 mb-2">
              <LinkIcon className="h-4 w-4" />
              Proof submitted on-chain
            </div>
            <a
              href={`https://explorer.solana.com/tx/${chainProof.txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline block mb-1"
            >
              View submit_proof tx →
            </a>
            <div className="text-xs text-slate-500">
              Witness nodes will call witness_sign × 3 (2-of-3 threshold → auto-settle)
            </div>
          </div>
        )}

        {/* Only show chain error when verification is done and witness verification also failed */}
        {!loading && chainProof?.status === "error" && (!result || result.status !== "verified") && (
          <div className="rounded-2xl p-4 border text-sm bg-rose-500/10 border-rose-500/20">
            <div className="flex items-start gap-2 text-rose-400">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
              On-chain submit failed: {chainProof.error}
            </div>
          </div>
        )}

        {/* ── Witness verification result ── */}
        {result && (
          <div className={`rounded-2xl p-5 border ${
            result.status === "verified"
              ? "bg-emerald-500/10 border-emerald-500/20"
              : "bg-rose-500/10 border-rose-500/20"
          }`}>
            <div className={`flex items-center gap-2 font-bold text-lg mb-4 ${
              result.status === "verified" ? "text-emerald-400" : "text-rose-400"
            }`}>
              {result.status === "verified"
                ? <CheckCircle className="h-5 w-5" />
                : <XCircle className="h-5 w-5" />
              }
              {result.status === "verified" ? "Witness Verified" : "Rejected"}
            </div>

            <div className="space-y-1 text-sm mb-4">
              <div className="text-slate-400">
                Task ID: <span className="font-mono text-slate-200">{result.task_id}</span>
              </div>
              <div className="text-slate-400">
                Witnesses: <span className="text-slate-200">{result.signatures.length}</span>
              </div>
            </div>

            <div className="space-y-2">
              {result.signatures.map((s, i) => (
                <div key={i} className={`rounded-xl px-4 py-2.5 border text-sm flex items-center gap-2 ${
                  s.approved
                    ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                    : "bg-rose-500/10 border-rose-500/20 text-rose-400"
                }`}>
                  {s.approved ? <CheckCircle className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
                  <span className="font-medium">Witness {i + 1}</span>
                  {s.reason && <span className="text-xs font-mono text-slate-400 ml-1 truncate">{s.reason}</span>}
                </div>
              ))}
            </div>

            {result.intent_result && (
              <div className={`mt-4 rounded-2xl p-4 border ${
                result.intent_result.aligned
                  ? "bg-emerald-500/10 border-emerald-500/20"
                  : "bg-rose-500/10 border-rose-500/20"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  {result.intent_result.aligned
                    ? <CheckCircle className="h-4 w-4 text-emerald-400" />
                    : <XCircle className="h-4 w-4 text-rose-400" />
                  }
                  <span className={`font-semibold text-sm ${result.intent_result.aligned ? "text-emerald-400" : "text-rose-400"}`}>
                    Intent {result.intent_result.aligned ? "Aligned" : "Mismatch"}
                  </span>
                  <span className="text-xs text-slate-500 ml-auto">
                    {Math.round(result.intent_result.confidence * 100)}% confidence
                  </span>
                </div>
                <p className="text-slate-400 text-sm leading-relaxed">{result.intent_result.reason}</p>
                <div className="text-slate-600 text-xs mt-2">Powered by Claude Haiku</div>
              </div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="flex items-start gap-2 bg-rose-500/10 border border-rose-500/20 rounded-2xl px-4 py-3 text-rose-400 text-sm">
            <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
