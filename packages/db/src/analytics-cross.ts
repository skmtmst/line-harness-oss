import { ANALYTICS_EVENT_TYPES, type AnalyticsEventType } from './analytics-event-types.js';

const DAY_MS = 86_400_000;
const MAX_AXIS_VALUES_PER_FRIEND = 20;
const MAX_MEMBER_ROWS = 200_000;
const MAX_ACCOUNT_FRIENDS = 50_000;

export type AnalyticsCrossAxis =
  | { kind: 'route' }
  | { kind: 'tag' }
  | { kind: 'field_choice'; fieldId: string }
  | { kind: 'score_band' }
  | { kind: 'scenario_status'; scenarioId: string }
  | { kind: 'form_choice'; formId: string; fieldKey: string }
  | { kind: 'conversion_point' }
  | { kind: 'booking_status' }
  | { kind: 'purchase_status' }
  | { kind: 'behavior'; eventType: AnalyticsEventType };

export interface AnalyticsCrossFilter {
  axis: AnalyticsCrossAxis;
  operator: 'include' | 'exclude';
  valueKeys: string[];
}

export type AnalyticsCrossMeasure =
  | { kind: 'unique_friends' }
  | { kind: 'events'; eventType: AnalyticsEventType };

export interface AnalyticsCrossQuery {
  rowAxis: AnalyticsCrossAxis;
  columnAxis: AnalyticsCrossAxis;
  measure: AnalyticsCrossMeasure;
  filters: AnalyticsCrossFilter[];
  periodFrom: string;
  periodTo: string;
  timeZone: string;
}

export interface AnalyticsCrossCell {
  rowKey: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
  value: number;
  uniqueFriends: number;
  totalRatio: number | null;
  previousValue: number;
  difference: number;
}

export interface AnalyticsCrossResult {
  lineAccountId: string;
  timeZone: string;
  rowValues: Array<{ key: string; label: string }>;
  columnValues: Array<{ key: string; label: string }>;
  cells: AnalyticsCrossCell[];
  totalValue: number;
  totalFriends: number;
  previousTotalValue: number;
  periodFrom: string;
  periodTo: string;
  previousPeriodFrom: string;
  previousPeriodTo: string;
  dataCutoffAt: string;
  state: 'available' | 'partial' | 'unavailable';
  stateReason: string | null;
}

interface AxisMembership {
  valuesByFriend: Map<string, Set<string>>;
  labels: Map<string, string>;
  missing: { key: string; label: string };
}

interface CrossEvaluationInput {
  friendIds: string[];
  row: AxisMembership;
  column: AxisMembership;
  filters: Array<{ definition: AnalyticsCrossFilter; membership: AxisMembership }>;
  previousRow: AxisMembership;
  previousColumn: AxisMembership;
  previousFilters: Array<{ definition: AnalyticsCrossFilter; membership: AxisMembership }>;
  measureByFriend: Map<string, number>;
  previousMeasureByFriend: Map<string, number>;
  rowLimit?: number;
  columnLimit?: number;
}

interface EvaluatedMatrix {
  rowValues: Array<{ key: string; label: string }>;
  columnValues: Array<{ key: string; label: string }>;
  cells: AnalyticsCrossCell[];
  totalValue: number;
  totalFriends: number;
  previousTotalValue: number;
  memberRows: Array<{ rowKey: string; columnKey: string; friendId: string }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requiredKey(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,128}$/.test(value)) throw new Error(code);
  return value;
}

function requiredValueKey(value: unknown, code: string): string {
  if (typeof value !== 'string') throw new Error(code);
  const normalized = value.trim();
  if (!normalized || normalized.length > 128 || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function explicitTimestamp(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
}

export function validateAnalyticsCrossAxis(value: unknown): AnalyticsCrossAxis {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('analytics_cross_axis_invalid');
  }
  switch (value.kind) {
    case 'route':
    case 'tag':
    case 'score_band':
    case 'conversion_point':
    case 'booking_status':
    case 'purchase_status':
      return { kind: value.kind };
    case 'field_choice':
      return { kind: value.kind, fieldId: requiredKey(value.fieldId, 'analytics_cross_field_required') };
    case 'scenario_status':
      return { kind: value.kind, scenarioId: requiredKey(value.scenarioId, 'analytics_cross_scenario_required') };
    case 'form_choice':
      return {
        kind: value.kind,
        formId: requiredKey(value.formId, 'analytics_cross_form_required'),
        fieldKey: requiredKey(value.fieldKey, 'analytics_cross_form_field_required'),
      };
    case 'behavior': {
      const eventType = requiredKey(value.eventType, 'analytics_cross_event_type_required');
      if (!ANALYTICS_EVENT_TYPES.has(eventType)) {
        throw new Error(`analytics_cross_event_type_unknown:${eventType}`);
      }
      return { kind: value.kind, eventType: eventType as AnalyticsEventType };
    }
    default:
      throw new Error(`analytics_cross_axis_unknown:${value.kind}`);
  }
}

function validateMeasure(value: unknown): AnalyticsCrossMeasure {
  if (!isRecord(value) || typeof value.kind !== 'string') {
    throw new Error('analytics_cross_measure_invalid');
  }
  if (value.kind === 'unique_friends') return { kind: value.kind };
  if (value.kind !== 'events') throw new Error(`analytics_cross_measure_unknown:${value.kind}`);
  const eventType = requiredKey(value.eventType, 'analytics_cross_measure_event_required');
  if (!ANALYTICS_EVENT_TYPES.has(eventType)) {
    throw new Error(`analytics_cross_event_type_unknown:${eventType}`);
  }
  return { kind: 'events', eventType: eventType as AnalyticsEventType };
}

export function validateAnalyticsCrossQuery(value: unknown): AnalyticsCrossQuery {
  if (!isRecord(value)) throw new Error('analytics_cross_query_invalid');
  const filtersRaw = value.filters ?? [];
  if (!Array.isArray(filtersRaw) || filtersRaw.length > 15) {
    throw new Error('analytics_cross_filters_max_15');
  }
  const filters = filtersRaw.map((raw): AnalyticsCrossFilter => {
    if (!isRecord(raw) || (raw.operator !== 'include' && raw.operator !== 'exclude')) {
      throw new Error('analytics_cross_filter_invalid');
    }
    if (!Array.isArray(raw.valueKeys) || raw.valueKeys.length < 1 || raw.valueKeys.length > 50) {
      throw new Error('analytics_cross_filter_values_invalid');
    }
    return {
      axis: validateAnalyticsCrossAxis(raw.axis),
      operator: raw.operator,
      valueKeys: [...new Set(raw.valueKeys.map((item) =>
        requiredValueKey(item, 'analytics_cross_filter_value_invalid')))],
    };
  });
  const periodFrom = explicitTimestamp(value.periodFrom, 'analytics_cross_period_from_invalid');
  const periodTo = explicitTimestamp(value.periodTo, 'analytics_cross_period_to_invalid');
  if (periodFrom > periodTo) throw new Error('analytics_cross_period_invalid');
  const maximum = new Date(periodFrom);
  maximum.setUTCMonth(maximum.getUTCMonth() + 13);
  if (Date.parse(periodTo) > maximum.getTime()) throw new Error('analytics_cross_period_max_13_months');
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone.trim() : '';
  try {
    new Intl.DateTimeFormat('ja-JP', { timeZone }).format(new Date());
  } catch {
    throw new Error('analytics_cross_timezone_invalid');
  }
  return {
    rowAxis: validateAnalyticsCrossAxis(value.rowAxis),
    columnAxis: validateAnalyticsCrossAxis(value.columnAxis),
    measure: validateMeasure(value.measure),
    filters,
    periodFrom,
    periodTo,
    timeZone,
  };
}

function valuesFor(membership: AxisMembership, friendId: string): Set<string> {
  return membership.valuesByFriend.get(friendId) ?? new Set([membership.missing.key]);
}

function passesFilters(
  friendId: string,
  filters: CrossEvaluationInput['filters'],
): boolean {
  return filters.every(({ definition, membership }) => {
    const actual = valuesFor(membership, friendId);
    const matches = definition.valueKeys.some((key) => actual.has(key));
    return definition.operator === 'include' ? matches : !matches;
  });
}

function rankKeys(
  friendIds: string[],
  membership: AxisMembership,
  limit: number,
): { values: Array<{ key: string; label: string }>; mapKey: (key: string) => string } {
  const counts = new Map<string, number>();
  for (const friendId of friendIds) {
    for (const key of valuesFor(membership, friendId)) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
  const keepCount = ranked.length > limit ? Math.max(1, limit - 1) : limit;
  const kept = ranked.slice(0, keepCount).map(([key]) => key);
  const keptSet = new Set(kept);
  const hasOther = ranked.some(([key]) => !keptSet.has(key));
  const values = kept.map((key) => ({
    key,
    label: key === membership.missing.key
      ? membership.missing.label
      : membership.labels.get(key) ?? key,
  }));
  if (hasOther) values.push({ key: '__other__', label: 'その他' });
  return { values, mapKey: (key) => keptSet.has(key) ? key : '__other__' };
}

function evaluatePeriod(
  friendIds: string[],
  row: AxisMembership,
  column: AxisMembership,
  filters: CrossEvaluationInput['filters'],
  measureByFriend: Map<string, number>,
  rowMap: (key: string) => string,
  columnMap: (key: string) => string,
): {
  cells: Map<string, { value: number; friends: Set<string> }>;
  totalValue: number;
  totalFriends: number;
  memberRows: Array<{ rowKey: string; columnKey: string; friendId: string }>;
} {
  const cells = new Map<string, { value: number; friends: Set<string> }>();
  const countedFriends = new Set<string>();
  const memberRows: Array<{ rowKey: string; columnKey: string; friendId: string }> = [];
  let totalValue = 0;
  for (const friendId of friendIds) {
    if (!passesFilters(friendId, filters)) continue;
    const measure = measureByFriend.get(friendId) ?? 0;
    if (measure <= 0) continue;
    countedFriends.add(friendId);
    totalValue += measure;
    const seenCells = new Set<string>();
    for (const rawRow of [...valuesFor(row, friendId)].slice(0, MAX_AXIS_VALUES_PER_FRIEND)) {
      for (const rawColumn of [...valuesFor(column, friendId)].slice(0, MAX_AXIS_VALUES_PER_FRIEND)) {
        const rowKey = rowMap(rawRow);
        const columnKey = columnMap(rawColumn);
        const key = `${rowKey}\u0000${columnKey}`;
        if (seenCells.has(key)) continue;
        seenCells.add(key);
        const cell = cells.get(key) ?? { value: 0, friends: new Set<string>() };
        cell.value += measure;
        cell.friends.add(friendId);
        cells.set(key, cell);
        memberRows.push({ rowKey, columnKey, friendId });
        if (memberRows.length > MAX_MEMBER_ROWS) throw new Error('analytics_cross_membership_limit');
      }
    }
  }
  return { cells, totalValue, totalFriends: countedFriends.size, memberRows };
}

export function evaluateAnalyticsCross(input: CrossEvaluationInput): EvaluatedMatrix {
  const filteredCurrent = input.friendIds.filter((friendId) => passesFilters(friendId, input.filters));
  const rowRank = rankKeys(filteredCurrent, input.row, input.rowLimit ?? 50);
  const columnRank = rankKeys(filteredCurrent, input.column, input.columnLimit ?? 20);
  const current = evaluatePeriod(
    input.friendIds, input.row, input.column, input.filters, input.measureByFriend,
    rowRank.mapKey, columnRank.mapKey,
  );
  const previous = evaluatePeriod(
    input.friendIds, input.previousRow, input.previousColumn, input.previousFilters,
    input.previousMeasureByFriend, rowRank.mapKey, columnRank.mapKey,
  );
  const cells: AnalyticsCrossCell[] = [];
  for (const row of rowRank.values) {
    for (const column of columnRank.values) {
      const key = `${row.key}\u0000${column.key}`;
      const now = current.cells.get(key);
      const before = previous.cells.get(key);
      const value = now?.value ?? 0;
      const previousValue = before?.value ?? 0;
      cells.push({
        rowKey: row.key,
        rowLabel: row.label,
        columnKey: column.key,
        columnLabel: column.label,
        value,
        uniqueFriends: now?.friends.size ?? 0,
        totalRatio: current.totalValue === 0 ? null : value / current.totalValue,
        previousValue,
        difference: value - previousValue,
      });
    }
  }
  return {
    rowValues: rowRank.values,
    columnValues: columnRank.values,
    cells,
    totalValue: current.totalValue,
    totalFriends: current.totalFriends,
    previousTotalValue: previous.totalValue,
    memberRows: current.memberRows,
  };
}

function previousRange(query: AnalyticsCrossQuery): { from: string; to: string } {
  const duration = Date.parse(query.periodTo) - Date.parse(query.periodFrom) + 1;
  return {
    from: new Date(Date.parse(query.periodFrom) - duration).toISOString(),
    to: new Date(Date.parse(query.periodFrom) - 1).toISOString(),
  };
}

function addMembership(
  membership: AxisMembership,
  friendId: string,
  key: string,
  label: string,
): void {
  const values = membership.valuesByFriend.get(friendId) ?? new Set<string>();
  if (values.size < MAX_AXIS_VALUES_PER_FRIEND) values.add(key);
  membership.valuesByFriend.set(friendId, values);
  membership.labels.set(key, label);
}

function emptyMembership(missingLabel = '未設定'): AxisMembership {
  return {
    valuesByFriend: new Map(),
    labels: new Map(),
    missing: { key: '__none__', label: missingLabel },
  };
}

async function assertAxisReference(
  db: D1Database,
  lineAccountId: string,
  axis: AnalyticsCrossAxis,
): Promise<void> {
  if (axis.kind === 'field_choice') {
    const row = await db.prepare(
      `SELECT id FROM friend_fields
        WHERE id = ? AND is_personal = 0
          AND type IN ('select','multi_select','checkbox')`,
    ).bind(axis.fieldId).first<{ id: string }>();
    if (!row) throw new Error('analytics_cross_field_reference_missing');
  } else if (axis.kind === 'scenario_status') {
    const row = await db.prepare(
      `SELECT id FROM scenarios WHERE id = ? AND line_account_id = ?`,
    ).bind(axis.scenarioId, lineAccountId).first<{ id: string }>();
    if (!row) throw new Error('analytics_cross_scenario_reference_missing');
  } else if (axis.kind === 'form_choice') {
    const row = await db.prepare(`SELECT fields FROM forms WHERE id = ?`)
      .bind(axis.formId).first<{ fields: string }>();
    if (!row) throw new Error('analytics_cross_form_reference_missing');
    let fields: unknown;
    try {
      fields = JSON.parse(row.fields);
    } catch {
      throw new Error('analytics_cross_form_schema_invalid');
    }
    const field = Array.isArray(fields)
      ? fields.find((item) => isRecord(item) && item.name === axis.fieldKey)
      : undefined;
    if (!isRecord(field) || !['select', 'radio', 'checkbox'].includes(String(field.type))) {
      throw new Error('analytics_cross_form_field_reference_missing');
    }
  }
}

async function loadFriendIds(
  db: D1Database,
  lineAccountId: string,
): Promise<{ ids: string[]; total: number; exceedsLimit: boolean }> {
  const count = await db.prepare(
    `SELECT COUNT(*) AS count FROM friends WHERE line_account_id = ?`,
  ).bind(lineAccountId).first<{ count: number }>();
  const total = Number(count?.count ?? 0);
  if (total > MAX_ACCOUNT_FRIENDS) return { ids: [], total, exceedsLimit: true };
  const rows = await db.prepare(
    `SELECT id FROM friends WHERE line_account_id = ? ORDER BY id`,
  ).bind(lineAccountId).all<{ id: string }>();
  return { ids: rows.results.map((row) => row.id), total, exceedsLimit: false };
}

const SCORE_BANDS = [
  { key: 'negative', label: '0未満', min: Number.NEGATIVE_INFINITY, max: -1 },
  { key: '0-19', label: '0〜19', min: 0, max: 19 },
  { key: '20-49', label: '20〜49', min: 20, max: 49 },
  { key: '50-99', label: '50〜99', min: 50, max: 99 },
  { key: '100-plus', label: '100以上', min: 100, max: Number.POSITIVE_INFINITY },
] as const;

const PURCHASE_LABELS: Record<string, string> = {
  'ec.order.confirmed': '注文確定',
  'ec.order.shipped': '発送済み',
  'ec.subscription.upcoming': '次回発送待ち',
  'ec.subscription.payment_failed': '支払い失敗',
  'ec.subscription.cancelled': '定期購入取消',
};

const BOOKING_LABELS: Record<string, string> = {
  requested: '申込待ち', confirmed: '確定', rejected: '却下', expired: '期限切れ',
  cancelled: '取消', completed: '完了', no_show: '来店なし',
};

async function loadEventRows(
  db: D1Database,
  lineAccountId: string,
  eventTypes: AnalyticsEventType[],
  range: { from: string; to: string },
): Promise<Array<{ friend_id: string; event_type: AnalyticsEventType; dimensions_json: string }>> {
  if (eventTypes.length === 0) return [];
  const placeholders = eventTypes.map(() => '?').join(',');
  const rows = await db.prepare(
    `SELECT friend_id, event_type, dimensions_json
       FROM analytics_events
      WHERE line_account_id = ? AND friend_id IS NOT NULL
        AND occurred_at >= ? AND occurred_at <= ?
        AND event_type IN (${placeholders})
      ORDER BY occurred_at, id`,
  ).bind(lineAccountId, range.from, range.to, ...eventTypes)
    .all<{ friend_id: string; event_type: AnalyticsEventType; dimensions_json: string }>();
  return rows.results;
}

async function loadAxisMembership(
  db: D1Database,
  lineAccountId: string,
  axis: AnalyticsCrossAxis,
  range: { from: string; to: string },
): Promise<AxisMembership> {
  await assertAxisReference(db, lineAccountId, axis);
  const membership = emptyMembership();
  if (axis.kind === 'route') {
    membership.missing.label = '経路不明';
    const rows = await db.prepare(
      `SELECT f.id AS friend_id, er.id AS value_key, er.name AS value_label
         FROM friends f LEFT JOIN entry_routes er ON er.ref_code = f.ref_code
        WHERE f.line_account_id = ?`,
    ).bind(lineAccountId).all<{ friend_id: string; value_key: string | null; value_label: string | null }>();
    for (const row of rows.results) {
      if (row.value_key) addMembership(membership, row.friend_id, row.value_key, row.value_label ?? row.value_key);
    }
  } else if (axis.kind === 'tag') {
    membership.missing.label = 'タグなし';
    const rows = await db.prepare(
      `SELECT ft.friend_id, t.id AS value_key, t.name AS value_label
         FROM friend_tags ft JOIN friends f ON f.id = ft.friend_id
         JOIN tags t ON t.id = ft.tag_id
        WHERE f.line_account_id = ?
          AND (t.line_account_id = ? OR t.line_account_id IS NULL)`,
    ).bind(lineAccountId, lineAccountId)
      .all<{ friend_id: string; value_key: string; value_label: string }>();
    for (const row of rows.results) addMembership(membership, row.friend_id, row.value_key, row.value_label);
  } else if (axis.kind === 'field_choice') {
    const rows = await db.prepare(
      `SELECT fv.friend_id, fv.value
         FROM friend_field_values fv JOIN friends f ON f.id = fv.friend_id
        WHERE f.line_account_id = ? AND fv.field_id = ?
          AND fv.value IS NOT NULL AND fv.value != ''`,
    ).bind(lineAccountId, axis.fieldId).all<{ friend_id: string; value: string }>();
    for (const row of rows.results) {
      let values: unknown = row.value;
      try { values = JSON.parse(row.value); } catch { /* 単一値はそのまま */ }
      for (const value of Array.isArray(values) ? values : [values]) {
        if (typeof value === 'string' && value.trim()) {
          addMembership(membership, row.friend_id, value.trim().slice(0, 128), value.trim().slice(0, 128));
        }
      }
    }
  } else if (axis.kind === 'score_band') {
    const rows = await db.prepare(
      `SELECT id AS friend_id, score FROM friends WHERE line_account_id = ?`,
    ).bind(lineAccountId).all<{ friend_id: string; score: number }>();
    for (const row of rows.results) {
      const band = SCORE_BANDS.find((item) => row.score >= item.min && row.score <= item.max)!;
      addMembership(membership, row.friend_id, band.key, band.label);
    }
  } else if (axis.kind === 'scenario_status') {
    membership.missing.label = '未開始';
    const rows = await db.prepare(
      `SELECT fs.friend_id, fs.status
         FROM friend_scenarios fs JOIN friends f ON f.id = fs.friend_id
        WHERE f.line_account_id = ? AND fs.scenario_id = ?`,
    ).bind(lineAccountId, axis.scenarioId).all<{ friend_id: string; status: string }>();
    const labels: Record<string, string> = {
      active: '進行中', paused: '一時停止', completed: '完了', delivering: '配信中',
    };
    for (const row of rows.results) addMembership(membership, row.friend_id, row.status, labels[row.status] ?? row.status);
  } else if (axis.kind === 'form_choice') {
    membership.missing.label = '期間内回答なし';
    const broadFrom = new Date(Date.parse(range.from) - DAY_MS).toISOString();
    const broadTo = new Date(Date.parse(range.to) + DAY_MS).toISOString();
    const rows = await db.prepare(
      `SELECT fs.friend_id, fs.data, fs.created_at
         FROM form_submissions fs JOIN friends f ON f.id = fs.friend_id
        WHERE f.line_account_id = ? AND fs.form_id = ?
          AND fs.created_at >= ? AND fs.created_at <= ?`,
    ).bind(lineAccountId, axis.formId, broadFrom, broadTo)
      .all<{ friend_id: string; data: string; created_at: string }>();
    for (const row of rows.results) {
      const occurredAt = Date.parse(row.created_at);
      if (occurredAt < Date.parse(range.from) || occurredAt > Date.parse(range.to)) continue;
      let data: unknown;
      try { data = JSON.parse(row.data); } catch { throw new Error('analytics_cross_form_data_invalid'); }
      if (!isRecord(data)) continue;
      const raw = data[axis.fieldKey];
      for (const value of Array.isArray(raw) ? raw : [raw]) {
        if (typeof value === 'string' && value.trim()) {
          addMembership(membership, row.friend_id, value.trim().slice(0, 128), value.trim().slice(0, 128));
        }
      }
    }
  } else if (axis.kind === 'conversion_point') {
    membership.missing.label = '期間内成果なし';
    const rows = await loadEventRows(db, lineAccountId, ['conversion_approved'], range);
    const labels = await db.prepare(
      `SELECT id, name FROM conversion_points WHERE line_account_id = ?`,
    ).bind(lineAccountId).all<{ id: string; name: string }>();
    const nameById = new Map(labels.results.map((row) => [row.id, row.name]));
    for (const row of rows) {
      const dimensions = JSON.parse(row.dimensions_json) as Record<string, unknown>;
      const pointId = dimensions.conversionPointId;
      if (typeof pointId === 'string' && nameById.has(pointId)) {
        addMembership(membership, row.friend_id, pointId, nameById.get(pointId)!);
      }
    }
  } else if (axis.kind === 'booking_status') {
    membership.missing.label = '期間内予約なし';
    const rows = await db.prepare(
      `SELECT friend_id, status FROM bookings
        WHERE line_account_id = ? AND starts_at >= ? AND starts_at <= ?`,
    ).bind(lineAccountId, range.from, range.to).all<{ friend_id: string; status: string }>();
    for (const row of rows.results) {
      addMembership(membership, row.friend_id, row.status, BOOKING_LABELS[row.status] ?? row.status);
    }
  } else if (axis.kind === 'purchase_status') {
    membership.missing.label = '期間内購入なし';
    const types = Object.keys(PURCHASE_LABELS) as AnalyticsEventType[];
    const rows = await loadEventRows(db, lineAccountId, types, range);
    for (const row of rows) addMembership(membership, row.friend_id, row.event_type, PURCHASE_LABELS[row.event_type]);
  } else if (axis.kind === 'behavior') {
    membership.missing = { key: 'no', label: '行動なし' };
    membership.labels.set('yes', '行動あり');
    const rows = await loadEventRows(db, lineAccountId, [axis.eventType], range);
    for (const row of rows) addMembership(membership, row.friend_id, 'yes', '行動あり');
  }
  return membership;
}

function axisEventTypes(axis: AnalyticsCrossAxis): AnalyticsEventType[] {
  if (axis.kind === 'behavior') return [axis.eventType];
  if (axis.kind === 'conversion_point') return ['conversion_approved'];
  if (axis.kind === 'purchase_status') return Object.keys(PURCHASE_LABELS) as AnalyticsEventType[];
  return [];
}

async function assertFilterValues(
  db: D1Database,
  lineAccountId: string,
  definition: AnalyticsCrossFilter,
  memberships: AxisMembership[],
): Promise<void> {
  const known = new Set([
    ...memberships.flatMap((membership) => [...membership.labels.keys()]),
    ...memberships.map((membership) => membership.missing.key),
  ]);
  const unknown = definition.valueKeys.filter((key) => !known.has(key));
  if (unknown.length === 0) return;
  const fixed = definition.axis.kind === 'score_band'
    ? new Set(SCORE_BANDS.map((band) => band.key))
    : definition.axis.kind === 'scenario_status'
      ? new Set(['active', 'paused', 'completed', 'delivering', '__none__'])
      : definition.axis.kind === 'booking_status'
        ? new Set([...Object.keys(BOOKING_LABELS), '__none__'])
        : definition.axis.kind === 'purchase_status'
          ? new Set([...Object.keys(PURCHASE_LABELS), '__none__'])
          : definition.axis.kind === 'behavior'
            ? new Set(['yes', 'no'])
            : null;
  if (fixed && unknown.every((key) => fixed.has(key))) return;
  if (definition.axis.kind === 'tag' || definition.axis.kind === 'route'
      || definition.axis.kind === 'conversion_point') {
    for (const key of unknown) {
      if (key === '__none__') continue;
      const row = definition.axis.kind === 'tag'
        ? await db.prepare(
          `SELECT id FROM tags WHERE id = ? AND (line_account_id = ? OR line_account_id IS NULL)`,
        ).bind(key, lineAccountId).first<{ id: string }>()
        : definition.axis.kind === 'route'
          ? await db.prepare(`SELECT id FROM entry_routes WHERE id = ?`).bind(key).first<{ id: string }>()
          : await db.prepare(
            `SELECT id FROM conversion_points WHERE id = ? AND line_account_id = ?`,
          ).bind(key, lineAccountId).first<{ id: string }>();
      if (!row) throw new Error('analytics_cross_filter_reference_missing');
    }
    return;
  }
  if (definition.axis.kind === 'field_choice') {
    const row = await db.prepare(
      `SELECT options_json FROM friend_fields WHERE id = ? AND is_personal = 0`,
    ).bind(definition.axis.fieldId).first<{ options_json: string | null }>();
    if (row && unknown.every((key) => choiceKeys(row.options_json).has(key))) return;
  }
  if (definition.axis.kind === 'form_choice') {
    const fieldKey = definition.axis.fieldKey;
    const row = await db.prepare(`SELECT fields FROM forms WHERE id = ?`)
      .bind(definition.axis.formId).first<{ fields: string }>();
    if (row) {
      let fields: unknown;
      try { fields = JSON.parse(row.fields); } catch { fields = []; }
      const field = Array.isArray(fields)
        ? fields.find((item) => isRecord(item) && item.name === fieldKey)
        : undefined;
      if (isRecord(field) && unknown.every((key) => choiceKeys(field.options).has(key))) return;
    }
  }
  // 選択肢を後から非表示にした場合も、過去回答に残っていれば上のknownで通る。
  // 現在も過去にも存在しない値は、0件として隠さず参照切れにする。
  throw new Error('analytics_cross_filter_reference_missing');
}

function choiceKeys(raw: unknown): Set<string> {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { return new Set(); }
  }
  if (!Array.isArray(parsed)) return new Set();
  const keys = new Set<string>();
  for (const item of parsed) {
    if (typeof item === 'string' && item.trim()) keys.add(item.trim());
    else if (isRecord(item)) {
      const value = item.value ?? item.key ?? item.label;
      if (typeof value === 'string' && value.trim()) keys.add(value.trim());
    }
  }
  return keys;
}

async function loadMeasure(
  db: D1Database,
  lineAccountId: string,
  friendIds: string[],
  measure: AnalyticsCrossMeasure,
  range: { from: string; to: string },
): Promise<Map<string, number>> {
  if (measure.kind === 'unique_friends') return new Map(friendIds.map((id) => [id, 1]));
  const rows = await db.prepare(
    `SELECT friend_id, COUNT(*) AS count FROM analytics_events
      WHERE line_account_id = ? AND friend_id IS NOT NULL
        AND event_type = ? AND occurred_at >= ? AND occurred_at <= ?
      GROUP BY friend_id`,
  ).bind(lineAccountId, measure.eventType, range.from, range.to)
    .all<{ friend_id: string; count: number }>();
  return new Map(rows.results.map((row) => [row.friend_id, Number(row.count)]));
}

async function analyticsCoverageState(
  db: D1Database,
  lineAccountId: string,
  eventTypes: AnalyticsEventType[],
  requiredFrom: string,
): Promise<{ state: 'available' | 'partial' | 'unavailable'; reason: string | null }> {
  const unique = [...new Set(eventTypes)];
  if (unique.length === 0) return { state: 'available', reason: null };
  const missing: string[] = [];
  const unavailable: string[] = [];
  const failed: string[] = [];
  const partial: string[] = [];
  for (const eventType of unique) {
    const row = await db.prepare(
      `SELECT available_from, state FROM analytics_event_coverage
        WHERE line_account_id = ? AND event_type = ?`,
    ).bind(lineAccountId, eventType).first<{
      available_from: string;
      state: 'available' | 'partial' | 'unavailable' | 'failed';
    }>();
    if (!row) missing.push(eventType);
    else if (row.state === 'failed') failed.push(eventType);
    else if (row.state === 'unavailable') unavailable.push(eventType);
    else if (row.state === 'partial' || row.available_from > requiredFrom) partial.push(eventType);
  }
  if (failed.length) throw new Error(`analytics_cross_coverage_failed:${failed.join(',')}`);
  if (missing.length || unavailable.length) {
    return {
      state: 'unavailable',
      reason: `取得できないイベント: ${[...missing, ...unavailable].join(', ')}`,
    };
  }
  if (partial.length) {
    return { state: 'partial', reason: `一部期間のみのイベント: ${partial.join(', ')}` };
  }
  return { state: 'available', reason: null };
}

async function loadRunRow(
  db: D1Database,
  runId: string,
  lineAccountId?: string,
): Promise<{
  id: string; line_account_id: string; query_json: string; state: string;
  result_json: string; error_code: string | null; period_from: string; period_to: string;
  time_zone: string; data_cutoff_at: string; created_at: string;
} | null> {
  const sql = lineAccountId
    ? `SELECT * FROM analytics_cross_runs WHERE id = ? AND line_account_id = ?`
    : `SELECT * FROM analytics_cross_runs WHERE id = ?`;
  return db.prepare(sql).bind(...(lineAccountId ? [runId, lineAccountId] : [runId])).first();
}

export async function createAnalyticsCrossRun(
  db: D1Database,
  input: {
    lineAccountId: string;
    query: unknown;
    timeZone: string;
    dataCutoffAt: string;
    createdBy?: string | null;
  },
): Promise<{ id: string; state: 'pending' }> {
  const query = validateAnalyticsCrossQuery({
    ...(isRecord(input.query) ? input.query : {}),
    timeZone: input.timeZone,
  });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO analytics_cross_runs (
       id, line_account_id, query_json, state, result_json, period_from, period_to,
       time_zone, data_cutoff_at, created_by, created_at
     ) VALUES (?, ?, ?, 'pending', '{}', ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.lineAccountId, JSON.stringify(query), query.periodFrom, query.periodTo,
    query.timeZone, input.dataCutoffAt, input.createdBy ?? null, createdAt,
  ).run();
  return { id, state: 'pending' };
}

export async function processAnalyticsCrossRun(
  db: D1Database,
  runId: string,
): Promise<AnalyticsCrossResult> {
  const claimed = await db.prepare(
    `UPDATE analytics_cross_runs SET state = 'running', started_at = ?
      WHERE id = ? AND state = 'pending'`,
  ).bind(new Date().toISOString(), runId).run();
  if (Number(claimed.meta?.changes ?? 0) !== 1) throw new Error('analytics_cross_run_not_pending');
  const row = await loadRunRow(db, runId);
  if (!row) throw new Error('analytics_cross_run_not_found');
  try {
    const query = validateAnalyticsCrossQuery(JSON.parse(row.query_json));
    const before = previousRange(query);
    if (row.data_cutoff_at < query.periodFrom) {
      const result: AnalyticsCrossResult = {
        lineAccountId: row.line_account_id, timeZone: query.timeZone,
        rowValues: [], columnValues: [], cells: [], totalValue: 0, totalFriends: 0,
        previousTotalValue: 0, periodFrom: query.periodFrom, periodTo: query.periodTo,
        previousPeriodFrom: before.from, previousPeriodTo: before.to,
        dataCutoffAt: row.data_cutoff_at, state: 'unavailable',
        stateReason: '集計時点が対象期間より前です',
      };
      await db.prepare(
        `UPDATE analytics_cross_runs SET state = 'unavailable', result_json = ?, completed_at = ?
          WHERE id = ? AND state = 'running'`,
      ).bind(JSON.stringify(result), new Date().toISOString(), runId).run();
      return result;
    }
    const cutoffPartial = row.data_cutoff_at < query.periodTo;
    const current = {
      from: query.periodFrom,
      to: cutoffPartial ? row.data_cutoff_at : query.periodTo,
    };
    const requiredEvents = [
      ...axisEventTypes(query.rowAxis),
      ...axisEventTypes(query.columnAxis),
      ...query.filters.flatMap((filter) => axisEventTypes(filter.axis)),
      ...(query.measure.kind === 'events' ? [query.measure.eventType] : []),
    ];
    const coverage = await analyticsCoverageState(
      db, row.line_account_id, requiredEvents, before.from,
    );
    if (coverage.state === 'unavailable') {
      const result: AnalyticsCrossResult = {
        lineAccountId: row.line_account_id, timeZone: query.timeZone,
        rowValues: [], columnValues: [], cells: [], totalValue: 0, totalFriends: 0,
        previousTotalValue: 0, periodFrom: query.periodFrom, periodTo: query.periodTo,
        previousPeriodFrom: before.from, previousPeriodTo: before.to,
        dataCutoffAt: row.data_cutoff_at, state: 'unavailable', stateReason: coverage.reason,
      };
      await db.prepare(
        `UPDATE analytics_cross_runs SET state = 'unavailable', result_json = ?, completed_at = ?
          WHERE id = ? AND state = 'running'`,
      ).bind(JSON.stringify(result), new Date().toISOString(), runId).run();
      return result;
    }
    const loadedFriends = await loadFriendIds(db, row.line_account_id);
    if (loadedFriends.exceedsLimit) {
      const result: AnalyticsCrossResult = {
        lineAccountId: row.line_account_id, timeZone: query.timeZone,
        rowValues: [], columnValues: [], cells: [], totalValue: 0, totalFriends: 0,
        previousTotalValue: 0, periodFrom: query.periodFrom, periodTo: query.periodTo,
        previousPeriodFrom: before.from, previousPeriodTo: before.to,
        dataCutoffAt: row.data_cutoff_at, state: 'unavailable',
        stateReason: `対象人数が上限${MAX_ACCOUNT_FRIENDS.toLocaleString('ja-JP')}人を超えています（${loadedFriends.total.toLocaleString('ja-JP')}人）`,
      };
      await db.prepare(
        `UPDATE analytics_cross_runs SET state = 'unavailable', result_json = ?, completed_at = ?
          WHERE id = ? AND state = 'running'`,
      ).bind(JSON.stringify(result), new Date().toISOString(), runId).run();
      return result;
    }
    const friendIds = loadedFriends.ids;
    const [currentRow, currentColumn, previousRow, previousColumn] = await Promise.all([
      loadAxisMembership(db, row.line_account_id, query.rowAxis, current),
      loadAxisMembership(db, row.line_account_id, query.columnAxis, current),
      loadAxisMembership(db, row.line_account_id, query.rowAxis, before),
      loadAxisMembership(db, row.line_account_id, query.columnAxis, before),
    ]);
    const currentFilters = [];
    const previousFilters = [];
    for (const definition of query.filters) {
      const [membership, previousMembership] = await Promise.all([
        loadAxisMembership(db, row.line_account_id, definition.axis, current),
        loadAxisMembership(db, row.line_account_id, definition.axis, before),
      ]);
      await assertFilterValues(
        db,
        row.line_account_id,
        definition,
        [membership, previousMembership],
      );
      currentFilters.push({ definition, membership });
      previousFilters.push({ definition, membership: previousMembership });
    }
    const [measure, previousMeasure] = await Promise.all([
      loadMeasure(db, row.line_account_id, friendIds, query.measure, current),
      loadMeasure(db, row.line_account_id, friendIds, query.measure, before),
    ]);
    const evaluated = evaluateAnalyticsCross({
      friendIds, row: currentRow, column: currentColumn, filters: currentFilters,
      previousRow, previousColumn, previousFilters,
      measureByFriend: measure, previousMeasureByFriend: previousMeasure,
    });
    for (let index = 0; index < evaluated.memberRows.length; index += 90) {
      await db.batch(evaluated.memberRows.slice(index, index + 90).map((member) => db.prepare(
        `INSERT INTO analytics_cross_run_members (
           run_id, line_account_id, row_key, col_key, friend_id
         ) VALUES (?, ?, ?, ?, ?)`,
      ).bind(runId, row.line_account_id, member.rowKey, member.columnKey, member.friendId)));
    }
    const result: AnalyticsCrossResult = {
      lineAccountId: row.line_account_id,
      timeZone: query.timeZone,
      rowValues: evaluated.rowValues,
      columnValues: evaluated.columnValues,
      cells: evaluated.cells,
      totalValue: evaluated.totalValue,
      totalFriends: evaluated.totalFriends,
      previousTotalValue: evaluated.previousTotalValue,
      periodFrom: query.periodFrom,
      periodTo: query.periodTo,
      previousPeriodFrom: before.from,
      previousPeriodTo: before.to,
      dataCutoffAt: row.data_cutoff_at,
      state: coverage.state === 'partial' || cutoffPartial ? 'partial' : 'available',
      stateReason: [
        coverage.reason,
        cutoffPartial ? `対象期間の途中です（${row.data_cutoff_at} まで）` : null,
      ].filter(Boolean).join(' / ') || null,
    };
    await db.prepare(
      `UPDATE analytics_cross_runs SET state = ?, result_json = ?, completed_at = ?
        WHERE id = ? AND state = 'running'`,
    ).bind(result.state, JSON.stringify(result), new Date().toISOString(), runId).run();
    return result;
  } catch (error) {
    await db.prepare(
      `UPDATE analytics_cross_runs SET state = 'failed', error_code = ?, completed_at = ?
        WHERE id = ? AND state = 'running'`,
    ).bind(
      error instanceof Error ? error.message.slice(0, 160) : 'analytics_cross_failed',
      new Date().toISOString(), runId,
    ).run();
    throw error;
  }
}

export async function processPendingAnalyticsCrossRuns(
  db: D1Database,
  limit = 2,
): Promise<{ processed: number; failed: number }> {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 5));
  const rows = await db.prepare(
    `SELECT id FROM analytics_cross_runs WHERE state = 'pending'
      ORDER BY created_at, id LIMIT ?`,
  ).bind(safeLimit).all<{ id: string }>();
  let processed = 0;
  let failed = 0;
  for (const row of rows.results) {
    try {
      await processAnalyticsCrossRun(db, row.id);
      processed += 1;
    } catch (error) {
      if (error instanceof Error && error.message === 'analytics_cross_run_not_pending') continue;
      failed += 1;
    }
  }
  return { processed, failed };
}

export async function recoverStalledAnalyticsCrossRuns(
  db: D1Database,
  now: Date,
): Promise<number> {
  const cutoff = new Date(now.getTime() - 10 * 60_000).toISOString();
  const result = await db.prepare(
    `UPDATE analytics_cross_runs
        SET state = 'pending', started_at = NULL, error_code = NULL
      WHERE state = 'running' AND started_at < ?`,
  ).bind(cutoff).run();
  return Number(result.meta?.changes ?? 0);
}

export async function getAnalyticsCrossRun(
  db: D1Database,
  lineAccountId: string,
  runId: string,
): Promise<{
  id: string;
  state: string;
  errorCode: string | null;
  result: AnalyticsCrossResult | null;
  createdAt: string;
} | null> {
  const row = await loadRunRow(db, runId, lineAccountId);
  if (!row) return null;
  return {
    id: row.id,
    state: row.state,
    errorCode: row.error_code,
    result: ['available', 'partial', 'unavailable'].includes(row.state)
      ? JSON.parse(row.result_json) as AnalyticsCrossResult
      : null,
    createdAt: row.created_at,
  };
}

export async function createAnalyticsCrossAudience(
  db: D1Database,
  input: {
    lineAccountId: string;
    runId: string;
    rowKey: string;
    columnKey: string;
    createdBy?: string | null;
    now: Date;
  },
): Promise<{ id: string; memberCount: number; expiresAt: string }> {
  const rowKey = requiredValueKey(input.rowKey, 'analytics_cross_row_key_invalid');
  const columnKey = requiredValueKey(input.columnKey, 'analytics_cross_column_key_invalid');
  const run = await loadRunRow(db, input.runId, input.lineAccountId);
  if (!run || !['available', 'partial'].includes(run.state)) {
    throw new Error('analytics_cross_run_not_found');
  }
  const result = JSON.parse(run.result_json) as AnalyticsCrossResult;
  if (!result.cells.some((cell) => cell.rowKey === rowKey && cell.columnKey === columnKey)) {
    throw new Error('analytics_cross_cell_not_found');
  }
  const count = await db.prepare(
    `SELECT COUNT(*) AS count FROM analytics_cross_run_members
      WHERE run_id = ? AND line_account_id = ? AND row_key = ? AND col_key = ?`,
  ).bind(input.runId, input.lineAccountId, rowKey, columnKey).first<{ count: number }>();
  const id = crypto.randomUUID();
  const createdAt = input.now.toISOString();
  const expiresAt = new Date(input.now.getTime() + DAY_MS).toISOString();
  await db.batch([
    db.prepare(
      `INSERT INTO analytics_result_audiences (
         id, line_account_id, source_kind, source_result_id, selection_key,
         member_count, expires_at, created_by, created_at
       ) VALUES (?, ?, 'cross', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id, input.lineAccountId, input.runId, `${rowKey}:${columnKey}`,
      Number(count?.count ?? 0), expiresAt, input.createdBy ?? null, createdAt,
    ),
    db.prepare(
      `INSERT INTO analytics_result_audience_members (audience_id, friend_id)
       SELECT ?, friend_id FROM analytics_cross_run_members
        WHERE run_id = ? AND line_account_id = ? AND row_key = ? AND col_key = ?`,
    ).bind(id, input.runId, input.lineAccountId, rowKey, columnKey),
  ]);
  return { id, memberCount: Number(count?.count ?? 0), expiresAt };
}
