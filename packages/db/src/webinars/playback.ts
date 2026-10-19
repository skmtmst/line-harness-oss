import { jstNow } from '../utils.js';
import { type WebinarHeartbeatPlayerState, type WebinarHeartbeatRejectReason, type WebinarHeartbeatInput, type WebinarHeartbeatResult, type WebinarViewSegmentCoverage, type WebinarHeartbeatOptions, type WebinarRetentionPoint } from './types.js';


export const WEBINAR_HEARTBEAT_PLAYER_STATES: readonly WebinarHeartbeatPlayerState[] = [
  'playing', 'paused', 'hidden', 'buffering', 'seeking',
];

/** heartbeat の送信間隔（秒）。再生中だけ15秒ごとに送る（J #821）。 */
export const WEBINAR_HEARTBEAT_WINDOW_SECONDS = 15;

/** 有効な視聴区間の合計がこの秒数以上で「視聴開始」とする（J #821）。 */
export const WEBINAR_VIEW_START_SECONDS = 30;

/** 離脱・維持率の集計バケット（秒）。設計 J-1 の「いちばん離れた所 12〜15分」に合わせる。 */
export const WEBINAR_RETENTION_BUCKET_SECONDS = 60;

export function parseWebinarHeartbeatPlayerState(
  value: unknown,
): WebinarHeartbeatPlayerState | null {
  if (value === undefined || value === null || value === '') return 'playing';
  return (WEBINAR_HEARTBEAT_PLAYER_STATES as readonly string[]).includes(String(value))
    ? (String(value) as WebinarHeartbeatPlayerState)
    : null;
}

export async function insertWebinarHeartbeatReject(
  db: D1Database,
  input: {
    webinarId: string;
    friendId: string;
    sessionStartAt: number;
    reason: WebinarHeartbeatRejectReason;
    positionSeconds: number;
  },
): Promise<void> {
  await db.prepare(
    `INSERT INTO webinar_heartbeat_rejects
       (id, webinar_id, friend_id, session_start_at, reason, position_seconds, received_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(), input.webinarId, input.friendId, input.sessionStartAt,
    input.reason, input.positionSeconds, jstNow(),
  ).run();
}

/**
 * heartbeat を1件受け付ける（J #821）。
 *
 * - 基準はサーバー受信時刻。クライアント申告の時刻は記録だけで判定に使わない。
 * - 再生中（playing）だけ有効な視聴区間を作る。一時停止・非表示・
 *   読み込み待ちの時間は視聴に数えない。
 * - 位置の移動中（seeking）は区間を作らず位置だけ進める（移動の跳びを異常にしない）。
 * - 再生中の位置の進みが「経過時間の2倍」を超えたら異常として除外し、
 *   理由を残す（速度再生は速度ぶんだけ上限を広げる）。
 */
export async function recordWebinarHeartbeat(
  db: D1Database,
  input: WebinarHeartbeatInput,
): Promise<WebinarHeartbeatResult> {
  const receivedAt = Math.floor(input.receivedAtEpoch ?? Date.now() / 1000);
  const rate = input.playbackRate ?? 1;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 4) {
    await insertWebinarHeartbeatReject(db, {
      webinarId: input.webinarId,
      friendId: input.friendId,
      sessionStartAt: input.sessionStartAt,
      reason: 'invalid_rate',
      positionSeconds: input.positionSeconds,
    });
    return { status: 'rejected', reason: 'invalid_rate' };
  }
  const state = parseWebinarHeartbeatPlayerState(input.playerState) ?? 'playing';

  let viewer = await db.prepare(
    `SELECT last_position_seconds, last_heartbeat_at
       FROM webinar_viewers
      WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
  ).bind(input.webinarId, input.friendId, input.sessionStartAt)
    .first<{ last_position_seconds: number; last_heartbeat_at: number | null }>();
  if (!viewer) {
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds, last_heartbeat_at)
       VALUES (?, ?, ?, ?, ?, 0, NULL)`,
    ).bind(
      crypto.randomUUID(), input.webinarId, input.friendId,
      input.sessionStartAt, jstNow(),
    ).run();
    viewer = { last_position_seconds: 0, last_heartbeat_at: null };
  }

  const touchHeartbeat = async (position: number | null) => {
    if (position === null) {
      await db.prepare(
        `UPDATE webinar_viewers SET last_heartbeat_at = ?
          WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
      ).bind(receivedAt, input.webinarId, input.friendId, input.sessionStartAt).run();
    } else {
      await db.prepare(
        `UPDATE webinar_viewers
            SET last_position_seconds = MAX(last_position_seconds, ?),
                last_heartbeat_at = ?
          WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`,
      ).bind(position, receivedAt, input.webinarId, input.friendId, input.sessionStartAt).run();
    }
  };

  // 位置の移動中は跳びが当然なので、異常にせず位置だけ進める。
  if (state === 'seeking') {
    await touchHeartbeat(input.positionSeconds);
    return { status: 'moved' };
  }
  // 一時停止・非表示・読み込み待ちは視聴に数えない。受信時刻だけ進める。
  if (state !== 'playing') {
    await touchHeartbeat(null);
    return { status: 'not_counted' };
  }

  const elapsed = viewer.last_heartbeat_at === null
    ? null
    : Math.max(0, receivedAt - viewer.last_heartbeat_at);
  const delta = input.positionSeconds - viewer.last_position_seconds;
  if (elapsed !== null) {
    const bound = 2 * elapsed * Math.max(1, rate);
    if (delta > bound || delta < -bound) {
      await insertWebinarHeartbeatReject(db, {
        webinarId: input.webinarId,
        friendId: input.friendId,
        sessionStartAt: input.sessionStartAt,
        reason: delta > bound ? 'position_jump' : 'negative_gap',
        positionSeconds: input.positionSeconds,
      });
      // 時刻だけ進め、異常な位置を基準にしない。次回は長い経過で判定する。
      await touchHeartbeat(null);
      return { status: 'rejected', reason: delta > bound ? 'position_jump' : 'negative_gap' };
    }
  }
  await recordWebinarViewSegment(db, input.webinarId, input.friendId, input.sessionStartAt, input.positionSeconds, {
    playbackRate: rate,
    clientAtMs: input.clientAtMs ?? null,
    windowSeconds: WEBINAR_HEARTBEAT_WINDOW_SECONDS,
  });
  await touchHeartbeat(input.positionSeconds);
  return { status: 'recorded' };
}

/** 異常として除外した heartbeat の件数。異常値警告の母数にする。 */
export async function countWebinarHeartbeatRejects(
  db: D1Database,
  webinarId: string,
): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*) AS n FROM webinar_heartbeat_rejects WHERE webinar_id = ?`,
  ).bind(webinarId).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function getWebinarViewSegmentCoverage(
  db: D1Database,
  webinarId: string,
): Promise<WebinarViewSegmentCoverage[]> {
  const result = await db.prepare(
    `SELECT start_seconds, end_seconds, COUNT(DISTINCT friend_id) AS viewers
       FROM webinar_view_segments
      WHERE webinar_id = ?
      GROUP BY start_seconds, end_seconds
      ORDER BY start_seconds, end_seconds`,
  ).bind(webinarId).all<WebinarViewSegmentCoverage>();
  return result.results ?? [];
}

/**
 * ハートビート間の実視聴区間を冪等に記録する。
 * 既定の窓は heartbeat の送信間隔（15秒）。5引数の呼び出しは
 * 従来どおり30秒窓で動く（後方互換）。
 */
export async function recordWebinarViewSegment(
  db: D1Database,
  webinarId: string,
  friendId: string,
  sessionStartAt: number,
  positionSeconds: number,
  options?: WebinarHeartbeatOptions,
): Promise<void> {
  const windowSeconds = Math.max(1, Math.floor(options?.windowSeconds ?? 30));
  const endSeconds = Math.max(1, Math.floor(positionSeconds));
  const startSeconds = Math.max(0, endSeconds - windowSeconds);
  const idempotencyKey = `${webinarId}:${friendId}:${sessionStartAt}:${startSeconds}:${endSeconds}`;
  const rate = options?.playbackRate ?? 1;
  const clientAtMs = options?.clientAtMs ?? null;
  try {
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_view_segments
         (id, webinar_id, friend_id, session_start_at, start_seconds, end_seconds,
          received_at, idempotency_key, playback_rate, client_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, friendId, sessionStartAt,
      startSeconds, endSeconds, jstNow(), idempotencyKey, rate, clientAtMs,
    ).run();
  } catch {
    // 507 より前の DB（列が無い）では従来の8列で入れる。
    await db.prepare(
      `INSERT OR IGNORE INTO webinar_view_segments
         (id, webinar_id, friend_id, session_start_at, start_seconds, end_seconds,
          received_at, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), webinarId, friendId, sessionStartAt,
      startSeconds, endSeconds, jstNow(), idempotencyKey,
    ).run();
  }
}

/**
 * 重なる区間を束ね、重複時間を足さない合計秒数を返す（J #821）。
 * 同じ区間の再送は呼び出し前に冪等キーで1行になっている前提。
 */
export async function getWebinarWatchedSeconds(db: D1Database, webinarId: string, friendId: string, sessionStartAt: number): Promise<number> {
  const { results } = await db.prepare(`SELECT start_seconds, end_seconds FROM webinar_view_segments
    WHERE webinar_id = ? AND friend_id = ? AND session_start_at = ?`)
    .bind(webinarId, friendId, sessionStartAt).all<{ start_seconds: number; end_seconds: number }>();
  return mergeWebinarWatchedSeconds(results);
}

export function mergeWebinarWatchedSeconds(
  intervals: Array<{ start_seconds: number; end_seconds: number }>,
): number {
  const sorted = intervals
    .filter((item) => item.end_seconds > item.start_seconds)
    .sort((a, b) => a.start_seconds - b.start_seconds || a.end_seconds - b.end_seconds);
  let total = 0;
  let cursorStart: number | null = null;
  let cursorEnd = 0;
  for (const item of sorted) {
    if (cursorStart === null || item.start_seconds > cursorEnd) {
      if (cursorStart !== null) total += cursorEnd - cursorStart;
      cursorStart = item.start_seconds;
      cursorEnd = item.end_seconds;
    } else if (item.end_seconds > cursorEnd) {
      cursorEnd = item.end_seconds;
    }
  }
  if (cursorStart !== null) total += cursorEnd - cursorStart;
  return total;
}

/**
 * 視聴開始した人（有効な区間の合計が閾値以上）の人数（J #821）。
 * 一時停止・非表示の時間は区間が無いので数えない。
 */
export async function countWebinarStartedViewers(
  db: D1Database,
  webinarId: string,
  thresholdSeconds = WEBINAR_VIEW_START_SECONDS,
): Promise<number> {
  const { results } = await db.prepare(
    `SELECT friend_id, start_seconds, end_seconds
       FROM webinar_view_segments
      WHERE webinar_id = ?
      ORDER BY friend_id, start_seconds, end_seconds`,
  ).bind(webinarId).all<{ friend_id: string; start_seconds: number; end_seconds: number }>();
  const byFriend = new Map<string, Array<{ start_seconds: number; end_seconds: number }>>();
  for (const row of results ?? []) {
    const list = byFriend.get(row.friend_id) ?? [];
    list.push({ start_seconds: row.start_seconds, end_seconds: row.end_seconds });
    byFriend.set(row.friend_id, list);
  }
  let started = 0;
  for (const intervals of byFriend.values()) {
    if (mergeWebinarWatchedSeconds(intervals) >= thresholdSeconds) started += 1;
  }
  return started;
}

/**
 * 維持率の線の材料（J-1）。各バケットを見ていた人（区間が被る人）の数。
 * 分母は視聴開始した人の数。割合の計算は画面側で行う。
 */
export async function getWebinarRetention(
  db: D1Database,
  webinarId: string,
  bucketSeconds = WEBINAR_RETENTION_BUCKET_SECONDS,
): Promise<{ bucketSeconds: number; started: number; points: WebinarRetentionPoint[] }> {
  const { results } = await db.prepare(
    `SELECT friend_id, start_seconds, end_seconds
       FROM webinar_view_segments
      WHERE webinar_id = ?`,
  ).bind(webinarId).all<{ friend_id: string; start_seconds: number; end_seconds: number }>();
  const rows = results ?? [];
  const byFriend = new Map<string, Array<{ start_seconds: number; end_seconds: number }>>();
  for (const row of rows) {
    const list = byFriend.get(row.friend_id) ?? [];
    list.push({ start_seconds: row.start_seconds, end_seconds: row.end_seconds });
    byFriend.set(row.friend_id, list);
  }
  let started = 0;
  const watching = new Map<number, Set<string>>();
  let maxEnd = 0;
  for (const [friendId, intervals] of byFriend) {
    if (mergeWebinarWatchedSeconds(intervals) >= WEBINAR_VIEW_START_SECONDS) started += 1;
    const merged: Array<{ start: number; end: number }> = [];
    const sorted = intervals
      .filter((item) => item.end_seconds > item.start_seconds)
      .sort((a, b) => a.start_seconds - b.start_seconds);
    for (const item of sorted) {
      const last = merged[merged.length - 1];
      if (!last || item.start_seconds > last.end) merged.push({ start: item.start_seconds, end: item.end_seconds });
      else if (item.end_seconds > last.end) last.end = item.end_seconds;
    }
    for (const span of merged) {
      maxEnd = Math.max(maxEnd, span.end);
      const fromBucket = Math.floor(span.start / bucketSeconds);
      const toBucket = Math.floor((span.end - 1) / bucketSeconds);
      for (let bucket = fromBucket; bucket <= toBucket; bucket += 1) {
        const set = watching.get(bucket) ?? new Set<string>();
        set.add(friendId);
        watching.set(bucket, set);
      }
    }
  }
  const bucketCount = maxEnd > 0 ? Math.floor((maxEnd - 1) / bucketSeconds) + 1 : 0;
  const points: WebinarRetentionPoint[] = [];
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    points.push({ at_seconds: bucket * bucketSeconds, viewers: watching.get(bucket)?.size ?? 0 });
  }
  return { bucketSeconds, started, points };
}
