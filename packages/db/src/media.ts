import { jstNow } from './utils.js';

const LOOKUP_CHUNK = 90;

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
}

export interface MediaUsage {
  media_id: string;
  ref_kind: string;
  ref_id: string;
  scanned_at: string;
}

export async function getMedia(
  db: D1Database,
  opts: { kind?: MediaKind; folderId?: string; limit?: number } = {},
): Promise<Media[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
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
    .prepare(`SELECT * FROM media ${where} ORDER BY created_at DESC LIMIT ?`)
    .bind(...values)
    .all<Media>();
  return result.results;
}

export async function getMediaById(db: D1Database, id: string): Promise<Media | null> {
  return db.prepare(`SELECT * FROM media WHERE id = ?`).bind(id).first<Media>();
}

export async function createMedia(
  db: D1Database,
  input: {
    kind: MediaKind;
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
         (id, folder_id, kind, filename, mime_type, size_bytes, width, height,
          duration_ms, r2_key, public_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
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
  return (await getMediaById(db, id))!;
}

export async function updateMedia(
  db: D1Database,
  id: string,
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
    values.push(id);
    await db.prepare(`UPDATE media SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
  }
  return getMediaById(db, id);
}

export async function deleteMedia(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM media WHERE id = ?`).bind(id).run();
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
