import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { createHash } from "crypto";
import { VerifyResult } from "./types";

export class WitnessSigner {
  private keypair: Keypair;

  constructor(privateKeyBase58: string) {
    const secretKey = bs58.decode(privateKeyBase58);
    this.keypair = Keypair.fromSecretKey(secretKey);
  }

  get publicKey(): string {
    return this.keypair.publicKey.toBase58();
  }

  /**
   * 对验证结果进行签名
   */
  sign(taskId: string, approved: boolean, reason?: string): string {
    const message = this.buildSignatureMessage(taskId, approved, reason);
    const messageBytes = Buffer.from(message, "hex");
    // Ed25519 签名
    const signature = this.keypair.secretKey.slice(0, 32);
    // 简化：使用 HMAC 模拟签名（生产环境使用 nacl.sign）
    const hmac = createHash("sha256")
      .update(Buffer.from(signature))
      .update(messageBytes)
      .digest("hex");
    return hmac;
  }

  private buildSignatureMessage(
    taskId: string,
    approved: boolean,
    reason?: string
  ): string {
    // 签名内容：taskId + approved + reason + timestamp
    const payload = {
      task_id: taskId,
      approved,
      reason: reason ?? "",
      witness: this.publicKey,
      timestamp: Math.floor(Date.now() / 1000),
    };
    return createHash("sha256")
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  buildVerifyResult(
    taskId: string,
    approved: boolean,
    reason?: string,
    chainData?: VerifyResult["chain_data"]
  ): VerifyResult {
    const signature = this.sign(taskId, approved, reason);
    return {
      task_id: taskId,
      approved,
      witness_pubkey: this.publicKey,
      signature,
      reason,
      verified_at: Math.floor(Date.now() / 1000),
      chain_data: chainData,
    };
  }
}
