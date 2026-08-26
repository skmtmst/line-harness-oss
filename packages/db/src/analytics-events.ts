import {
  ANALYTICS_EVENT_TYPES,
  type AnalyticsEventType,
} from './analytics-event-types.js';

const DIMENSION_KEYS: Partial<Record<AnalyticsEventType, readonly string[]>> = {
  friend_add: ['friendKind', 'attributionStatus'],
  message_received: ['messageType', 'matched'],
  message_sent: ['messageType', 'deliveryType', 'source'],
  postback_received: ['matched'],
  tag_change: ['tagId', 'action'],
  scenario_started: ['scenarioId'],
  scenario_completed: ['scenarioId'],
  form_submitted: ['formId'],
  url_clicked: ['trackedLinkId'],
  site_event: ['eventType', 'pathGroup'],
  booking_confirmed: ['menuId'],
  booking_cancelled: ['menuId'],
  conversion_created: ['conversionPointId', 'approvalStatus'],
  conversion_approved: ['conversionPointId'],
  conversion_rejected: ['conversionPointId'],
  automation_completed: ['automationId', 'status'],
  'ec.order.confirmed': ['status'],
  'ec.order.shipped': ['status'],
  'ec.subscription.upcoming': ['status'],
  'ec.subscription.payment_failed': ['status'],
  'ec.subscription.cancelled': ['status'],
};

export interface AnalyticsEvent {
  id: string;
  lineAccountId: string;
  friendId: string | null;
  visitorKey: string | null;
  eventType: AnalyticsEventType;
  sourceKind: string;
  sourceId: string;
  occurredAt: string;
  dimensions: Record<string, string | number | boolean>;
  numericValue: number | null;
  currency: string | null;
  idempotencyKey: string;
}

export interface RecordAnalyticsEventInput {
  lineAccountId: string;
  friendId?: string | null;
  visitorKey?: string | null;
  eventType: string;
  sourceKind: string;
  sourceId: string;
  occurredAt: string;
  dimensions?: Record<string, unknown>;
  numericValue?: number | null;
  currency?: string | null;
  idempotencyKey?: string;
}

function requiredText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

function normalizeOccurredAt(value: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T/.test(normalized) || !/(Z|[+-]\d{2}:?\d{2})$/.test(normalized)) {
    throw new Error('analytics_event_time_requires_timezone');
  }
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) throw new Error('analytics_event_time_invalid');
  return date.toISOString();
}

export function sanitizeAnalyticsDimensions(
  eventType: AnalyticsEventType,
  raw: Record<string, unknown> | undefined,
): Record<string, string | number | boolean> {
  const allowed = new Set(DIMENSION_KEYS[eventType] ?? []);
  const dimensions: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    if (!allowed.has(key)) continue;
    if (typeof value === 'boolean') dimensions[key] = value;
    else if (typeof value === 'number' && Number.isFinite(value)) dimensions[key] = value;
    else if (typeof value === 'string' && value.trim()) dimensions[key] = value.trim().slice(0, 128);
  }
  return dimensions;
}

export async function recordAnalyticsEvent(
  db: D1Database,
  input: RecordAnalyticsEventInput,
): Promise<AnalyticsEvent> {
  const lineAccountId = requiredText(input.lineAccountId, 'analytics_event_account_required');
  const sourceKind = requiredText(input.sourceKind, 'analytics_event_source_kind_required');
  const sourceId = requiredText(input.sourceId, 'analytics_event_source_id_required');
  if (!ANALYTICS_EVENT_TYPES.has(input.eventType)) {
    throw new Error(`analytics_event_type_unknown:${input.eventType}`);
  }
  const eventType = input.eventType as AnalyticsEventType;
  const occurredAt = normalizeOccurredAt(input.occurredAt);
  const numericValue = input.numericValue ?? null;
  if (numericValue !== null && !Number.isFinite(numericValue)) {
    throw new Error('analytics_event_numeric_value_invalid');
  }
  const currency = input.currency?.trim().toUpperCase() || null;
  if (currency && !/^[A-Z]{3}$/.test(currency)) throw new Error('analytics_event_currency_invalid');
  const idempotencyKey = input.idempotencyKey?.trim()
    || `${sourceKind}:${sourceId}:${eventType}`;
  const dimensions = sanitizeAnalyticsDimensions(eventType, input.dimensions);
  const id = crypto.randomUUID();

  await db.prepare(
    `INSERT OR IGNORE INTO analytics_events (
       id, line_account_id, friend_id, visitor_key, event_type, source_kind,
       source_id, occurred_at, dimensions_json, numeric_value, currency, idempotency_key
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id,
    lineAccountId,
    input.friendId ?? null,
    input.visitorKey ?? null,
    eventType,
    sourceKind,
    sourceId,
    occurredAt,
    JSON.stringify(dimensions),
    numericValue,
    currency,
    idempotencyKey,
  ).run();

  const row = await db.prepare(
    `SELECT id, line_account_id, friend_id, visitor_key, event_type, source_kind,
            source_id, occurred_at, dimensions_json, numeric_value, currency, idempotency_key
       FROM analytics_events
      WHERE line_account_id = ? AND idempotency_key = ?`,
  ).bind(lineAccountId, idempotencyKey).first<{
    id: string;
    line_account_id: string;
    friend_id: string | null;
    visitor_key: string | null;
    event_type: AnalyticsEventType;
    source_kind: string;
    source_id: string;
    occurred_at: string;
    dimensions_json: string;
    numeric_value: number | null;
    currency: string | null;
    idempotency_key: string;
  }>();
  if (!row) throw new Error('analytics_event_insert_failed');
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    friendId: row.friend_id,
    visitorKey: row.visitor_key,
    eventType: row.event_type,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    occurredAt: row.occurred_at,
    dimensions: JSON.parse(row.dimensions_json) as Record<string, string | number | boolean>,
    numericValue: row.numeric_value,
    currency: row.currency,
    idempotencyKey: row.idempotency_key,
  };
}
