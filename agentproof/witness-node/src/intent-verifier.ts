// agentproof/witness-node/src/intent-verifier.ts
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { IntentVerifyParams, IntentResult } from './types';

const AUDIT_ENGINE_URL = process.env.AUDIT_ENGINE_URL ?? 'http://localhost:3002';

const authToken = process.env.ANTHROPIC_AUTH_TOKEN;
const client = authToken
  ? new Anthropic({
      apiKey: authToken,
      ...(process.env.ANTHROPIC_BASE_URL ? { baseURL: process.env.ANTHROPIC_BASE_URL } : {}),
    })
  : null;

async function fetchManifest(agentPubkey: string): Promise<unknown> {
  try {
    const res = await axios.get(`${AUDIT_ENGINE_URL}/manifest/pubkey/${agentPubkey}`);
    return res.data.manifest;
  } catch {
    return null;
  }
}

function buildPrompt(manifest: unknown, params: IntentVerifyParams): string {
  return `Agent 注册时声明能力：${manifest ? JSON.stringify(manifest, null, 2) : '未提供'}

用户委托任务：${params.task_type}
期望输出：${JSON.stringify(params.expected_output ?? {})}

实际链上执行摘要：
- 调用了哪些程序：${params.tx_summary.programs_called.join(', ')}
- 资金流向：${params.tx_summary.fund_flows}
- 失败率：${params.tx_summary.failure_rate}%

判断：此次执行是否符合 Agent 声明能力 + 用户委托意图？

返回 JSON（只返回 JSON，不要其他文字）：
{
  "aligned": true或false,
  "confidence": 0.0到1.0,
  "reason": "<判断理由>",
  "risk_flags": []
}`;
}

export class IntentVerifier {
  async verify(params: IntentVerifyParams): Promise<IntentResult> {
    if (!client) {
      throw new Error('ANTHROPIC_AUTH_TOKEN not configured');
    }

    const manifest = await fetchManifest(params.agent_pubkey);
    const prompt = buildPrompt(manifest, params);

    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return {
        aligned: false,
        confidence: 0,
        reason: 'Failed to parse Claude response',
        risk_flags: [],
      };
    }

    const parsed = JSON.parse(jsonMatch[0]) as {
      aligned: boolean;
      confidence: number;
      reason: string;
      risk_flags: string[];
    };
    return {
      aligned: Boolean(parsed.aligned),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reason: parsed.reason ?? '',
      risk_flags: parsed.risk_flags ?? [],
    };
  }
}
