import { jstNow } from './utils.js';

export type BroadcastMessageAssetKind = 'rich_message' | 'card_message' | 'coupon' | 'research';

export interface BroadcastMessageAsset {
  id: string;
  line_account_id: string | null;
  kind: BroadcastMessageAssetKind;
  name: string;
  payload_json: string;
  created_at: string;
  updated_at: string;
}

export async function listBroadcastMessageAssets(db: D1Database, lineAccountId?: string, kind?: BroadcastMessageAssetKind) {
  const clauses: string[] = [];
  const bindings: unknown[] = [];
  if (lineAccountId) {
    clauses.push('(line_account_id = ? OR line_account_id IS NULL)');
    bindings.push(lineAccountId);
  }
  if (kind) {
    clauses.push('kind = ?');
    bindings.push(kind);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const statement = db.prepare(`SELECT * FROM broadcast_message_assets${where} ORDER BY updated_at DESC, id DESC`);
  const result = bindings.length
    ? await statement.bind(...bindings).all<BroadcastMessageAsset>()
    : await statement.all<BroadcastMessageAsset>();
  return result.results;
}

export function getBroadcastMessageAsset(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM broadcast_message_assets WHERE id = ?').bind(id).first<BroadcastMessageAsset>();
}

export async function createBroadcastMessageAsset(
  db: D1Database,
  input: { lineAccountId?: string | null; kind: BroadcastMessageAssetKind; name: string; payloadJson: string },
) {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(
    `INSERT INTO broadcast_message_assets (id, line_account_id, kind, name, payload_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, input.lineAccountId ?? null, input.kind, input.name, input.payloadJson, now, now).run();
  return getBroadcastMessageAsset(db, id);
}

export async function updateBroadcastMessageAsset(db: D1Database, id: string, input: { name: string; payloadJson: string }) {
  await db.prepare('UPDATE broadcast_message_assets SET name = ?, payload_json = ?, updated_at = ? WHERE id = ?')
    .bind(input.name, input.payloadJson, jstNow(), id).run();
  return getBroadcastMessageAsset(db, id);
}

export async function deleteBroadcastMessageAsset(db: D1Database, id: string) {
  const result = await db.prepare('DELETE FROM broadcast_message_assets WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
