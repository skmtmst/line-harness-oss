import { REVENUE_IMPACT_KEYS } from '@line-crm/shared';

export type EcOrderState = 'current' | 'refunded' | 'cancelled';
export type EcActionExecutionStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'skipped'
  | 'retryable_failed'
  | 'permanent_failed';

/*
 * IDEA-23: 失敗・見送りの理由を運用の言葉へ寄せる分類。
 * 「未連携／権限不足／通信失敗」を別々に出す完了条件に対応する。
 * 分類コード(error_code等の安全な値)からは classifyEcErrorCode、
 * 生のエラーメッセージ(台帳の last_error 等)からは classifyEcRawError を使う。
 * 生メッセージそのものは API の外へ出さない。
 */
export type EcFailureKind =
  | 'unlinked'       // LINEの友だちと結びついていない
  | 'not_following'  // 結びついた友だちが現在フォローしていない
  | 'permission'     // LINE連携の認証・アカウント設定の不備
  | 'communication'  // 一時的な通信・送信の失敗（自動または手動の再試行対象）
  | 'rejected'       // 送信内容・宛先の拒否
  | 'by_setting'     // 設定で意図的に送っていない
  | 'internal';      // 内部処理の失敗

/** 台帳へ保存済みの安全な分類コードを業務の分類へ写す。 */
export function classifyEcErrorCode(code: string | null | undefined): EcFailureKind | null {
  if (!code) return null;
  switch (code) {
    case 'line_identity_unmatched':
      return 'unlinked';
    case 'friend_not_following':
      return 'not_following';
    case 'notification_disabled':
      return 'by_setting';
    case 'line_authentication_failed':
    case 'line_account_not_found':
    case 'line_account_unavailable':
    case 'line_account_mismatch':
      return 'permission';
    case 'line_rejected':
      return 'rejected';
    case 'line_rate_limited':
    case 'line_temporary_failure':
    case 'delivery_failed':
      return 'communication';
    default:
      // read_model_failed / event_processing_failed / legacy_processing_failed など。
      return 'internal';
  }
}

/*
 * 購読台帳(ec_v6_dispatches)やフォロー配信(nen_delivery_jobs)の last_error は
 * 生のエラーメッセージが入ることがある。内容は出さず、HTTPステータスや
 * 一時障害語の痕跡だけで業務の分類へ寄せる。読み取れないものは内部失敗。
 */
export function classifyEcRawError(raw: string | null | undefined): EcFailureKind | null {
  if (!raw) return null;
  if (/\b(401|403)\b/.test(raw) || /unauthorized|forbidden|authentication/i.test(raw)) {
    return 'permission';
  }
  if (/\b(400|404|422)\b/.test(raw)) return 'rejected';
  if (
    /\b429\b/.test(raw)
    || /\b5\d{2}\b/.test(raw)
    || /timeout|timed out|network|socket|fetch|econn|eai_again/i.test(raw)
  ) {
    return 'communication';
  }
  return 'internal';
}

export const EC_ACTION_EXECUTION_STATUSES: ReadonlySet<EcActionExecutionStatus> = new Set([
  'pending', 'processing', 'succeeded', 'skipped', 'retryable_failed', 'permanent_failed',
]);

export interface EcReadModelEvent {
  eventId: string;
  sourceKey: string;
  externalEventId: string;
  eventType: string;
  lineAccountId: string;
  customerId: string | null;
  friendId?: string | null;
  occurredAt: string;
  order?: {
    number?: string;
    total?: number;
    currency?: string;
    date?: string;
    detail_url?: string | null;
    items?: Array<{
      product_id?: string | number | null;
      name: string;
      quantity: number;
      unit_amount?: number | null;
      line_amount?: number | null;
      product_url?: string | null;
    }>;
  };
  refund?: { amount?: number | null };
}

function actionType(eventType: string): string {
  if (eventType === 'ec.customer.profile_updated') return 'profile_sync';
  if (eventType === 'ec.order.refunded') return 'conversion_mileage_adjustment';
  return 'line_notification';
}

function orderState(eventType: string): EcOrderState {
  if (eventType === 'ec.order.refunded') return 'refunded';
  if (eventType === 'ec.order.cancelled') return 'cancelled';
  return 'current';
}

function integerOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null;
}

/** raw receiptを失わず、画面用の注文と再試行単位を冪等に作る。 */
export async function upsertEcEventReadModels(
  db: D1Database,
  event: EcReadModelEvent,
  now = new Date().toISOString(),
): Promise<void> {
  await db.prepare(
    `INSERT OR IGNORE INTO ec_action_executions
       (id, event_id, line_account_id, action_type, rule_version, idempotency_key,
        status, attempt_count, max_attempts, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'ec-action-v1', ?, 'pending', 0, 3, 1, ?, ?)`,
  ).bind(
    crypto.randomUUID(), event.eventId, event.lineAccountId, actionType(event.eventType),
    `ec:event:${event.eventId}:${actionType(event.eventType)}:v1`, now, now,
  ).run();

  const orderNumber = event.order?.number?.trim();
  if (!orderNumber) return;
  const proposedId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO ec_orders
       (id, line_account_id, source_key, external_order_id, customer_id, friend_id,
        order_number, normalized_status, provider_status, currency, total_amount_minor,
        refunded_amount_minor, ordered_at, detail_url, last_event_id, version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(line_account_id, source_key, external_order_id) DO UPDATE SET
       customer_id = COALESCE(excluded.customer_id, ec_orders.customer_id),
       friend_id = COALESCE(excluded.friend_id, ec_orders.friend_id),
       normalized_status = excluded.normalized_status,
       provider_status = excluded.provider_status,
       currency = excluded.currency,
       total_amount_minor = COALESCE(excluded.total_amount_minor, ec_orders.total_amount_minor),
       refunded_amount_minor = COALESCE(excluded.refunded_amount_minor, ec_orders.refunded_amount_minor),
       ordered_at = CASE WHEN excluded.ordered_at < ec_orders.ordered_at THEN excluded.ordered_at ELSE ec_orders.ordered_at END,
       detail_url = COALESCE(excluded.detail_url, ec_orders.detail_url),
       last_event_id = excluded.last_event_id,
       version = ec_orders.version + CASE WHEN ec_orders.last_event_id = excluded.last_event_id THEN 0 ELSE 1 END,
       updated_at = excluded.updated_at`,
  ).bind(
    proposedId, event.lineAccountId, event.sourceKey, orderNumber,
    event.customerId, event.friendId ?? null, orderNumber, orderState(event.eventType),
    event.eventType, event.order?.currency?.trim() || 'JPY',
    integerOrNull(event.order?.total), integerOrNull(event.refund?.amount),
    event.order?.date ?? event.occurredAt, event.order?.detail_url ?? null,
    event.eventId, now, now,
  ).run();

  const order = await db.prepare(
    `SELECT id FROM ec_orders
      WHERE line_account_id = ? AND source_key = ? AND external_order_id = ?`,
  ).bind(event.lineAccountId, event.sourceKey, orderNumber).first<{ id: string }>();
  if (!order || !Array.isArray(event.order?.items)) return;

  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM ec_order_lines WHERE order_id = ?').bind(order.id),
  ];
  event.order.items.slice(0, 100).forEach((item, index) => {
    const quantity = Math.max(1, Math.round(Number(item.quantity) || 1));
    const unitAmount = integerOrNull(item.unit_amount);
    statements.push(db.prepare(
      `INSERT INTO ec_order_lines
         (id, order_id, line_index, external_product_id, product_name, quantity,
          unit_amount_minor, line_amount_minor, product_url, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), order.id, index,
      item.product_id == null ? null : String(item.product_id),
      item.name.trim().slice(0, 200) || '商品', quantity, unitAmount,
      integerOrNull(item.line_amount) ?? (unitAmount === null ? null : unitAmount * quantity),
      item.product_url ?? null, now,
    ));
  });
  await db.batch(statements);
}

export async function attachEcOrderFriend(
  db: D1Database,
  input: { eventId: string; lineAccountId: string; friendId: string; now?: string },
): Promise<void> {
  await db.prepare(
    `UPDATE ec_orders SET friend_id = ?, updated_at = ?
      WHERE last_event_id = ? AND line_account_id = ?`,
  ).bind(input.friendId, input.now ?? new Date().toISOString(), input.eventId, input.lineAccountId).run();
}

type ActionRow = {
  id: string;
  event_id: string;
  line_account_id: string;
  action_type: string;
  rule_version: string;
  status: EcActionExecutionStatus;
  attempt_count: number;
  max_attempts: number;
  error_code: string | null;
  error_message_safe: string | null;
  last_attempted_at: string | null;
  next_retry_at: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

/**
 * 再試行の待ち時間（秒）。失敗回数が増えるほど待つが、上限で頭打ちにし、
 * ±10% のぶれを付けて同時刻の再試行が束にならないようにする。
 */
export function ecRetryDelaySeconds(attempt: number): number {
  const capped = Math.min(300 * 2 ** Math.max(0, attempt - 1), 7200);
  const jitter = 0.9 + Math.random() * 0.2;
  return Math.max(60, Math.round(capped * jitter));
}

export function ecRetryAt(nowIso: string, attempt: number): string {
  return new Date(new Date(nowIso).getTime() + ecRetryDelaySeconds(attempt) * 1000).toISOString();
}

export async function setEcActionExecutionStatus(
  db: D1Database,
  input: {
    eventId: string;
    lineAccountId: string;
    status: Exclude<EcActionExecutionStatus, 'pending' | 'processing'>;
    errorCode?: string | null;
    errorMessageSafe?: string | null;
    now?: string;
  },
): Promise<void> {
  const current = await db.prepare(
    `SELECT * FROM ec_action_executions WHERE event_id = ? AND line_account_id = ?`,
  ).bind(input.eventId, input.lineAccountId).first<ActionRow>();
  if (!current) return;
  const now = input.now ?? new Date().toISOString();
  // 失敗の報告は試行回数に数える。上限に達したら dead letter
  //（permanent_failed）へ倒し、それ以上は再試行しない。
  const failedReport = input.status === 'retryable_failed';
  const nextAttempt = failedReport ? Number(current.attempt_count || 0) + 1 : Number(current.attempt_count) || 0;
  const requestedStatus = failedReport && nextAttempt >= Number(current.max_attempts)
    ? 'permanent_failed'
    : input.status;
  const nextRetryAt = requestedStatus === 'retryable_failed' ? ecRetryAt(now, nextAttempt) : null;
  const update = db.prepare(
    `UPDATE ec_action_executions
        SET status = ?, attempt_count = ?,
            error_code = ?, error_message_safe = ?, last_attempted_at = ?, next_retry_at = ?,
            version = version + 1, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND version = ?`,
  ).bind(
    requestedStatus, nextAttempt, input.errorCode ?? null, input.errorMessageSafe ?? null,
    now, nextRetryAt, now, current.id, input.lineAccountId, current.version,
  );
  if (failedReport) {
    // 失敗のたびに試行の行を1行足す（監査のため閉じた行で残す）。
    await db.batch([
      update,
      db.prepare(
        `INSERT OR IGNORE INTO ec_action_execution_attempts
           (id, action_execution_id, attempt_number, trigger_kind, from_status, to_status,
            requested_by, idempotency_key, request_fingerprint, error_code, error_message_safe, created_at)
         VALUES (?, ?, ?, 'automatic', ?, ?, NULL, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), current.id, nextAttempt, current.status, requestedStatus,
        `automatic:${current.id}:${nextAttempt}`, `automatic:${current.id}:${nextAttempt}`,
        input.errorCode ?? null, input.errorMessageSafe ?? null, now,
      ),
    ]);
    return;
  }
  if (Number(current.attempt_count) === 0) {
    // 初回報告の記録も残す（成功・スキップのまま終わった試行を見せるため）。
    await db.batch([
      db.prepare(
        `UPDATE ec_action_executions
            SET status = ?, attempt_count = 1,
                error_code = ?, error_message_safe = ?, last_attempted_at = ?, next_retry_at = NULL,
                version = version + 1, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND version = ?`,
      ).bind(
        requestedStatus, input.errorCode ?? null, input.errorMessageSafe ?? null,
        now, now, current.id, input.lineAccountId, current.version,
      ),
      db.prepare(
        `INSERT OR IGNORE INTO ec_action_execution_attempts
           (id, action_execution_id, attempt_number, trigger_kind, from_status, to_status,
            requested_by, idempotency_key, request_fingerprint, error_code, error_message_safe, created_at)
         VALUES (?, ?, 1, 'automatic', 'pending', ?, NULL, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), current.id, requestedStatus,
        `automatic:${current.id}:1`, `automatic:${current.id}:1`,
        input.errorCode ?? null, input.errorMessageSafe ?? null, now,
      ),
    ]);
    return;
  }
  await db.batch([
    update,
    db.prepare(
      `UPDATE ec_action_execution_attempts
          SET to_status = ?, error_code = ?, error_message_safe = ?
        WHERE action_execution_id = ? AND attempt_number = ?`,
    ).bind(
      requestedStatus, input.errorCode ?? null, input.errorMessageSafe ?? null,
      current.id, Math.max(1, nextAttempt),
    ),
  ]);
}

export interface EcOrderReadModel {
  id: string;
  lineAccountId: string;
  externalOrderId: string;
  orderNumber: string;
  customerId: string | null;
  friendId: string | null;
  customerName: string | null;
  status: EcOrderState;
  providerStatus: string;
  currency: string;
  totalAmount: number | null;
  refundedAmount: number | null;
  orderedAt: string;
  detailUrl: string | null;
  version: number;
  orderLines: Array<{
    id: string;
    productId: string | null;
    productName: string;
    quantity: number;
    unitAmount: number | null;
    lineAmount: number | null;
    productUrl: string | null;
  }>;
}

export async function listEcOrders(
  db: D1Database,
  input: {
    lineAccountId: string;
    status?: EcOrderState | null;
    query?: string;
    limit: number;
    offset: number;
  },
): Promise<{
  items: EcOrderReadModel[];
  total: number;
  summary: { total: number; current: number; refunded: number; cancelled: number; totalAmount: number };
}> {
  const clauses = ['o.line_account_id = ?'];
  const bindings: Array<string | number> = [input.lineAccountId];
  if (input.status) {
    clauses.push('o.normalized_status = ?');
    bindings.push(input.status);
  }
  if (input.query) {
    clauses.push(`(o.order_number LIKE ? ESCAPE '\\' OR COALESCE(f.display_name, '') LIKE ? ESCAPE '\\')`);
    const escaped = input.query.replace(/[\\%_]/g, (value) => `\\${value}`);
    bindings.push(`%${escaped}%`, `%${escaped}%`);
  }
  const where = clauses.join(' AND ');
  const [rows, count, summary] = await Promise.all([
    db.prepare(
      `SELECT o.*, f.display_name AS customer_name
         FROM ec_orders o LEFT JOIN friends f ON f.id = o.friend_id
        WHERE ${where}
        ORDER BY o.ordered_at DESC, o.id DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, input.limit, input.offset).all<Record<string, unknown>>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM ec_orders o LEFT JOIN friends f ON f.id = o.friend_id WHERE ${where}`,
    ).bind(...bindings).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN normalized_status = 'current' THEN 1 ELSE 0 END) AS current_count,
              SUM(CASE WHEN normalized_status = 'refunded' THEN 1 ELSE 0 END) AS refunded_count,
              SUM(CASE WHEN normalized_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_count,
              COALESCE(SUM(total_amount_minor), 0) AS total_amount
         FROM ec_orders WHERE line_account_id = ?`,
    ).bind(input.lineAccountId).first<Record<string, number>>(),
  ]);
  const ids = rows.results.map((row) => String(row.id));
  const lineRows = ids.length
    ? await db.prepare(
      `SELECT * FROM ec_order_lines WHERE order_id IN (${ids.map(() => '?').join(',')})
        ORDER BY order_id, line_index`,
    ).bind(...ids).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const linesByOrder = new Map<string, EcOrderReadModel['orderLines']>();
  for (const line of lineRows.results) {
    const orderId = String(line.order_id);
    const lines = linesByOrder.get(orderId) ?? [];
    lines.push({
      id: String(line.id), productId: line.external_product_id == null ? null : String(line.external_product_id),
      productName: String(line.product_name), quantity: Number(line.quantity),
      unitAmount: line.unit_amount_minor == null ? null : Number(line.unit_amount_minor),
      lineAmount: line.line_amount_minor == null ? null : Number(line.line_amount_minor),
      productUrl: line.product_url == null ? null : String(line.product_url),
    });
    linesByOrder.set(orderId, lines);
  }
  return {
    items: rows.results.map((row) => ({
      id: String(row.id), lineAccountId: String(row.line_account_id),
      externalOrderId: String(row.external_order_id), orderNumber: String(row.order_number),
      customerId: row.customer_id == null ? null : String(row.customer_id),
      friendId: row.friend_id == null ? null : String(row.friend_id),
      customerName: row.customer_name == null ? null : String(row.customer_name),
      status: row.normalized_status as EcOrderState, providerStatus: String(row.provider_status),
      currency: String(row.currency),
      totalAmount: row.total_amount_minor == null ? null : Number(row.total_amount_minor),
      refundedAmount: row.refunded_amount_minor == null ? null : Number(row.refunded_amount_minor),
      orderedAt: String(row.ordered_at), detailUrl: row.detail_url == null ? null : String(row.detail_url),
      version: Number(row.version), orderLines: linesByOrder.get(String(row.id)) ?? [],
    })),
    total: Number(count?.count ?? 0),
    summary: {
      total: Number(summary?.total ?? 0), current: Number(summary?.current_count ?? 0),
      refunded: Number(summary?.refunded_count ?? 0), cancelled: Number(summary?.cancelled_count ?? 0),
      totalAmount: Number(summary?.total_amount ?? 0),
    },
  };
}

export interface EcActionExecutionReadModel {
  id: string;
  eventId: string;
  eventType: string;
  actionType: string;
  ruleVersion: string;
  status: EcActionExecutionStatus;
  attemptCount: number;
  maxAttempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastAttemptedAt: string | null;
  nextRetryAt: string | null;
  version: number;
  receivedAt: string;
  orderNumber: string | null;
  customerName: string | null;
  friendId: string | null;
  retryAvailable: boolean;
  /** 失敗・見送りの業務分類。正常・処理中は null。 */
  failureKind: EcFailureKind | null;
}

function actionReadModel(row: Record<string, unknown>): EcActionExecutionReadModel {
  const errorCode = row.error_code == null ? null : String(row.error_code);
  return {
    id: String(row.id), eventId: String(row.event_id), eventType: String(row.event_type),
    actionType: String(row.action_type), ruleVersion: String(row.rule_version),
    status: row.status as EcActionExecutionStatus, attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts), errorCode,
    failureKind: classifyEcErrorCode(errorCode),
    errorMessage: row.error_message_safe == null ? null : String(row.error_message_safe),
    lastAttemptedAt: row.last_attempted_at == null ? null : String(row.last_attempted_at),
    nextRetryAt: row.next_retry_at == null ? null : String(row.next_retry_at),
    version: Number(row.version), receivedAt: String(row.received_at),
    orderNumber: row.order_number == null ? null : String(row.order_number),
    customerName: row.customer_name == null ? null : String(row.customer_name),
    friendId: row.friend_id == null ? null : String(row.friend_id),
    retryAvailable: row.status === 'retryable_failed' && Number(row.attempt_count) < Number(row.max_attempts),
  };
}

export async function listEcActionExecutions(
  db: D1Database,
  input: {
    lineAccountId: string;
    eventId?: string | null;
    status?: EcActionExecutionStatus | null;
    statuses?: EcActionExecutionStatus[] | null;
    limit: number;
    offset: number;
  },
): Promise<{
  items: EcActionExecutionReadModel[];
  total: number;
  summary: Record<EcActionExecutionStatus, number>;
}> {
  const clauses = ['a.line_account_id = ?'];
  const bindings: Array<string | number> = [input.lineAccountId];
  if (input.eventId) { clauses.push('a.event_id = ?'); bindings.push(input.eventId); }
  if (input.status) { clauses.push('a.status = ?'); bindings.push(input.status); }
  const statuses = (input.statuses ?? []).filter((status) => EC_ACTION_EXECUTION_STATUSES.has(status));
  if (statuses.length > 0) {
    clauses.push(`a.status IN (${statuses.map(() => '?').join(',')})`);
    bindings.push(...statuses);
  }
  const where = clauses.join(' AND ');
  const [rows, count, summaryRows] = await Promise.all([
    db.prepare(
      `SELECT a.*, e.event_type, e.received_at, e.friend_id AS friend_id,
              json_extract(e.payload, '$.order.number') AS order_number,
              f.display_name AS customer_name
         FROM ec_action_executions a
         JOIN ec_events e ON e.id = a.event_id
         LEFT JOIN friends f ON f.id = e.friend_id
        WHERE ${where}
        ORDER BY e.received_at DESC, a.created_at DESC LIMIT ? OFFSET ?`,
    ).bind(...bindings, input.limit, input.offset).all<Record<string, unknown>>(),
    db.prepare(`SELECT COUNT(*) AS count FROM ec_action_executions a WHERE ${where}`)
      .bind(...bindings).first<{ count: number }>(),
    db.prepare(
      `SELECT status, COUNT(*) AS count FROM ec_action_executions
        WHERE line_account_id = ? GROUP BY status`,
    ).bind(input.lineAccountId).all<{ status: EcActionExecutionStatus; count: number }>(),
  ]);
  const summary: Record<EcActionExecutionStatus, number> = {
    pending: 0, processing: 0, succeeded: 0, skipped: 0, retryable_failed: 0, permanent_failed: 0,
  };
  for (const row of summaryRows.results) summary[row.status] = Number(row.count);
  return {
    items: rows.results.map(actionReadModel),
    total: Number(count?.count ?? 0), summary,
  };
}

export type RetryEcActionExecutionResult =
  | { kind: 'queued' | 'duplicate'; execution: EcActionExecutionReadModel }
  | { kind: 'not_found' }
  | { kind: 'changed' }
  | { kind: 'invalid_state'; status: EcActionExecutionStatus };

async function getActionExecutionForResult(
  db: D1Database,
  lineAccountId: string,
  id: string,
): Promise<EcActionExecutionReadModel | null> {
  const row = await db.prepare(
    `SELECT a.*, e.event_type, e.received_at, e.friend_id AS friend_id,
            json_extract(e.payload, '$.order.number') AS order_number,
            f.display_name AS customer_name
       FROM ec_action_executions a
       JOIN ec_events e ON e.id = a.event_id
       LEFT JOIN friends f ON f.id = e.friend_id
      WHERE a.id = ? AND a.line_account_id = ?`,
  ).bind(id, lineAccountId).first<Record<string, unknown>>();
  return row ? actionReadModel(row) : null;
}

export async function retryEcActionExecution(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestFingerprint: string;
    requestedBy: string;
    now?: string;
  },
): Promise<RetryEcActionExecutionResult> {
  const replay = await db.prepare(
    `SELECT at.request_fingerprint, at.action_execution_id
       FROM ec_action_execution_attempts at
       JOIN ec_action_executions a ON a.id = at.action_execution_id
      WHERE at.idempotency_key = ? AND a.line_account_id = ?`,
  ).bind(input.idempotencyKey, input.lineAccountId).first<{
    request_fingerprint: string; action_execution_id: string;
  }>();
  if (replay) {
    if (replay.request_fingerprint !== input.requestFingerprint || replay.action_execution_id !== input.id) {
      return { kind: 'changed' };
    }
    const execution = await getActionExecutionForResult(db, input.lineAccountId, input.id);
    return execution ? { kind: 'duplicate', execution } : { kind: 'not_found' };
  }
  const current = await db.prepare(
    `SELECT * FROM ec_action_executions WHERE id = ? AND line_account_id = ?`,
  ).bind(input.id, input.lineAccountId).first<ActionRow>();
  if (!current) return { kind: 'not_found' };
  if (Number(current.version) !== input.expectedVersion) return { kind: 'changed' };
  if (current.status !== 'retryable_failed' || Number(current.attempt_count) >= Number(current.max_attempts)) {
    return { kind: 'invalid_state', status: current.status };
  }
  const now = input.now ?? new Date().toISOString();
  const attemptNumber = Number(current.attempt_count) + 1;
  const updated = await db.prepare(
    `UPDATE ec_action_executions
        SET status = 'pending', attempt_count = ?, error_code = NULL, error_message_safe = NULL,
            next_retry_at = ?, version = version + 1, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND version = ? AND status = 'retryable_failed'`,
  ).bind(attemptNumber, now, now, input.id, input.lineAccountId, input.expectedVersion).run();
  if (Number(updated.meta.changes ?? 0) !== 1) return { kind: 'changed' };
  await db.batch([
    db.prepare(
      `INSERT INTO ec_action_execution_attempts
         (id, action_execution_id, attempt_number, trigger_kind, from_status, to_status,
          requested_by, idempotency_key, request_fingerprint, created_at)
       VALUES (?, ?, ?, 'manual', 'retryable_failed', 'pending', ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), input.id, attemptNumber, input.requestedBy,
      input.idempotencyKey, input.requestFingerprint, now,
    ),
    db.prepare(
      `UPDATE ec_events SET status = 'received', error_message = NULL, updated_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'failed'`,
    ).bind(now, current.event_id, input.lineAccountId),
  ]);
  const execution = await getActionExecutionForResult(db, input.lineAccountId, input.id);
  if (!execution) return { kind: 'not_found' };
  return { kind: 'queued', execution };
}

function maskSensitiveString(value: string): string {
  if (/[*\u2022\u25cf\u2026]/.test(value)) return value;
  const email = value.match(/^([^@\s]+)@([^@\s]+)$/);
  if (email) return `${email[1]!.slice(0, 2)}***@${email[2]}`;
  if (/^\+?[0-9 ()-]{10,20}$/.test(value) && value.replace(/\D/g, '').length >= 10) {
    return `***${value.replace(/\D/g, '').slice(-4)}`;
  }
  return value;
}

function parseMaskedJson(value: unknown): unknown {
  let parsed: unknown;
  try { parsed = JSON.parse(String(value ?? 'null')) as unknown; } catch { return null; }
  const visit = (item: unknown): unknown => {
    if (typeof item === 'string') return maskSensitiveString(item);
    if (Array.isArray(item)) return item.map(visit);
    if (item && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item).map(([key, nested]) => [key, visit(nested)]));
    }
    return item;
  };
  return visit(parsed);
}

export async function listEcIdentityCandidates(
  db: D1Database,
  input: {
    tenantId: string;
    lineAccountId: string;
    status: 'pending' | 'linked' | 'different' | 'deferred' | 'invalidated';
    limit: number;
    offset: number;
  },
): Promise<{
  items: Array<Record<string, unknown>>;
  total: number;
  summary: {
    unmatched: number;
    candidates: number;
    candidateExternalCustomers: number;
    duplicateSuspicions: number;
    linked: number;
    potentialRevenue: number | null;
  };
}> {
  const [rows, count, pendingSummary, unmatched, linked, duplicates] = await Promise.all([
    db.prepare(
      `SELECT id, status, version, confidence_score, left_snapshot_json, right_snapshot_json,
              evidence_json, impact_json, detected_at, reviewed_at
         FROM identity_candidates
        WHERE tenant_id = ? AND kind = 'ec_member' AND left_line_account_id = ? AND status = ?
        ORDER BY detected_at DESC, id DESC LIMIT ? OFFSET ?`,
    ).bind(input.tenantId, input.lineAccountId, input.status, input.limit, input.offset)
      .all<Record<string, unknown>>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM identity_candidates
        WHERE tenant_id = ? AND kind = 'ec_member' AND left_line_account_id = ? AND status = ?`,
    ).bind(input.tenantId, input.lineAccountId, input.status).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count, COUNT(DISTINCT external_customer_id) AS customer_count
         FROM identity_candidates
        WHERE tenant_id = ? AND kind = 'ec_member' AND left_line_account_id = ? AND status = 'pending'`,
    ).bind(input.tenantId, input.lineAccountId).first<{ count: number; customer_count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM ec_events
        WHERE line_account_id = ? AND status = 'identity_pending'`,
    ).bind(input.lineAccountId).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM ec_identity_links
        WHERE tenant_id = ? AND line_account_id = ? AND unlinked_at IS NULL`,
    ).bind(input.tenantId, input.lineAccountId).first<{ count: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS count FROM (
         SELECT external_customer_id FROM identity_candidates
          WHERE tenant_id = ? AND kind = 'ec_member' AND left_line_account_id = ?
            AND status = 'pending' AND external_customer_id IS NOT NULL
          GROUP BY external_customer_id HAVING COUNT(*) > 1
       )`,
    ).bind(input.tenantId, input.lineAccountId).first<{ count: number }>(),
  ]);
  const items = rows.results.map((row) => ({
    id: String(row.id), status: String(row.status), version: Number(row.version),
    confidenceScore: Number(row.confidence_score),
    left: parseMaskedJson(row.left_snapshot_json), right: parseMaskedJson(row.right_snapshot_json),
    evidence: parseMaskedJson(row.evidence_json), impact: parseMaskedJson(row.impact_json),
    detectedAt: String(row.detected_at), reviewedAt: row.reviewed_at == null ? null : String(row.reviewed_at),
  }));
  const revenueValues = items.flatMap((item) => Array.isArray(item.impact)
    ? (item.impact as Array<Record<string, unknown>>)
      .filter((metric) => REVENUE_IMPACT_KEYS.includes(String(metric.key)))
      .map((metric) => typeof metric.value === 'number' ? metric.value : null)
    : []).filter((value): value is number => value !== null);
  return {
    items, total: Number(count?.count ?? 0),
    summary: {
      unmatched: Number(unmatched?.count ?? 0), candidates: Number(pendingSummary?.count ?? 0),
      candidateExternalCustomers: Number(pendingSummary?.customer_count ?? 0),
      duplicateSuspicions: Number(duplicates?.count ?? 0), linked: Number(linked?.count ?? 0),
      potentialRevenue: revenueValues.length ? revenueValues.reduce((sum, value) => sum + value, 0) : null,
    },
  };
}

/*
 * IDEA-23: 1注文の処理状況を説明できるように、注文1件へ紐づく受信出来事・
 * 個別処理・通知送達・発送後の案内・成果/マイル/スコアをまとめて返す。
 * 一覧用の一覧表ではなく「この注文はどこまで進み、どこで止まり、何を
 * やり直せるか」を追うための読み取り専用ビュー。生のエラーメッセージや
 * 注文本文・秘密値は返さず、分類と安全な文言だけを返す。
 */

export interface EcOrderDetailAttempt {
  attemptNumber: number;
  triggerKind: 'automatic' | 'manual';
  toStatus: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
}

export interface EcOrderDetailDispatch {
  subscriber: 'notification' | 'v6';
  status: 'pending' | 'sent' | 'failed';
  attemptCount: number;
  updatedAt: string;
  failureKind: EcFailureKind | null;
}

export interface EcOrderDetailDelivery {
  id: string;
  audienceType: 'customer' | 'operator';
  channel: 'line' | 'email' | 'in_app';
  status: 'pending' | 'provider_accepted' | 'excluded' | 'retry_wait' | 'failed';
  retryable: boolean;
  attempts: number;
  errorCode: string | null;
  errorMessage: string | null;
  failureKind: EcFailureKind | null;
  queuedAt: string;
  acceptedAt: string | null;
  nextRetryAt: string | null;
  executionMode: string;
}

export interface EcOrderDetailEvent {
  id: string;
  externalEventId: string;
  eventType: string;
  status: string;
  /** 出来事として止まったときの分類。進行中・正常は null。 */
  failureKind: EcFailureKind | null;
  receivedAt: string;
  processedAt: string | null;
  actions: Array<EcActionExecutionReadModel & { attempts: EcOrderDetailAttempt[] }>;
  dispatches: EcOrderDetailDispatch[];
  deliveries: EcOrderDetailDelivery[];
}

export interface EcOrderDetailFollowUp {
  id: string;
  campaignKey: string;
  campaignLabel: string | null;
  scheduledAt: string;
  status: string;
  attempts: number;
  sentAt: string | null;
  /** 既知の見送り理由コードのみ。生のエラーは出さない。 */
  reason: string | null;
  failureKind: EcFailureKind | null;
}

/**
 * IDEA-16: 注文に結びついた成果1件と、その報酬・支払いの記録。
 *
 * 報酬側の値はすべて「書かれた記録」をそのまま返す。承認前の成果には
 * 計算の版も支払い確定の行も無いので rewardAmount / rewardEntryStatus は
 * null のまま返し、画面側が「未確定」と出せるようにする。未確定の額を
 * ここで推定して埋めない。
 */
export interface EcOrderDetailConversion {
  id: string;
  pointName: string | null;
  approvalStatus: 'pending' | 'approved' | 'rejected' | null;
  value: number | null;
  createdAt: string;
  /** 成果の起こりの根拠（記録時に metadata へ残した注文番号）。 */
  orderNumber: string | null;
  /** 成果の起こりの根拠（記録時に metadata へ残したEC側の出来事ID）。 */
  ecEventId: string | null;
  /** 帰属した紹介者。誰の紹介でもない成果は null。 */
  affiliateName: string | null;
  /** 承認時に固定された報酬の版の金額。承認前・計算不可は null（未確定）。 */
  rewardAmount: number | null;
  /** 支払い確定（締めで起きた credit 行）の状態。settled/paid/reversed 等。無ければ null。 */
  rewardEntryStatus: string | null;
  /** 確定後の取消で起きた反対仕訳（debit）の金額。無ければ null。 */
  reversedAmount: number | null;
  /** この報酬を含む締めの状態（closed/exported/paid/…）。締め前は null。 */
  settlementState: string | null;
  /** 支払いCSV束の最新の状態（created/approved/exported/imported）。無ければ null。 */
  payoutBatchState: string | null;
  /** 取り込んだ支払い結果（paid/failed/returned）。無ければ null。 */
  payoutResult: string | null;
  /** 同じ注文・同じ成果地点の成果がほかにもあるとき true（二重計上の候補）。 */
  duplicateCandidate: boolean;
}

export interface EcOrderDetail {
  order: EcOrderReadModel;
  events: EcOrderDetailEvent[];
  followUps: EcOrderDetailFollowUp[];
  outcomes: {
    conversions: Array<EcOrderDetailConversion>;
    mileage: Array<{
      id: string;
      entryType: string;
      amount: number;
      status: string;
      reason: string;
      occurredAt: string;
    }>;
    scores: Array<{
      id: string;
      scoreChange: number;
      reason: string | null;
      occurredAt: string;
    }>;
  };
}

/* nen_delivery_jobs.last_error のうち画面へ出してよい既知の見送り理由。 */
const FOLLOWUP_SAFE_REASONS = new Set([
  'friend_unavailable',
  'line_account_unavailable',
  'line_account_mismatch',
  'campaign_snapshot_missing',
  'campaign_disabled',
  'order_cancelled',
  'order_refunded',
  'campaign_form_already_submitted',
  'frequency_suppressed',
]);

/**
 * 注文1件の処理状況ビュー。アカウントと注文IDで固定し、別アカウントの
 * 注文は存在しないものとして扱う（行の有無を越権確認させない）。
 */
export async function getEcOrderDetail(
  db: D1Database,
  input: { lineAccountId: string; orderId: string },
): Promise<EcOrderDetail | null> {
  const orderRow = await db.prepare(
    `SELECT o.*, f.display_name AS customer_name
       FROM ec_orders o LEFT JOIN friends f ON f.id = o.friend_id
      WHERE o.id = ? AND o.line_account_id = ?`,
  ).bind(input.orderId, input.lineAccountId).first<Record<string, unknown>>();
  if (!orderRow) return null;

  const lineRows = await db.prepare(
    `SELECT * FROM ec_order_lines WHERE order_id = ? ORDER BY line_index`,
  ).bind(input.orderId).all<Record<string, unknown>>();
  const order: EcOrderReadModel = {
    id: String(orderRow.id), lineAccountId: String(orderRow.line_account_id),
    externalOrderId: String(orderRow.external_order_id), orderNumber: String(orderRow.order_number),
    customerId: orderRow.customer_id == null ? null : String(orderRow.customer_id),
    friendId: orderRow.friend_id == null ? null : String(orderRow.friend_id),
    customerName: orderRow.customer_name == null ? null : String(orderRow.customer_name),
    status: orderRow.normalized_status as EcOrderState, providerStatus: String(orderRow.provider_status),
    currency: String(orderRow.currency),
    totalAmount: orderRow.total_amount_minor == null ? null : Number(orderRow.total_amount_minor),
    refundedAmount: orderRow.refunded_amount_minor == null ? null : Number(orderRow.refunded_amount_minor),
    orderedAt: String(orderRow.ordered_at),
    detailUrl: orderRow.detail_url == null ? null : String(orderRow.detail_url),
    version: Number(orderRow.version),
    orderLines: lineRows.results.map((line) => ({
      id: String(line.id),
      productId: line.external_product_id == null ? null : String(line.external_product_id),
      productName: String(line.product_name), quantity: Number(line.quantity),
      unitAmount: line.unit_amount_minor == null ? null : Number(line.unit_amount_minor),
      lineAmount: line.line_amount_minor == null ? null : Number(line.line_amount_minor),
      productUrl: line.product_url == null ? null : String(line.product_url),
    })),
  };

  // 同じ注文番号の出来事を受信順に並べる。order.number は受信体では
  // 数値のことがあるため TEXT へ寄せてから突き合わせる。
  const eventRows = await db.prepare(
    `SELECT id, external_event_id, event_type, status, error_message, received_at, processed_at
       FROM ec_events
      WHERE line_account_id = ? AND source = ? AND json_valid(payload)
        AND CAST(json_extract(payload, '$.order.number') AS TEXT) = ?
      ORDER BY received_at ASC, id ASC`,
  ).bind(input.lineAccountId, String(orderRow.source_key), order.orderNumber)
    .all<Record<string, unknown>>();
  const eventIds = eventRows.results.map((row) => String(row.id));
  const externalIds = eventRows.results.map((row) => String(row.external_event_id));

  const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',');

  const actionRows = eventIds.length
    ? await db.prepare(
      `SELECT a.*, e.event_type, e.received_at, e.friend_id,
              json_extract(e.payload, '$.order.number') AS order_number,
              f.display_name AS customer_name
         FROM ec_action_executions a
         JOIN ec_events e ON e.id = a.event_id
         LEFT JOIN friends f ON f.id = e.friend_id
        WHERE a.event_id IN (${placeholders(eventIds.length)})
        ORDER BY a.created_at ASC`,
    ).bind(...eventIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  const actionIds = actionRows.results.map((row) => String(row.id));
  const attemptRows = actionIds.length
    ? await db.prepare(
      `SELECT * FROM ec_action_execution_attempts
        WHERE action_execution_id IN (${placeholders(actionIds.length)})
        ORDER BY action_execution_id, attempt_number`,
    ).bind(...actionIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const attemptsByAction = new Map<string, EcOrderDetailAttempt[]>();
  for (const row of attemptRows.results) {
    const actionId = String(row.action_execution_id);
    const list = attemptsByAction.get(actionId) ?? [];
    list.push({
      attemptNumber: Number(row.attempt_number),
      triggerKind: row.trigger_kind === 'manual' ? 'manual' : 'automatic',
      toStatus: String(row.to_status),
      errorCode: row.error_code == null ? null : String(row.error_code),
      errorMessage: row.error_message_safe == null ? null : String(row.error_message_safe),
      createdAt: String(row.created_at),
    });
    attemptsByAction.set(actionId, list);
  }

  const dispatchRows = eventIds.length
    ? await db.prepare(
      `SELECT * FROM ec_v6_dispatches WHERE event_id IN (${placeholders(eventIds.length)})`,
    ).bind(...eventIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };
  const dispatchesByEvent = new Map<string, EcOrderDetailDispatch[]>();
  for (const row of dispatchRows.results) {
    const eventId = String(row.event_id);
    const status = String(row.status);
    const list = dispatchesByEvent.get(eventId) ?? [];
    list.push({
      subscriber: row.subscriber === 'v6' ? 'v6' : 'notification',
      status: status === 'sent' ? 'sent' : status === 'failed' ? 'failed' : 'pending',
      attemptCount: Number(row.attempt_count),
      updatedAt: String(row.updated_at),
      // last_error は生メッセージなので分類だけを返す。
      failureKind: status === 'failed' ? classifyEcRawError(row.last_error == null ? null : String(row.last_error)) : null,
    });
    dispatchesByEvent.set(eventId, list);
  }

  /*
   * 共通送信台帳の行をこの注文の出来事へ戻す。
   * - 顧客通知: dedupe_key = 'ec:<外部出来事ID>'（recordCustomerEcDelivery の契約）
   * - 運用者通知: source_event_id = 台帳行ID（dispatchOperatorEvent の契約）
   */
  const deliveriesByEvent = new Map<string, EcOrderDetailDelivery[]>();
  const ecDedupeKeys = externalIds.map((id) => `ec:${id}`);
  if (eventIds.length) {
    const deliveryRows = await db.prepare(
      `SELECT d.id, d.instance_id, d.audience_type, d.channel, d.status, d.retryable,
              d.attempts, d.error_code, d.error_message_safe, d.queued_at, d.accepted_at,
              d.next_retry_at, d.execution_mode,
              i.dedupe_key AS instance_dedupe_key, i.source_event_id AS instance_source_event_id
         FROM notification_deliveries d
         JOIN notification_instances i ON i.id = d.instance_id
        WHERE i.line_account_id = ?
          AND (
            (i.audience_type = 'customer' AND i.dedupe_key IN (${placeholders(ecDedupeKeys.length)}))
            OR (i.audience_type = 'operator' AND i.source_event_id IN (${placeholders(eventIds.length)}))
          )
        ORDER BY d.queued_at ASC, d.id ASC`,
    ).bind(input.lineAccountId, ...ecDedupeKeys, ...eventIds).all<Record<string, unknown>>();
    const eventIdByExternal = new Map(eventRows.results.map((row) => [String(row.external_event_id), String(row.id)]));
    for (const row of deliveryRows.results) {
      const audience = row.audience_type === 'operator' ? 'operator' : 'customer';
      const eventId = audience === 'operator'
        ? String(row.instance_source_event_id ?? '')
        : eventIdByExternal.get(String(row.instance_dedupe_key ?? '').slice(3)) ?? '';
      if (!eventId) continue;
      const errorCode = row.error_code == null ? null : String(row.error_code);
      const list = deliveriesByEvent.get(eventId) ?? [];
      list.push({
        id: String(row.id),
        audienceType: audience,
        channel: row.channel === 'email' ? 'email' : row.channel === 'in_app' ? 'in_app' : 'line',
        status: String(row.status) as EcOrderDetailDelivery['status'],
        retryable: Number(row.retryable) === 1,
        attempts: Number(row.attempts),
        errorCode,
        errorMessage: row.error_message_safe == null ? null : String(row.error_message_safe),
        failureKind: classifyEcErrorCode(errorCode),
        queuedAt: String(row.queued_at),
        acceptedAt: row.accepted_at == null ? null : String(row.accepted_at),
        nextRetryAt: row.next_retry_at == null ? null : String(row.next_retry_at),
        executionMode: String(row.execution_mode),
      });
      deliveriesByEvent.set(eventId, list);
    }
  }

  const events: EcOrderDetailEvent[] = eventRows.results.map((row) => {
    const id = String(row.id);
    const status = String(row.status);
    const actions = actionRows.results
      .filter((action) => String(action.event_id) === id)
      .map((action) => ({
        ...actionReadModel(action),
        attempts: attemptsByAction.get(String(action.id)) ?? [],
      }));
    // 出来事単位の分類は個別処理のコードを正とし、無いときだけ
    // 台帳の error_message をコードとして試す（生文は分類へ回す）。
    const actionKind = actions.map((action) => action.failureKind).find((kind) => kind !== null) ?? null;
    const rawError = row.error_message == null ? null : String(row.error_message);
    const eventKind = actionKind
      ?? classifyEcErrorCode(rawError)
      ?? (status === 'failed' ? classifyEcRawError(rawError) : null);
    return {
      id,
      externalEventId: String(row.external_event_id),
      eventType: String(row.event_type),
      status,
      failureKind: eventKind,
      receivedAt: String(row.received_at),
      processedAt: row.processed_at == null ? null : String(row.processed_at),
      actions,
      dispatches: dispatchesByEvent.get(id) ?? [],
      deliveries: deliveriesByEvent.get(id) ?? [],
    };
  });

  const followUpRows = await db.prepare(
    `SELECT j.id, j.campaign_key, j.scheduled_at, j.status, j.attempts, j.last_error,
            j.sent_at, j.created_at, cs.label AS campaign_label
       FROM nen_delivery_jobs j
       LEFT JOIN nen_campaign_settings cs ON cs.campaign_key = j.campaign_key
      WHERE j.line_account_id = ?
        AND json_valid(j.payload)
        AND json_extract(j.payload, '$.event.order.number') = ?
      ORDER BY j.scheduled_at ASC, j.id ASC`,
  ).bind(input.lineAccountId, order.orderNumber).all<Record<string, unknown>>();
  const followUps: EcOrderDetailFollowUp[] = followUpRows.results.map((row) => {
    const status = String(row.status);
    const rawError = row.last_error == null ? null : String(row.last_error);
    return {
      id: String(row.id),
      campaignKey: String(row.campaign_key),
      campaignLabel: row.campaign_label == null ? null : String(row.campaign_label),
      scheduledAt: String(row.scheduled_at),
      status,
      attempts: Number(row.attempts),
      sentAt: row.sent_at == null ? null : String(row.sent_at),
      reason: status === 'skipped' && rawError && FOLLOWUP_SAFE_REASONS.has(rawError) ? rawError : null,
      failureKind: status === 'failed' ? classifyEcRawError(rawError) : null,
    };
  });

  /*
   * 成果・マイル・スコアは発生元の外部出来事IDか注文番号で辿る。
   * 友だち未連携の注文には付かない（記録口が友だちを要求する）。
   *
   * IDEA-16: 成果の行から報酬の版・支払い確定・締め・支払いCSV束・支払い結果
   * まで同じ行で返し、注文から報酬・支払い状態へそのまま辿れるようにする。
   * 記録は友だちの所属アカウントで突き合わせる。注文番号はアカウントを
   * 越えて同じ番号が来ることがあるため、番号だけで突き合わせると別店の
   * 成果がこの注文へ混ざる。
   */
  const conversions = await db.prepare(
    `SELECT ce.id, ce.conversion_point_id, ce.point_name_snapshot, ce.approval_status,
            ce.value_snapshot, ce.created_at,
            CAST(json_extract(ce.metadata, '$.orderNumber') AS TEXT) AS order_number,
            json_extract(ce.metadata, '$.ecEventId') AS ec_event_id,
            a.name AS affiliate_name,
            calc.amount_minor AS reward_amount_minor,
            credit.status AS credit_status,
            debit.amount_minor AS reversed_amount_minor,
            st.state AS settlement_state,
            (SELECT pb.state
               FROM affiliate_payout_batch_lines pbl
               JOIN affiliate_payout_batches pb ON pb.id = pbl.batch_id
              WHERE pbl.settlement_line_id = sl.id
              ORDER BY pb.created_at DESC, pb.id DESC LIMIT 1) AS payout_batch_state,
            (SELECT pr.result
               FROM affiliate_payout_results pr
              WHERE pr.settlement_line_id = sl.id
              ORDER BY pr.imported_at DESC, pr.id DESC LIMIT 1) AS payout_result
       FROM conversion_events ce
       JOIN friends cf ON cf.id = ce.friend_id AND cf.line_account_id = ?
       LEFT JOIN affiliates a ON a.id = ce.affiliate_id
       LEFT JOIN affiliate_reward_calculations calc ON calc.conversion_event_id = ce.id
       LEFT JOIN affiliate_reward_entries credit
         ON credit.conversion_event_id = ce.id AND credit.entry_type = 'credit'
       LEFT JOIN affiliate_reward_entries debit
         ON debit.conversion_event_id = ce.id AND debit.entry_type = 'debit'
       LEFT JOIN affiliate_settlement_lines sl ON sl.entry_id = credit.id
       LEFT JOIN affiliate_settlements st ON st.id = sl.settlement_id
      WHERE json_valid(ce.metadata)
        AND json_extract(ce.metadata, '$.sourceType') = 'ec_order_confirmed'
        AND (
          CAST(json_extract(ce.metadata, '$.orderNumber') AS TEXT) = ?
          ${externalIds.length ? `OR json_extract(ce.metadata, '$.ecEventId') IN (${placeholders(externalIds.length)})` : ''}
        )
      ORDER BY ce.created_at ASC`,
  ).bind(input.lineAccountId, order.orderNumber, ...externalIds).all<Record<string, unknown>>();

  const mileage = externalIds.length
    ? await db.prepare(
      `SELECT ml.id, ml.entry_type, ml.amount, ml.status, ml.reason, ml.occurred_at
         FROM mileage_ledger ml
        WHERE ml.source_event_id IN (${placeholders(externalIds.length)})
           OR ml.engagement_event_id IN (
             SELECT id FROM engagement_events
              WHERE source = 'eccube' AND source_event_id IN (${placeholders(externalIds.length)})
           )
        ORDER BY ml.occurred_at ASC`,
    ).bind(...externalIds, ...externalIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  const scores = externalIds.length
    ? await db.prepare(
      `SELECT id, score_change, reason, COALESCE(occurred_at, created_at) AS happened_at
         FROM friend_scores
        WHERE line_account_id = ? AND source = 'eccube'
          AND source_event_id IN (${placeholders(externalIds.length)})
        ORDER BY happened_at ASC`,
    ).bind(input.lineAccountId, ...externalIds).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  /*
   * IDEA-16: 同じ注文・同じ成果地点へ2件以上の成果が乗っているときは
   * 二重計上の候補として印を付ける。同じ出来事IDの再送は冪等キーで
   * 1件に潰れるが、別の出来事IDで同じ注文が届き直すと別の成果が立つ。
   * ここでは自動で消さず、候補として見せて人が確認する。
   */
  const conversionsPerPoint = new Map<string, number>();
  for (const row of conversions.results) {
    const pointId = String(row.conversion_point_id);
    conversionsPerPoint.set(pointId, (conversionsPerPoint.get(pointId) ?? 0) + 1);
  }

  return {
    order,
    events,
    followUps,
    outcomes: {
      conversions: conversions.results.map((row) => ({
        id: String(row.id),
        pointName: row.point_name_snapshot == null ? null : String(row.point_name_snapshot),
        approvalStatus: (row.approval_status ?? null) as 'pending' | 'approved' | 'rejected' | null,
        value: row.value_snapshot == null ? null : Number(row.value_snapshot),
        createdAt: String(row.created_at),
        orderNumber: row.order_number == null ? null : String(row.order_number),
        ecEventId: row.ec_event_id == null ? null : String(row.ec_event_id),
        affiliateName: row.affiliate_name == null ? null : String(row.affiliate_name),
        rewardAmount: row.reward_amount_minor == null ? null : Number(row.reward_amount_minor),
        rewardEntryStatus: row.credit_status == null ? null : String(row.credit_status),
        reversedAmount: row.reversed_amount_minor == null ? null : Number(row.reversed_amount_minor),
        settlementState: row.settlement_state == null ? null : String(row.settlement_state),
        payoutBatchState: row.payout_batch_state == null ? null : String(row.payout_batch_state),
        payoutResult: row.payout_result == null ? null : String(row.payout_result),
        duplicateCandidate: (conversionsPerPoint.get(String(row.conversion_point_id)) ?? 0) >= 2,
      })),
      mileage: mileage.results.map((row) => ({
        id: String(row.id),
        entryType: String(row.entry_type),
        amount: Number(row.amount),
        status: String(row.status),
        reason: String(row.reason),
        occurredAt: String(row.occurred_at),
      })),
      scores: scores.results.map((row) => ({
        id: String(row.id),
        scoreChange: Number(row.score_change),
        reason: row.reason == null ? null : String(row.reason),
        occurredAt: String(row.happened_at),
      })),
    },
  };
}
