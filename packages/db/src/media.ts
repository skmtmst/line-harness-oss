import type {
  MediaDeleteImpact,
  MediaDeleteImpactReference,
  MediaDeleteImpactReferenceKind,
  MediaReplacementBlocker,
  MediaReplacementImpact,
  MediaReplacementReference,
} from '@line-crm/shared';
import { jstNow } from './utils.js';

const LOOKUP_CHUNK = 90;
const MEDIA_USAGE_WRITE_CHUNK = 20;

/**
 * メディアライブラリ。
 *
 * これまで画像は使う場所ごとにアップロードしていて、同じ画像が
 * 何本も R2 に積み上がっていた。1か所に集めて、使い回せるようにする。
 */

export const MEDIA_KINDS = ['image', 'video', 'audio', 'file'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

export const MEDIA_REF_KINDS = [
  'template',
  'broadcast',
  'rich_menu',
  'scenario_step',
  'nen_column',
  'event',
  'webinar',
] as const;
export type MediaRefKind = (typeof MEDIA_REF_KINDS)[number];

export interface Media {
  id: string;
  line_account_id: string | null;
  folder_id: string | null;
  kind: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  r2_key: string;
  public_url: string | null;
  uploaded_by: string | null;
  created_at: string;
  /** 一覧取得時だけ付く。使用先をカードごとに再取得しないための集計値。 */
  usage_count?: number;
}

export interface MediaUsage {
  media_id: string;
  ref_kind: string;
  ref_id: string;
  scanned_at: string;
}

export interface MediaReplacementPlan {
  source: Media;
  replacement: Media;
  usages: MediaUsage[];
  impact: Omit<MediaReplacementImpact, 'revision'>;
}

export async function getMedia(
  db: D1Database,
  opts: { lineAccountId: string; kind?: MediaKind; folderId?: string; limit?: number },
): Promise<Media[]> {
  const conditions: string[] = ['m.line_account_id = ?'];
  const values: unknown[] = [opts.lineAccountId];
  if (opts.kind) {
    conditions.push('kind = ?');
    values.push(opts.kind);
  }
  if (opts.folderId) {
    conditions.push('folder_id = ?');
    values.push(opts.folderId);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  values.push(opts.limit ?? 200);
  const result = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM media_usages u WHERE u.media_id = m.id) AS usage_count
         FROM media m
         ${where}
        ORDER BY m.created_at DESC
        LIMIT ?`,
    )
    .bind(...values)
    .all<Media>();
  return result.results;
}

export async function getMediaById(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<Media | null> {
  return db.prepare(`SELECT * FROM media WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).first<Media>();
}

export async function createMedia(
  db: D1Database,
  input: {
    kind: MediaKind;
    lineAccountId: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
    folderId?: string | null;
    width?: number | null;
    height?: number | null;
    durationMs?: number | null;
    publicUrl?: string | null;
    uploadedBy?: string | null;
  },
): Promise<Media> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO media
         (id, line_account_id, folder_id, kind, filename, mime_type, size_bytes, width, height,
          duration_ms, r2_key, public_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.folderId ?? null,
      input.kind,
      input.filename,
      input.mimeType,
      input.sizeBytes,
      input.width ?? null,
      input.height ?? null,
      input.durationMs ?? null,
      input.r2Key,
      input.publicUrl ?? null,
      input.uploadedBy ?? null,
      jstNow(),
    )
    .run();
  return (await getMediaById(db, id, input.lineAccountId))!;
}

export async function updateMedia(
  db: D1Database,
  id: string,
  lineAccountId: string,
  input: { filename?: string; folderId?: string | null },
): Promise<Media | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (input.filename !== undefined) {
    sets.push('filename = ?');
    values.push(input.filename);
  }
  if ('folderId' in input) {
    sets.push('folder_id = ?');
    values.push(input.folderId ?? null);
  }
  if (sets.length > 0) {
    values.push(id, lineAccountId);
    await db.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?`).bind(...values).run();
  }
  return getMediaById(db, id, lineAccountId);
}

export async function deleteMedia(db: D1Database, id: string, lineAccountId: string): Promise<void> {
  await db.prepare(`DELETE FROM media WHERE id = ? AND line_account_id = ?`).bind(id, lineAccountId).run();
}

/**
 * 使用箇所。
 *
 * 削除する前に「5か所で使われています」と出すための表。本文を
 * スキャンして作り直すので、最後のスキャン時点の情報でしかない。
 * それでも「何も分からないまま消す」よりはるかにましだ、という判断。
 */
export async function getMediaUsages(db: D1Database, mediaId: string): Promise<MediaUsage[]> {
  const result = await db
    .prepare(`SELECT * FROM media_usages WHERE media_id = ? ORDER BY ref_kind ASC, ref_id ASC`)
    .bind(mediaId)
    .all<MediaUsage>();
  return result.results;
}

export async function countMediaUsages(db: D1Database, mediaId: string): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM media_usages WHERE media_id = ?`)
    .bind(mediaId)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

type NamedReference = {
  name: string;
  account_id: string | null;
  account_ids?: string | null;
  owner_id?: string | null;
};

function belongsToAccount(row: NamedReference, lineAccountId: string): boolean {
  if (row.account_id === lineAccountId) return true;
  if (!row.account_ids) return false;
  try {
    const ids = JSON.parse(row.account_ids) as unknown;
    return Array.isArray(ids) && ids.includes(lineAccountId);
  } catch {
    // 壊れたJSONを「このアカウントのもの」と推測して見せない。
    return false;
  }
}

function accountIdsOf(row: NamedReference): string[] {
  const result = new Set<string>();
  if (row.account_id) result.add(row.account_id);
  if (!row.account_ids) return [...result];
  try {
    const ids = JSON.parse(row.account_ids) as unknown;
    if (Array.isArray(ids)) {
      for (const value of ids) if (typeof value === 'string') result.add(value);
    }
  } catch {
    // 壊れたJSONはaccount_idだけを残す。describe側で正本不明として止める。
  }
  return [...result];
}

async function describeMediaUsage(
  db: D1Database,
  usage: MediaUsage,
  lineAccountId: string,
): Promise<MediaDeleteImpactReference> {
  let row: NamedReference | null = null;
  let href: string | null = null;

  switch (usage.ref_kind as MediaDeleteImpactReferenceKind) {
    case 'template':
      row = await db.prepare(
        `SELECT name, line_account_id AS account_id FROM templates WHERE id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && belongsToAccount(row, lineAccountId)) {
        href = `/templates/edit?id=${encodeURIComponent(usage.ref_id)}`;
      }
      break;
    case 'broadcast':
      row = await db.prepare(
        `SELECT title AS name, line_account_id AS account_id, account_ids
           FROM broadcasts WHERE id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && belongsToAccount(row, lineAccountId)) {
        href = `/broadcasts/detail?id=${encodeURIComponent(usage.ref_id)}`;
      }
      break;
    case 'rich_menu':
      row = await db.prepare(
        `SELECT g.name || '・' || p.name AS name, g.account_id AS account_id,
                g.id AS owner_id
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE p.id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && row.owner_id && belongsToAccount(row, lineAccountId)) {
        href = `/rich-menus/edit?id=${encodeURIComponent(row.owner_id)}`;
      }
      break;
    case 'scenario_step':
      row = await db.prepare(
        `SELECT s.name || '・' || (ss.step_order + 1) || '通目' AS name,
                s.line_account_id AS account_id, s.id AS owner_id
           FROM scenario_steps ss
           JOIN scenarios s ON s.id = ss.scenario_id
          WHERE ss.id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && row.owner_id && belongsToAccount(row, lineAccountId)) {
        href = `/scenarios/detail?id=${encodeURIComponent(row.owner_id)}`;
      }
      break;
    case 'nen_column':
      row = await db.prepare(
        `SELECT title AS name, line_account_id AS account_id FROM nen_columns WHERE id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && belongsToAccount(row, lineAccountId)) href = '/nen-campaigns?tab=columns';
      break;
    case 'event':
      row = await db.prepare(
        `SELECT name, line_account_id AS account_id, account_ids FROM events WHERE id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && belongsToAccount(row, lineAccountId)) {
        href = `/events/edit?id=${encodeURIComponent(usage.ref_id)}`;
      }
      break;
    case 'webinar':
      row = await db.prepare(
        `SELECT title AS name, account_id FROM webinars WHERE id = ?`,
      ).bind(usage.ref_id).first<NamedReference>();
      if (row && belongsToAccount(row, lineAccountId)) {
        href = `/webinars/edit?id=${encodeURIComponent(usage.ref_id)}`;
      }
      break;
    default:
      // DBのCHECKに無い値も、詳細不明の参照として削除を止める。
      break;
  }

  const available = row !== null && belongsToAccount(row, lineAccountId);
  return {
    kind: usage.ref_kind as MediaDeleteImpactReferenceKind,
    name: available ? row?.name ?? null : null,
    href: available ? href : null,
    state: available ? 'available' : 'unavailable',
    scannedAt: usage.scanned_at,
  };
}

/**
 * 登録メディアを消す直前の影響。
 *
 * `media_usages` を件数だけでなく現在の各台帳へ照合する。参照先が消えていたり
 * 別アカウントだったりして名前を安全に返せない場合も、その参照自体は落とさず
 * unavailable として削除を止める。
 */
export async function getMediaDeleteImpact(
  db: D1Database,
  mediaId: string,
  lineAccountId: string,
  checkedAt: string,
): Promise<MediaDeleteImpact | null> {
  const media = await getMediaById(db, mediaId, lineAccountId);
  if (!media) return null;

  const usages = await getMediaUsages(db, mediaId);
  const references = await Promise.all(
    usages.map((usage) => describeMediaUsage(db, usage, lineAccountId)),
  );
  const lastScannedAt = references.reduce<string | null>(
    (latest, reference) => latest === null || reference.scannedAt > latest
      ? reference.scannedAt
      : latest,
    null,
  );

  return {
    media: {
      id: media.id,
      filename: media.filename,
      kind: media.kind as MediaDeleteImpact['media']['kind'],
    },
    usageCount: references.length,
    references,
    checkedAt,
    lastScannedAt,
    canDelete: references.length === 0,
    recommendedAction: references.length === 0 ? 'delete' : 'review_references',
  };
}

async function describeMediaReplacementUsage(
  db: D1Database,
  usage: MediaUsage,
  lineAccountId: string,
): Promise<MediaReplacementReference> {
  const described = await describeMediaUsage(db, usage, lineAccountId);
  if (described.state === 'unavailable') {
    return {
      ...described,
      replaceable: false,
      blocker: 'unavailable_reference',
      reason: '使用先の正本を確認できないため、一括では差し替えられません。',
    };
  }
  if (usage.ref_kind === 'webinar') {
    return {
      ...described,
      replaceable: false,
      blocker: 'unsupported_reference',
      reason: 'ウェビナー動画は配信用の一式を持つため、このファイルだけを差し替えられません。',
    };
  }
  if (usage.ref_kind === 'broadcast' || usage.ref_kind === 'event') {
    const table = usage.ref_kind === 'broadcast' ? 'broadcasts' : 'events';
    const row = await db.prepare(
      `SELECT line_account_id AS account_id, account_ids, '' AS name FROM ${table} WHERE id = ?`,
    ).bind(usage.ref_id).first<NamedReference>();
    const accounts = row ? accountIdsOf(row) : [];
    if (accounts.some((id) => id !== lineAccountId)) {
      return {
        ...described,
        replaceable: false,
        blocker: 'shared_reference',
        reason: '複数のLINEアカウントで共有しているため、この画面からは差し替えません。',
      };
    }
  }
  return { ...described, replaceable: true, blocker: null, reason: null };
}

/**
 * 使用中メディアを別の登録メディアへ差し替える前の計画。
 *
 * source / replacement は同じLINEアカウントで引き、参照不明・共有参照・
 * ウェビナー動画を1件でも含むと全体を止める。途中だけ変えると、利用者が
 * 「全部替わった」と誤認するためである。
 */
export async function getMediaReplacementPlan(
  db: D1Database,
  input: {
    sourceId: string;
    replacementId: string;
    lineAccountId: string;
    checkedAt: string;
  },
): Promise<MediaReplacementPlan | null> {
  const [source, replacement] = await Promise.all([
    getMediaById(db, input.sourceId, input.lineAccountId),
    getMediaById(db, input.replacementId, input.lineAccountId),
  ]);
  if (!source || !replacement) return null;

  const usages = await getMediaUsages(db, source.id);
  const references = await Promise.all(
    usages.map((usage) => describeMediaReplacementUsage(db, usage, input.lineAccountId)),
  );
  const blockers = new Set<MediaReplacementBlocker>();
  if (source.id === replacement.id) blockers.add('same_media');
  if (source.kind !== replacement.kind) blockers.add('different_kind');
  for (const reference of references) if (reference.blocker) blockers.add(reference.blocker);

  const mediaSummary = (media: Media): MediaReplacementImpact['source'] => ({
    id: media.id,
    filename: media.filename,
    kind: media.kind as MediaReplacementImpact['source']['kind'],
  });
  return {
    source,
    replacement,
    usages,
    impact: {
      source: mediaSummary(source),
      replacement: mediaSummary(replacement),
      usageCount: references.length,
      replaceableCount: references.filter((reference) => reference.replaceable).length,
      references,
      blockers: [...blockers],
      canReplace: blockers.size === 0,
      checkedAt: input.checkedAt,
    },
  };
}

/** 影響確認済みの使用先をD1の1回のbatchで差し替える。 */
export async function applyMediaReplacementPlan(
  db: D1Database,
  plan: MediaReplacementPlan,
  lineAccountId: string,
): Promise<number> {
  if (!plan.impact.canReplace) throw new Error('media_replacement_blocked');
  const oldKey = plan.source.r2_key;
  const newKey = plan.replacement.r2_key;
  const sourceId = plan.source.id;
  const usageIds = (kind: MediaRefKind) =>
    `SELECT ref_id FROM media_usages WHERE media_id = ? AND ref_kind = '${kind}'`;
  const statements: D1PreparedStatement[] = [
    db.prepare(`UPDATE templates SET message_content = REPLACE(message_content, ?, ?)
      WHERE line_account_id = ? AND id IN (${usageIds('template')})`)
      .bind(oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`UPDATE broadcasts
      SET message_content = REPLACE(message_content, ?, ?),
          message_bubbles_json = REPLACE(message_bubbles_json, ?, ?)
      WHERE line_account_id = ?
        AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)
        AND id IN (${usageIds('broadcast')})`)
      .bind(oldKey, newKey, oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`UPDATE rich_menu_pages SET image_r2_key = REPLACE(image_r2_key, ?, ?)
      WHERE EXISTS (SELECT 1 FROM rich_menu_groups g
        WHERE g.id = rich_menu_pages.group_id AND g.account_id = ?)
        AND id IN (${usageIds('rich_menu')})`)
      .bind(oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`UPDATE scenario_steps
      SET message_content = REPLACE(message_content, ?, ?),
          message_bubbles_json = REPLACE(message_bubbles_json, ?, ?)
      WHERE EXISTS (SELECT 1 FROM scenarios s
        WHERE s.id = scenario_steps.scenario_id AND s.line_account_id = ?)
        AND id IN (${usageIds('scenario_step')})`)
      .bind(oldKey, newKey, oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`UPDATE nen_columns SET image_url = REPLACE(image_url, ?, ?)
      WHERE line_account_id = ? AND id IN (${usageIds('nen_column')})`)
      .bind(oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`UPDATE events
      SET image_url = REPLACE(image_url, ?, ?), og_image_url = REPLACE(og_image_url, ?, ?)
      WHERE line_account_id = ?
        AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)
        AND id IN (${usageIds('event')})`)
      .bind(oldKey, newKey, oldKey, newKey, lineAccountId, sourceId),
    db.prepare(`INSERT OR IGNORE INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
      SELECT ?, ref_kind, ref_id, ? FROM media_usages WHERE media_id = ?`)
      .bind(plan.replacement.id, plan.impact.checkedAt, sourceId),
    db.prepare(`DELETE FROM media_usages WHERE media_id = ?`).bind(sourceId),
  ];
  const results = await db.batch(statements);
  return results.slice(0, 6).reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
}

export async function recordMediaUsage(
  db: D1Database,
  input: { mediaId: string; refKind: MediaRefKind; refId: string },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(media_id, ref_kind, ref_id) DO UPDATE SET scanned_at = excluded.scanned_at`,
    )
    .bind(input.mediaId, input.refKind, input.refId, jstNow())
    .run();
}

export interface MediaUsageScanState {
  sourceIndex: number;
  lastRefId: string;
  cycleStartedAt: string;
}

/** 定期走査の進捗をD1に残し、次のcronが続きから再開できるようにする。 */
export async function getMediaUsageScanState(
  db: D1Database,
  now: string,
): Promise<MediaUsageScanState> {
  await db.prepare(
    `INSERT OR IGNORE INTO media_usage_scan_state
       (id, source_index, last_ref_id, cycle_started_at, updated_at)
     VALUES (1, 0, '', ?, ?)`,
  ).bind(now, now).run();
  const row = await db.prepare(
    `SELECT source_index, last_ref_id, cycle_started_at
       FROM media_usage_scan_state WHERE id = 1`,
  ).bind().first<{ source_index: number; last_ref_id: string; cycle_started_at: string }>();
  if (!row) throw new Error('media usage scan state is unavailable');
  return {
    sourceIndex: Number(row.source_index),
    lastRefId: row.last_ref_id,
    cycleStartedAt: row.cycle_started_at,
  };
}

export async function saveMediaUsageScanState(
  db: D1Database,
  state: MediaUsageScanState,
  now: string,
): Promise<void> {
  await db.prepare(
    `UPDATE media_usage_scan_state
        SET source_index = ?, last_ref_id = ?, cycle_started_at = ?, updated_at = ?
      WHERE id = 1`,
  ).bind(state.sourceIndex, state.lastRefId, state.cycleStartedAt, now).run();
}

/** 使用先を複数行INSERTへまとめ、D1のbind上限内でbatch実行する。 */
export async function recordMediaUsages(
  db: D1Database,
  usages: Array<{ mediaId: string; refKind: MediaRefKind; refId: string }>,
  scannedAt: string,
): Promise<void> {
  if (usages.length === 0) return;
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < usages.length; index += MEDIA_USAGE_WRITE_CHUNK) {
    const chunk = usages.slice(index, index + MEDIA_USAGE_WRITE_CHUNK);
    const values = chunk.map(() => '(?, ?, ?, ?)').join(',');
    const binds = chunk.flatMap((usage) => [
      usage.mediaId,
      usage.refKind,
      usage.refId,
      scannedAt,
    ]);
    statements.push(db.prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES ${values}
       ON CONFLICT(media_id, ref_kind, ref_id) DO UPDATE SET scanned_at = excluded.scanned_at`,
    ).bind(...binds));
  }
  await db.batch(statements);
}

/**
 * 今回のスキャンで触らなかった記録を消す。
 *
 * 本文から画像が外されたとき、記録だけが残り続けると「使われている」
 * と言い続けることになる。
 *
 * 対象は「今回走査したメディア」だけに限る。走査していないメディアの
 * 記録まで消すと、上限で外れたものが「どこでも使われていない」ことに
 * なってしまい、削除前の警告が効かなくなる。
 */
export async function pruneStaleMediaUsages(
  db: D1Database,
  scannedBefore: string,
  mediaIds: string[],
): Promise<number> {
  if (mediaIds.length === 0) return 0;
  let changes = 0;
  for (let index = 0; index < mediaIds.length; index += LOOKUP_CHUNK) {
    const chunk = mediaIds.slice(index, index + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const result = await db
      .prepare(
        `DELETE FROM media_usages
          WHERE scanned_at < ? AND media_id IN (${placeholders})`,
      )
      .bind(scannedBefore, ...chunk)
      .run();
    changes += result.meta?.changes ?? 0;
  }
  return changes;
}

/** 定期走査用。古い使用先の整理も1回の上限内に分ける。 */
export async function pruneStaleMediaUsagesBatch(
  db: D1Database,
  scannedBefore: string,
  mediaIds: string[],
  limit: number,
): Promise<number> {
  if (mediaIds.length === 0 || limit <= 0) return 0;
  let changes = 0;
  for (let index = 0; index < mediaIds.length && changes < limit; index += LOOKUP_CHUNK) {
    const chunk = mediaIds.slice(index, index + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const remaining = limit - changes;
    const result = await db
      .prepare(
        `DELETE FROM media_usages
          WHERE rowid IN (
            SELECT rowid FROM media_usages
             WHERE scanned_at < ? AND media_id IN (${placeholders})
             LIMIT ?
          )`,
      )
      .bind(scannedBefore, ...chunk, remaining)
      .run();
    changes += result.meta?.changes ?? 0;
  }
  return changes;
}
