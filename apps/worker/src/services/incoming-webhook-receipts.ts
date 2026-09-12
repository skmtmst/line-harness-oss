/** A receipt survives request failures; only completed work is acknowledged as a duplicate. */
const LEASE_MS = 300_000;

export interface IncomingWebhookExecution {
  sourceEventId: string;
  occurredAt: string;
  step<T>(key: string, work: () => Promise<T>): Promise<T>;
  complete(): Promise<void>;
  fail(): Promise<void>;
}

export async function stableWebhookStepId(sourceEventId: string, key: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([sourceEventId, key]))));
  // LINE retry keys must be UUIDs. A stable version-5-shaped key also survives a lost response.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function reserveIncomingWebhook(
  db: D1Database, webhookId: string, signatureHash: string,
): Promise<{ kind: 'completed' } | { kind: 'busy' } | { kind: 'acquired'; execution: IncomingWebhookExecution }> {
  const now = Date.now();
  await db.prepare(`INSERT OR IGNORE INTO incoming_webhook_receipts
    (webhook_id,signature_hash,source_event_id,received_at) VALUES (?,?,?,?)`)
    .bind(webhookId, signatureHash, crypto.randomUUID(), new Date(now).toISOString()).run();
  const owner = crypto.randomUUID();
  const claimed = await db.prepare(`UPDATE incoming_webhook_receipts
    SET status='processing',lease_owner=?,lease_expires_at=?,attempt_count=attempt_count+1,last_error_code=NULL
    WHERE webhook_id=? AND signature_hash=? AND (status IN ('accepted','retryable_failed')
      OR (status='processing' AND COALESCE(lease_expires_at,0)<=?))`)
    .bind(owner, now + LEASE_MS, webhookId, signatureHash, now).run();
  const row = await db.prepare(`SELECT source_event_id,status,received_at FROM incoming_webhook_receipts
    WHERE webhook_id=? AND signature_hash=?`).bind(webhookId, signatureHash)
    .first<{ source_event_id: string; status: string; received_at: string }>();
  if (!row) throw new Error('incoming_receipt_unavailable');
  if ((claimed.meta?.changes ?? 0) !== 1) return { kind: row.status === 'completed' ? 'completed' : 'busy' };

  const renew = async () => {
    const at = Date.now();
    const result = await db.prepare(`UPDATE incoming_webhook_receipts SET lease_expires_at=?
      WHERE source_event_id=? AND status='processing' AND lease_owner=? AND lease_expires_at>?`)
      .bind(at + LEASE_MS, row.source_event_id, owner, at).run();
    if ((result.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
  };
  return { kind: 'acquired', execution: {
    sourceEventId: row.source_event_id,
    occurredAt: row.received_at,
    async step<T>(key: string, work: () => Promise<T>): Promise<T> {
      await renew();
      const previous = await db.prepare(`SELECT result_json FROM incoming_webhook_steps
        WHERE source_event_id=? AND step_key=? AND status='completed'`)
        .bind(row.source_event_id, key).first<{ result_json: string | null }>();
      if (previous) return JSON.parse(previous.result_json ?? 'null') as T;
      await db.prepare(`INSERT OR IGNORE INTO incoming_webhook_steps
        (source_event_id,step_key,status) VALUES (?,?,'processing')`).bind(row.source_event_id, key).run();
      const result = await work();
      await renew();
      const saved = await db.prepare(`UPDATE incoming_webhook_steps SET status='completed',result_json=?
        WHERE source_event_id=? AND step_key=? AND EXISTS (
          SELECT 1 FROM incoming_webhook_receipts WHERE source_event_id=? AND lease_owner=?
            AND status='processing' AND lease_expires_at>?)`)
        .bind(JSON.stringify(result ?? null), row.source_event_id, key, row.source_event_id, owner, Date.now()).run();
      if ((saved.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
      return result;
    },
    async complete() {
      await renew();
      const result = await db.prepare(`UPDATE incoming_webhook_receipts
        SET status='completed',completed_at=?,lease_owner=NULL,lease_expires_at=NULL
        WHERE source_event_id=? AND lease_owner=? AND status='processing'`)
        .bind(new Date().toISOString(), row.source_event_id, owner).run();
      if ((result.meta?.changes ?? 0) !== 1) throw new Error('incoming_receipt_lease_lost');
    },
    async fail() {
      await db.prepare(`UPDATE incoming_webhook_receipts
        SET status='retryable_failed',last_error_code='processing_failed',lease_owner=NULL,lease_expires_at=NULL
        WHERE source_event_id=? AND lease_owner=? AND status='processing'`)
        .bind(row.source_event_id, owner).run();
    },
  } };
}
