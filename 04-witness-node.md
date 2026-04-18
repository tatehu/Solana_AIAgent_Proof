# 04 — 见证节点服务（Node.js/TypeScript）

## 初始化项目

```bash
mkdir witness-node && cd witness-node
npm init -y

npm install @solana/web3.js @helius-labs/sdk express cors dotenv bs58 \
  @coral-xyz/anchor typescript tsx

npm install -D @types/node @types/express @types/cors
```

---

## package.json

```json
{
  "name": "@agentproof/witness-node",
  "version": "0.1.0",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "tsx src/test.ts"
  }
}
```

---

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "lib": ["ES2022"],
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true
  }
}
```

---

## src/types.ts

```typescript
export interface VerifyRequest {
  task_id: string;          // 32字节hex
  agent_pubkey: string;     // base58 公钥
  task_type: string;        // "SOLANA_SWAP" | "DATA_ANALYSIS" | etc.
  tx_signature: string;     // 链上交易签名（base58）
  input_hash: string;       // 32字节hex
  output_hash: string;      // 32字节hex
  instruction_hash: string; // 32字节hex（用户原始指令哈希）
  slot: number;             // 执行时 Slot
  expected_output?: {       // 可选：预期输出参数
    token_in?: string;
    token_out?: string;
    min_amount_out?: number;
    [key: string]: unknown;
  };
}

export interface VerifyResult {
  task_id: string;
  approved: boolean;
  witness_pubkey: string;
  signature: string;       // 见证节点 Ed25519 签名
  reason?: string;         // 拒绝原因
  verified_at: number;     // Unix 时间戳
  chain_data?: {           // 链上查询到的实际数据
    slot: number;
    block_time: number;
    fee: number;
    status: string;
  };
}

export interface AgentProofTask {
  task_id: string;
  status: 'pending' | 'verified' | 'rejected' | 'timeout';
  signatures: VerifyResult[];
  created_at: number;
  settled_at?: number;
}
```

---

## src/verifier.ts（核心验证逻辑）

```typescript
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
      const accountKeys = tx.transaction.message.accountKeys.map(k =>
        k.pubkey ? k.pubkey.toBase58() : k.toBase58()
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
        b => b.owner === req.agent_pubkey
      );
      const agentPreBalance = preBalances.find(
        b => b.owner === req.agent_pubkey
      );

      if (agentPostBalance && agentPreBalance) {
        const balanceChange =
          parseFloat(agentPostBalance.uiTokenAmount.uiAmountString ?? "0") -
          parseFloat(agentPreBalance.uiTokenAmount.uiAmountString ?? "0");

        if (balanceChange < expected.min_amount_out) {
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
```

---

## src/signer.ts（见证签名管理）

```typescript
import {
  Keypair,
  Transaction,
  Connection,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as bs58 from "bs58";
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
    const signature = this.keypair.sign(Buffer.from(message));
    return bs58.encode(signature);
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
```

---

## src/api.ts（REST API）

```typescript
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
      `[Verify] Task ${verifyReq.task_id}: ${verification.approved ? "APPROVED" : "REJECTED"} ${verification.reason ? "- " + verification.reason : ""}`
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
    last_proof: "https://explorer.solana.com/address/...",
  });
});
```

---

## src/index.ts（服务入口）

```typescript
import dotenv from "dotenv";
dotenv.config();

import { initApp } from "./api";

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
const HELIUS_RPC_URL = process.env.HELIUS_RPC_URL ?? "";
const WITNESS_PRIVATE_KEY = process.env.WITNESS_PRIVATE_KEY ?? "";

if (!HELIUS_RPC_URL || !WITNESS_PRIVATE_KEY) {
  console.error("Missing required environment variables: HELIUS_RPC_URL, WITNESS_PRIVATE_KEY");
  process.exit(1);
}

const app = initApp(HELIUS_RPC_URL, WITNESS_PRIVATE_KEY);

app.listen(PORT, () => {
  console.log(`🔍 AgentProof Witness Node running on port ${PORT}`);
  console.log(`   RPC: ${HELIUS_RPC_URL.substring(0, 50)}...`);
});
```

---

## 多节点编排（Docker Compose）

```yaml
# docker-compose.yml（见证节点集群）
version: "3.8"

services:
  witness-1:
    build: ./witness-node
    ports:
      - "3001:3001"
    environment:
      - PORT=3001
      - HELIUS_RPC_URL=${HELIUS_RPC_URL}
      - WITNESS_PRIVATE_KEY=${WITNESS_1_PRIVATE_KEY}
      - AGENTPROOF_PROGRAM_ID=${AGENTPROOF_PROGRAM_ID}
    restart: always

  witness-2:
    build: ./witness-node
    ports:
      - "3002:3001"
    environment:
      - PORT=3001
      - HELIUS_RPC_URL=${HELIUS_RPC_URL}
      - WITNESS_PRIVATE_KEY=${WITNESS_2_PRIVATE_KEY}
      - AGENTPROOF_PROGRAM_ID=${AGENTPROOF_PROGRAM_ID}
    restart: always

  witness-3:
    build: ./witness-node
    ports:
      - "3003:3001"
    environment:
      - PORT=3001
      - HELIUS_RPC_URL=${HELIUS_RPC_URL}
      - WITNESS_PRIVATE_KEY=${WITNESS_3_PRIVATE_KEY}
      - AGENTPROOF_PROGRAM_ID=${AGENTPROOF_PROGRAM_ID}
    restart: always
```

---

## 启动命令

```bash
# 生成 3 个见证节点密钥对
for i in 1 2 3; do
  solana-keygen new --no-bip39-passphrase -o witness-$i.json
  echo "Witness $i: $(solana address -k witness-$i.json)"
done

# 开发模式（单节点）
cd witness-node
cp .env.example .env
# 填写 HELIUS_API_KEY 和 WITNESS_PRIVATE_KEY
npm run dev

# 生产模式（3节点集群）
docker-compose up -d
```
