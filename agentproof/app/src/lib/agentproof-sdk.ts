import axios from "axios";
import { Connection, PublicKey } from "@solana/web3.js";
import { WITNESS_NODE_URL, RISK_MONITOR_URL, PROGRAM_ID, RPC_URL } from "./solana";

export interface AgentInfo {
  agent_pubkey: string;
  credit_score: number;
  safety_index: number;
  tasks_completed: number;
  tasks_failed: number;
  success_rate: number;
  staked_lamports: number;
  is_frozen: boolean;
  registered_at: number;
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

export interface IntentResult {
  aligned: boolean;
  confidence: number;
  reason: string;
  risk_flags: string[];
}

export interface ProofResult {
  task_id: string;
  status: "pending" | "verified" | "rejected";
  signatures: Array<{
    witness_pubkey: string;
    approved: boolean;
    reason?: string;
  }>;
  intent_result?: IntentResult;
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
    // AgentRecord discriminator: [4, 201, 129, 70, 197, 134, 47, 169]
    const DISCRIMINATOR = Buffer.from([4, 201, 129, 70, 197, 134, 47, 169]);
    const connection = new Connection(RPC_URL, "confirmed");

    const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ memcmp: { offset: 0, bytes: DISCRIMINATOR.toString("base64"), encoding: "base64" } }],
    });

    return accounts.map(({ account }) => {
      const data = account.data;
      let offset = 8; // skip discriminator
      const agent_pubkey = new PublicKey(data.slice(offset, offset + 32)).toBase58(); offset += 32;
      offset += 32; // capability_hash
      const staked_lamports = Number(data.readBigUInt64LE(offset)); offset += 8;
      const credit_score = Number(data.readBigUInt64LE(offset)); offset += 8;
      const safety_index = Number(data.readBigUInt64LE(offset)); offset += 8;
      const tasks_completed = Number(data.readBigUInt64LE(offset)); offset += 8;
      const tasks_failed = Number(data.readBigUInt64LE(offset)); offset += 8;
      const success_rate_bps = data.readUInt16LE(offset); offset += 2;
      const is_frozen = data[offset] === 1; offset += 1;
      const registered_at = Number(data.readBigInt64LE(offset));

      return {
        agent_pubkey,
        credit_score,
        safety_index,
        tasks_completed,
        tasks_failed,
        success_rate: success_rate_bps / 100,
        staked_lamports,
        is_frozen,
        registered_at,
      };
    });
  }
}

export const agentProof = new AgentProofSDK();
