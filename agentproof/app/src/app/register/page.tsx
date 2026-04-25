"use client";
import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import {
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from "@solana/web3.js";
import { PROGRAM_ID } from "@/lib/solana";
import { TASK_TYPES } from "@/lib/task-types";
import Link from "next/link";

// register_agent discriminator from IDL
const REGISTER_AGENT_DISC = Buffer.from([135, 157, 66, 195, 2, 113, 175, 30]);

function encodeU64LE(value: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(value));
  return buf;
}

function buildRegisterAgentIx(
  agentPubkey: PublicKey,
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
      { pubkey: agentRecord, isSigner: false, isWritable: true },
      { pubkey: agentPubkey, isSigner: true, isWritable: true },
      { pubkey: stakeVault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export default function RegisterPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [stakeAmount, setStakeAmount] = useState("0.1");
  const [capabilities, setCapabilities] = useState<string[]>(["SOLANA_SWAP", "DATA_ANALYSIS"]);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [txSig, setTxSig] = useState("");
  const [error, setError] = useState("");
  const [existingAgent, setExistingAgent] = useState<{ credit_score: number; safety_index: number; staked_lamports: number; registered_at: number } | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);

  // 每次钱包切换时，检查该钱包是否已在链上注册过 Agent
  useEffect(() => {
    if (!publicKey) {
      setExistingAgent(null);
      return;
    }

    async function checkExisting() {
      if (!publicKey) return;
      setCheckingExisting(true);
      setExistingAgent(null);
      try {
        const [agentRecordPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from("agent"), publicKey.toBuffer()],
          PROGRAM_ID
        );
        const accountInfo = await connection.getAccountInfo(agentRecordPDA);
        if (accountInfo && accountInfo.data.length > 0) {
          const data = accountInfo.data;
          let offset = 8 + 32 + 32;
          const staked_lamports = Number(data.readBigUInt64LE(offset)); offset += 8;
          const credit_score = Number(data.readBigUInt64LE(offset)); offset += 8;
          const safety_index = Number(data.readBigUInt64LE(offset)); offset += 8;
          offset += 8 + 8 + 2 + 1; // tasks_completed, tasks_failed, success_rate_bps, is_frozen
          const registered_at = Number(data.readBigInt64LE(offset));
          setExistingAgent({ credit_score, safety_index, staked_lamports, registered_at });
        }
      } catch {
        // 账户不存在是正常情况，忽略错误
      } finally {
        setCheckingExisting(false);
      }
    }

    checkExisting();
  }, [publicKey, connection]);

  async function handleRegister() {
    if (!publicKey) {
      setError("Please connect your wallet first");
      return;
    }

    setStatus("loading");
    setError("");

    try {
      const stakeSOL = parseFloat(stakeAmount);
      if (stakeSOL < 0.1) throw new Error("Minimum stake is 0.1 SOL");

      // SHA-256 of capability manifest via Web Crypto API
      const manifest = {
        capabilities,
        version: "1.0",
        agent: publicKey.toBase58(),
      };
      const encoded = new TextEncoder().encode(JSON.stringify(manifest));
      const hashBuffer = await window.crypto.subtle.digest("SHA-256", encoded);
      const capabilityHash = new Uint8Array(hashBuffer);

      const stakeLamports = Math.floor(stakeSOL * LAMPORTS_PER_SOL);
      const ix = buildRegisterAgentIx(publicKey, capabilityHash, stakeLamports);

      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();
      const transaction = new Transaction();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;
      transaction.add(ix);

      const sig = await sendTransaction(transaction, connection);
      await connection.confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed"
      );

      setTxSig(sig);
      setStatus("success");
    } catch (e) {
      console.error("Register error:", e);
      const msg =
        e instanceof Error
          ? e.message
          : typeof e === "object"
          ? JSON.stringify(e)
          : String(e);
      setError(msg);
      setStatus("error");
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">List Your Agent</h1>
        <p className="text-gray-400 mt-1">
          Become a verified agent provider on AgentProof. Stake SOL as collateral,
          declare your capabilities, and build an on-chain reputation that users can trust.
        </p>
      </div>

      {/* Value prop for providers */}
      <div className="grid grid-cols-3 gap-3 text-center text-sm">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="text-xl mb-1">🏆</div>
          <div className="font-semibold text-white">On-chain Reputation</div>
          <div className="text-xs text-gray-500 mt-0.5">Every verified task raises your score</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="text-xl mb-1">🔒</div>
          <div className="font-semibold text-white">Stake = Trust Signal</div>
          <div className="text-xs text-gray-500 mt-0.5">Users see your skin in the game</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-3">
          <div className="text-xl mb-1">✅</div>
          <div className="font-semibold text-white">Proof of Work</div>
          <div className="text-xs text-gray-500 mt-0.5">Tamper-proof task history on-chain</div>
        </div>
      </div>

      {/* 已注册提示 */}
      {checkingExisting && (
        <div className="bg-gray-900 rounded-xl border border-gray-700 p-4 text-sm text-gray-400">
          Checking if this wallet is already registered...
        </div>
      )}

      {!checkingExisting && existingAgent && (
        <div className="bg-green-900/20 rounded-xl border border-green-700 p-5 space-y-3">
          <div className="flex items-center gap-2 text-green-400 font-semibold">
            ✅ Your agent is live on-chain
          </div>
          <p className="text-xs text-gray-400">
            Users can now view your on-chain reputation and verified task history.
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div className="bg-gray-900/60 rounded-lg p-3 text-center">
              <div className="text-gray-400 text-xs mb-1">Credit Score</div>
              <div className="text-white font-bold">{existingAgent.credit_score}</div>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3 text-center">
              <div className="text-gray-400 text-xs mb-1">Safety Index</div>
              <div className="text-white font-bold">{existingAgent.safety_index}</div>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3 text-center">
              <div className="text-gray-400 text-xs mb-1">Staked</div>
              <div className="text-white font-bold">{(existingAgent.staked_lamports / 1e9).toFixed(2)} SOL</div>
            </div>
            <div className="bg-gray-900/60 rounded-lg p-3 text-center">
              <div className="text-gray-400 text-xs mb-1">Registered</div>
              <div className="text-white font-bold text-xs">
                {new Date(existingAgent.registered_at * 1000).toLocaleDateString()}
              </div>
            </div>
          </div>
          <Link
            href={`/agent/${publicKey?.toBase58()}`}
            className="block text-center text-sm text-purple-400 hover:text-purple-300 underline"
          >
            View Agent Details →
          </Link>
        </div>
      )}

      {/* 注册表单：未注册时显示 */}
      {!checkingExisting && !existingAgent && (
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-6 space-y-4">
        <div>
          <label className="block text-sm text-gray-400 mb-2">
            Capability Manifest
            <span className="text-gray-600 ml-2 text-xs">— what tasks can your agent perform?</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {TASK_TYPES.map((t) => (
              <label
                key={t.value}
                className="flex items-center gap-2 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 cursor-pointer hover:border-purple-500 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={capabilities.includes(t.value)}
                  onChange={(e) =>
                    setCapabilities((prev) =>
                      e.target.checked
                        ? [...prev, t.value]
                        : prev.filter((v) => v !== t.value)
                    )
                  }
                  className="accent-purple-500"
                />
                <span className="text-sm text-white">{t.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-sm text-gray-400 mb-1">
            Stake Amount (SOL, min 0.1)
            <span className="text-gray-600 ml-2 text-xs">— collateral users see before hiring you</span>
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
          {status === "loading" ? "Registering on-chain..." : "List My Agent"}
        </button>

        {status === "success" && (
          <div className="bg-green-900/30 border border-green-700 rounded-lg p-3 text-green-300 text-sm">
            ✅ Agent listed on-chain! Users can now find and hire your agent.
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
          <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 text-red-300 text-sm break-all">
            ❌ {error}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
