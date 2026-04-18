import express, { Request, Response } from "express";
import cors from "cors";
import { ChainVerifier } from "./verifier";
import { WitnessSigner } from "./signer";
import { VerifyRequest, AgentProofTask } from "./types";

const app = express();
app.use(cors());
app.use(express.json());

// 内存存储（生产环境换成 Redis 或数据库）
const taskStore = new Map<string, AgentProofTask>();

let verifier: ChainVerifier;
let signer: WitnessSigner;

export function initApp(rpcUrl: string, privateKey: string) {
  verifier = new ChainVerifier(rpcUrl);
  signer = new WitnessSigner(privateKey);
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

    return res.json({ task, result });
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
  // 这里返回模拟数据（Demo 用）
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
