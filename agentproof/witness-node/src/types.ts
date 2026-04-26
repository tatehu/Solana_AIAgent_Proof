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
    agent_in_accounts?: boolean;
  };
}

export interface AgentProofTask {
  task_id: string;
  status: "pending" | "verified" | "rejected" | "timeout";
  signatures: VerifyResult[];
  created_at: number;
  settled_at?: number;
}

export interface IntentVerifyParams {
  agent_pubkey: string;
  task_type: string;
  expected_output?: unknown;
  tx_summary: {
    tx_signature: string;   // actual on-chain signature — passed to intent-engine
    programs_called: string[];
    fund_flows: string;
    failure_rate: number;
    slot: number;
  };
}

export interface IntentResult {
  aligned: boolean;
  confidence: number;
  reason: string;
  risk_flags: string[];
}

export interface VerifyResultWithIntent extends VerifyResult {
  intent_result?: IntentResult;
}
