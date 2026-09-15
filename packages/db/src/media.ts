import type {
  MediaDeleteImpact,
  MediaDeleteImpactReference,
  MediaDeleteImpactReferenceKind,
  MediaReplacementBlocker,
  MediaReplacementImpact,
  MediaReplacementReference,
} from '@line-crm/shared';
import { jstNow } from './utils.js';
import { getMediaStorageQuota } from './media-uploads.js';

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

/**
 * N-198/N-204 (#796):「上限に近い」は1ファイルの固定値(旧: 画像8MB等)では
 * なく、契約上限への圧迫で決める。契約上限のこの割合以上を1行で占める
 * ファイルだけを返す。分母は getMediaStorageQuota と同じ計算元の
 * limitBytes を使い、要求値や画面内推定は使わない。既定10GBの0.1%は
 * 約10MBで、旧しきい値(画像8MB級)と同じ帯に寄せている。
 */
export const MEDIA_NEAR_LIMIT_SHARE = 0.001;

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

/** 保存先と別のLINEアカウントのメディアが本文に含まれる。 */
export class MediaReferenceAccountError extends Error {
  constructor() {
    super('MEDIA_REFERENCE_ACCOUNT_MISMATCH');
    this.name = 'MediaReferenceAccountError';
  }
}

type MediaUsageMutationResult = { meta?: { changes?: number } };

/**
 * 本文が指すライブURL・固定版R2キーを解決し、本体の保存と使用台帳を1原子処理で書く。
 *
 * 参照保存だけが成功して台帳が0件になる窓を作らないため、呼び出し側の
 * INSERT/UPDATEも同じ `db.batch` へ渡す。別accountのキーはbatch開始前に拒否し、
 * 台帳INSERTが失敗した場合はD1のbatch rollbackで本体も戻す。
 *
 * `usageGuard` はCAS付き更新用。更新に負けた実行が、勝った実行の台帳を
 * 古い候補で上書きしないよう、各台帳文に現在行の条件を付ける。
 */
export async function applyMediaUsageMutation(
  db: D1Database,
  input: {
    lineAccountId: string | null;
    refKind: MediaRefKind;
    refId: string;
    searchableContent: Array<string | null | undefined>;
    mutationStatements: D1PreparedStatement[];
    usageGuard?: { sql: string; binds: unknown[] };
  },
): Promise<MediaUsageMutationResult[]> {
  const content = input.searchableContent.filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  let referenced: Array<{ id: string; line_account_id: string | null }> = [];
  if (content.length > 0) {
    const matchOne = `(
      instr(?, m.r2_key) > 0
      OR (mv.r2_key IS NOT NULL AND instr(?, mv.r2_key) > 0)
      OR instr(?, '/media/' || m.id || '/content') > 0
    )`;
    const rows = await db.prepare(
      `SELECT DISTINCT m.id, m.line_account_id
         FROM media m
         LEFT JOIN media_versions mv ON mv.media_id = m.id
        WHERE ${content.map(() => matchOne).join(' OR ')}`,
    ).bind(...content.flatMap((value) => [value, value, value]))
      .all<{ id: string; line_account_id: string | null }>();
    referenced = rows.results;
  }
  if (referenced.some((row) => row.line_account_id !== input.lineAccountId)) {
    throw new MediaReferenceAccountError();
  }

  const guardSql = input.usageGuard ? ` AND (${input.usageGuard.sql})` : '';
  const guardBinds = input.usageGuard?.binds ?? [];
  const statements = [
    ...input.mutationStatements,
    db.prepare(
      `DELETE FROM media_usages
        WHERE ref_kind = ? AND ref_id = ?${guardSql}`,
    ).bind(input.refKind, input.refId, ...guardBinds),
  ];
  const scannedAt = jstNow();
  for (let index = 0; index < referenced.length; index += MEDIA_USAGE_WRITE_CHUNK) {
    const chunk = referenced.slice(index, index + MEDIA_USAGE_WRITE_CHUNK);
    if (input.usageGuard) {
      statements.push(db.prepare(
        `WITH pending(media_id, ref_kind, ref_id, scanned_at) AS (
           VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(',')}
         )
         INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
         SELECT media_id, ref_kind, ref_id, scanned_at FROM pending
          WHERE ${input.usageGuard.sql}`,
      ).bind(
        ...chunk.flatMap((row) => [row.id, input.refKind, input.refId, scannedAt]),
        ...guardBinds,
      ));
      continue;
    }
    statements.push(db.prepare(
      `INSERT INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
       VALUES ${chunk.map(() => '(?, ?, ?, ?)').join(',')}`,
    ).bind(...chunk.flatMap((row) => [row.id, input.refKind, input.refId, scannedAt])));
  }
  return db.batch(statements) as Promise<MediaUsageMutationResult[]>;
}

/** 削除影響と、その表示を作った同一時点の使用先行。 */
export interface MediaDeleteImpactSnapshot {
  impact: MediaDeleteImpact;
  usages: MediaUsage[];
}

export interface MediaReplacementPlan {
  source: Media;
  replacement: Media;
  usages: MediaUsage[];
  impact: Omit<MediaReplacementImpact, 'revision'>;
}

export async function getMedia(
  db: D1Database,
  opts: {
    lineAccountId: string;
    kind?: MediaKind;
    folderId?: string;
    excludeId?: string;
    query?: string;
    unusedOnly?: boolean;
    nearLimitOnly?: boolean;
    sort?: 'newest' | 'oldest' | 'name' | 'size' | 'usage';
    limit?: number;
    offset?: number;
  },
): Promise<Media[]> {
  const conditions: string[] = ['m.line_account_id = ?'];
  const values: unknown[] = [opts.lineAccountId];
  if (opts.kind) {
    conditions.push('kind = ?');
    values.push(opts.kind);
  }
  if (opts.folderId) {
    if (opts.folderId === '__ungrouped__') conditions.push('m.folder_id IS NULL');
    else {
      conditions.push('m.folder_id = ?');
      values.push(opts.folderId);
    }
  }
  if (opts.excludeId) {
    conditions.push('m.id != ?');
    values.push(opts.excludeId);
  }
  if (opts.query) {
    conditions.push("LOWER(m.filename) LIKE ? ESCAPE '\\'");
    values.push(`%${opts.query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (opts.unusedOnly) {
    conditions.push('(SELECT COUNT(*) FROM media_usages u WHERE u.media_id = m.id) = 0');
  }
  if (opts.nearLimitOnly) {
    // 一覧口と同じ計算元。INSERT OR IGNORE で上限行が無い口座にも既定値が入る。
    // 上限未設定(limit<=0)は安全側で何も返さない。壊れ値(負値・NULL)は
    // 正のしきい値との比較で自然に外れる。
    const quota = await getMediaStorageQuota(db, opts.lineAccountId);
    if (!(quota.limitBytes > 0)) return [];
    conditions.push('m.size_bytes >= ?');
    values.push(quota.limitBytes * MEDIA_NEAR_LIMIT_SHARE);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const orderBy = opts.sort === 'oldest' ? 'm.created_at ASC'
    : opts.sort === 'name' ? 'm.filename COLLATE NOCASE ASC'
      : opts.sort === 'size' ? 'm.size_bytes DESC'
        : opts.sort === 'usage' ? 'usage_count DESC, m.created_at DESC'
          : 'm.created_at DESC';
  values.push(opts.limit ?? 200, opts.offset ?? 0);
  const result = await db
    .prepare(
      `SELECT m.*,
              (SELECT COUNT(*) FROM media_usages u WHERE u.media_id = m.id) AS usage_count
         FROM media m
         ${where}
        ORDER BY ${orderBy}
        LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<Media>();
  return result.results;
}

/** 一覧と同じ条件で、ページ外を含む総件数を返す。 */
export async function countMedia(
  db: D1Database,
  opts: Omit<Parameters<typeof getMedia>[1], 'limit' | 'offset' | 'sort'>,
): Promise<number> {
  const conditions = ['m.line_account_id = ?'];
  const values: unknown[] = [opts.lineAccountId];
  if (opts.kind) { conditions.push('m.kind = ?'); values.push(opts.kind); }
  if (opts.folderId === '__ungrouped__') conditions.push('m.folder_id IS NULL');
  else if (opts.folderId) { conditions.push('m.folder_id = ?'); values.push(opts.folderId); }
  if (opts.excludeId) { conditions.push('m.id != ?'); values.push(opts.excludeId); }
  if (opts.query) {
    conditions.push("LOWER(m.filename) LIKE ? ESCAPE '\\'");
    values.push(`%${opts.query.toLowerCase().replace(/[\\%_]/g, '\\$&')}%`);
  }
  if (opts.unusedOnly) conditions.push('(SELECT COUNT(*) FROM media_usages u WHERE u.media_id = m.id) = 0');
  if (opts.nearLimitOnly) {
    const quota = await getMediaStorageQuota(db, opts.lineAccountId);
    if (!(quota.limitBytes > 0)) return 0;
    conditions.push('m.size_bytes >= ?');
    values.push(quota.limitBytes * MEDIA_NEAR_LIMIT_SHARE);
  }
  const row = await db.prepare(`SELECT COUNT(*) AS total FROM media m WHERE ${conditions.join(' AND ')}`)
    .bind(...values).first<{ total: number }>();
  return Number(row?.total ?? 0);
}

export async function getMediaById(
  db: D1Database,
  id: string,
  lineAccountId: string | null,
): Promise<Media | null> {
  if (lineAccountId === null) {
    return db.prepare(`SELECT * FROM media WHERE id = ? AND line_account_id IS NULL`)
      .bind(id).first<Media>();
  }
  return db.prepare(`SELECT * FROM media WHERE id = ? AND line_account_id = ?`)
    .bind(id, lineAccountId).first<Media>();
}

export async function createMedia(
  db: D1Database,
  input: {
    kind: MediaKind;
    /** null は統括所有（バナー生成など、店舗に属さないメディア）。 */
    lineAccountId: string | null;
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
  const now = jstNow();
  await db.batch([
    db.prepare(
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
      now,
    ),
    db.prepare(
      `INSERT INTO media_versions
         (id, media_id, version_no, r2_key, mime_type, size_bytes, width, height, duration_ms,
          scan_status, scanned_at, uploaded_by, created_at, published_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, input.r2Key, input.mimeType, input.sizeBytes,
      input.width ?? null, input.height ?? null, input.durationMs ?? null,
      now, input.uploadedBy ?? null, now, now,
    ),
  ]);
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
 * 削除する前に「5か所で使われています」と出すための表。
 * 対応済みの保存経路では本文と同じ原子処理で更新し、走査は旧データや
 * 一時的な欠損を補修する安全網としてだけ残す。
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
export async function getMediaDeleteImpactSnapshot(
  db: D1Database,
  mediaId: string,
  lineAccountId: string,
  checkedAt: string,
): Promise<MediaDeleteImpactSnapshot | null> {
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
    usages,
    impact: {
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
    },
  };
}

/** 既存の削除口用。参照IDが必要な画面は snapshot 版を使う。 */
export async function getMediaDeleteImpact(
  db: D1Database,
  mediaId: string,
  lineAccountId: string,
  checkedAt: string,
): Promise<MediaDeleteImpact | null> {
  return (await getMediaDeleteImpactSnapshot(db, mediaId, lineAccountId, checkedAt))?.impact ?? null;
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

/**
 * 使用先本文の中でメディアを指している文字列の置き換え対。
 *
 * 固定参照は版ごとのr2_key（旧版を指すものも使用中）、ライブ参照は
 * メディアIDの公開パス。どちらも文字列置換で差し替え先へ付け替えられる。
 */
function mediaReferenceReplacePairs(
  sourceId: string,
  sourceKeys: string[],
  replacement: Media,
): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const key of sourceKeys) pairs.push([key, replacement.r2_key]);
  pairs.push([mediaLiveContentPath(sourceId), mediaLiveContentPath(replacement.id)]);
  return pairs;
}

/**
 * 置き換え文をD1のbind上限内に収める。
 *
 * 置き換え対が少ない通常時は表ごとに1文（従来どおり、行は1回だけ数える）。
 * 版数が多くて対が膨らんだときだけ列・対ごとに分け、LIKE条件で実際に
 * そのトークンを含む行だけを対象にする。
 */
const USAGE_REPLACE_PAIR_CHUNK = 24;

function usageReplaceStatements(
  db: D1Database,
  opts: {
    table: string;
    columns: string[];
    scopeSql: string;
    scopeBinds: unknown[];
    idSubquery: string;
    idSubqueryBinds: unknown[];
    pairs: Array<[string, string]>;
  },
): D1PreparedStatement[] {
  if (opts.pairs.length <= USAGE_REPLACE_PAIR_CHUNK) {
    const setClause = opts.columns
      .map((column) => `${column} = ${opts.pairs.reduce((expr) => `REPLACE(${expr}, ?, ?)`, column)}`)
      .join(', ');
    const binds = opts.columns.flatMap(() => opts.pairs.flatMap(([from, to]) => [from, to]));
    return [db.prepare(
      `UPDATE ${opts.table} SET ${setClause}
        WHERE ${opts.scopeSql} AND id IN (${opts.idSubquery})`,
    ).bind(...binds, ...opts.scopeBinds, ...opts.idSubqueryBinds)];
  }
  const statements: D1PreparedStatement[] = [];
  for (const column of opts.columns) {
    for (let index = 0; index < opts.pairs.length; index += USAGE_REPLACE_PAIR_CHUNK) {
      const chunk = opts.pairs.slice(index, index + USAGE_REPLACE_PAIR_CHUNK);
      const expression = chunk.reduce((expr) => `REPLACE(${expr}, ?, ?)`, column);
      const guard = chunk.map(() => `${column} LIKE ?`).join(' OR ');
      statements.push(db.prepare(
        `UPDATE ${opts.table} SET ${column} = ${expression}
          WHERE ${opts.scopeSql} AND id IN (${opts.idSubquery}) AND (${guard})`,
      ).bind(
        ...chunk.flatMap(([from, to]) => [from, to]),
        ...opts.scopeBinds,
        ...opts.idSubqueryBinds,
        ...chunk.map(([from]) => `%${from}%`),
      ));
    }
  }
  return statements;
}

/** 影響確認済みの使用先をD1の1回のbatchで差し替える。 */
export async function applyMediaReplacementPlan(
  db: D1Database,
  plan: MediaReplacementPlan,
  lineAccountId: string,
): Promise<number> {
  if (!plan.impact.canReplace) throw new Error('media_replacement_blocked');
  const sourceId = plan.source.id;
  // 現行版だけでなく旧版を指す固定参照とライブ参照も同じ使用先なので、
  // 版の全r2_keyとライブ参照パスをまとめて差し替え先へ置き換える。
  const sourceKeys = [
    ...new Set([
      plan.source.r2_key,
      ...(await getMediaVersionKeys(db, sourceId)),
    ]),
  ].filter((key) => key.length > 0);
  const pairs = mediaReferenceReplacePairs(sourceId, sourceKeys, plan.replacement);
  const usageIds = (kind: MediaRefKind) =>
    `SELECT ref_id FROM media_usages WHERE media_id = ? AND ref_kind = '${kind}'`;
  const scoped = (scopeSql: string, scopeBinds: unknown[], kind: MediaRefKind, columns: string[], table: string) =>
    usageReplaceStatements(db, {
      table,
      columns,
      scopeSql,
      scopeBinds,
      idSubquery: usageIds(kind),
      idSubqueryBinds: [sourceId],
      pairs,
    });
  const statements: D1PreparedStatement[] = [
    ...scoped('line_account_id = ?', [lineAccountId], 'template', ['message_content'], 'templates'),
    ...scoped(
      'line_account_id = ? AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)',
      [lineAccountId], 'broadcast', ['message_content', 'message_bubbles_json'], 'broadcasts',
    ),
    ...scoped(
      `EXISTS (SELECT 1 FROM rich_menu_groups g
        WHERE g.id = rich_menu_pages.group_id AND g.account_id = ?)`,
      [lineAccountId], 'rich_menu', ['image_r2_key'], 'rich_menu_pages',
    ),
    ...scoped(
      `EXISTS (SELECT 1 FROM scenarios s
        WHERE s.id = scenario_steps.scenario_id AND s.line_account_id = ?)`,
      [lineAccountId], 'scenario_step', ['message_content', 'message_bubbles_json'], 'scenario_steps',
    ),
    ...scoped('line_account_id = ?', [lineAccountId], 'nen_column', ['image_url'], 'nen_columns'),
    ...scoped(
      'line_account_id = ? AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)',
      [lineAccountId], 'event', ['image_url', 'og_image_url'], 'events',
    ),
    db.prepare(`INSERT OR IGNORE INTO media_usages (media_id, ref_kind, ref_id, scanned_at)
      SELECT ?, ref_kind, ref_id, ? FROM media_usages WHERE media_id = ?`)
      .bind(plan.replacement.id, plan.impact.checkedAt, sourceId),
    db.prepare(`DELETE FROM media_usages WHERE media_id = ?`).bind(sourceId),
  ];
  const results = await db.batch(statements);
  // 末尾2件はmedia_usagesの付け替えなので、本文を書き換えた件数だけ数える。
  return results.slice(0, results.length - 2)
    .reduce((sum, result) => sum + Number(result.meta?.changes ?? 0), 0);
}

/**
 * ライブ参照の公開パス。
 *
 * 使用先本文には「版ごとのr2_key」か、このメディアIDのパスを
 * `/media/<id>/content` の形で埋め込む。版のr2_keyはその版を指し続け
 * （固定参照）、メディアIDのパスは配信時に最新版へ解決される
 * （ライブ参照）。どちらも本文内の文字列として表せるため、使用先の
 * 記録へ列を足さずに使用先ごとの切り替えができる。
 */
export function mediaLiveContentPath(mediaId: string): string {
  return `/media/${mediaId}/content`;
}

/** メディアの全版のr2_key（現行・旧版を問わず、固定参照が指し得る実体）。 */
export async function getMediaVersionKeys(
  db: D1Database,
  mediaId: string,
): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT r2_key FROM media_versions WHERE media_id = ?`)
    .bind(mediaId)
    .all<{ r2_key: string }>();
  return rows.results.map((row) => row.r2_key);
}

/**
 * 使用先本文を照合するトークン。
 *
 * 固定参照は版ごとのr2_key（旧版を指すものも使用中）、ライブ参照は
 * メディアIDの公開パスで見つける。
 */
export async function getMediaUsageMatchTokens(
  db: D1Database,
  mediaId: string,
): Promise<string[]> {
  return [...new Set([...await getMediaVersionKeys(db, mediaId), mediaLiveContentPath(mediaId)])];
}

/** 複数メディア分を1回で取る。media_id → 照合トークン。 */
export async function getMediaUsageMatchTokenMap(
  db: D1Database,
  mediaIds: string[],
): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  for (const id of mediaIds) map.set(id, [mediaLiveContentPath(id)]);
  for (let index = 0; index < mediaIds.length; index += LOOKUP_CHUNK) {
    const chunk = mediaIds.slice(index, index + LOOKUP_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await db
      .prepare(`SELECT media_id, r2_key FROM media_versions WHERE media_id IN (${placeholders})`)
      .bind(...chunk)
      .all<{ media_id: string; r2_key: string }>();
    for (const row of rows.results) {
      const tokens = map.get(row.media_id) ?? [mediaLiveContentPath(row.media_id)];
      if (!tokens.includes(row.r2_key)) tokens.push(row.r2_key);
      map.set(row.media_id, tokens);
    }
  }
  return map;
}

/** 公開のライブ配信がメディアIDから最新版へ解決するための最小限の行。 */
export async function getMediaLiveTarget(
  db: D1Database,
  id: string,
): Promise<Pick<Media, 'id' | 'r2_key' | 'mime_type' | 'filename'> | null> {
  return db.prepare(
    `SELECT id, r2_key, mime_type, filename FROM media WHERE id = ?`,
  ).bind(id).first<Pick<Media, 'id' | 'r2_key' | 'mime_type' | 'filename'>>();
}

export type MediaUsageReferenceMode = 'live' | 'pinned' | 'mixed' | 'unknown' | 'unavailable';

export interface MediaUsageReferenceState {
  mode: MediaUsageReferenceMode;
  /** pinned のとき参照している版。混在・判別不能・使用先不明は null。 */
  versionNo: number | null;
}

interface UsageContentRow {
  /** 複数のLINEアカウントで共有している正本。この画面からは書き換えない。 */
  shared: boolean;
  columns: Record<string, string>;
}

function usageTextColumns(row: Record<string, unknown>, columns: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const column of columns) {
    const value = row[column];
    if (typeof value === 'string' && value) result[column] = value;
  }
  return result;
}

/**
 * 使用先の正本行を読み、参照が埋まっている列だけを返す。
 *
 * 表示側（describeMediaUsage）と同じ所属判定で、見せられる使用先だけを
 * 扱う。共有されている配信・イベントは内容の書き換えを止める目印として
 * `shared` を立てる。
 */
async function loadUsageContent(
  db: D1Database,
  usage: { ref_kind: string; ref_id: string },
  lineAccountId: string,
): Promise<UsageContentRow | null> {
  switch (usage.ref_kind) {
    case 'template': {
      const row = await db.prepare(
        `SELECT message_content FROM templates WHERE id = ? AND line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['message_content']) } : null;
    }
    case 'broadcast': {
      const row = await db.prepare(
        `SELECT message_content, message_bubbles_json,
                line_account_id AS account_id, account_ids
           FROM broadcasts WHERE id = ?`,
      ).bind(usage.ref_id).first<Record<string, unknown> & NamedReference>();
      if (!row || !belongsToAccount(row, lineAccountId)) return null;
      return {
        shared: row.account_id !== lineAccountId
          || accountIdsOf(row).some((id) => id !== lineAccountId),
        columns: usageTextColumns(row, ['message_content', 'message_bubbles_json']),
      };
    }
    case 'rich_menu': {
      const row = await db.prepare(
        `SELECT p.image_r2_key FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE p.id = ? AND g.account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['image_r2_key']) } : null;
    }
    case 'scenario_step': {
      const row = await db.prepare(
        `SELECT ss.message_content, ss.message_bubbles_json
           FROM scenario_steps ss
           JOIN scenarios s ON s.id = ss.scenario_id
          WHERE ss.id = ? AND s.line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row
        ? { shared: false, columns: usageTextColumns(row, ['message_content', 'message_bubbles_json']) }
        : null;
    }
    case 'nen_column': {
      const row = await db.prepare(
        `SELECT image_url FROM nen_columns WHERE id = ? AND line_account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['image_url']) } : null;
    }
    case 'event': {
      const row = await db.prepare(
        `SELECT image_url, og_image_url, line_account_id AS account_id, account_ids
           FROM events WHERE id = ?`,
      ).bind(usage.ref_id).first<Record<string, unknown> & NamedReference>();
      if (!row || !belongsToAccount(row, lineAccountId)) return null;
      return {
        shared: row.account_id !== lineAccountId
          || accountIdsOf(row).some((id) => id !== lineAccountId),
        columns: usageTextColumns(row, ['image_url', 'og_image_url']),
      };
    }
    case 'webinar': {
      const row = await db.prepare(
        `SELECT video_prefix FROM webinars WHERE id = ? AND account_id = ?`,
      ).bind(usage.ref_id, lineAccountId).first<Record<string, unknown>>();
      return row ? { shared: false, columns: usageTextColumns(row, ['video_prefix']) } : null;
    }
    default:
      return null;
  }
}

function detectUsageReferenceState(
  mediaId: string,
  versions: Array<{ version_no: number; r2_key: string }>,
  columns: Record<string, string>,
): MediaUsageReferenceState {
  const text = Object.values(columns).join('\n');
  const live = text.includes(mediaLiveContentPath(mediaId));
  const hits = versions.filter((version) => version.r2_key && text.includes(version.r2_key));
  if (live) return hits.length > 0
    ? { mode: 'mixed', versionNo: null }
    : { mode: 'live', versionNo: null };
  if (hits.length === 1) return { mode: 'pinned', versionNo: Number(hits[0].version_no) };
  if (hits.length > 1) return { mode: 'mixed', versionNo: null };
  // 記録はあるが本文からは今の形を判別できない。触らずそのまま知らせる。
  return { mode: 'unknown', versionNo: null };
}

/**
 * 記録済み使用先ごとの参照モードと固定版を読む。
 *
 * 返す配列は `usages` と同じ順番。正本が別アカウントへ移った等で読めない
 * 使用先は `unavailable` として残す。
 */
export async function getMediaUsageReferenceStates(
  db: D1Database,
  input: {
    media: Media;
    usages: MediaUsage[];
    versions: Array<{ version_no: number; r2_key: string }>;
    lineAccountId: string;
  },
): Promise<MediaUsageReferenceState[]> {
  return Promise.all(input.usages.map(async (usage) => {
    const row = await loadUsageContent(db, usage, input.lineAccountId);
    if (!row) return { mode: 'unavailable' as const, versionNo: null };
    return detectUsageReferenceState(input.media.id, input.versions, row.columns);
  }));
}

export type MediaUsageReferenceErrorCode =
  | 'media_usage_not_found'
  | 'media_usage_shared'
  | 'media_reference_unsupported'
  | 'media_version_not_found'
  | 'media_reference_stale';

export class MediaUsageReferenceError extends Error {
  constructor(readonly code: MediaUsageReferenceErrorCode) {
    super(code);
    this.name = 'MediaUsageReferenceError';
  }
}

/**
 * 1つの使用先の参照を、ライブ参照または指定した固定版へ書き換える。
 *
 * 本文に埋まっている現在の参照文字列（全版のr2_key・ライブ参照パス）を
 * 見つけ、その使用先の行だけを対象に置き換える。同じメディアを使う
 * 他の使用先の行には一切触れない。
 *
 * ライブ参照はURLとして読まれる列（テンプレート・一斉配信・シナリオ・
 * NEN・イベント）でのみ使える。リッチメニューはR2キーで渡す列のため
 * 固定版だけ、ウェビナー動画は一式を持つため対象外とする。
 */
export async function retargetMediaUsageReference(
  db: D1Database,
  input: {
    media: Media;
    lineAccountId: string;
    refKind: string;
    refId: string;
    target: { mode: 'live' } | { mode: 'pinned'; versionNo: number };
    /** 同じPATCHで保存するメディア名・フォルダ。参照切替と同じbatchへ載せる。 */
    mediaUpdate?: { filename?: string; folderId?: string | null };
  },
): Promise<{ changed: boolean; state: MediaUsageReferenceState }> {
  if (input.refKind === 'webinar') {
    throw new MediaUsageReferenceError('media_reference_unsupported');
  }
  if (input.target.mode === 'live' && input.refKind === 'rich_menu') {
    throw new MediaUsageReferenceError('media_reference_unsupported');
  }
  const versionRows = (await db.prepare(
    `SELECT version_no, r2_key, scan_status FROM media_versions WHERE media_id = ?`,
  ).bind(input.media.id).all<{ version_no: number; r2_key: string; scan_status: string }>()).results;
  const targetVersionNo = input.target.mode === 'pinned' ? input.target.versionNo : null;
  const targetKey = targetVersionNo === null
    ? undefined
    : versionRows.find(
        (version) => Number(version.version_no) === targetVersionNo
          && version.scan_status === 'verified',
      )?.r2_key;
  if (input.target.mode === 'pinned' && !targetKey) {
    throw new MediaUsageReferenceError('media_version_not_found');
  }

  const usage = { ref_kind: input.refKind, ref_id: input.refId };
  const row = await loadUsageContent(db, usage, input.lineAccountId);
  if (!row) throw new MediaUsageReferenceError('media_usage_not_found');
  if (row.shared) throw new MediaUsageReferenceError('media_usage_shared');

  const livePath = mediaLiveContentPath(input.media.id);
  const state = detectUsageReferenceState(input.media.id, versionRows, row.columns);
  const mediaSets: string[] = [];
  const mediaValues: unknown[] = [];
  if (input.mediaUpdate?.filename !== undefined) {
    mediaSets.push('filename = ?');
    mediaValues.push(input.mediaUpdate.filename);
  }
  if (input.mediaUpdate && 'folderId' in input.mediaUpdate) {
    mediaSets.push('folder_id = ?');
    mediaValues.push(input.mediaUpdate.folderId ?? null);
  }
  const mediaUpdateStatement = mediaSets.length > 0
    ? db.prepare(`UPDATE media SET ${mediaSets.join(', ')} WHERE id = ? AND line_account_id = ?`)
      .bind(...mediaValues, input.media.id, input.lineAccountId)
    : null;
  const already = input.target.mode === 'live'
    ? state.mode === 'live'
    : state.mode === 'pinned' && state.versionNo === input.target.versionNo;
  if (already) {
    if (mediaUpdateStatement) await db.batch([mediaUpdateStatement]);
    return { changed: false, state };
  }
  if (state.mode === 'unknown') {
    // このメディアを指す文字列が本文に無い＝記録だけが残っている。
    // 置き換える正本が分からないので、無闇に書き換えず読み直しを促す。
    throw new MediaUsageReferenceError('media_reference_stale');
  }

  const scope = (() => {
    switch (input.refKind) {
      case 'template':
      case 'nen_column':
        return { sql: 'line_account_id = ?', binds: [input.lineAccountId] };
      case 'broadcast':
      case 'event':
        return {
          sql: `line_account_id = ?
            AND (account_ids IS NULL OR json_array_length(account_ids) <= 1)`,
          binds: [input.lineAccountId],
        };
      case 'rich_menu':
        return {
          sql: `EXISTS (SELECT 1 FROM rich_menu_groups g
            WHERE g.id = rich_menu_pages.group_id AND g.account_id = ?)`,
          binds: [input.lineAccountId],
        };
      case 'scenario_step':
        return {
          sql: `EXISTS (SELECT 1 FROM scenarios s
            WHERE s.id = scenario_steps.scenario_id AND s.line_account_id = ?)`,
          binds: [input.lineAccountId],
        };
      default:
        throw new MediaUsageReferenceError('media_reference_unsupported');
    }
  })();
  const table: Record<string, string> = {
    template: 'templates',
    broadcast: 'broadcasts',
    rich_menu: 'rich_menu_pages',
    scenario_step: 'scenario_steps',
    nen_column: 'nen_columns',
    event: 'events',
  };
  const targetTable = table[input.refKind];
  if (!targetTable) throw new MediaUsageReferenceError('media_reference_unsupported');

  const statements: D1PreparedStatement[] = mediaUpdateStatement ? [mediaUpdateStatement] : [];
  for (const [column, value] of Object.entries(row.columns)) {
    const pairs: Array<[string, string]> = [];
    if (input.target.mode === 'live') {
      for (const version of versionRows) {
        if (!version.r2_key || !value.includes(version.r2_key)) continue;
        // URL形の埋め込みはURLごと、単体のキーはパスへ置き換える。
        pairs.push([`/images/${version.r2_key}`, livePath]);
        pairs.push([version.r2_key, livePath]);
      }
    } else {
      for (const version of versionRows) {
        if (!version.r2_key || !value.includes(version.r2_key)) continue;
        pairs.push([version.r2_key, targetKey!]);
      }
      if (value.includes(livePath)) pairs.push([livePath, `/images/${targetKey}`]);
    }
    if (pairs.length === 0) continue;
    // D1 は1文100 bindまで。置換2＋LIKE1ずつに対象ID・所属を足すため、
    // 24対ずつに分ける（最大74 bind）。
    for (let index = 0; index < pairs.length; index += USAGE_REPLACE_PAIR_CHUNK) {
      const chunk = pairs.slice(index, index + USAGE_REPLACE_PAIR_CHUNK);
      const expression = chunk.reduce((expr) => `REPLACE(${expr}, ?, ?)`, column);
      const guard = chunk.map(() => `${column} LIKE ?`).join(' OR ');
      statements.push(db.prepare(
        `UPDATE ${targetTable} SET ${column} = ${expression}
          WHERE id = ? AND ${scope.sql} AND (${guard})`,
      ).bind(
        ...chunk.flatMap(([from, to]) => [from, to]),
        input.refId,
        ...scope.binds,
        ...chunk.map(([from]) => `%${from}%`),
      ));
    }
  }
  if (statements.length === (mediaUpdateStatement ? 1 : 0)) {
    throw new MediaUsageReferenceError('media_reference_stale');
  }
  const results = await db.batch(statements);
  const changed = results.some((result) => Number(result.meta?.changes ?? 0) > 0);

  // 書いた結果を読み直して確認する。途中で本文が変わっていた場合に
  // 「切り替わった」と誤って見せないため。
  const after = await loadUsageContent(db, usage, input.lineAccountId);
  const afterState = after
    ? detectUsageReferenceState(input.media.id, versionRows, after.columns)
    : null;
  const ok = afterState && (input.target.mode === 'live'
    ? afterState.mode === 'live'
    : afterState.mode === 'pinned' && afterState.versionNo === input.target.versionNo);
  if (!ok) throw new MediaUsageReferenceError('media_reference_stale');
  return { changed, state: afterState! };
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
