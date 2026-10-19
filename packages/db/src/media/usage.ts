import { jstNow } from '../utils.js';
import { type MediaRefKind } from './primitives.js';
import { type MediaUsageScanState } from './types.js';
import { MEDIA_USAGE_WRITE_CHUNK, LOOKUP_CHUNK } from './definitions.js';


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
