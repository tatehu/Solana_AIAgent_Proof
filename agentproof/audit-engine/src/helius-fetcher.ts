// agentproof/audit-engine/src/helius-fetcher.ts
import axios from 'axios';

const HELIUS_API_BASE = 'https://api.helius.xyz/v0';
const HELIUS_RPC_BASE = 'https://mainnet.helius-rpc.com';

export interface HeliusTxSignature {
  signature: string;
  slot: number;
  err: unknown;
  blockTime: number;
}

export interface ParsedHeliusTx {
  signature: string;
  slot: number;
  blockTime: number | null;
  err: unknown;
  fee: number;
  accountData: Array<{ account: string; nativeBalanceChange: number }>;
  instructions: Array<{ programId: string; data: string }>;
}

export async function fetchRecentSignatures(
  agentPubkey: string,
  limit = 500
): Promise<HeliusTxSignature[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not configured');

  const rpcUrl = `${HELIUS_RPC_BASE}/?api-key=${apiKey}`;
  const response = await axios.post(rpcUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'getSignaturesForAddress',
    params: [agentPubkey, { limit }],
  });

  return (response.data.result ?? []) as HeliusTxSignature[];
}

export async function fetchParsedTransactions(
  signatures: string[]
): Promise<ParsedHeliusTx[]> {
  const apiKey = process.env.HELIUS_API_KEY;
  if (!apiKey) throw new Error('HELIUS_API_KEY not configured');

  const results: ParsedHeliusTx[] = [];
  const BATCH_SIZE = 10;
  const RATE_LIMIT_MS = 100;

  for (let i = 0; i < signatures.length; i += BATCH_SIZE) {
    const batch = signatures.slice(i, i + BATCH_SIZE);
    const url = `${HELIUS_API_BASE}/transactions?api-key=${apiKey}`;

    try {
      const response = await axios.post(url, { transactions: batch });
      results.push(...(response.data ?? []));
    } catch (err) {
      console.error(`[helius-fetcher] batch ${i}-${i + BATCH_SIZE} failed:`, err);
    }

    if (i + BATCH_SIZE < signatures.length) {
      await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_MS));
    }
  }

  return results;
}
