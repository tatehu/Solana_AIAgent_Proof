"use client";
import { useState } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, LAMPORTS_PER_SOL, Transaction, SystemProgram } from "@solana/web3.js";
import { createHash } from "crypto";

export default function RegisterPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [capabilities, setCapabilities] = useState("SOLANA_SWAP,DATA_ANALYSIS");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");

  async function handleRegister() {
    if (!publicKey) {
      setError("Please connect your wallet first");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      // 计算 capability_hash
      const capabilityManifest = {
        capabilities: capabilities.split(",").map((c) => c.trim()),
        version: "1.0",
        agent: publicKey.toBase58(),
      };
      const capabilityHash = createHash("sha256")
        .update(JSON.stringify(capabilityManifest))
        .digest();

      const stakeSOL = parseFloat(stakeAmount);
      if (stakeSOL < 0.1) {
        throw new Error("Minimum stake is 0.1 SOL");
      }

      // TODO: 调用 Anchor 程序 register_agent 指令
      // 这里用简单转账模拟（Demo 用）
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: publicKey, // 实际应是 stake_vault PDA
          lamports: stakeSOL * LAMPORTS_PER_SOL,
        })
      );

      const sig = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setTxSig(sig);
      setStatus("success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setStatus("error");
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Register Agent</h1>
      <p className="text-gray-400">
        Register your AI Agent on-chain, stake SOL as a behavior guarantee, and
        declare your capability manifest.
      </p>

      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Capability Manifest (comma-separated)
          </label>
          <input
            type="text"
            value={capabilities}
            onChange={(e) => setCapabilities(e.target.value)}
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
            placeholder="SOLANA_SWAP,DATA_ANALYSIS"
          />
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Stake Amount (SOL, min 0.1)
          </label>
          <input
            type="number"
            value={stakeAmount}
            onChange={(e) => setStakeAmount(e.target.value)}
            min="0.1"
            step="0.1"
            className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
          />
        </div>

        {!publicKey && (
          <p className="text-yellow-400 text-sm">
            ⚠️ Connect your Phantom wallet (Devnet) to register
          </p>
        )}

        <button
          onClick={handleRegister}
          disabled={!publicKey || status === "loading"}
          className="w-full bg-purple-600 hover:bg-purple-700 disabled:bg-gray-700 disabled:text-gray-500 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {status === "loading" ? "Registering..." : "Register Agent"}
        </button>

        {status === "success" && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-300 text-sm">
            ✅ Agent registered successfully!
            <br />
            <a
              href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="underline mt-1 block"
            >
              View on Solana Explorer →
            </a>
          </div>
        )}

        {status === "error" && (
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm">
            ❌ {error}
          </div>
        )}
      </div>
    </div>
  );
}
