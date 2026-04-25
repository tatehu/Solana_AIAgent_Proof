// agentproof/audit-engine/src/claude-auditor.ts
import Anthropic from '@anthropic-ai/sdk';
import { CapabilityManifest } from './manifest-store';
import { TxSummary } from './tx-summarizer';

export interface AuditResult {
  credit_score: number;
  safety_index: number;
  risk_flags: string[];
  summary: string;
}

function buildPrompt(
  agentPubkey: string,
  manifest: CapabilityManifest | undefined,
  txSummary: TxSummary
): string {
  return `Agent 公钥：${agentPubkey}
声明能力：${manifest ? JSON.stringify(manifest, null, 2) : '未提供'}

历史行为摘要（最近 ${txSummary.total_txs} 笔交易）：
- 调用合约：${txSummary.programs_called.slice(0, 10).join(', ')}
- 资金净变动：${txSummary.net_sol_change} SOL
- 失败率：${txSummary.failure_rate}%
- 活跃时间段：${txSummary.date_range.from} ~ ${txSummary.date_range.to}

请分析：
1. 实际行为与声明能力是否一致？
2. 是否有未声明的异常操作？
3. 资金安全记录如何？

返回 JSON（只返回 JSON，不要其他文字）：
{
  "credit_score": <0-100整数>,
  "safety_index": <0-100整数>,
  "risk_flags": ["...", "..."],
  "summary": "<100字以内的中文总结>"
}`;
}

export async function auditAgent(
  agentPubkey: string,
  manifest: CapabilityManifest | undefined,
  txSummary: TxSummary
): Promise<AuditResult> {
  const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
  const baseURL = process.env.ANTHROPIC_BASE_URL;

  if (!authToken) throw new Error('ANTHROPIC_AUTH_TOKEN not configured');

  const client = new Anthropic({
    apiKey: authToken,
    ...(baseURL ? { baseURL } : {}),
  });

  const response = await client.messages.create({
    model: 'claude-opus-4-5',
    max_tokens: 1024,
    system: '你是 AgentProof 的 AI 风险审计员，专注于分析 Solana 上 AI Agent 的链上历史行为。',
    messages: [{ role: 'user', content: buildPrompt(agentPubkey, manifest, txSummary) }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`Claude returned non-JSON: ${text.slice(0, 200)}`);

  const parsed = JSON.parse(jsonMatch[0]) as AuditResult;

  return {
    credit_score: Math.max(0, Math.min(100, parsed.credit_score ?? 50)),
    safety_index: Math.max(0, Math.min(100, parsed.safety_index ?? 50)),
    risk_flags: parsed.risk_flags ?? [],
    summary: parsed.summary ?? '',
  };
}
