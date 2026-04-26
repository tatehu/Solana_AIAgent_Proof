// agentproof/witness-node/src/intent-verifier.ts
// Delegates to the LangGraph intent-engine service (Python, port 3002).
import axios from 'axios';
import { IntentVerifyParams, IntentResult } from './types';

const INTENT_ENGINE_URL = process.env.INTENT_ENGINE_URL ?? 'http://localhost:3002';

export class IntentVerifier {
  async verify(params: IntentVerifyParams): Promise<IntentResult> {
    const resp = await axios.post(
      `${INTENT_ENGINE_URL}/verify`,
      {
        task_type:       params.task_type,
        agent_pubkey:    params.agent_pubkey,
        tx_signature:    params.tx_summary.tx_signature ?? '',
        slot:            params.tx_summary.slot,
        expected_output: params.expected_output ?? {},
        manifest:        null,  // intent-engine fetches from audit-engine automatically
      },
      { timeout: 30_000 },
    );

    const data = resp.data as {
      aligned:      boolean;
      confidence:   number;
      reason:       string;
      risk_flags:   string[];
    };

    return {
      aligned:    Boolean(data.aligned),
      confidence: Math.max(0, Math.min(1, data.confidence ?? 0.5)),
      reason:     data.reason ?? '',
      risk_flags: data.risk_flags ?? [],
    };
  }
}
