import {
  Connection,
  PublicKey,
  ParsedTransactionWithMeta,
} from "@solana/web3.js";
import { createHash } from "crypto";
import { VerifyRequest, VerifyResult } from "./types";

export class ChainVerifier {
  private connection: Connection;

  constructor(rpcUrl: string) {
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      confirmTransactionInitialTimeout: 60000,
    });
  }

  /**
   * 验证任务证明的核心逻辑
   * 验证的全部是 Solana 公共账本上的客观事实
   */
  async verify(req: VerifyRequest): Promise<{
    approved: boolean;
    reason?: string;
    chainData?: VerifyResult["chain_data"];
  }> {
    try {
      // Step 1: 验证 TxSig 是否存在于 Solana 账本
      const tx = await this.getTransaction(req.tx_signature);
      if (!tx) {
        return {
          approved: false,
          reason: `Transaction ${req.tx_signature} not found on-chain`,
        };
      }

      // Step 2: 验证交易状态（是否成功）
      if (tx.meta?.err) {
        return {
          approved: false,
          reason: `Transaction failed with error: ${JSON.stringify(tx.meta.err)}`,
        };
      }

      // Step 3: 验证执行 Slot 是否匹配（允许 ±5 Slot 误差）
      const actualSlot = tx.slot;
      if (Math.abs(actualSlot - req.slot) > 5) {
        return {
          approved: false,
          reason: `Slot mismatch: claimed ${req.slot}, actual ${actualSlot}`,
        };
      }

      // Step 4: 根据任务类型验证具体参数
      const taskVerification = await this.verifyByTaskType(req, tx);
      if (!taskVerification.approved) {
        return taskVerification;
      }

      // Step 5: 验证交易参与者包含 Agent
      const accountKeys = tx.transaction.message.accountKeys.map((k) =>
        "pubkey" in k ? k.pubkey.toBase58() : (k as PublicKey).toBase58()
      );
      if (!accountKeys.includes(req.agent_pubkey)) {
        return {
          approved: false,
          reason: `Agent ${req.agent_pubkey} not found in transaction accounts`,
        };
      }

      return {
        approved: true,
        chainData: {
          slot: actualSlot,
          block_time: tx.blockTime ?? 0,
          fee: tx.meta?.fee ?? 0,
          status: "confirmed",
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        approved: false,
        reason: `Verification error: ${message}`,
      };
    }
  }

  private async getTransaction(
    signature: string
  ): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
    } catch {
      return null;
    }
  }

  private async verifyByTaskType(
    req: VerifyRequest,
    tx: ParsedTransactionWithMeta
  ): Promise<{ approved: boolean; reason?: string }> {
    switch (req.task_type) {
      case "SOLANA_SWAP":
        return this.verifySwapTask(req, tx);
      case "DATA_ANALYSIS":
        return this.verifyDataAnalysisTask(req, tx);
      default:
        // 对于未知任务类型，只验证 TxSig 存在即可
        return { approved: true };
    }
  }

  private async verifySwapTask(
    req: VerifyRequest,
    tx: ParsedTransactionWithMeta
  ): Promise<{ approved: boolean; reason?: string }> {
    const expected = req.expected_output;
    if (!expected) return { approved: true };

    // 验证 token 余额变化
    const preBalances = tx.meta?.preTokenBalances ?? [];
    const postBalances = tx.meta?.postTokenBalances ?? [];

    // 简化验证：检查 tokenOut 余额是否增加
    if (expected.min_amount_out && expected.token_out) {
      const agentPostBalance = postBalances.find(
        (b) => b.owner === req.agent_pubkey
      );
      const agentPreBalance = preBalances.find(
        (b) => b.owner === req.agent_pubkey
      );

      if (agentPostBalance && agentPreBalance) {
        const balanceChange =
          parseFloat(agentPostBalance.uiTokenAmount.uiAmountString ?? "0") -
          parseFloat(agentPreBalance.uiTokenAmount.uiAmountString ?? "0");

        if (balanceChange < (expected.min_amount_out as number)) {
          return {
            approved: false,
            reason: `Output amount ${balanceChange} below minimum ${expected.min_amount_out}`,
          };
        }
      }
    }

    return { approved: true };
  }

  private async verifyDataAnalysisTask(
    req: VerifyRequest,
    _tx: ParsedTransactionWithMeta
  ): Promise<{ approved: boolean; reason?: string }> {
    // 数据分析任务：验证输出数据账户是否存在
    try {
      // output_hash 对应链上数据账户地址
      const dataAccountPubkey = new PublicKey(
        Buffer.from(req.output_hash, "hex")
      );
      const accountInfo = await this.connection.getAccountInfo(
        dataAccountPubkey
      );

      if (!accountInfo) {
        return {
          approved: false,
          reason: "Data account referenced in output_hash not found on-chain",
        };
      }

      return { approved: true };
    } catch {
      // 如果 output_hash 不是有效公钥，只验证 TxSig 存在
      return { approved: true };
    }
  }

  /**
   * 计算数据的 SHA-256 哈希
   */
  static hashData(data: unknown): string {
    return createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex");
  }
}
