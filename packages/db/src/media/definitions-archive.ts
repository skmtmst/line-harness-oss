import { logger } from '@line-crm/shared/server';
import { jstNow } from '../utils.js';
import { type Media, type MediaArchiveResult } from './primitives.js';
import { getMediaById } from './definitions-reads.js';


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
      logger.error("src_media_failed");
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
