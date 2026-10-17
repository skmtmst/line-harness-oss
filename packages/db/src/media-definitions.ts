import { jstNow } from './utils.js';
import { getMediaStorageQuota } from './media-uploads.js';
import { type MediaRefKind, type MediaUsageMutationResult, type MediaKind, type Media, type MediaArchiveResult } from './media-primitives.js';


export const LOOKUP_CHUNK = 90;
export const MEDIA_USAGE_WRITE_CHUNK = 20;

/**
 * 表が無いときの読み口失敗（R34）。
 *
 * 古い検証環境などで機能の表がまだ無いと、D1 は `no such table` で
 * 落ちる。使用先の確認は「読めなかったら例外」が原則だが、表そのものが
 * 無い読み口まで例外にすると、どの画像でも取得が失敗し、読み直しても
 * 直らない（監査 R34）。表が無い読み口は「未確認」として残し、ほかの
 * 読み口は続ける。一時的なD1障害はここでは救わず、例外のままにする。
 */
export function isMissingTableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('no such table');
}

/**
 * N-198/N-204 (#796):「上限に近い」は1ファイルの固定値(旧: 画像8MB等)では
 * なく、契約上限への圧迫で決める。契約上限のこの割合以上を1行で占める
 * ファイルだけを返す。分母は getMediaStorageQuota と同じ計算元の
 * limitBytes を使い、要求値や画面内推定は使わない。既定10GBの0.1%は
 * 約10MBで、旧しきい値(画像8MB級)と同じ帯に寄せている。
 */
export const MEDIA_NEAR_LIMIT_SHARE = 0.001;

/** 保存先と別のLINEアカウントのメディアが本文に含まれる。 */
export class MediaReferenceAccountError extends Error {
  constructor() {
    super('MEDIA_REFERENCE_ACCOUNT_MISMATCH');
    this.name = 'MediaReferenceAccountError';
  }
}

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
    /**
     * アーカイブの扱い。既定 'exclude'（一覧・選択には出さない）。
     * 'only' はアーカイブ済みだけ、'all' は全部。
     */
    archived?: 'exclude' | 'only' | 'all';
    sort?: 'newest' | 'oldest' | 'name' | 'size' | 'usage';
    limit?: number;
    offset?: number;
  },
): Promise<Media[]> {
  const conditions: string[] = ['m.line_account_id = ?'];
  const values: unknown[] = [opts.lineAccountId];
  if (opts.archived === 'only') conditions.push('m.archived_at IS NOT NULL');
  else if (opts.archived !== 'all') conditions.push('m.archived_at IS NULL');
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
  if (opts.archived === 'only') conditions.push('m.archived_at IS NOT NULL');
  else if (opts.archived !== 'all') conditions.push('m.archived_at IS NULL');
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
  input: {
    expectedRevision?: number;
    filename?: string;
    folderId?: string | null;
    usageExpiresAt?: string | null;
    usageConsentNote?: string | null;
  },
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
  // 利用期限・同意の記録は明示指定されたときだけ書き換える。
  // null は「記録を消す」で、未記録＝不明へ戻す。
  if ('usageExpiresAt' in input) {
    sets.push('usage_expires_at = ?');
    values.push(input.usageExpiresAt ?? null);
  }
  if ('usageConsentNote' in input) {
    sets.push('usage_consent_note = ?');
    values.push(input.usageConsentNote ?? null);
  }
  if (sets.length > 0) {
    sets.push('revision = revision + 1');
    values.push(id, lineAccountId);
    if (input.expectedRevision !== undefined) values.push(input.expectedRevision);
    const result = await db.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = ? AND line_account_id = ?${input.expectedRevision === undefined ? '' : ' AND revision = ?'}`).bind(...values).run();
    if (Number(result.meta?.changes ?? 0) !== 1) return null;
  }
  return getMediaById(db, id, lineAccountId);
}

export async function deleteMedia(db: D1Database, id: string, lineAccountId: string): Promise<void> {
  await db.prepare(`DELETE FROM media WHERE id = ? AND line_account_id = ?`).bind(id, lineAccountId).run();
}

/**
 * メディアのアーカイブ／復元。
 *
 * 退避は消去ではない。本文・過去配信・テンプレートからの参照はそのまま
 * 使え、一覧と新規選択からだけ隠す。
 *
 * 失敗しても中間状態を残さない決まり:
 * - UPDATE の WHERE で現在の状態を条件にする。並行する同じ操作や逆向き
 *   操作に負けたら 0 件で引き返し、監査行は書かない（書き込み0）。
 * - 状態を変えたあとで監査の書き込みが落ちたら、自分が立てた値だけを
 *   条件に逆 UPDATE で巻き戻す。巻き戻せなければ失敗として投げる。
 */
export async function setMediaArchiveState(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    archive: boolean;
    actorId: string | null;
    reason: string;
    now?: string;
  },
): Promise<MediaArchiveResult> {
  const now = input.now ?? jstNow();
  const existing = await db
    .prepare(`SELECT * FROM media WHERE id = ? AND line_account_id = ?`)
    .bind(input.id, input.lineAccountId)
    .first<Media>();
  if (!existing) return { status: 'not_found' };
  const isArchived = existing.archived_at !== null && existing.archived_at !== undefined;
  if (input.archive && isArchived) return { status: 'already_archived' };
  if (!input.archive && !isArchived) return { status: 'already_active' };

  const updated = input.archive
    ? await db.prepare(
        `UPDATE media SET archived_at = ?, archived_by = ?, archive_reason = ?
          WHERE id = ? AND line_account_id = ? AND archived_at IS NULL`,
      ).bind(now, input.actorId, input.reason, input.id, input.lineAccountId).run()
    : await db.prepare(
        `UPDATE media SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
          WHERE id = ? AND line_account_id = ? AND archived_at IS NOT NULL`,
      ).bind(input.id, input.lineAccountId).run();
  if ((updated.meta?.changes ?? 0) === 0) {
    // 先読みとの間に逆向き操作が入った。何も書いていない。
    return { status: input.archive ? 'already_archived' : 'already_active' };
  }

  try {
    await db.prepare(
      `INSERT INTO operation_audit (id, target_kind, target_id, action, actor_id, friend_id, detail_json)
       VALUES (?, 'media', ?, ?, ?, NULL, ?)`,
    ).bind(
      crypto.randomUUID(),
      input.id,
      input.archive ? 'archived' : 'restored',
      input.actorId,
      JSON.stringify({
        reason: input.reason,
        before: input.archive ? 'active' : 'archived',
        after: input.archive ? 'archived' : 'active',
        archived_at: input.archive ? now : existing.archived_at ?? null,
        archived_by: input.archive ? input.actorId : existing.archived_by ?? null,
        line_account_id: input.lineAccountId,
      }),
    ).run();
  } catch (error) {
    // 監査なしの状態変更を残さない。自分が書いた値だけを条件に戻すので、
    // 他の操作で変わった行は触らない。
    const reverted = input.archive
      ? await db.prepare(
          `UPDATE media SET archived_at = NULL, archived_by = NULL, archive_reason = NULL
            WHERE id = ? AND archived_at = ? AND archived_by IS ? AND archive_reason IS ?`,
        ).bind(input.id, now, input.actorId, input.reason).run()
      : await db.prepare(
          `UPDATE media SET archived_at = ?, archived_by = ?, archive_reason = ?
            WHERE id = ? AND archived_at IS NULL`,
        ).bind(existing.archived_at ?? null, existing.archived_by ?? null,
          existing.archive_reason ?? null, input.id).run();
    if ((reverted.meta?.changes ?? 0) === 0) {
      console.error(JSON.stringify({"code":"src_media_failed"}));
    }
    throw error;
  }

  const media = await getMediaById(db, input.id, input.lineAccountId);
  return { status: input.archive ? 'archived' : 'restored', media: media! };
}

/** メディアを一覧・新規選択から退避する。理由は必須（あとから追えるように）。 */
export async function archiveMedia(
  db: D1Database,
  input: { id: string; lineAccountId: string; actorId: string | null; reason: string; now?: string },
): Promise<MediaArchiveResult> {
  return setMediaArchiveState(db, { ...input, archive: true });
}

/** 退避したメディアを一覧へ戻す。 */
export async function restoreMedia(
  db: D1Database,
  input: { id: string; lineAccountId: string; actorId: string | null; reason: string; now?: string },
): Promise<MediaArchiveResult> {
  return setMediaArchiveState(db, { ...input, archive: false });
}
