import { jstNow } from './utils.js';

export type BroadcastMessageAssetKind = 'rich_message' | 'card_message' | 'coupon' | 'research';

export type BroadcastMessageAssetStatus = 'draft' | 'published' | 'published_with_draft';

export interface BroadcastMessageAsset {
  id: string;
  line_account_id: string | null;
  kind: BroadcastMessageAssetKind;
  name: string;
  payload_json: string;
  folder_id: string | null;
  published_version: number;
  published_at: string | null;
  draft_payload_json: string | null;
  draft_revision: number;
  created_at: string;
  updated_at: string;
}

export interface BroadcastMessageAssetVersion {
  id: string;
  asset_id: string;
  version_number: number;
  payload_json: string;
  created_by_staff_id: string | null;
  created_at: string;
}

export function hasAssetDraft(row: Pick<BroadcastMessageAsset, 'draft_payload_json' | 'draft_revision'> | null | undefined): boolean {
  if (!row) return false;
  return row.draft_payload_json != null || Number(row.draft_revision ?? 0) > 0;
}

export function assetStatusOf(row: Pick<BroadcastMessageAsset, 'published_version' | 'draft_payload_json' | 'draft_revision'>): BroadcastMessageAssetStatus {
  if (Number(row.published_version ?? 0) < 1) return 'draft';
  return hasAssetDraft(row) ? 'published_with_draft' : 'published';
}

/** 編集中のpayload。下書きがあれば下書き、なければ公開版（旧caller互換）。 */
export function draftPayloadOf(row: BroadcastMessageAsset): string {
  return row.draft_payload_json ?? row.payload_json;
}

function rowFromUnknown(row: Record<string, unknown>): BroadcastMessageAsset {
  return {
    id: String(row.id),
    line_account_id: (row.line_account_id as string | null) ?? null,
    kind: row.kind as BroadcastMessageAssetKind,
    name: String(row.name),
    payload_json: String(row.payload_json),
    folder_id: (row.folder_id as string | null) ?? null,
    published_version: Number(row.published_version ?? 1),
    published_at: (row.published_at as string | null) ?? null,
    draft_payload_json: (row.draft_payload_json as string | null) ?? null,
    draft_revision: Number(row.draft_revision ?? 0),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function listBroadcastMessageAssets(
  db: D1Database,
  lineAccountId?: string,
  kind?: BroadcastMessageAssetKind,
  filter?: { folderId?: string | null; status?: BroadcastMessageAssetStatus },
) {
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
  if (filter?.folderId !== undefined) {
    if (filter.folderId === null) clauses.push('folder_id IS NULL');
    else {
      clauses.push('folder_id = ?');
      bindings.push(filter.folderId);
    }
  }
  if (filter?.status !== undefined) {
    if (filter.status === 'draft') clauses.push('published_version = 0');
    else if (filter.status === 'published') clauses.push('published_version >= 1 AND draft_payload_json IS NULL AND draft_revision = 0');
    else clauses.push('published_version >= 1 AND (draft_payload_json IS NOT NULL OR draft_revision > 0)');
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const statement = db.prepare(`SELECT * FROM broadcast_message_assets${where} ORDER BY updated_at DESC, id DESC`);
  const result = bindings.length
    ? await statement.bind(...bindings).all<Record<string, unknown>>()
    : await statement.all<Record<string, unknown>>();
  return (result.results ?? []).map(rowFromUnknown);
}

/**
 * 件数だけを種類ごとに返す（PERF-04）。
 *
 * 件数タブは各行の payload を必要としないので、本文を読まない集計で足りる。
 * scopeWhere/scopeBindings には呼び出し側がアカウント可視範囲の条件を渡す
 * （一覧の line_account_id 絞り込みと同じ範囲で数えないと件数が合わない）。
 */
export async function countBroadcastMessageAssetsByKind(
  db: D1Database,
  scopeWhere: string,
  scopeBindings: unknown[] = [],
  lineAccountId?: string,
  filter?: { folderId?: string | null; status?: BroadcastMessageAssetStatus },
) {
  const clauses = [scopeWhere];
  const bindings = [...scopeBindings];
  if (lineAccountId) {
    // 一覧と同じ「自アカウント＋未割当」の絞り込み。
    clauses.push('(line_account_id = ? OR line_account_id IS NULL)');
    bindings.push(lineAccountId);
  }
  if (filter?.folderId !== undefined) {
    if (filter.folderId === null) clauses.push('folder_id IS NULL');
    else {
      clauses.push('folder_id = ?');
      bindings.push(filter.folderId);
    }
  }
  if (filter?.status !== undefined) {
    if (filter.status === 'draft') clauses.push('published_version = 0');
    else if (filter.status === 'published') clauses.push('published_version >= 1 AND draft_payload_json IS NULL AND draft_revision = 0');
    else clauses.push('published_version >= 1 AND (draft_payload_json IS NOT NULL OR draft_revision > 0)');
  }
  const rows = await db.prepare(
    `SELECT kind, COUNT(*) AS count FROM broadcast_message_assets WHERE ${clauses.join(' AND ')} GROUP BY kind`,
  ).bind(...bindings).all<{ kind: BroadcastMessageAssetKind; count: number }>();
  const counts: Record<BroadcastMessageAssetKind, number> = {
    rich_message: 0,
    card_message: 0,
    coupon: 0,
    research: 0,
  };
  for (const row of rows.results) {
    if (row.kind in counts) counts[row.kind] = Number(row.count);
  }
  return counts;
}

export async function getBroadcastMessageAsset(db: D1Database, id: string) {
  const row = await db.prepare('SELECT * FROM broadcast_message_assets WHERE id = ?').bind(id).first<Record<string, unknown>>();
  return row ? rowFromUnknown(row) : null;
}

export async function createBroadcastMessageAsset(
  db: D1Database,
  input: { lineAccountId?: string | null; kind: BroadcastMessageAssetKind; name: string; payloadJson: string; folderId?: string | null },
) {
  const id = crypto.randomUUID();
  const now = jstNow();
  // 新規は未公開の下書きで始める。live列には初期内容を入れるが版は0。
  await db.prepare(
    `INSERT INTO broadcast_message_assets (id, line_account_id, kind, name, payload_json, folder_id, published_version, published_at, draft_payload_json, draft_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 1, ?, ?)`,
  ).bind(id, input.lineAccountId ?? null, input.kind, input.name, input.payloadJson, input.folderId ?? null, input.payloadJson, now, now).run();
  return getBroadcastMessageAsset(db, id);
}

/** 名前・置き場だけをlive列へ直書きする。送信文（payload）はここでは変えない。 */
export async function updateBroadcastMessageAssetMeta(
  db: D1Database,
  id: string,
  input: { name?: string; folderId?: string | null },
) {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    values.push(input.name);
  }
  if (input.folderId !== undefined) {
    sets.push('folder_id = ?');
    values.push(input.folderId);
  }
  if (sets.length === 0) return getBroadcastMessageAsset(db, id);
  sets.push('updated_at = ?');
  values.push(jstNow());
  await db.prepare(`UPDATE broadcast_message_assets SET ${sets.join(', ')} WHERE id = ?`).bind(...values, id).run();
  return getBroadcastMessageAsset(db, id);
}

export async function updateBroadcastMessageAsset(db: D1Database, id: string, input: { name: string; payloadJson: string }) {
  const current = await getBroadcastMessageAsset(db, id);
  if (!current) return null;
  await updateBroadcastMessageAssetMeta(db, id, { name: input.name });
  return saveBroadcastMessageAssetDraft(db, id, { payloadJson: input.payloadJson });
}

/**
 * 編集内容を下書きへだけ書く。公開版（payload_json）は触らない。
 * 同時保存の負けはTEMPLATE流儀の409扱い（ASSET_DRAFT_CONFLICT）。
 */
export async function saveBroadcastMessageAssetDraft(
  db: D1Database,
  id: string,
  updates: { payloadJson?: string },
) {
  const current = await getBroadcastMessageAsset(db, id);
  if (!current) throw new Error('ASSET_NOT_FOUND');
  const draftPayload = updates.payloadJson ?? current.draft_payload_json ?? current.payload_json;
  const expectedVersion = Number(current.published_version ?? 0);
  const expectedDraftRevision = Number(current.draft_revision ?? 0);
  const result = await db.prepare(
    `UPDATE broadcast_message_assets
        SET draft_payload_json = ?,
            draft_revision = draft_revision + 1,
            updated_at = ?
      WHERE id = ? AND published_version = ? AND draft_revision = ?`,
  ).bind(draftPayload, jstNow(), id, expectedVersion, expectedDraftRevision).run();
  if ((result.meta.changes ?? 0) === 0) throw new Error('ASSET_DRAFT_CONFLICT');
  return getBroadcastMessageAsset(db, id);
}

export interface AssetPublishResult {
  row: BroadcastMessageAsset;
  published: boolean;
  replayed: boolean;
}

function fingerprintPayload(payloadJson: string): string {
  let hash = 0;
  for (let i = 0; i < payloadJson.length; i += 1) {
    hash = (hash * 31 + payloadJson.charCodeAt(i)) | 0;
  }
  return String(hash);
}

/**
 * 下書きを公開版へ写す。公開版・版履歴だけが変わり、下書きは消える。
 * 同じ確認キーの再送は成功時の版をそのまま返す。別内容の使い回しは409。
 */
export async function publishBroadcastMessageAsset(
  db: D1Database,
  id: string,
  options: { expectedVersion: number; expectedDraftRevision: number; idempotencyKey: string; createdByStaffId?: string | null },
): Promise<AssetPublishResult> {
  const current = await getBroadcastMessageAsset(db, id);
  if (!current) throw new Error('ASSET_NOT_FOUND');
  const raced = await getBroadcastMessageAsset(db, id);
  if (!raced) throw new Error('ASSET_NOT_FOUND');
  if (Number(raced.published_version) !== Number(current.published_version)) throw new Error('ASSET_VERSION_CONFLICT');
  if (Number(raced.draft_revision ?? 0) !== Number(current.draft_revision ?? 0)) throw new Error('ASSET_DRAFT_CONFLICT');

  const prior = await db.prepare(
    'SELECT published_version, draft_revision, draft_fingerprint, payload_json FROM broadcast_asset_publish_keys WHERE asset_id = ? AND idempotency_key = ?',
  ).bind(id, options.idempotencyKey).first<{ published_version: number; draft_revision: number; draft_fingerprint: string; payload_json: string | null }>();
  const draftPayload = current.draft_payload_json ?? current.payload_json;
  const fingerprint = fingerprintPayload(draftPayload);
  if (prior) {
    if (prior.draft_fingerprint !== fingerprint) throw new Error('ASSET_PUBLISH_KEY_CONFLICT');
    const row = await getBroadcastMessageAsset(db, id);
    return { row: row!, published: false, replayed: true };
  }

  if (Number(current.published_version) !== options.expectedVersion) throw new Error('ASSET_VERSION_CONFLICT');
  if (Number(current.draft_revision ?? 0) !== options.expectedDraftRevision) throw new Error('ASSET_DRAFT_CONFLICT');

  const hasDraft = hasAssetDraft(current);
  const nextVersion = Number(current.published_version) + 1;
  const now = jstNow();
  if (!hasDraft) {
    await db.prepare(
      `INSERT INTO broadcast_asset_publish_keys (asset_id, idempotency_key, published_version, draft_revision, draft_fingerprint, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, options.idempotencyKey, Number(current.published_version), Number(current.draft_revision ?? 0), fingerprint, null, now).run();
    const row = await getBroadcastMessageAsset(db, id);
    return { row: row!, published: false, replayed: false };
  }

  const versionId = crypto.randomUUID();
  const statements = [
    db.prepare(
      `UPDATE broadcast_message_assets
          SET payload_json = draft_payload_json,
              draft_payload_json = NULL,
              draft_revision = 0,
              published_version = published_version + 1,
              published_at = ?,
              updated_at = ?
        WHERE id = ? AND published_version = ? AND draft_revision = ?`,
    ).bind(now, now, id, current.published_version, current.draft_revision ?? 0),
    db.prepare(
      `INSERT INTO broadcast_asset_versions (id, asset_id, version_number, payload_json, created_by_staff_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(versionId, id, nextVersion, draftPayload, options.createdByStaffId ?? null, now),
    db.prepare(
      `INSERT INTO broadcast_asset_publish_keys (asset_id, idempotency_key, published_version, draft_revision, draft_fingerprint, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(id, options.idempotencyKey, Number(current.published_version), Number(current.draft_revision ?? 0), fingerprint, draftPayload, now),
  ];
  const results = await db.batch(statements);
  const changed = Number((results[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (changed === 0) {
    const latest = await db.prepare(
      'SELECT published_version FROM broadcast_asset_publish_keys WHERE asset_id = ? AND idempotency_key = ?',
    ).bind(id, options.idempotencyKey).first<{ published_version: number }>();
    if (latest) {
      const row = await getBroadcastMessageAsset(db, id);
      return { row: row!, published: false, replayed: true };
    }
    throw new Error('ASSET_VERSION_CONFLICT');
  }
  const row = await getBroadcastMessageAsset(db, id);
  return { row: row!, published: true, replayed: false };
}

export async function listBroadcastMessageAssetVersions(db: D1Database, assetId: string) {
  const result = await db.prepare(
    `SELECT * FROM broadcast_asset_versions WHERE asset_id = ? ORDER BY version_number DESC`,
  ).bind(assetId).all<BroadcastMessageAssetVersion>();
  return result.results ?? [];
}

export async function deleteBroadcastMessageAsset(db: D1Database, id: string) {
  const result = await db.prepare('DELETE FROM broadcast_message_assets WHERE id = ?').bind(id).run();
  return (result.meta.changes ?? 0) > 0;
}
