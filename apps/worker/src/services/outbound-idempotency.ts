const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LEASE_MS = 60_000;

export type OutboundChannel = 'line' | 'email';
export type OutboundFailureStatus = 'failed' | 'unknown';

export type OutboundReservation =
  | { kind: 'acquired'; leaseToken: string }
  | { kind: 'retry'; leaseToken: string }
  | { kind: 'replay'; responseId: string }
  | { kind: 'in_progress' }
  | { kind: 'failed'; code: string; retryable: boolean; nextRetryAt: string | null }
  | { kind: 'unknown'; code: string }
  | { kind: 'conflict' };

export type OutboundFailureClassification = {
  status: OutboundFailureStatus;
  code: string;
  retryable: boolean;
  nextRetryAt: string | null;
  httpStatus: 400 | 429 | 502 | 503;
};

type OutboundRow = {
  channel: OutboundChannel;
  resource_id: string;
  payload_hash: string;
  line_account_id: string | null;
  status: 'in_progress' | 'succeeded' | 'failed' | 'unknown';
  response_id: string | null;
  failure_code: string | null;
  retryable: number;
  next_retry_at: string | null;
  lease_token: string | null;
};

export type OutboundFailureListItem = {
  idempotencyKey: string;
  resourceId: string;
  status: OutboundFailureStatus;
  failureCode: string;
  attemptCount: number;
  retryable: boolean;
  nextRetryAt: string | null;
  lastFailedAt: string;
  updatedAt: string;
};

export function isValidIdempotencyKey(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export async function hashOutboundPayload(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function leaseExpiry(now: string): string {
  const parsed = Date.parse(now);
  return new Date((Number.isFinite(parsed) ? parsed : Date.now()) + LEASE_MS).toISOString();
}

async function readOutboundRow(db: D1Database, key: string): Promise<OutboundRow | null> {
  return db
    .prepare(
      `SELECT channel, resource_id, payload_hash, line_account_id, status, response_id,
              failure_code, retryable, next_retry_at, lease_token
         FROM outbound_send_requests WHERE idempotency_key = ?`,
    )
    .bind(key)
    .first<OutboundRow>();
}

function matchingReservation(
  row: OutboundRow,
  args: { channel: OutboundChannel; resourceId: string; payloadHash: string; lineAccountId?: string | null },
): boolean {
  return row.channel === args.channel
    && row.resource_id === args.resourceId
    && row.payload_hash === args.payloadHash
    && (args.lineAccountId == null || row.line_account_id === args.lineAccountId);
}

/**
 * 外部送信の直前にキーを予約する。
 *
 * failed のうち retryable かつ再試行時刻を過ぎた行だけを CAS で取得する。
 * unknown はLINE受理済みの可能性があるため、同じキーでも自動再送しない。
 * retryInProgress は古いLINE送信経路との互換用。個別送信は必ず false を渡す。
 */
export async function reserveOutboundSend(
  db: D1Database,
  args: {
    key: string;
    channel: OutboundChannel;
    resourceId: string;
    payloadHash: string;
    lineAccountId?: string | null;
    retryInProgress: boolean;
    now: string;
  },
): Promise<OutboundReservation> {
  const leaseToken = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO outbound_send_requests
         (idempotency_key, channel, resource_id, payload_hash, line_account_id, status,
          attempt_count, retryable, lease_token, lease_expires_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'in_progress', 1, 0, ?, ?, ?, ?)`,
    )
    .bind(
      args.key,
      args.channel,
      args.resourceId,
      args.payloadHash,
      args.lineAccountId ?? null,
      leaseToken,
      leaseExpiry(args.now),
      args.now,
      args.now,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) === 1) return { kind: 'acquired', leaseToken };

  const row = await readOutboundRow(db, args.key);
  if (!row) return { kind: 'in_progress' };
  if (!matchingReservation(row, args)) return { kind: 'conflict' };
  if (row.status === 'succeeded' && row.response_id) {
    return { kind: 'replay', responseId: row.response_id };
  }
  if (row.status === 'unknown') {
    return { kind: 'unknown', code: row.failure_code ?? 'DELIVERY_UNKNOWN' };
  }
  if (row.status === 'failed') {
    const retryable = row.retryable === 1;
    const due = row.next_retry_at == null || row.next_retry_at <= args.now;
    if (!retryable || !due) {
      return {
        kind: 'failed',
        code: row.failure_code ?? 'OUTBOUND_SEND_FAILED',
        retryable,
        nextRetryAt: row.next_retry_at,
      };
    }

    const retryLeaseToken = crypto.randomUUID();
    const claimed = await db.prepare(
      `UPDATE outbound_send_requests
          SET status = 'in_progress', failure_code = NULL, retryable = 0,
              next_retry_at = NULL, lease_token = ?, lease_expires_at = ?,
              attempt_count = attempt_count + 1, updated_at = ?
        WHERE idempotency_key = ?
          AND status = 'failed' AND retryable = 1
          AND (next_retry_at IS NULL OR next_retry_at <= ?)
          AND (? IS NULL OR line_account_id = ?)`,
    ).bind(
      retryLeaseToken,
      leaseExpiry(args.now),
      args.now,
      args.key,
      args.now,
      args.lineAccountId ?? null,
      args.lineAccountId ?? null,
    ).run();
    if ((claimed.meta?.changes ?? 0) === 1) {
      return { kind: 'retry', leaseToken: retryLeaseToken };
    }
    return { kind: 'in_progress' };
  }

  if (args.retryInProgress && row.lease_token) {
    return { kind: 'retry', leaseToken: row.lease_token };
  }
  return { kind: 'in_progress' };
}

/** 同じ D1 batch に送信ログとこの更新を入れ、記録の片落ちを防ぐ。 */
export function completeOutboundSendStatement(
  db: D1Database,
  args: { key: string; responseId: string; now: string; leaseToken?: string | null },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbound_send_requests
          SET status = 'succeeded', response_id = ?, completed_at = ?, updated_at = ?,
              failure_code = NULL, retryable = 0, next_retry_at = NULL,
              lease_token = NULL, lease_expires_at = NULL
        WHERE idempotency_key = ? AND status = 'in_progress'
          AND (? IS NULL OR lease_token = ?)`,
    )
    .bind(
      args.responseId,
      args.now,
      args.now,
      args.key,
      args.leaseToken ?? null,
      args.leaseToken ?? null,
    );
}

/** LINE呼出しまたは確定保存の失敗を、安全なcodeだけで確定する。 */
export async function failOutboundSend(
  db: D1Database,
  args: {
    key: string;
    leaseToken: string;
    status: OutboundFailureStatus;
    code: string;
    retryable: boolean;
    nextRetryAt: string | null;
    now: string;
  },
): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE outbound_send_requests
        SET status = ?, failure_code = ?, retryable = ?, next_retry_at = ?,
            last_failed_at = ?, updated_at = ?, lease_token = NULL, lease_expires_at = NULL
      WHERE idempotency_key = ? AND status = 'in_progress' AND lease_token = ?`,
  ).bind(
    args.status,
    args.code,
    args.retryable ? 1 : 0,
    args.nextRetryAt,
    args.now,
    args.now,
    args.key,
    args.leaseToken,
  ).run();
  return (result.meta?.changes ?? 0) === 1;
}

function retryAtFromHeader(value: unknown, now: string): string {
  const base = Number.isFinite(Date.parse(now)) ? Date.parse(now) : Date.now();
  const raw = typeof value === 'string' ? value.trim() : '';
  const seconds = Number(raw);
  if (raw && Number.isFinite(seconds) && seconds >= 0) {
    return new Date(base + Math.min(seconds, 86_400) * 1000).toISOString();
  }
  const date = Date.parse(raw);
  if (Number.isFinite(date) && date > base) return new Date(Math.min(date, base + 86_400_000)).toISOString();
  return new Date(base + 60_000).toISOString();
}

/** 例外本文は保存せず、HTTP状態だけから安全な失敗codeへ落とす。 */
export function classifyLineOutboundFailure(error: unknown, now: string): OutboundFailureClassification {
  const shaped = error as { status?: unknown; retryAfter?: unknown } | null;
  const status = typeof shaped?.status === 'number' ? shaped.status : null;
  if (status == null) {
    return {
      status: 'unknown',
      code: 'LINE_DELIVERY_UNKNOWN',
      retryable: false,
      nextRetryAt: null,
      httpStatus: 503,
    };
  }
  if (status === 429) {
    return {
      status: 'failed',
      code: 'LINE_RATE_LIMITED',
      retryable: true,
      nextRetryAt: retryAtFromHeader(shaped?.retryAfter, now),
      httpStatus: 429,
    };
  }
  if (status === 408 || status >= 500) {
    return {
      status: 'failed',
      code: 'LINE_TEMPORARILY_UNAVAILABLE',
      retryable: true,
      nextRetryAt: retryAtFromHeader(shaped?.retryAfter, now),
      httpStatus: 502,
    };
  }
  return {
    status: 'failed',
    code: 'LINE_REQUEST_REJECTED',
    retryable: false,
    nextRetryAt: null,
    httpStatus: 400,
  };
}

export async function listOutboundSendFailures(
  db: D1Database,
  args: { lineAccountId: string; limit: number },
): Promise<OutboundFailureListItem[]> {
  const result = await db.prepare(
    `SELECT idempotency_key, resource_id, status, failure_code, attempt_count,
            retryable, next_retry_at, last_failed_at, updated_at
       FROM outbound_send_requests
      WHERE line_account_id = ? AND status IN ('failed', 'unknown')
      ORDER BY updated_at DESC, idempotency_key DESC
      LIMIT ?`,
  ).bind(args.lineAccountId, args.limit).all<{
    idempotency_key: string;
    resource_id: string;
    status: OutboundFailureStatus;
    failure_code: string;
    attempt_count: number;
    retryable: number;
    next_retry_at: string | null;
    last_failed_at: string;
    updated_at: string;
  }>();
  return (result.results ?? []).map((row) => ({
    idempotencyKey: row.idempotency_key,
    resourceId: row.resource_id,
    status: row.status,
    failureCode: row.failure_code,
    attemptCount: row.attempt_count,
    retryable: row.retryable === 1,
    nextRetryAt: row.next_retry_at,
    lastFailedAt: row.last_failed_at,
    updatedAt: row.updated_at,
  }));
}
