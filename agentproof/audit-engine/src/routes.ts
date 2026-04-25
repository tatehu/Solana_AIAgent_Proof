// agentproof/audit-engine/src/routes.ts
import { Router, Request, Response } from 'express';
import { fetchRecentSignatures, fetchParsedTransactions } from './helius-fetcher';
import { summarizeTransactions } from './tx-summarizer';
import { auditAgent } from './claude-auditor';
import {
  storeManifest,
  storeManifestForPubkey,
  getManifestByHash,
  getManifestForPubkey,
  storeAuditResult,
  getAuditResult,
  CapabilityManifest,
} from './manifest-store';

export function createRoutes(): Router {
  const router = Router();

  router.post('/audit', async (req: Request, res: Response) => {
    const { agent_pubkey, capability_manifest } = req.body as {
      agent_pubkey: string;
      capability_manifest?: CapabilityManifest;
    };

    if (!agent_pubkey) {
      return res.status(400).json({ error: 'agent_pubkey required' });
    }

    const PUBKEY_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
    if (!PUBKEY_RE.test(agent_pubkey)) {
      return res.status(400).json({ error: 'invalid agent_pubkey format' });
    }

    try {
      if (capability_manifest) {
        storeManifest(capability_manifest);
        storeManifestForPubkey(agent_pubkey, capability_manifest);
      }

      const sigs = await fetchRecentSignatures(agent_pubkey, 500);
      const txs = await fetchParsedTransactions(sigs.map(s => s.signature));
      const txSummary = summarizeTransactions(txs, agent_pubkey);

      const manifest = capability_manifest ?? getManifestForPubkey(agent_pubkey);
      const auditResult = await auditAgent(agent_pubkey, manifest, txSummary);

      storeAuditResult(agent_pubkey, {
        ...auditResult,
        audit_summary: auditResult.summary,
        tx_count: txSummary.total_txs,
        audited_at: Date.now(),
      });

      return res.json({
        ...auditResult,
        tx_count: txSummary.total_txs,
        date_range: txSummary.date_range,
      });
    } catch (err) {
      console.error('[audit] error:', err);
      const message = err instanceof Error ? err.message : 'Audit failed';
      return res.status(500).json({ error: message });
    }
  });

  router.get('/audit/:agent_pubkey', (req: Request, res: Response) => {
    const result = getAuditResult(req.params.agent_pubkey);
    if (!result) return res.status(404).json({ error: 'No audit result found' });
    return res.json(result);
  });

  router.post('/manifest', (req: Request, res: Response) => {
    const { manifest, agent_pubkey } = req.body as {
      capability_hash?: string;
      manifest: CapabilityManifest;
      agent_pubkey?: string;
    };

    if (!manifest) {
      return res.status(400).json({ error: 'manifest required' });
    }

    const hash = storeManifest(manifest);
    if (agent_pubkey) storeManifestForPubkey(agent_pubkey, manifest);

    return res.json({ capability_hash: hash });
  });

  router.get('/manifest/pubkey/:agent_pubkey', (req: Request, res: Response) => {
    const manifest = getManifestForPubkey(req.params.agent_pubkey);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found for pubkey' });
    return res.json({ manifest });
  });

  router.get('/manifest/:capability_hash', (req: Request, res: Response) => {
    const manifest = getManifestByHash(req.params.capability_hash);
    if (!manifest) return res.status(404).json({ error: 'Manifest not found' });
    return res.json({ manifest });
  });

  return router;
}
