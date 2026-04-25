// agentproof/audit-engine/src/tx-summarizer.ts
import { ParsedHeliusTx } from './helius-fetcher';

export interface TxSummary {
  total_txs: number;
  failure_rate: number;
  programs_called: string[];
  fund_flows: Array<{ direction: 'in' | 'out'; amount_sol: number; counterparty: string }>;
  date_range: { from: string; to: string };
  net_sol_change: number;
}

export function summarizeTransactions(txs: ParsedHeliusTx[], agentPubkey: string): TxSummary {
  const failed = txs.filter(tx => tx.err !== null).length;
  const failure_rate = txs.length > 0 ? (failed / txs.length) * 100 : 0;

  const programSet = new Set<string>();
  for (const tx of txs) {
    for (const ix of tx.instructions ?? []) {
      if (ix.programId) programSet.add(ix.programId);
    }
  }

  const fund_flows: TxSummary['fund_flows'] = [];
  let net_sol_change = 0;

  for (const tx of txs) {
    for (const acct of tx.accountData ?? []) {
      if (acct.account === agentPubkey && acct.nativeBalanceChange !== 0) {
        const amount_sol = Math.abs(acct.nativeBalanceChange) / 1e9;
        const direction = acct.nativeBalanceChange > 0 ? 'in' : 'out';
        net_sol_change += acct.nativeBalanceChange / 1e9;
        fund_flows.push({ direction, amount_sol, counterparty: 'unknown' });
      }
    }
  }

  const blockTimes = txs.map(t => t.blockTime).filter((t): t is number => t !== null);
  const minTime = blockTimes.length ? Math.min(...blockTimes) : 0;
  const maxTime = blockTimes.length ? Math.max(...blockTimes) : 0;

  return {
    total_txs: txs.length,
    failure_rate: Math.round(failure_rate * 100) / 100,
    programs_called: Array.from(programSet),
    fund_flows: fund_flows.slice(0, 20),
    date_range: {
      from: minTime ? new Date(minTime * 1000).toISOString() : 'unknown',
      to: maxTime ? new Date(maxTime * 1000).toISOString() : 'unknown',
    },
    net_sol_change: Math.round(net_sol_change * 1000) / 1000,
  };
}
