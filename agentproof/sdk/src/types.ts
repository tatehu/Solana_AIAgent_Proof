export interface AgentProofConfig {
  rpcUrl: string;
  programId: string;
  witnessNodeUrl: string;
  riskMonitorUrl?: string;
}

export interface VerifyOptions {
  agentId: string;
  taskType: TaskType;
  taskId: string;
  txSignature: string;
  expectedOutput?: Record<string, unknown>;
}

export type TaskType =
  | "SOLANA_SWAP"
  | "DATA_ANALYSIS"
  | "REPORT_GENERATION"
  | "DEFI_OPERATION"
  | "CUSTOM";

export interface VerifiedProof {
  taskId: string;
  agentId: string;
  verified: boolean;
  proofNftAddress?: string;
  witnessCount: number;
  verifiedAt: number;
  txSignature: string;
  slot: number;
}

export interface AgentProfile {
  agentId: string;
  reputationScore: number;
  totalTasks: number;
  successRate: number;
  isFrozen: boolean;
  lastVerifiedTask?: string;
  registeredAt: number;
}
