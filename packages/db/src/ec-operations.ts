export type EcOrderState = 'current' | 'refunded' | 'cancelled';
export type EcActionExecutionStatus =
  | 'pending'
  | 'processing'
  | 'succeeded'
  | 'skipped'
  | 'retryable_failed'
  | 'permanent_failed';

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
  const attemptNumber = Math.max(1, Number(current.attempt_count) || 0);
  const firstAttempt = Number(current.attempt_count) === 0;
  const requestedStatus = input.status === 'retryable_failed'
    && attemptNumber >= Number(current.max_attempts)
    ? 'permanent_failed'
    : input.status;
  const update = db.prepare(
    `UPDATE ec_action_executions
        SET status = ?, attempt_count = CASE WHEN attempt_count = 0 THEN 1 ELSE attempt_count END,
            error_code = ?, error_message_safe = ?, last_attempted_at = ?, next_retry_at = NULL,
            version = version + 1, updated_at = ?
      WHERE id = ? AND line_account_id = ? AND version = ?`,
  ).bind(
    requestedStatus, input.errorCode ?? null, input.errorMessageSafe ?? null,
    now, now, current.id, input.lineAccountId, current.version,
  );
  if (firstAttempt) {
    await db.batch([
      update,
      db.prepare(
        `INSERT OR IGNORE INTO ec_action_execution_attempts
           (id, action_execution_id, attempt_number, trigger_kind, from_status, to_status,
            requested_by, idempotency_key, request_fingerprint, error_code, error_message_safe, created_at)
         VALUES (?, ?, 1, 'automatic', 'pending', ?, NULL, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), current.id, requestedStatus, `automatic:${current.id}:1`,
        `automatic:${current.id}:1`, input.errorCode ?? null, input.errorMessageSafe ?? null, now,
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
      current.id, attemptNumber,
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
  retryAvailable: boolean;
}

function actionReadModel(row: Record<string, unknown>): EcActionExecutionReadModel {
  return {
    id: String(row.id), eventId: String(row.event_id), eventType: String(row.event_type),
    actionType: String(row.action_type), ruleVersion: String(row.rule_version),
    status: row.status as EcActionExecutionStatus, attemptCount: Number(row.attempt_count),
    maxAttempts: Number(row.max_attempts), errorCode: row.error_code == null ? null : String(row.error_code),
    errorMessage: row.error_message_safe == null ? null : String(row.error_message_safe),
    lastAttemptedAt: row.last_attempted_at == null ? null : String(row.last_attempted_at),
    nextRetryAt: row.next_retry_at == null ? null : String(row.next_retry_at),
    version: Number(row.version), receivedAt: String(row.received_at),
    orderNumber: row.order_number == null ? null : String(row.order_number),
    customerName: row.customer_name == null ? null : String(row.customer_name),
    retryAvailable: row.status === 'retryable_failed' && Number(row.attempt_count) < Number(row.max_attempts),
  };
}

export async function listEcActionExecutions(
  db: D1Database,
  input: {
    lineAccountId: string;
    eventId?: string | null;
    status?: EcActionExecutionStatus | null;
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
  const where = clauses.join(' AND ');
  const [rows, count, summaryRows] = await Promise.all([
    db.prepare(
      `SELECT a.*, e.event_type, e.received_at,
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
    `SELECT a.*, e.event_type, e.received_at,
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
      .filter((metric) => ['sales', 'revenue', 'order_amount'].includes(String(metric.key)))
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
