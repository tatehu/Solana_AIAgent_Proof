import { Connection, PublicKey } from "@solana/web3.js";
import axios from "axios";
import {
  AgentProofConfig,
  VerifyOptions,
  VerifiedProof,
  AgentProfile,
} from "./types";

export class AgentProofClient {
  private connection: Connection;
  private config: AgentProofConfig;

  constructor(config: AgentProofConfig) {
    this.config = config;
    this.connection = new Connection(config.rpcUrl, "confirmed");
  }

  /**
   * 验证 Agent 是否完成了声称的任务
   *
   * @example
   * const proof = await client.verify({
   *   agentId: "AgentXXX...",
   *   taskType: "SOLANA_SWAP",
   *   taskId: "task_001",
   *   txSignature: "5xyz...",
   *   expectedOutput: { tokenIn: "SOL", tokenOut: "USDC", minAmountOut: 95 }
   * });
   *
   * if (proof.verified) {
   *   await releasePayment(proof.taskId);
   * }
   */
  async verify(options: VerifyOptions): Promise<VerifiedProof> {
    const { agentId, taskType, taskId, txSignature, expectedOutput } = options;

    // 从链上查询任务证明
    const taskProofPDA = this.getTaskProofPDA(Buffer.from(taskId));
    const accountInfo = await this.connection.getAccountInfo(taskProofPDA);

    if (!accountInfo) {
      // 链上没有记录，通过见证节点实时验证
      const verifyResult = await axios.post(
        `${this.config.witnessNodeUrl}/api/v1/verify`,
        {
          task_id: taskId,
          agent_pubkey: agentId,
          task_type: taskType,
          tx_signature: txSignature,
          input_hash: "0".repeat(64),
          output_hash: "0".repeat(64),
          instruction_hash: "0".repeat(64),
          slot: await this.connection.getSlot(),
          expected_output: expectedOutput,
        }
      );

      const task = verifyResult.data.task;
      return {
        taskId,
        agentId,
        verified: task.status === "verified",
        witnessCount: task.signatures?.length ?? 0,
        verifiedAt: task.settled_at ?? Date.now() / 1000,
        txSignature,
        slot: 0,
      };
    }

    // 解析链上证明数据（简化版：实际需要根据 Anchor IDL 反序列化）
    const verified = accountInfo.data[accountInfo.data.length - 3] === 1;

    return {
      taskId,
      agentId,
      verified,
      witnessCount: 2,
      verifiedAt: Date.now() / 1000,
      txSignature,
      slot: 0,
    };
  }

  /**
   * 获取 Agent 链上档案（声誉、成功率等）
   *
   * @example
   * const agent = await client.getAgent("AgentXXX...");
   * console.log(agent.reputationScore);  // 847/1000
   * console.log(agent.successRate);      // 98.3%
   *
   * // 根据声誉决定借款上限
   * const borrowLimit = agent.reputationScore * 10; // $8,470 USDC
   */
  async getAgent(agentId: string): Promise<AgentProfile> {
    try {
      const response = await axios.get(
        `${this.config.witnessNodeUrl}/api/v1/agent/${agentId}`
      );
      const data = response.data;
      return {
        agentId,
        reputationScore: data.reputation_score,
        totalTasks: data.tasks_completed,
        successRate: data.success_rate,
        isFrozen: data.is_frozen,
        lastVerifiedTask: data.last_proof,
        registeredAt: 0,
      };
    } catch {
      return this.getAgentFromChain(agentId);
    }
  }

  /**
   * 检查 Agent 是否安全（未被冻结）
   */
  async isAgentSafe(agentId: string): Promise<boolean> {
    const agent = await this.getAgent(agentId);
    return !agent.isFrozen;
  }

  /**
   * 获取 Agent 风险评分
   */
  async getRiskScore(agentId: string): Promise<{
    score: number;
    level: "safe" | "warning" | "danger";
    reasons: string[];
  }> {
    if (!this.config.riskMonitorUrl) {
      throw new Error("riskMonitorUrl not configured");
    }
    const response = await axios.get(
      `${this.config.riskMonitorUrl}/api/v1/risk/${agentId}`
    );
    return {
      score: response.data.score,
      level: response.data.level,
      reasons: response.data.reasons,
    };
  }

  private getTaskProofPDA(taskId: Buffer): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
      [Buffer.from("proof"), taskId],
      new PublicKey(this.config.programId)
    );
    return pda;
  }

  private async getAgentFromChain(agentId: string): Promise<AgentProfile> {
    const [agentRecordPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from("agent"), new PublicKey(agentId).toBuffer()],
      new PublicKey(this.config.programId)
    );
    const accountInfo = await this.connection.getAccountInfo(agentRecordPDA);
    if (!accountInfo) {
      throw new Error(`Agent ${agentId} not registered`);
    }
    return {
      agentId,
      reputationScore: 0,
      totalTasks: 0,
      successRate: 0,
      isFrozen: false,
      registeredAt: 0,
    };
  }
}
