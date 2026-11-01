import type { D1Database } from '@cloudflare/workers-types';
import { jstNow } from '@line-crm/db';

export class FormDraftCreateError extends Error {
  constructor(public readonly code: 'idempotency_conflict' | 'draft_unavailable') { super(code); }
}

/** 作成と操作記録を同じbatchで確定し、応答喪失後も空の下書きを増やさない。 */
export async function createFormDraftOnce(db: D1Database, input: {
  accountId: string; actorId: string; key: string; name: string;
}): Promise<{ id: string; isActive: false; contentRevision: number; replayed: boolean }> {
  const action = `form_draft_create:${input.accountId}`;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ name: input.name })));
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const receipt = () => db.prepare(`SELECT request_hash,resource_id FROM operation_request_receipts
    WHERE action=? AND actor_id=? AND idempotency_key=?`).bind(action, input.actorId, input.key)
    .first<{ request_hash: string; resource_id: string }>();
  const replay = async (row: { request_hash: string; resource_id: string }) => {
    if (row.request_hash !== hash) throw new FormDraftCreateError('idempotency_conflict');
    const exists = await db.prepare(`SELECT f.id FROM forms f JOIN form_accounts a ON a.form_id=f.id
      WHERE f.id=? AND a.line_account_id=? AND f.status='active'`).bind(row.resource_id, input.accountId).first();
    if (!exists) throw new FormDraftCreateError('draft_unavailable');
    // 作成時の版を返す。他者の更新後の版を、自分が作った版として引き渡さない。
    return { id: row.resource_id, isActive: false as const, contentRevision: 1, replayed: true };
  };
  const previous = await receipt();
  if (previous) return replay(previous);
  const id = crypto.randomUUID(), now = jstNow();
  try {
    await db.batch([
      db.prepare(`INSERT INTO forms(id,name,fields,is_active,created_at,updated_at) VALUES(?,?,'[]',0,?,?)`)
        .bind(id, input.name, now, now),
      db.prepare(`INSERT INTO form_accounts(form_id,line_account_id) VALUES(?,?)`).bind(id, input.accountId),
      db.prepare(`INSERT INTO operation_request_receipts(action,actor_id,idempotency_key,request_hash,resource_id,created_at)
        VALUES(?,?,?,?,?,?)`).bind(action, input.actorId, input.key, hash, id, now),
    ]);
  } catch (cause) {
    const raced = await receipt();
    if (raced) return replay(raced);
    throw cause;
  }
  return { id, isActive: false, contentRevision: 1, replayed: false };
}
