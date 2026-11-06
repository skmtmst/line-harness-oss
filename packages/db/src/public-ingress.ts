/** 公開受信の使い回しを原子的に防ぐ。本文・署名・顧客情報は保存しない。 */
export async function consumePublicIngressReceipt(db: D1Database, input: {
  kind: 'conversion_nonce' | 'site_event'; scopeId: string; key: string; now?: string;
}): Promise<boolean> {
  const result = await db.prepare(`INSERT OR IGNORE INTO public_ingress_receipts
    (kind, scope_id, receipt_key, received_at) VALUES (?, ?, ?, ?)`)
    .bind(input.kind, input.scopeId, input.key, input.now ?? new Date().toISOString()).run();
  return Number(result.meta?.changes ?? 0) === 1;
}
