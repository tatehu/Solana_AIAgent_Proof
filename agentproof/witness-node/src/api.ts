import express, { Request, Response } from "express";
import cors from "cors";
import { ChainVerifier } from "./verifier";
import { WitnessSigner } from "./signer";
import { ChainClient } from "./chain-client";
import { VerifyRequest, AgentProofTask } from "./types";
import { IntentVerifier } from "./intent-verifier";
import { IntentResult } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

// 内存存储（生产环境换成 Redis 或数据库）
const taskStore = new Map<string, AgentProofTask>();

let verifier: ChainVerifier;
let signer: WitnessSigner;
let chainClient: ChainClient;
let intentVerifier: IntentVerifier;

export function initApp(rpcUrl: string, privateKey: string, programId: string) {
  verifier = new ChainVerifier(rpcUrl);
  signer = new WitnessSigner(privateKey);
  chainClient = new ChainClient(rpcUrl, privateKey, programId);
  intentVerifier = new IntentVerifier();
  return app;
}

// 健康检查
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    witness_pubkey: signer?.publicKey,
    timestamp: Date.now(),
  });
});

// 返回 3 个见证节点公钥（前端 submit_proof 时需要）
app.get("/api/v1/pubkeys", (_req: Request, res: Response) => {
  if (!chainClient) {
    return res.status(503).json({ error: "Chain client not initialized" });
  }
  const keys = chainClient.getWitnessPublicKeys();
  return res.json({
    witnesses: [keys.primary, keys.secondary1, keys.secondary2],
  });
});

// 提交验证请求
app.post("/api/v1/verify", async (req: Request, res: Response) => {
  const verifyReq = req.body as VerifyRequest;

  if (!verifyReq.task_id || !verifyReq.tx_signature) {
    return res.status(400).json({
      error: "Missing required fields: task_id, tx_signature",
    });
  }

  try {
    // 检查是否已经验证过
    const existing = taskStore.get(verifyReq.task_id);
    if (existing?.status !== "pending" && existing) {
      return res.json({ task: existing });
    }

    // 执行链上验证
    const verification = await verifier.verify(verifyReq);

    // Claude intent verification (only if chain verified and intentVerifier available)
    let intentResult: IntentResult | undefined;
    if (verification.approved && intentVerifier) {
      try {
        intentResult = await intentVerifier.verify({
          agent_pubkey: verifyReq.agent_pubkey,
          task_type: verifyReq.task_type,
          expected_output: verifyReq.expected_output,
          tx_summary: {
            tx_signature: verifyReq.tx_signature,
            programs_called: [],
            fund_flows: JSON.stringify(verification.chainData ?? {}),
            failure_rate: 0,
            slot: verifyReq.slot,
          },
        });
        if (!intentResult.aligned) {
          verification.approved = false;
          verification.reason = `Intent mismatch: ${intentResult.reason}`;
        }
      } catch (err) {
        console.warn('[intent] verification failed, skipping:', err);
      }
    }

    // 构建验证结果（含见证签名）
    const result = signer.buildVerifyResult(
      verifyReq.task_id,
      verification.approved,
      verification.reason,
      verification.chainData
    );

    // 存储任务状态
    const task: AgentProofTask = {
      task_id: verifyReq.task_id,
      status: verification.approved ? "verified" : "rejected",
      signatures: [result],
      created_at: Math.floor(Date.now() / 1000),
      settled_at: Math.floor(Date.now() / 1000),
    };
    taskStore.set(verifyReq.task_id, task);

    console.log(
      `[Verify] Task ${verifyReq.task_id}: ${
        verification.approved ? "APPROVED" : "REJECTED"
      } ${verification.reason ? "- " + verification.reason : ""}`
    );

    // 异步提交 witness_sign × 3 到链上（不阻塞 HTTP 响应）
    if (verifyReq.agent_pubkey && chainClient) {
      setImmediate(async () => {
        try {
          const agentPubkey =
            verifyReq.agent_pubkey ||
            (await chainClient.readAgentPubkeyFromProof(verifyReq.task_id));

          if (agentPubkey) {
            const signResults = await chainClient.submitWitnessSign(
              verifyReq.task_id,
              agentPubkey,
              verification.approved,
              verification.reason
            );
            const settled = signResults.some((r) => r.signature);
            console.log(
              `[ChainSign] Task ${verifyReq.task_id}: ${settled ? "settled on-chain" : "chain sign failed"}`
            );
          } else {
            console.warn(
              `[ChainSign] Cannot find agent_pubkey for task ${verifyReq.task_id}`
            );
          }
        } catch (e) {
          console.error("[ChainSign] Unexpected error:", e);
        }
      });
    }

    return res.json({ task, result, intent_result: intentResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[Verify Error] ${message}`);
    return res.status(500).json({ error: message });
  }
});

// 查询任务状态
app.get("/api/v1/proof/:taskId", (req: Request, res: Response) => {
  const { taskId } = req.params;
  const task = taskStore.get(taskId);

  if (!task) {
    return res.status(404).json({ error: "Task not found" });
  }

  return res.json({ task });
});

// 查询 Agent 信息（从链上读取）
app.get("/api/v1/agent/:pubkey", async (req: Request, res: Response) => {
  const { pubkey } = req.params;

  // TODO: 从链上 AgentRecord PDA 读取
  return res.json({
    agent_pubkey: pubkey,
    reputation_score: 847,
    tasks_completed: 156,
    success_rate: 98.3,
    is_frozen: false,
    last_proof: `https://explorer.solana.com/address/${pubkey}?cluster=devnet`,
  });
});

// 触发冻结（由 AI 风控服务调用）
app.post("/api/v1/freeze", async (req: Request, res: Response) => {
  const { agent_id, reason, risk_score } = req.body as {
    agent_id: string;
    reason: string;
    risk_score: number;
  };

  if (!agent_id || !reason) {
    return res.status(400).json({ error: "Missing agent_id or reason" });
  }

  // TODO: 实际调用链上 freeze_agent 指令
  console.log(`[Freeze] Agent: ${agent_id}, Score: ${risk_score}, Reason: ${reason}`);

  return res.json({
    success: true,
    agent_id,
    message: `Freeze request submitted for agent ${agent_id}`,
  });
});

export default app;
