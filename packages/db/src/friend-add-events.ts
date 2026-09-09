import { jstNow, toJstString } from './utils.js';

export type FriendAddKind = 'first_time' | 'returning';
export type FriendAddAttributionStatus = 'captured' | 'unavailable';
export type FriendAddCandidateSource = 'line_login' | 'liff' | 'short_link';
export type FriendAddCandidateStatus = 'pending' | 'consumed' | 'expired' | 'late';
export type FriendAddRoutingStatus = 'pending' | 'completed' | 'failed' | 'suppressed' | 'partial_failed';

export interface FriendAddAttributionCandidate {
  id: string;
  lineAccountId: string;
  friendId: string;
  refCode: string;
  entryRouteId: string | null;
  source: FriendAddCandidateSource;
  status: FriendAddCandidateStatus;
  occurredAt: string;
  expiresAt: string;
}

export interface FriendAddEventListItem {
  id: string;
  friendId: string;
  displayName: string | null;
  pictureUrl: string | null;
  kind: FriendAddKind;
  isUnblockedHint: boolean | null;
  attributionStatus: FriendAddAttributionStatus;
  refCode: string | null;
  entryRouteId: string | null;
  entryRouteName: string | null;
  routingStatus: FriendAddRoutingStatus;
  occurredAt: string;
  processedAt: string | null;
}

export interface FriendAddEventSummary {
  total: number;
  firstTime: number;
  returning: number;
  captured: number;
  unavailable: number;
  pending: number;
  failed: number;
}

export interface FriendAddEventListResult {
  items: FriendAddEventListItem[];
  summary: FriendAddEventSummary;
  nextCursor: string | null;
}

function addMinutes(value: string, minutes: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  date.setMinutes(date.getMinutes() + minutes);
  return toJstString(date);
}

export async function recordFriendAddAttributionCandidate(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    refCode: string;
    entryRouteId?: string | null;
    source: FriendAddCandidateSource;
    occurredAt?: string;
  },
): Promise<FriendAddAttributionCandidate> {
  const occurredAt = input.occurredAt ?? jstNow();
  const refCode = input.refCode.trim();
  if (!refCode || refCode.startsWith('xh:')) {
    throw new Error('friend_add_candidate_invalid_ref');
  }

  await db.prepare(
    `UPDATE friend_add_attribution_candidates
        SET status = 'expired'
      WHERE line_account_id = ? AND friend_id = ? AND status = 'pending' AND expires_at < ?`,
  ).bind(input.lineAccountId, input.friendId, occurredAt).run();

  const recent = await db.prepare(
    `SELECT id, line_account_id, friend_id, ref_code, entry_route_id, source, status,
            occurred_at, expires_at
       FROM friend_add_attribution_candidates
      WHERE line_account_id = ? AND friend_id = ? AND ref_code = ? AND source = ?
        AND status = 'pending' AND expires_at >= ?
      ORDER BY occurred_at DESC LIMIT 1`,
  ).bind(input.lineAccountId, input.friendId, refCode, input.source, occurredAt)
    .first<{
      id: string; line_account_id: string; friend_id: string; ref_code: string;
      entry_route_id: string | null; source: FriendAddCandidateSource;
      status: FriendAddCandidateStatus; occurred_at: string; expires_at: string;
    }>();
  if (recent) return mapCandidate(recent);

  const lateEvent = await db.prepare(
    `SELECT id FROM friend_add_events
      WHERE line_account_id = ? AND friend_id = ? AND attribution_status = 'unavailable'
        AND routing_status != 'pending'
        AND occurred_at >= ? AND occurred_at <= ?
      ORDER BY occurred_at DESC LIMIT 1`,
  ).bind(input.lineAccountId, input.friendId, addMinutes(occurredAt, -2), occurredAt)
    .first<{ id: string }>();

  const id = crypto.randomUUID();
  const status: FriendAddCandidateStatus = lateEvent ? 'late' : 'pending';
  const expiresAt = addMinutes(occurredAt, 10);
  await db.prepare(
    `INSERT INTO friend_add_attribution_candidates
      (id, line_account_id, friend_id, ref_code, entry_route_id, source, status,
       occurred_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.lineAccountId, input.friendId, refCode, input.entryRouteId ?? null,
    input.source, status, occurredAt, expiresAt,
  ).run();

  return {
    id, lineAccountId: input.lineAccountId, friendId: input.friendId, refCode,
    entryRouteId: input.entryRouteId ?? null, source: input.source, status,
    occurredAt, expiresAt,
  };
}

export async function recordFriendAddEvent(
  db: D1Database,
  input: {
    lineAccountId: string;
    friendId: string;
    webhookEventId: string;
    friendKind: FriendAddKind;
    isUnblockedHint?: boolean | null;
    occurredAt: string;
  },
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT OR IGNORE INTO friend_add_events
      (id, line_account_id, friend_id, webhook_event_id, friend_kind,
       is_unblocked_hint, attribution_status, routing_status, occurred_at)
     VALUES (?, ?, ?, ?, ?, ?, 'unavailable', 'pending', ?)`,
  ).bind(
    id, input.lineAccountId, input.friendId, input.webhookEventId, input.friendKind,
    input.isUnblockedHint == null ? null : (input.isUnblockedHint ? 1 : 0), input.occurredAt,
  ).run();
  const row = await db.prepare(
    `SELECT id FROM friend_add_events WHERE line_account_id = ? AND webhook_event_id = ?`,
  ).bind(input.lineAccountId, input.webhookEventId).first<{ id: string }>();
  if (!row) throw new Error('friend_add_event_insert_failed');
  return row.id;
}

/** 最新の未使用候補を、対象イベントへ一度だけ結び付ける。 */
export async function captureFriendAddEventAttribution(
  db: D1Database,
  input: { eventId: string; lineAccountId: string; friendId: string; now?: string },
): Promise<{ refCode: string; entryRouteId: string | null } | null> {
  const now = input.now ?? jstNow();
  const existing = await db.prepare(
    `SELECT attribution_status, ref_code, entry_route_id
       FROM friend_add_events
      WHERE id = ? AND line_account_id = ? AND friend_id = ?`,
  ).bind(input.eventId, input.lineAccountId, input.friendId).first<{
    attribution_status: FriendAddAttributionStatus;
    ref_code: string | null;
    entry_route_id: string | null;
  }>();
  if (existing?.attribution_status === 'captured' && existing.ref_code) {
    return { refCode: existing.ref_code, entryRouteId: existing.entry_route_id };
  }

  await db.prepare(
    `UPDATE friend_add_attribution_candidates SET status = 'expired'
      WHERE line_account_id = ? AND friend_id = ? AND status = 'pending' AND expires_at < ?`,
  ).bind(input.lineAccountId, input.friendId, now).run();

  const candidate = await db.prepare(
    `SELECT id, ref_code, entry_route_id
       FROM friend_add_attribution_candidates
      WHERE line_account_id = ? AND friend_id = ? AND status = 'pending' AND expires_at >= ?
      ORDER BY occurred_at DESC LIMIT 1`,
  ).bind(input.lineAccountId, input.friendId, now)
    .first<{ id: string; ref_code: string; entry_route_id: string | null }>();
  if (!candidate) return null;

  const claimed = await db.prepare(
    `UPDATE friend_add_attribution_candidates
        SET status = 'consumed', consumed_by_event_id = ?
      WHERE id = ? AND line_account_id = ? AND friend_id = ? AND status = 'pending'`,
  ).bind(input.eventId, candidate.id, input.lineAccountId, input.friendId).run();
  if ((claimed.meta?.changes ?? 0) !== 1) return null;

  await db.prepare(
    `UPDATE friend_add_events
        SET attribution_status = 'captured', ref_code = ?, entry_route_id = ?, candidate_id = ?
      WHERE id = ? AND line_account_id = ? AND friend_id = ?`,
  ).bind(
    candidate.ref_code, candidate.entry_route_id, candidate.id,
    input.eventId, input.lineAccountId, input.friendId,
  ).run();
  return { refCode: candidate.ref_code, entryRouteId: candidate.entry_route_id };
}

/**
 * 送信権の予約の有効期間（分）。処理が終われば予約を消すので、残るのは
 * 処理中に落ちたときだけ。その予約は古くなれば奪い直せる。
 * 通常の処理は数秒で終わるため、2分でも余裕がある。
 */
export const FRIEND_ADD_SEND_CLAIM_TTL_MINUTES = 2;

/**
 * 別webhook IDで並行に届いたfollowの二重送信を防ぐ送信権の予約。
 * (line_account_id, friend_id) に1行だけ置き、先に置いた実行だけが送る。
 */
export interface FriendAddSendClaim {
  /** 送ってよいか。 */
  held: boolean;
  /**
   * 奪い直したとき、**前の持ち主が外部送信を始めた印が残っていた**か。
   * true なら送ったかもしれないので、奪った側は送らない（送達不明）。
   * 送り直すと同じ人へ2通届く。
   */
  previousDispatchUnknown: boolean;
  /**
   * 予約の世代。回収（奪い直し）のたびに1つ進む。外部送信・アクション・
   * 台帳の確定はすべて (event_id, generation) の組で持ち主を確かめてから
   * 行う。回収された古い持ち主はここで弾かれる（fencing）。
   * 取れなかったときは 0。
   */
  generation: number;
}

/**
 * 送信権の予約を**1文の CAS（compare-and-set）**で取る。
 *
 * 空いていれば置く。誰かの予約があっても、古い（TTL超過）ときだけ
 * 自分の event_id へ書き換えて世代を1つ進める。**取れた行そのものを
 * RETURNING で受け取る**ので、「置いた」あとに別の実行が奪って、
 * その世代を自分のものと読み違える隙が無い。
 *
 * 予約表が読めないときは投げる。呼ぶ側は送らない（fail-closed）。
 * ここで「送ってよい」に倒すと、fencing の無い実行が二重送信する。
 */
export async function claimFriendAddSendRight(
  db: D1Database,
  input: { lineAccountId: string; friendId: string; eventId: string; now?: string },
): Promise<FriendAddSendClaim> {
  const now = input.now ?? jstNow();
  const cutoff = addMinutes(now, -FRIEND_ADD_SEND_CLAIM_TTL_MINUTES);
  const won = await db.prepare(
    `INSERT INTO friend_add_send_claims
       (line_account_id, friend_id, event_id, generation, claimed_at, dispatched_at)
     VALUES (?, ?, ?, 1, ?, NULL)
     ON CONFLICT (line_account_id, friend_id) DO UPDATE
        SET event_id = excluded.event_id,
            generation = friend_add_send_claims.generation + 1,
            claimed_at = excluded.claimed_at
      WHERE friend_add_send_claims.claimed_at < ?
     RETURNING event_id, generation, dispatched_at`,
  ).bind(input.lineAccountId, input.friendId, input.eventId, now, cutoff)
    .first<{ event_id: string; generation: number; dispatched_at: string | null }>();
  // 他人の予約が生きている（DO UPDATE の WHERE が偽）ときは行が返らない。
  if (!won || won.event_id !== input.eventId) {
    return { held: false, generation: 0, previousDispatchUnknown: false };
  }
  /*
   * 奪い直したときに前の持ち主の「送り始めた」印が残っていたら、
   * その実行は送ったかもしれない。予約は持てても送らない。
   * DO UPDATE で dispatched_at を触らないのは、この判断のために残すため。
   */
  return {
    held: true,
    generation: won.generation,
    previousDispatchUnknown: won.dispatched_at != null,
  };
}

/**
 * まだ予約の持ち主かを確かめ、**同じ1文で貸出期限を延ばす**（heartbeat）。
 *
 * 外部送信の直前に必ず通す。確認と延長を別の文に分けると、確認して
 * から送っている最中に期限切れとみなされ、別の実行に奪われる。奪った側も
 * 送るため、同じ人に2通届く。TTL より長くかかる送信でも、この1文を
 * くぐるたびに期限が延びるので奪われない。
 *
 * 戻り値 false は「もう持ち主ではない」。呼ぶ側は外部効果を行わない。
 */
export async function touchFriendAddSendClaim(
  db: D1Database,
  input: {
    lineAccountId: string; friendId: string; eventId: string;
    generation: number; now?: string;
    /**
     * これから外部へ送る場合は true。予約に「送り始めた」印を立てる。
     * 途中で消えても、奪った側がこの印を見て送らないようにするため。
     * DBだけを触る効果（登録・アクション）では立てない。
     */
    markDispatching?: boolean;
  },
): Promise<boolean> {
  if (!Number.isInteger(input.generation) || input.generation < 1) return false;
  const now = input.now ?? jstNow();
  const result = await db.prepare(
    `UPDATE friend_add_send_claims
        SET claimed_at = ?,
            dispatched_at = CASE WHEN ? = 1 THEN COALESCE(dispatched_at, ?) ELSE dispatched_at END
      WHERE line_account_id = ? AND friend_id = ? AND event_id = ? AND generation = ?`,
  ).bind(
    now, input.markDispatching ? 1 : 0, now,
    input.lineAccountId, input.friendId, input.eventId, input.generation,
  ).run();
  return (result.meta?.changes ?? 0) === 1;
}

/**
 * 使い終わった予約を消す。**自分の event_id と世代の行だけ**消す。
 * 回収で世代が進んでいたら（別の持ち主の行になっていたら）消さない。
 */
export async function releaseFriendAddSendRight(
  db: D1Database,
  input: { lineAccountId: string; friendId: string; eventId: string; generation: number },
): Promise<void> {
  if (!Number.isInteger(input.generation) || input.generation < 1) return;
  await db.prepare(
    `DELETE FROM friend_add_send_claims
      WHERE line_account_id = ? AND friend_id = ? AND event_id = ? AND generation = ?`,
  ).bind(input.lineAccountId, input.friendId, input.eventId, input.generation).run();
}

/**
 * 台帳の確定。
 *
 * `fence` を渡すと、**同じ1文の中で**送信権の予約（event_id と世代）を
 * 突き合わせ、持ち主でなければ1行も書かない。確かめてから書く2文にすると
 * その隙に回収されることがあり、回収後の古い持ち主が結果を上書きできる。
 *
 * 戻り値は書けたかどうか。false は「持ち主でなくなっていた」を表す。
 */
export async function markFriendAddEventRouting(
  db: D1Database,
  input: {
    eventId: string;
    lineAccountId: string;
    status: FriendAddRoutingStatus;
    routingRuleId?: string | null;
    winningRuleVersionId?: string | null;
    errorCode?: string | null;
    scenarioEnrollmentId?: string | null;
    deliveryCount?: number;
    fence?: { friendId: string; generation: number };
  },
): Promise<boolean> {
  const fence = input.fence;
  const fenceSql = fence
    ? ` AND EXISTS (SELECT 1 FROM friend_add_send_claims c
                     WHERE c.line_account_id = ? AND c.friend_id = ?
                       AND c.event_id = ? AND c.generation = ?)`
    : '';
  const bindings: unknown[] = [
    input.status,
    input.routingRuleId ?? null,
    input.winningRuleVersionId ?? null,
    input.errorCode ?? null,
    input.scenarioEnrollmentId ?? null,
    Math.max(0, Math.floor(input.deliveryCount ?? 0)),
    Math.max(0, Math.floor(input.deliveryCount ?? 0)),
    jstNow(),
    jstNow(),
    input.eventId,
    input.lineAccountId,
  ];
  if (fence) {
    bindings.push(input.lineAccountId, fence.friendId, input.eventId, fence.generation);
  }
  const result = await db.prepare(
    `UPDATE friend_add_events
        SET routing_status = ?, routing_rule_id = ?, winning_rule_version_id = ?,
            error_code = ?, scenario_enrollment_id = ?, delivery_count = ?,
            first_delivery_sent_at = CASE
              WHEN ? > 0 THEN COALESCE(first_delivery_sent_at, ?)
              ELSE first_delivery_sent_at
            END,
            processed_at = ?
      WHERE id = ? AND line_account_id = ?${fenceSql}`,
  ).bind(...bindings).run();
  if ((result.meta?.changes ?? 0) !== 1) return false;
  // 取得待ちを閉じた直後に届いた候補を、次回の再追加へ持ち越さない。
  await db.prepare(
    `UPDATE friend_add_attribution_candidates
        SET status = 'late'
      WHERE line_account_id = ? AND status = 'pending'
        AND friend_id = (SELECT friend_id FROM friend_add_events WHERE id = ? AND line_account_id = ?)
        AND occurred_at >= (SELECT occurred_at FROM friend_add_events WHERE id = ? AND line_account_id = ?)`,
  ).bind(
    input.lineAccountId, input.eventId, input.lineAccountId,
    input.eventId, input.lineAccountId,
  ).run();
  return true;
}

export async function listFriendAddEvents(
  db: D1Database,
  input: {
    lineAccountId: string;
    limit?: number;
    cursor?: string | null;
    kind?: FriendAddKind;
    attributionStatus?: FriendAddAttributionStatus;
    routingStatus?: FriendAddRoutingStatus;
  },
): Promise<FriendAddEventListResult> {
  const limit = Math.max(1, Math.min(input.limit ?? 50, 100));
  const clauses = ['e.line_account_id = ?'];
  const bindings: Array<string | number> = [input.lineAccountId];
  if (input.cursor) { clauses.push('e.occurred_at < ?'); bindings.push(input.cursor); }
  if (input.kind) { clauses.push('e.friend_kind = ?'); bindings.push(input.kind); }
  if (input.attributionStatus) { clauses.push('e.attribution_status = ?'); bindings.push(input.attributionStatus); }
  if (input.routingStatus) { clauses.push('e.routing_status = ?'); bindings.push(input.routingStatus); }
  bindings.push(limit + 1);

  const result = await db.prepare(
    `SELECT e.id, e.friend_id, f.display_name, f.picture_url, e.friend_kind,
            e.is_unblocked_hint, e.attribution_status, e.ref_code, e.entry_route_id,
            er.name AS entry_route_name, e.routing_status, e.occurred_at, e.processed_at
       FROM friend_add_events e
       JOIN friends f ON f.id = e.friend_id AND f.line_account_id = e.line_account_id
       LEFT JOIN entry_routes er ON er.id = e.entry_route_id
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.occurred_at DESC, e.id DESC LIMIT ?`,
  ).bind(...bindings).all<{
    id: string; friend_id: string; display_name: string | null; picture_url: string | null;
    friend_kind: FriendAddKind; is_unblocked_hint: number | null;
    attribution_status: FriendAddAttributionStatus; ref_code: string | null;
    entry_route_id: string | null; entry_route_name: string | null;
    routing_status: FriendAddRoutingStatus; occurred_at: string; processed_at: string | null;
  }>();
  const rows = result.results ?? [];
  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);

  const summary = await db.prepare(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN friend_kind = 'first_time' THEN 1 ELSE 0 END) AS first_time,
            SUM(CASE WHEN friend_kind = 'returning' THEN 1 ELSE 0 END) AS returning_count,
            SUM(CASE WHEN attribution_status = 'captured' THEN 1 ELSE 0 END) AS captured,
            SUM(CASE WHEN attribution_status = 'unavailable' THEN 1 ELSE 0 END) AS unavailable,
            SUM(CASE WHEN routing_status = 'pending' THEN 1 ELSE 0 END) AS pending,
            SUM(CASE WHEN routing_status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM friend_add_events WHERE line_account_id = ?`,
  ).bind(input.lineAccountId).first<{
    total: number; first_time: number | null; returning_count: number | null;
    captured: number | null; unavailable: number | null; pending: number | null; failed: number | null;
  }>();

  return {
    items: page.map((row) => ({
      id: row.id, friendId: row.friend_id, displayName: row.display_name,
      pictureUrl: row.picture_url, kind: row.friend_kind,
      isUnblockedHint: row.is_unblocked_hint == null ? null : row.is_unblocked_hint === 1,
      attributionStatus: row.attribution_status, refCode: row.ref_code,
      entryRouteId: row.entry_route_id, entryRouteName: row.entry_route_name,
      routingStatus: row.routing_status, occurredAt: row.occurred_at, processedAt: row.processed_at,
    })),
    summary: {
      total: summary?.total ?? 0, firstTime: summary?.first_time ?? 0,
      returning: summary?.returning_count ?? 0, captured: summary?.captured ?? 0,
      unavailable: summary?.unavailable ?? 0, pending: summary?.pending ?? 0,
      failed: summary?.failed ?? 0,
    },
    nextCursor: hasMore ? (page.at(-1)?.occurred_at ?? null) : null,
  };
}

function mapCandidate(row: {
  id: string; line_account_id: string; friend_id: string; ref_code: string;
  entry_route_id: string | null; source: FriendAddCandidateSource;
  status: FriendAddCandidateStatus; occurred_at: string; expires_at: string;
}): FriendAddAttributionCandidate {
  return {
    id: row.id, lineAccountId: row.line_account_id, friendId: row.friend_id,
    refCode: row.ref_code, entryRouteId: row.entry_route_id, source: row.source,
    status: row.status, occurredAt: row.occurred_at, expiresAt: row.expires_at,
  };
}
