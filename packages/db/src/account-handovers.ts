import { jstNow } from './utils.js';

/**
 * LINEアカウントの乗り換え（引き継ぎ）。設計 ★V6 33-4（`nx3XW`）。台帳 #133。
 *
 * **`account_migrations` とは別物。** あちらは友だちを別のアカウントへ移す表。
 * こちらは「2つのアカウントをコードでつなぎ、突合してから本実行する」5段の流れ。
 */

export const HANDOVER_STATUSES = [
  'code_issued',
  'linked',
  'previewed',
  'resolved',
  'executing',
  'completed',
  'failed',
  'cancelled',
] as const;
export type HandoverStatus = (typeof HANDOVER_STATUSES)[number];

/** 事前確認の4区分。設計の言葉と1対1。 */
export const MATCH_BUCKETS = ['auto', 'review', 'unmatched', 'lookalike'] as const;
export type MatchBucket = (typeof MATCH_BUCKETS)[number];

export type ProviderMatch = 'same' | 'different' | 'unknown';

export interface HandoverRow {
  id: string;
  from_account_id: string;
  to_account_id: string | null;
  code: string;
  code_expires_at: string;
  status: HandoverStatus;
  provider_match: ProviderMatch;
  source_friend_total: number | null;
  auto_count: number | null;
  review_count: number | null;
  unmatched_count: number | null;
  lookalike_count: number | null;
  moved_count: number;
  failed_count: number;
  failure_reason: string | null;
  created_by: string | null;
  created_at: string;
  linked_at: string | null;
  previewed_at: string | null;
  resolved_at: string | null;
  executed_at: string | null;
  completed_at: string | null;
}

export interface HandoverDecisionRow {
  id: string;
  handover_id: string;
  from_friend_id: string;
  to_friend_id: string | null;
  decision: 'link' | 'new' | 'skip';
  bucket: MatchBucket;
  note: string | null;
  decided_by: string | null;
  decided_at: string;
}

export interface MatchCounts {
  auto: number;
  review: number;
  unmatched: number;
  lookalike: number;
}

/**
 * 4区分の合計が元の友だち数と合っているか。
 *
 * **合わない結果を保存しない。** 出すと、運用者は「どこかの人が消えた」と読む。
 * 画面側（`handover-view.ts` の `totalsMatch`）と同じ決まりを、口の側でも守る。
 */
export function countsAddUp(counts: MatchCounts, sourceTotal: number): boolean {
  return counts.auto + counts.review + counts.unmatched + counts.lookalike === sourceTotal;
}

/**
 * プロバイダーが同じか。
 *
 * **分からないことを「同じ」と書かない。** LINE の Messaging API は
 * プロバイダーを返さないので、どちらかが未入力なら `unknown` にする。
 * `unknown` のまま進めると、事前確認で「一致しない」が大量に出た理由が
 * 分からなくなるので、画面はその断りを出す。
 */
export function compareProviders(
  fromProviderId: string | null | undefined,
  toProviderId: string | null | undefined,
): ProviderMatch {
  if (!fromProviderId || !toProviderId) return 'unknown';
  return fromProviderId === toProviderId ? 'same' : 'different';
}

/** 引き継ぎコード。読み違えやすい文字（0/O、1/I/L）は使わない。 */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateHandoverCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < 12; i += 1) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  }
  return code;
}

/** 段1。コードを出す。既に生きているコードがあればそれを返す（二重に出さない）。 */
export async function issueHandoverCode(
  db: D1Database,
  input: { fromAccountId: string; createdBy?: string | null; ttlMinutes?: number },
): Promise<HandoverRow> {
  const existing = await db
    .prepare(
      `SELECT * FROM account_handovers
        WHERE from_account_id = ? AND status = 'code_issued' AND code_expires_at > ?
        ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(input.fromAccountId, jstNow())
    .first<HandoverRow>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const now = jstNow();
  const expires = new Date(Date.now() + (input.ttlMinutes ?? 60) * 60_000).toISOString();
  await db
    .prepare(
      `INSERT INTO account_handovers (id, from_account_id, code, code_expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.fromAccountId, generateHandoverCode(), expires, input.createdBy ?? null, now)
    .run();
  return (await getHandoverById(db, id))!;
}

export async function getHandoverById(db: D1Database, id: string): Promise<HandoverRow | null> {
  return db.prepare(`SELECT * FROM account_handovers WHERE id = ?`).bind(id).first<HandoverRow>();
}

export async function getHandoverByCode(db: D1Database, code: string): Promise<HandoverRow | null> {
  return db
    .prepare(`SELECT * FROM account_handovers WHERE code = ?`)
    .bind(code)
    .first<HandoverRow>();
}

/** 段2。受け取り先で読む。**期限切れのコードは通さない。** */
export async function linkHandover(
  db: D1Database,
  input: { code: string; toAccountId: string; providerMatch: ProviderMatch },
): Promise<{ ok: true; handover: HandoverRow } | { ok: false; error: string }> {
  const handover = await getHandoverByCode(db, input.code);
  if (!handover) return { ok: false, error: 'そのコードはありません' };
  if (handover.status !== 'code_issued') return { ok: false, error: 'そのコードはもう使われています' };
  if (handover.code_expires_at <= jstNow()) return { ok: false, error: 'そのコードは期限が切れています' };
  if (handover.from_account_id === input.toAccountId) {
    return { ok: false, error: '同じアカウントへは引き継げません' };
  }
  const now = jstNow();
  await db
    .prepare(
      `UPDATE account_handovers
          SET to_account_id = ?, provider_match = ?, status = 'linked', linked_at = ?
        WHERE id = ?`,
    )
    .bind(input.toAccountId, input.providerMatch, now, handover.id)
    .run();
  return { ok: true, handover: (await getHandoverById(db, handover.id))! };
}

/**
 * 段3。事前確認の結果を保存する。
 *
 * **合計が合わないものは保存しない。** 保存すると、画面がそれを出してしまう。
 * また **ここでは元のアカウントを何も変えない**（設計の「ここで止めても、
 * 元のアカウントは何も変わりません」）。この関数が触るのは `account_handovers`
 * の数の列だけで、`friends` には一切書かない。
 */
export async function savePreview(
  db: D1Database,
  id: string,
  input: { sourceFriendTotal: number; counts: MatchCounts },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!countsAddUp(input.counts, input.sourceFriendTotal)) {
    return { ok: false, error: '区分の合計が元の友だち数と合いません' };
  }
  await db
    .prepare(
      `UPDATE account_handovers
          SET source_friend_total = ?, auto_count = ?, review_count = ?,
              unmatched_count = ?, lookalike_count = ?,
              status = 'previewed', previewed_at = ?
        WHERE id = ?`,
    )
    .bind(
      input.sourceFriendTotal,
      input.counts.auto,
      input.counts.review,
      input.counts.unmatched,
      input.counts.lookalike,
      jstNow(),
      id,
    )
    .run();
  return { ok: true };
}

/** 段4。競合の判断を1件保存する。同じ人を2回決めたら上書きする。 */
export async function saveDecision(
  db: D1Database,
  input: {
    handoverId: string;
    fromFriendId: string;
    toFriendId?: string | null;
    decision: 'link' | 'new' | 'skip';
    bucket: MatchBucket;
    note?: string | null;
    decidedBy?: string | null;
  },
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO account_handover_decisions
         (id, handover_id, from_friend_id, to_friend_id, decision, bucket, note, decided_by, decided_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (handover_id, from_friend_id) DO UPDATE SET
         to_friend_id = excluded.to_friend_id,
         decision = excluded.decision,
         bucket = excluded.bucket,
         note = excluded.note,
         decided_by = excluded.decided_by,
         decided_at = excluded.decided_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.handoverId,
      input.fromFriendId,
      input.toFriendId ?? null,
      input.decision,
      input.bucket,
      input.note ?? null,
      input.decidedBy ?? null,
      now,
    )
    .run();
}

export async function listDecisions(
  db: D1Database,
  handoverId: string,
): Promise<HandoverDecisionRow[]> {
  const result = await db
    .prepare(`SELECT * FROM account_handover_decisions WHERE handover_id = ? ORDER BY decided_at`)
    .bind(handoverId)
    .all<HandoverDecisionRow>();
  return result.results;
}

/**
 * 段4が終わったか。
 *
 * **「要確認」を全部決めるまで本実行できない。** 決めていない人がいるまま
 * 進めると、その人がどちらにも入らずに消える。
 */
export async function unresolvedReviewCount(db: D1Database, id: string): Promise<number | null> {
  const handover = await getHandoverById(db, id);
  if (!handover || handover.review_count === null) return null;
  const decided = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM account_handover_decisions
        WHERE handover_id = ? AND bucket = 'review'`,
    )
    .bind(id)
    .first<{ c: number }>();
  return handover.review_count - (decided?.c ?? 0);
}

export async function markResolved(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE account_handovers SET status = 'resolved', resolved_at = ? WHERE id = ?`)
    .bind(jstNow(), id)
    .run();
}

/** 段5。本実行の始まり。 */
export async function markExecuting(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE account_handovers SET status = 'executing', executed_at = ? WHERE id = ?`)
    .bind(jstNow(), id)
    .run();
}

/** 段5。本実行の終わりと照合。 */
export async function completeHandover(
  db: D1Database,
  id: string,
  result: { movedCount: number; failedCount: number; failureReason?: string | null },
): Promise<void> {
  const status = result.failedCount > 0 ? 'failed' : 'completed';
  await db
    .prepare(
      `UPDATE account_handovers
          SET moved_count = ?, failed_count = ?, failure_reason = ?, status = ?, completed_at = ?
        WHERE id = ?`,
    )
    .bind(result.movedCount, result.failedCount, result.failureReason ?? null, status, jstNow(), id)
    .run();
}

export async function cancelHandover(db: D1Database, id: string): Promise<void> {
  await db
    .prepare(`UPDATE account_handovers SET status = 'cancelled' WHERE id = ?`)
    .bind(id)
    .run();
}

export async function listHandoversForAccount(
  db: D1Database,
  accountId: string,
): Promise<HandoverRow[]> {
  const result = await db
    .prepare(
      `SELECT * FROM account_handovers
        WHERE from_account_id = ? OR to_account_id = ?
        ORDER BY created_at DESC`,
    )
    .bind(accountId, accountId)
    .all<HandoverRow>();
  return result.results;
}
