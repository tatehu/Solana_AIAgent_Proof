export { AgentProofClient } from "./client";
export type {
  AgentProofConfig,
  VerifyOptions,
  VerifiedProof,
  AgentProfile,
  TaskType,
} from "./types";

// 便捷工厂函数
import { AgentProofClient } from "./client";
import type { AgentProofConfig } from "./types";

export function createClient(config: AgentProofConfig): AgentProofClient {
  return new AgentProofClient(config);
}
