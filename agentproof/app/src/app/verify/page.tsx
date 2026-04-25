"use client";
import { useState } from "react";
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
import { TASK_TYPES } from "@/lib/task-types";

// Anchor discriminator = sha256("global:submit_proof")[0..8]
async function submitProofDiscriminator(): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("global:submit_proof")
  );
  return new Uint8Array(hash).slice(0, 8);
}

// Map task type string to u8 (must match Rust enum order)
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

// task_id: string → 32-byte Uint8Array
// 64-char hex → decode directly; otherwise SHA-256 the string
async function taskIdToBytes(taskId: string): Promise<Uint8Array> {
  if (/^[0-9a-fA-F]{64}$/.test(taskId)) {
    return Buffer.from(taskId, "hex");
  }
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(taskId)
  );
  return new Uint8Array(hash);
}

// tx signature base58 → 64 bytes
function txSigToBytes(sig: string): Uint8Array {
  // base58 decode via @solana/web3.js bs58
  // PublicKey uses 32 bytes; for 64-byte sig we build it manually
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const dec = Array.from(sig).reduce((acc, c) => {
    const idx = chars.indexOf(c);
    return acc * 58n + BigInt(idx);
  }, 0n);
  const hex = dec.toString(16).padStart(128, "0");
  return Buffer.from(hex, "hex");
}

// Build submit_proof instruction data (Borsh layout matching SubmitProofParams)
// discriminator(8) + task_id(32) + instruction_hash(32) + input_hash(32)
// + output_hash(32) + tx_signature(64) + slot(u64 LE) + task_type(u8)
// + witnesses([Pubkey;3] = 3×32 bytes)
async function buildSubmitProofData(
  taskIdBytes: Uint8Array,
  txSigBytes: Uint8Array,
  slot: number,
  taskType: number,
  witnesses: PublicKey[]
): Promise<Buffer> {
  const disc = await submitProofDiscriminator();
  const zeros32 = Buffer.alloc(32);

  const witnessBufs = witnesses.map((w) => w.toBuffer());

  return Buffer.concat([
    Buffer.from(disc),
    Buffer.from(taskIdBytes),    // instruction_hash (reuse task_id as placeholder)
    zeros32,                      // input_hash
    zeros32,                      // output_hash
    Buffer.from(txSigBytes),     // tx_signature (64 bytes)
    encodeU64LE(slot),           // slot
    Buffer.from([taskType]),     // task_type (u8)
    ...witnessBufs,              // witnesses [Pubkey;3]
  ]);
}

// Re-encoded: Anchor's SubmitProofParams is a struct passed as single arg
// Layout: discriminator(8) + SubmitProofParams borsh:
//   task_id[32] + instruction_hash[32] + input_hash[32] + output_hash[32]
//   + tx_signature[64] + slot u64 + task_type u8 + witnesses [Pubkey;3]
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
    Buffer.from(taskIdBytes),   // task_id
    zeros32,                    // instruction_hash
    zeros32,                    // input_hash
    zeros32,                    // output_hash
    Buffer.from(txSigBytes),   // tx_signature (64 bytes)
    encodeU64LE(slot),         // slot
    Buffer.from([taskType]),   // task_type
    ...witnesses.map((w) => w.toBuffer()), // witnesses [Pubkey;3]
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

  const [taskId, setTaskId] = useState("");
  const [agentPubkeyInput, setAgentPubkeyInput] = useState("");
  const [txSig, setTxSig] = useState("");
  const [taskType, setTaskType] = useState("SOLANA_SWAP");
  const [slot, setSlot] = useState("");
  const [result, setResult] = useState<ProofResult | null>(null);
  const [chainProof, setChainProof] = useState<ChainProofStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<string>("");
  const [error, setError] = useState("");

  async function handleVerify() {
    if (!taskId || !txSig) {
      setError("Please fill in Task ID and Tx Signature");
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

      // Step 1: fetch witness pubkeys from witness node
      setStep("Fetching witness pubkeys...");
      const pubkeysRes = await fetch(`${WITNESS_NODE_URL}/api/v1/pubkeys`);
      if (!pubkeysRes.ok) throw new Error("Witness node unreachable — is it running?");
      const { witnesses: witnessPubkeyStrs } = await pubkeysRes.json() as {
        witnesses: string[];
      };
      const witnesses = witnessPubkeyStrs.map((s) => new PublicKey(s));

      // Step 2: compute PDA accounts
      const taskIdBytes = await taskIdToBytes(taskId);
      const txSigBytes = txSigToBytes(txSig);
      const slotNum = slot ? parseInt(slot) : 0;
      const taskTypeU8 = TASK_TYPE_U8[taskType] ?? 5;

      const [taskProofPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("proof"), Buffer.from(taskIdBytes)],
        PROGRAM_ID
      );
      const agentPubkeyObj = new PublicKey(agentPubkey);
      const [agentRecordPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("agent"), agentPubkeyObj.toBuffer()],
        PROGRAM_ID
      );
      const [witnessPoolPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("witness_pool")],
        PROGRAM_ID
      );

      // Step 3: build and send submit_proof transaction
      setStep("Submitting proof on-chain...");
      const ixData = await buildSubmitProofIxData(
        taskIdBytes,
        txSigBytes,
        slotNum,
        taskTypeU8,
        witnesses
      );

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

      let chainTxSig: string | undefined;
      try {
        chainTxSig = await sendTransaction(tx, connection);
        await connection.confirmTransaction(
          { signature: chainTxSig, blockhash, lastValidBlockHeight },
          "confirmed"
        );
        setChainProof({ txSig: chainTxSig, status: "submitted" });
      } catch (chainErr) {
        const msg = chainErr instanceof Error ? chainErr.message : String(chainErr);
        setChainProof({ txSig: "", status: "error", error: msg });
        // Continue anyway — witness node HTTP verification is still useful
      }

      // Step 4: call witness node HTTP API for off-chain verification + trigger chain signing
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
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setError(msg);
    } finally {
      setLoading(false);
      setStep("");
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Verify Task</h1>
      <p className="text-gray-400">
        Submit a task proof to witness nodes for on-chain verification.
      </p>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">Task ID (hex or string)</label>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder="task_001 or 32-byte hex"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Agent Pubkey{" "}
            <span className="text-gray-500">(leave blank to use connected wallet)</span>
          </label>
          <input
            type="text"
            value={agentPubkeyInput}
            onChange={(e) => setAgentPubkeyInput(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder={publicKey?.toBase58() ?? "Connect wallet or paste pubkey"}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Tx Signature (base58)
          </label>
          <input
            type="text"
            value={txSig}
            onChange={(e) => setTxSig(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder="Solana transaction signature"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Slot <span className="text-gray-500">(from Explorer, tx detail page)</span>
          </label>
          <input
            type="number"
            value={slot}
            onChange={(e) => setSlot(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder="e.g. 123456789"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Task Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
          >
            {TASK_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {!publicKey && (
          <p className="text-yellow-400 text-sm">
            ⚠️ Connect your Phantom wallet (Devnet) to submit proof on-chain
          </p>
        )}

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {loading ? step || "Processing..." : "Submit for Verification"}
        </button>

        {/* Chain submit_proof result */}
        {chainProof && (
          <div
            className={`rounded-lg p-3 border text-sm ${
              chainProof.status === "submitted"
                ? "bg-blue-900/20 border-blue-700"
                : "bg-yellow-900/20 border-yellow-700"
            }`}
          >
            {chainProof.status === "submitted" ? (
              <>
                <div className="font-bold text-blue-300">
                  🔗 Proof submitted on-chain
                </div>
                <a
                  href={`https://explorer.solana.com/tx/${chainProof.txSig}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-400 underline mt-1 block"
                >
                  View submit_proof tx →
                </a>
                <div className="text-xs text-gray-400 mt-1">
                  Witness nodes will call witness_sign × 3 (2-of-3 threshold → auto-settle)
                </div>
              </>
            ) : (
              <div className="text-yellow-300">
                ⚠️ On-chain submit skipped: {chainProof.error}
              </div>
            )}
          </div>
        )}

        {/* Witness node verification result */}
        {result && (
          <div
            className={`rounded-lg p-4 border ${
              result.status === "verified"
                ? "bg-green-900/20 border-green-700"
                : "bg-red-900/20 border-red-700"
            }`}
          >
            <div className="font-bold text-lg mb-2">
              {result.status === "verified" ? "✅ Witness Verified" : "❌ Rejected"}
            </div>
            <div className="text-sm text-gray-400">
              Task ID: <span className="font-mono">{result.task_id}</span>
            </div>
            <div className="text-sm text-gray-400 mt-1">
              Witnesses: {result.signatures.length}
            </div>
            {result.signatures.map((s, i) => (
              <div key={i} className="text-sm mt-2 border-t border-gray-700 pt-2">
                <span className={s.approved ? "text-green-400" : "text-red-400"}>
                  {s.approved ? "✅" : "❌"} Witness {i + 1}
                </span>
                {s.reason && (
                  <div className="text-yellow-300 mt-0.5 font-mono text-xs break-all">
                    {s.reason}
                  </div>
                )}
              </div>
            ))}
            {result.intent_result && (
              <div className={`mt-4 p-4 rounded-lg border ${
                result.intent_result.aligned
                  ? 'bg-green-900/20 border-green-700'
                  : 'bg-red-900/20 border-red-700'
              }`}>
                <div className="flex items-center gap-2">
                  <span>{result.intent_result.aligned ? '✅' : '❌'}</span>
                  <span className="font-semibold text-white">
                    Claude 意图验证：{result.intent_result.aligned ? '与声明能力一致' : '意图不符'}
                    （置信度 {Math.round(result.intent_result.confidence * 100)}%）
                  </span>
                </div>
                <p className="text-gray-300 text-sm mt-2">{result.intent_result.reason}</p>
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
            ❌ {error}
          </div>
        )}
      </div>
    </div>
  );
}
