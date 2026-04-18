"use client";
import { useState } from "react";
import { agentProof } from "@/lib/agentproof-sdk";
import type { ProofResult } from "@/lib/agentproof-sdk";

export default function VerifyPage() {
  const [taskId, setTaskId] = useState("");
  const [agentPubkey, setAgentPubkey] = useState("");
  const [txSig, setTxSig] = useState("");
  const [taskType, setTaskType] = useState("SOLANA_SWAP");
  const [result, setResult] = useState<ProofResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleVerify() {
    if (!taskId || !agentPubkey || !txSig) {
      setError("Please fill in all required fields");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const proof = await agentProof.verifyProof({
        task_id: taskId,
        agent_pubkey: agentPubkey,
        task_type: taskType,
        tx_signature: txSig,
        input_hash: "0".repeat(64),
        output_hash: "0".repeat(64),
        instruction_hash: "0".repeat(64),
        slot: 0,
      });
      setResult(proof);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verification failed";
      setError(msg);
    } finally {
      setLoading(false);
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
          <label className="block text-sm text-gray-400 mb-1">Task ID (hex)</label>
          <input
            type="text"
            value={taskId}
            onChange={(e) => setTaskId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder="task_001 or 32-byte hex"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">Agent Pubkey (base58)</label>
          <input
            type="text"
            value={agentPubkey}
            onChange={(e) => setAgentPubkey(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm"
            placeholder="Agent wallet public key"
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
          <label className="block text-sm text-gray-400 mb-1">Task Type</label>
          <select
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
          >
            <option value="SOLANA_SWAP">SOLANA_SWAP</option>
            <option value="DATA_ANALYSIS">DATA_ANALYSIS</option>
            <option value="REPORT_GENERATION">REPORT_GENERATION</option>
            <option value="DEFI_OPERATION">DEFI_OPERATION</option>
            <option value="CUSTOM">CUSTOM</option>
          </select>
        </div>

        <button
          onClick={handleVerify}
          disabled={loading}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {loading ? "Verifying..." : "Submit for Verification"}
        </button>

        {result && (
          <div
            className={`rounded-lg p-4 border ${
              result.status === "verified"
                ? "bg-green-900/20 border-green-700"
                : "bg-red-900/20 border-red-700"
            }`}
          >
            <div className="font-bold text-lg mb-2">
              {result.status === "verified" ? "✅ Verified" : "❌ Rejected"}
            </div>
            <div className="text-sm text-gray-400">
              Task ID: <span className="font-mono">{result.task_id}</span>
            </div>
            <div className="text-sm text-gray-400 mt-1">
              Witnesses: {result.signatures.length}
            </div>
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
