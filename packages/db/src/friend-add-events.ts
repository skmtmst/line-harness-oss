import { jstNow, toJstString } from './utils.js';

export type FriendAddKind = 'first_time' | 'returning';
export type FriendAddAttributionStatus = 'captured' | 'unavailable';
export type FriendAddCandidateSource = 'line_login' | 'liff' | 'short_link';
export type FriendAddCandidateStatus = 'pending' | 'consumed' | 'expired' | 'late';
export type FriendAddRoutingStatus = 'pending' | 'completed' | 'failed' | 'suppressed';

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

export async function markFriendAddEventRouting(
  db: D1Database,
  input: { eventId: string; lineAccountId: string; status: FriendAddRoutingStatus; routingRuleId?: string | null },
): Promise<void> {
  await db.prepare(
    `UPDATE friend_add_events
        SET routing_status = ?, routing_rule_id = ?, processed_at = ?
      WHERE id = ? AND line_account_id = ?`,
  ).bind(input.status, input.routingRuleId ?? null, jstNow(), input.eventId, input.lineAccountId).run();
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
