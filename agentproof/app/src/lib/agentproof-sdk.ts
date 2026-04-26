import axios from "axios";
import { WITNESS_NODE_URL, RISK_MONITOR_URL } from "./solana";

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
  owner_wallet?: string;
  created_at?: number;
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

// Simple in-memory TTL cache for expensive calls
interface CacheEntry<T> { data: T; expiresAt: number }
class TTLCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  get(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry || Date.now() > entry.expiresAt) { this.store.delete(key); return null; }
    return entry.data;
  }
  set(key: string, data: T, ttlMs: number) { this.store.set(key, { data, expiresAt: Date.now() + ttlMs }); }
}

const agentsCache = new TTLCache<AgentInfo[]>();
const leaderboardCache = new TTLCache<unknown>();

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
    const cached = agentsCache.get("all");
    if (cached) return cached;

    try {
      const resp = await fetch(`${RISK_MONITOR_URL}/api/v1/leaderboard?limit=200&offset=0`);
      if (!resp.ok) throw new Error(`leaderboard ${resp.status}`);
      const data = await resp.json();
      const result: AgentInfo[] = (data.agents ?? []).map((a: {
        agent_id: string;
        total_score: number;
        completion_rate: number;
        behavior_safety: number;
        tx_count: number;
        anomaly_count: number;
        owner_wallet?: string;
        created_at?: number;
      }) => ({
        agent_pubkey: a.agent_id,
        credit_score: a.total_score,
        safety_index: Math.round(a.behavior_safety),
        tasks_completed: a.tx_count,
        tasks_failed: a.anomaly_count,
        success_rate: a.completion_rate,
        staked_lamports: 0,
        is_frozen: false,
        registered_at: a.created_at ?? 0,
        owner_wallet: a.owner_wallet,
        created_at: a.created_at,
      }));
      agentsCache.set("all", result, 30_000);
      return result;
    } catch (e) {
      console.error("listAgents failed:", e);
      return [];
    }
  }
}

export const agentProof = new AgentProofSDK();
