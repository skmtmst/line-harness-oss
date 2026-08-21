const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OutboundChannel = 'line' | 'email';

export type OutboundReservation =
  | { kind: 'acquired' }
  | { kind: 'retry' }
  | { kind: 'replay'; responseId: string }
  | { kind: 'in_progress' }
  | { kind: 'conflict' };

export function isValidIdempotencyKey(value: string | undefined): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export async function hashOutboundPayload(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * 外部送信の前にキーを予約する。
 *
 * LINE は同じキーを X-Line-Retry-Key にも渡せるため、処理途中の再試行を
 * 許可してよい。メールは上流に同等の保証がないため、結果不明の処理は
 * 再送せず in_progress のまま止める。
 */
export async function reserveOutboundSend(
  db: D1Database,
  args: {
    key: string;
    channel: OutboundChannel;
    resourceId: string;
    payloadHash: string;
    retryInProgress: boolean;
    now: string;
  },
): Promise<OutboundReservation> {
  const inserted = await db
    .prepare(
      `INSERT OR IGNORE INTO outbound_send_requests
         (idempotency_key, channel, resource_id, payload_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'in_progress', ?, ?)`,
    )
    .bind(args.key, args.channel, args.resourceId, args.payloadHash, args.now, args.now)
    .run();
  if ((inserted.meta?.changes ?? 0) === 1) return { kind: 'acquired' };

  const row = await db
    .prepare(
      `SELECT channel, resource_id, payload_hash, status, response_id
         FROM outbound_send_requests WHERE idempotency_key = ?`,
    )
    .bind(args.key)
    .first<{
      channel: OutboundChannel;
      resource_id: string;
      payload_hash: string;
      status: 'in_progress' | 'succeeded';
      response_id: string | null;
    }>();

  // INSERT が競合したのに行を確認できない場合も、再送せず安全側で止める。
  if (!row) return { kind: 'in_progress' };
  if (
    row.channel !== args.channel ||
    row.resource_id !== args.resourceId ||
    row.payload_hash !== args.payloadHash
  ) {
    return { kind: 'conflict' };
  }
  if (row.status === 'succeeded' && row.response_id) {
    return { kind: 'replay', responseId: row.response_id };
  }
  return args.retryInProgress ? { kind: 'retry' } : { kind: 'in_progress' };
}

/** 同じ D1 batch に送信ログとこの更新を入れ、記録の片落ちを防ぐ。 */
export function completeOutboundSendStatement(
  db: D1Database,
  args: { key: string; responseId: string; now: string },
): D1PreparedStatement {
  return db
    .prepare(
      `UPDATE outbound_send_requests
          SET status = 'succeeded', response_id = ?, completed_at = ?, updated_at = ?
        WHERE idempotency_key = ? AND status = 'in_progress'`,
    )
    .bind(args.responseId, args.now, args.now, args.key);
}
