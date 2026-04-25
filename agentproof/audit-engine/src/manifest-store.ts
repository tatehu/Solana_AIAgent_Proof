// agentproof/audit-engine/src/manifest-store.ts
import { createHash } from 'crypto';

export interface CapabilityManifest {
  name: string;
  version: string;
  allowed_actions: string[];
  max_slippage_bps?: number;
  allowed_programs?: string[];
  [key: string]: unknown;
}

interface StoredAuditResult {
  credit_score: number;
  safety_index: number;
  risk_flags: string[];
  audit_summary: string;
  tx_count: number;
  audited_at: number;
}

const manifestStore = new Map<string, CapabilityManifest>();
const auditCache = new Map<string, StoredAuditResult>();
const pubkeyManifestStore = new Map<string, CapabilityManifest>();

export function storeManifest(manifest: CapabilityManifest): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(manifest))
    .digest('hex');
  manifestStore.set(hash, manifest);
  return hash;
}

export function getManifestByHash(hash: string): CapabilityManifest | undefined {
  return manifestStore.get(hash);
}

export function storeAuditResult(agentPubkey: string, result: StoredAuditResult): void {
  auditCache.set(agentPubkey, result);
}

export function getAuditResult(agentPubkey: string): StoredAuditResult | undefined {
  return auditCache.get(agentPubkey);
}

export function storeManifestForPubkey(agentPubkey: string, manifest: CapabilityManifest): void {
  pubkeyManifestStore.set(agentPubkey, manifest);
}

export function getManifestForPubkey(agentPubkey: string): CapabilityManifest | undefined {
  return pubkeyManifestStore.get(agentPubkey);
}
