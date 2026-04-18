import axios from "axios";
import { WITNESS_NODE_URL, RISK_MONITOR_URL } from "./solana";

export interface AgentInfo {
  agent_pubkey: string;
  reputation_score: number;
  tasks_completed: number;
  success_rate: number;
  is_frozen: boolean;
}

export interface ProofVerifyRequest {
  task_id: string;
  agent_pubkey: string;
  task_type: string;
  tx_signature: string;
  input_hash: string;
  output_hash: string;
  instruction_hash: string;
  slot: number;
  expected_output?: Record<string, unknown>;
}

export interface ProofResult {
  task_id: string;
  status: "pending" | "verified" | "rejected";
  signatures: Array<{
    witness_pubkey: string;
    approved: boolean;
    reason?: string;
  }>;
}

export interface RiskScore {
  agent_id: string;
  score: number;
  level: "safe" | "warning" | "danger";
  reasons: string[];
  should_freeze: boolean;
  breakdown: Record<string, number>;
}

class AgentProofSDK {
  // ========================
  // Witness Node API
  // ========================

  async verifyProof(req: ProofVerifyRequest): Promise<ProofResult> {
    const response = await axios.post(`${WITNESS_NODE_URL}/api/v1/verify`, req);
    return response.data.task;
  }

  async getProof(taskId: string): Promise<ProofResult> {
    const response = await axios.get(
      `${WITNESS_NODE_URL}/api/v1/proof/${taskId}`
    );
    return response.data.task;
  }

  async getAgent(agentPubkey: string): Promise<AgentInfo> {
    const response = await axios.get(
      `${WITNESS_NODE_URL}/api/v1/agent/${agentPubkey}`
    );
    return response.data;
  }

  // ========================
  // Risk Monitor API
  // ========================

  async getRiskScore(agentId: string): Promise<RiskScore> {
    const response = await axios.get(
      `${RISK_MONITOR_URL}/api/v1/risk/${agentId}`
    );
    return response.data;
  }

  async getAlerts(): Promise<RiskScore[]> {
    const response = await axios.get(`${RISK_MONITOR_URL}/api/v1/alerts`);
    return response.data.alerts;
  }

  async analyzeAgent(agentId: string): Promise<RiskScore> {
    const response = await axios.post(`${RISK_MONITOR_URL}/api/v1/analyze`, {
      agent_id: agentId,
    });
    return response.data;
  }

  async listAgents(): Promise<AgentInfo[]> {
    const response = await axios.get(`${RISK_MONITOR_URL}/api/v1/agents`);
    return response.data.agents;
  }
}

export const agentProof = new AgentProofSDK();
