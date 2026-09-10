import { jstNow, toJstString } from './utils.js';
import type { FriendAddCandidateSource } from './friend-add-events.js';

/**
 * N-244 抑止台帳。停止した流入経路への試行(refは停止済み)を、友だち追加の
 * follow webhook へ引き継ぐための記録。候補・friends.ref_code が無い
 * 別followでも、同一利用者の直近の停止試行を見て自然流入扱いにしない。
 *
 * - 鍵は (LINEアカウント, LINEユーザー)。友だち行が無い段階でも書ける。
 * - 行は有効期限(候補と同じ10分)で自然に失効する。消費はしない
 *   (Webhook再送・複数イベントでも抑止を保つため)。
 * - 明示の帰属(候補・既存ref_code)が勝つ。台帳は「帰属なし」の場合だけ見る。
 */
export interface EntryRouteStopSuppression {
  id: string;
  lineAccountId: string;
  lineUserId: string;
  friendId: string | null;
  refCode: string;
  source: FriendAddCandidateSource;
  occurredAt: string;
  expiresAt: string;
}

/** 候補の有効期間(10分)と合わせ、同一流入フローだけを抑止する。 */
export const STOP_SUPPRESSION_TTL_MINUTES = 10;

interface SuppressionRow {
  id: string;
  line_account_id: string;
  line_user_id: string;
  friend_id: string | null;
  ref_code: string;
  source: FriendAddCandidateSource;
  occurred_at: string;
  expires_at: string;
}

function mapSuppression(row: SuppressionRow): EntryRouteStopSuppression {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    lineUserId: row.line_user_id,
    friendId: row.friend_id,
    refCode: row.ref_code,
    source: row.source,
    occurredAt: row.occurred_at,
    expiresAt: row.expires_at,
  };
}

export async function recordEntryRouteStopSuppression(
  db: D1Database,
  input: {
    lineAccountId: string;
    lineUserId: string;
    friendId?: string | null;
    refCode: string;
    source: FriendAddCandidateSource;
    occurredAt?: string;
  },
): Promise<EntryRouteStopSuppression> {
  const occurredAt = input.occurredAt ?? jstNow();
  const refCode = input.refCode.trim();
  if (!refCode || refCode.startsWith('xh:')) {
    throw new Error('stop_suppression_invalid_ref');
  }

  // 重複排除はupsertに寄せる。早道のSELECTで返すと、有効期限の延長や
  // 友だち確定の埋め込みが効かなくなるため。
  const id = crypto.randomUUID();
  const expiresAt = toJstString(new Date(Date.now() + STOP_SUPPRESSION_TTL_MINUTES * 60_000));
  // 同一キーで同時に書いても1行に寄せる (upsert)。期限切れ後の再試行は
  // 有効期限を延ばし、分かっている友だちを埋める。最初に書いた行の
  // 発生日・由来は残す。
  await db
    .prepare(
      `INSERT INTO entry_route_stop_suppressions
        (id, line_account_id, line_user_id, friend_id, ref_code, source,
         occurred_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(line_account_id, line_user_id, ref_code) DO UPDATE SET
         friend_id = COALESCE(excluded.friend_id, entry_route_stop_suppressions.friend_id),
         expires_at = excluded.expires_at`,
    )
    .bind(
      id, input.lineAccountId, input.lineUserId, input.friendId ?? null,
      refCode, input.source, occurredAt, expiresAt,
    )
    .run();

  const written = await db
    .prepare(
      `SELECT id, line_account_id, line_user_id, friend_id, ref_code, source,
              occurred_at, expires_at
         FROM entry_route_stop_suppressions
        WHERE line_account_id = ? AND line_user_id = ? AND ref_code = ?
        ORDER BY occurred_at DESC LIMIT 1`,
    )
    .bind(input.lineAccountId, input.lineUserId, refCode)
    .first<SuppressionRow>();
  if (!written) throw new Error('stop_suppression_write_failed');
  return mapSuppression(written);
}

/** 有効期限内の直近の抑止があれば返す。無ければ null (通常フローへ)。 */
export async function getActiveEntryRouteStopSuppression(
  db: D1Database,
  input: { lineAccountId: string; lineUserId: string; now?: string },
): Promise<EntryRouteStopSuppression | null> {
  const now = input.now ?? jstNow();
  const row = await db
    .prepare(
      `SELECT id, line_account_id, line_user_id, friend_id, ref_code, source,
              occurred_at, expires_at
         FROM entry_route_stop_suppressions
        WHERE line_account_id = ? AND line_user_id = ? AND expires_at >= ?
        ORDER BY occurred_at DESC LIMIT 1`,
    )
    .bind(input.lineAccountId, input.lineUserId, now)
    .first<SuppressionRow>();
  return row ? mapSuppression(row) : null;
}
