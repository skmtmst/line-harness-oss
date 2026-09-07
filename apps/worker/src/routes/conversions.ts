import { Hono, type Context, type MiddlewareHandler } from 'hono';
import {
  getConversionPoints,
  getConversionPointById,
  createConversionPoint,
  updateConversionPoint,
  stopConversionPoint,
  trackConversion,
  getConversionEvents,
  getConversionReport,
  getConversionApprovalQueue,
  setConversionApproval,
  getConversionApprovalNotifyInfo,
  syncAffiliateConversionMileage,
  listConversionDefinitions,
  getConversionDefinitionDetail,
  addConversionDefinitionUsage,
  createConversionDefinition,
  previewConversionDefinition,
  getConversionDefinitionDeleteImpact,
  stopConversionDefinition,
  replaceConversionDefinitionUsages,
  deleteUnusedConversionDefinition,
  getConversionDefinitionReport,
  listConversionDefinitionsForExport,
  ConversionDefinitionError,
  CONVERSION_DEFINITION_USAGE_KINDS,
} from '@line-crm/db';
import { IDENTITY_KEY_SQL } from '../lib/identity-key.js';
import { notifyAffiliateApproval } from '../services/affiliate-notifier.js';
import type { Env } from '../index.js';
import { auditLog } from '../lib/audit-log.js';
import { requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts, getVisibleLineAccountScope } from '../services/account-access.js';
import { listLimit, listOffset } from './list-pagination.js';

import type {
  ConversionPoint,
  ConversionMeasureMethod,
  ConversionDefinitionRange,
  ConversionDefinitionSort,
  ConversionDefinitionStatus,
  ConversionDefinitionUsageKind,
  ConversionDeduplicationMode,
  ConversionValueMode,
  ConversionReversalPolicy,
} from '@line-crm/db';

const conversions = new Hono<Env>();

async function adminAccountScope(c: Context<Env>, alias = '') {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  const column = `${alias}line_account_id`;
  const where = scope.allowedAccountIds.length
    ? `(${column} IN (${scope.allowedAccountIds.map(() => '?').join(',')})${scope.canSeeUnassigned ? ` OR ${column} IS NULL` : ''})`
    : scope.canSeeUnassigned
      ? `${column} IS NULL`
      : '1 = 0';
  return { scope, where };
}

const requireVisibleConversionPoint: MiddlewareHandler<Env> = async (c, next) => {
  const point = await getConversionPointById(c.env.DB, c.req.param('id') ?? '');
  if (!point || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [point.line_account_id])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await next();
};

const requireVisibleConversionEvent: MiddlewareHandler<Env> = async (c, next) => {
  const row = await c.env.DB.prepare(
    `SELECT cp.line_account_id FROM conversion_events ce
       JOIN conversion_points cp ON cp.id = ce.conversion_point_id
      WHERE ce.id = ?`,
  ).bind(c.req.param('id')).first<{ line_account_id: string | null }>();
  if (!row || !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [row.line_account_id])) {
    return c.json({ success: false, error: 'Attributed conversion event not found' }, 404);
  }
  await next();
};

async function visibleConversionPointIds(c: Context<Env>) {
  const { scope, where } = await adminAccountScope(c, 'cp.');
  const rows = await c.env.DB.prepare(`SELECT cp.id AS id FROM conversion_points cp WHERE ${where}`)
    .bind(...scope.allowedAccountIds)
    .all<{ id: string }>();
  return new Set(rows.results.map((row) => row.id));
}

const MEASURE_METHODS: ConversionMeasureMethod[] = ['url_reach', 'webhook', 'manual'];

function serializeConversionPoint(p: ConversionPoint) {
  return {
    id: p.id,
    name: p.name,
    eventType: p.event_type,
    value: p.value,
    measureMethod: p.measure_method,
    targetUrl: p.target_url,
    countRepeat: p.count_repeat !== 0,
    attributionDays: p.attribution_days,
    lineAccountId: p.line_account_id,
    version: p.version,
    status: p.status,
    stoppedAt: p.stopped_at,
    createdAt: p.created_at,
  };
}

type ConversionPermission = 'view' | 'edit' | 'export';

function conversionPermission(permission: ConversionPermission): MiddlewareHandler<Env> {
  return async (c, next) => {
    const staff = c.get('staff');
    const keys = staff?.permissionKeys ?? [];
    const hasFeature = keys.includes('/conversions');
    const allowed = staff && (
      staff.role === 'owner'
      || staff.role === 'admin'
      || (permission === 'view' && hasFeature)
      || (permission === 'edit' && hasFeature && keys.includes('conversion.definition.edit'))
      || (permission === 'export' && hasFeature && keys.includes('conversion.report.export'))
    );
    if (!allowed) {
      return c.json({ success: false, error: 'この機能を操作する権限がありません' }, 403);
    }
    await next();
  };
}

function conversionContractError(c: Context<Env>, error: unknown): Response {
  if (error instanceof ConversionDefinitionError) {
    return c.json({ success: false, code: error.code, error: error.message }, error.status);
  }
  console.error(JSON.stringify({
    event: 'conversion_definition_contract_failed',
    path: c.req.path,
    reason: error instanceof Error ? error.message : String(error),
  }));
  return c.json({ success: false, error: '成果地点の情報を処理できませんでした' }, 500);
}

function jstDate(date: Date): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function parseDate(value: string | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00+09:00`);
  return Number.isNaN(parsed.getTime()) || jstDate(parsed) !== value ? null : parsed;
}

function conversionRange(c: Context<Env>):
  | { ok: true; range: ConversionDefinitionRange; previousRange: ConversionDefinitionRange }
  | { ok: false; response: Response } {
  const rawTo = c.req.query('to') ?? jstDate(new Date());
  const toDate = parseDate(rawTo);
  const rawFrom = c.req.query('from') ?? (toDate
    ? jstDate(new Date(toDate.getTime() - 29 * 24 * 60 * 60 * 1000))
    : '');
  const fromDate = parseDate(rawFrom);
  if (!fromDate || !toDate || fromDate > toDate) {
    return {
      ok: false,
      response: c.json({ success: false, error: 'from と to は正しい日付順で指定してください' }, 400),
    };
  }
  const inclusiveDays = Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
  if (inclusiveDays > 366) {
    return {
      ok: false,
      response: c.json({ success: false, error: '集計期間は366日以内で指定してください' }, 400),
    };
  }
  const previousTo = new Date(fromDate.getTime() - 24 * 60 * 60 * 1000);
  const previousFrom = new Date(previousTo.getTime() - (inclusiveDays - 1) * 24 * 60 * 60 * 1000);
  return {
    ok: true,
    range: { from: `${rawFrom} 00:00:00`, to: `${rawTo} 23:59:59`, timeZone: 'Asia/Tokyo' },
    previousRange: {
      from: `${jstDate(previousFrom)} 00:00:00`,
      to: `${jstDate(previousTo)} 23:59:59`,
      timeZone: 'Asia/Tokyo',
    },
  };
}

const DEFINITION_STATUSES = new Set<ConversionDefinitionStatus>(['active', 'stopped']);
const DEFINITION_SORTS = new Set<ConversionDefinitionSort>([
  'count_desc', 'value_desc', 'updated_desc', 'name_asc',
]);
const DEFINITION_SOURCE_TYPES = new Set([
  'ec_order_confirmed', 'form_submitted', 'reservation_confirmed', 'url_reach',
  'webinar_completed', 'tag_added',
]);
const DEDUPLICATION_MODES = new Set<ConversionDeduplicationMode>(['every', 'once_per_friend', 'window']);
const VALUE_MODES = new Set<ConversionValueMode>(['source', 'fixed', 'none']);
const REVERSAL_POLICIES = new Set<ConversionReversalPolicy>(['source_cancelled', 'manual', 'none']);

function positiveVersion(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function plainObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function readDefinitionInput(body: Record<string, unknown>) {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const sourceType = typeof body.sourceType === 'string' ? body.sourceType : '';
  const sourceConfig = plainObject(body.sourceConfig) ?? {};
  const lineAccountId = typeof body.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
  const deduplicationMode = body.deduplicationMode as ConversionDeduplicationMode;
  const valueMode = body.valueMode as ConversionValueMode;
  const reversalPolicy = body.reversalPolicy as ConversionReversalPolicy;
  const windowDays = body.deduplicationWindowDays == null ? null : Number(body.deduplicationWindowDays);
  const fixedValue = body.fixedValue == null || body.fixedValue === '' ? null : Number(body.fixedValue);
  const attributionDays = body.attributionDays == null || body.attributionDays === '' ? null : Number(body.attributionDays);
  const targetUrl = typeof body.targetUrl === 'string' && body.targetUrl.trim() ? body.targetUrl.trim() : null;
  if (!name || name.length > 120 || !lineAccountId || !DEFINITION_SOURCE_TYPES.has(sourceType)
    || !DEDUPLICATION_MODES.has(deduplicationMode) || !VALUE_MODES.has(valueMode)
    || !REVERSAL_POLICIES.has(reversalPolicy)
    || (deduplicationMode === 'window' && (!Number.isInteger(windowDays) || windowDays! < 1 || windowDays! > 365))
    || (valueMode === 'fixed' && (fixedValue === null || !Number.isFinite(fixedValue) || fixedValue < 0))
    || (attributionDays !== null && (!Number.isInteger(attributionDays) || attributionDays < 1 || attributionDays > 365))
    || (sourceType === 'url_reach' && (!targetUrl || !/^https?:\/\//.test(targetUrl)))) {
    return null;
  }
  return {
    name, sourceType, sourceConfig, lineAccountId, deduplicationMode,
    deduplicationWindowDays: windowDays, valueMode, fixedValue, reversalPolicy,
    attributionDays, targetUrl,
    measureMethod: sourceType === 'url_reach' ? 'url_reach' as const : 'webhook' as const,
  };
}

function definitionFilters(c: Context<Env>) {
  const status = c.req.query('status');
  const sort = c.req.query('sort') ?? 'count_desc';
  if (status && !DEFINITION_STATUSES.has(status as ConversionDefinitionStatus)) {
    return { ok: false as const, response: c.json({ success: false, error: 'status が正しくありません' }, 400) };
  }
  if (!DEFINITION_SORTS.has(sort as ConversionDefinitionSort)) {
    return { ok: false as const, response: c.json({ success: false, error: 'sort が正しくありません' }, 400) };
  }
  return {
    ok: true as const,
    value: {
      lineAccountId: c.req.query('lineAccountId'),
      query: c.req.query('q'),
      status: status as ConversionDefinitionStatus | undefined,
      sourceType: c.req.query('sourceType'),
      sort: sort as ConversionDefinitionSort,
    },
  };
}

async function conversionDefinitionScope(c: Context<Env>, lineAccountId?: string) {
  if (lineAccountId && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
    return { ok: false as const, response: c.json({ success: false, error: 'このLINEアカウントを表示する権限がありません' }, 403) };
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  return {
    ok: true as const,
    value: { allowedAccountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned },
  };
}

function csvCell(value: unknown): string {
  const raw = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

interface ConversionPointBody {
  name?: unknown;
  eventType?: unknown;
  value?: unknown;
  measureMethod?: unknown;
  targetUrl?: unknown;
  countRepeat?: unknown;
  attributionDays?: unknown;
  lineAccountId?: unknown;
}

/**
 * 計測に関する項目を検証して取り出す。
 *
 * url_reach なのに対象URLが無い、という組み合わせを弾く。保存できてしまうと
 * 「設定したのに1件も数えられない」という、気づきにくい壊れ方をする。
 */
function readMeasureOptions(
  body: ConversionPointBody,
  current?: ConversionPoint,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const out: Record<string, unknown> = {};

  let method = current?.measure_method ?? 'manual';
  if (body.measureMethod !== undefined) {
    if (!MEASURE_METHODS.includes(body.measureMethod as ConversionMeasureMethod)) {
      return { ok: false, error: `measureMethod must be one of ${MEASURE_METHODS.join(', ')}` };
    }
    method = body.measureMethod as ConversionMeasureMethod;
    out.measureMethod = method;
  }

  let targetUrl = current?.target_url ?? null;
  if ('targetUrl' in body) {
    const raw = body.targetUrl;
    if (raw === null || raw === '' || raw === undefined) {
      targetUrl = null;
    } else if (typeof raw !== 'string' || !/^https?:\/\//.test(raw)) {
      return { ok: false, error: 'targetUrl must start with http:// or https://' };
    } else {
      targetUrl = raw.trim();
    }
    out.targetUrl = targetUrl;
  }

  if (method === 'url_reach' && !targetUrl) {
    return { ok: false, error: 'targetUrl is required when measureMethod is url_reach' };
  }

  if (body.countRepeat !== undefined) out.countRepeat = body.countRepeat !== false;

  if ('attributionDays' in body) {
    const raw = body.attributionDays;
    if (raw === null || raw === '' || raw === undefined) {
      out.attributionDays = null;
    } else {
      const n = Number(raw);
      if (!Number.isInteger(n) || n < 1 || n > 365) {
        return { ok: false, error: 'attributionDays must be an integer between 1 and 365' };
      }
      out.attributionDays = n;
    }
  }

  if ('lineAccountId' in body) {
    const raw = body.lineAccountId;
    out.lineAccountId = raw === null || raw === '' || raw === undefined ? null : String(raw);
  }

  return { ok: true, value: out };
}

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/definitions - V6 list, filters, state counts and metrics
conversions.get('/api/conversions/definitions', conversionPermission('view'), async (c) => {
  try {
    const range = conversionRange(c);
    if (!range.ok) return range.response;
    const filters = definitionFilters(c);
    if (!filters.ok) return filters.response;
    const scope = await conversionDefinitionScope(c, filters.value.lineAccountId);
    if (!scope.ok) return scope.response;
    const cursorRaw = c.req.query('cursor') ?? '0';
    const cursor = Number(cursorRaw);
    if (!/^\d+$/.test(cursorRaw) || !Number.isSafeInteger(cursor)) {
      return c.json({ success: false, error: 'cursor は0以上の整数で指定してください' }, 400);
    }
    const data = await listConversionDefinitions(c.env.DB, {
      scope: scope.value,
      ...filters.value,
      range: range.range,
      cursor,
      limit: listLimit(c.req.query('limit'), 50),
    });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// POST /api/conversions/definitions - save the complete V6 definition and its initial usages
conversions.post('/api/conversions/definitions', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ success: false, error: 'JSON本文が正しくありません' }, 400);
    const definition = readDefinitionInput(body);
    const rawUsages = Array.isArray(body.usages) ? body.usages : [];
    const usages = rawUsages.map((raw) => {
      const usage = plainObject(raw);
      return usage && CONVERSION_DEFINITION_USAGE_KINDS.includes(usage.refKind as ConversionDefinitionUsageKind)
        && typeof usage.refId === 'string' && usage.refId.trim() && usage.refId.length <= 200
        ? {
            refKind: usage.refKind as ConversionDefinitionUsageKind,
            refId: usage.refId.trim(),
            refVersionId: typeof usage.refVersionId === 'string' && usage.refVersionId.trim()
              ? usage.refVersionId.trim() : null,
          }
        : null;
    });
    if (!definition || usages.some((usage) => usage === null)) {
      return c.json({ success: false, error: '成果地点の入力内容を正しく指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [definition.lineAccountId])) {
      return c.json({ success: false, error: '成果地点が見つかりません' }, 404);
    }
    const data = await createConversionDefinition(c.env.DB, {
      ...definition,
      usages: usages.filter((usage): usage is NonNullable<typeof usage> => usage !== null),
      staffId: c.get('staff')!.id,
    });
    auditLog(c, 'conversion.definition.create', { kind: 'conversion_definition', id: data!.id });
    return c.json({ success: true, data }, 201);
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// POST /api/conversions/definitions/preview - calculate from the submitted draft without saving it
conversions.post('/api/conversions/definitions/preview', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    if (!body) return c.json({ success: false, error: 'JSON本文が正しくありません' }, 400);
    const definition = readDefinitionInput({ name: '保存前試算', reversalPolicy: 'manual', ...body });
    if (!definition) return c.json({ success: false, error: '試算する入力内容を正しく指定してください' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [definition.lineAccountId])) {
      return c.json({ success: false, error: '成果地点が見つかりません' }, 404);
    }
    const scope = await conversionDefinitionScope(c, definition.lineAccountId);
    if (!scope.ok) return scope.response;
    const range = conversionRange(c);
    if (!range.ok) return range.response;
    const data = await previewConversionDefinition(c.env.DB, {
      scope: scope.value,
      lineAccountId: definition.lineAccountId,
      sourceType: definition.sourceType,
      deduplicationMode: definition.deduplicationMode,
      deduplicationWindowDays: definition.deduplicationWindowDays,
      valueMode: definition.valueMode,
      fixedValue: definition.fixedValue,
      range: range.range,
    });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// GET /api/conversions/definitions/:id - definition, current version and usages
conversions.get('/api/conversions/definitions/:id', conversionPermission('view'), async (c) => {
  try {
    const scope = await conversionDefinitionScope(c);
    if (!scope.ok) return scope.response;
    const data = await getConversionDefinitionDetail(c.env.DB, c.req.param('id'), scope.value);
    if (!data) return c.json({ success: false, error: '成果地点が見つかりません' }, 404);
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

conversions.get('/api/conversions/definitions/:id/delete-impact', conversionPermission('view'), async (c) => {
  try {
    const scope = await conversionDefinitionScope(c);
    if (!scope.ok) return scope.response;
    const data = await getConversionDefinitionDeleteImpact(c.env.DB, c.req.param('id'), scope.value);
    if (!data) return c.json({ success: false, error: '成果地点が見つかりません' }, 404);
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

conversions.post('/api/conversions/definitions/:id/stop', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = positiveVersion(body?.expectedVersion);
    if (!body || expectedVersion === null) {
      return c.json({ success: false, error: 'expectedVersionを正しく指定してください' }, 400);
    }
    const scope = await conversionDefinitionScope(c);
    if (!scope.ok) return scope.response;
    const data = await stopConversionDefinition(c.env.DB, {
      id: c.req.param('id'), scope: scope.value, expectedVersion,
      reason: typeof body.reason === 'string' ? body.reason.trim() : null,
      staffId: c.get('staff')!.id,
    });
    auditLog(c, 'conversion.definition.stop', { kind: 'conversion_definition', id: c.req.param('id') });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

conversions.post('/api/conversions/definitions/:id/replace', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = positiveVersion(body?.expectedVersion);
    const replacementExpectedVersion = positiveVersion(body?.replacementExpectedVersion);
    const replacementId = typeof body?.replacementId === 'string' ? body.replacementId.trim() : '';
    if (!body || expectedVersion === null || replacementExpectedVersion === null || !replacementId) {
      return c.json({ success: false, error: '差し替え先と版を正しく指定してください' }, 400);
    }
    const scope = await conversionDefinitionScope(c);
    if (!scope.ok) return scope.response;
    const data = await replaceConversionDefinitionUsages(c.env.DB, {
      id: c.req.param('id'), replacementId, scope: scope.value,
      expectedVersion, replacementExpectedVersion,
      reason: typeof body.reason === 'string' ? body.reason.trim() : null,
      staffId: c.get('staff')!.id,
    });
    auditLog(c, 'conversion.definition.replace', { kind: 'conversion_definition', id: c.req.param('id') });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

conversions.delete('/api/conversions/definitions/:id', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => null);
    const expectedVersion = positiveVersion(body?.expectedVersion);
    if (!body || expectedVersion === null) {
      return c.json({ success: false, error: 'expectedVersionを正しく指定してください' }, 400);
    }
    const scope = await conversionDefinitionScope(c);
    if (!scope.ok) return scope.response;
    const data = await deleteUnusedConversionDefinition(c.env.DB, {
      id: c.req.param('id'), scope: scope.value, expectedVersion,
      reason: typeof body.reason === 'string' ? body.reason.trim() : null,
      staffId: c.get('staff')!.id,
    });
    auditLog(c, 'conversion.definition.delete', { kind: 'conversion_definition', id: c.req.param('id') });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// POST /api/conversions/definitions/:id/usages - bind one published version to a consumer
conversions.post('/api/conversions/definitions/:id/usages', conversionPermission('edit'), async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: unknown;
      expectedVersion?: unknown;
      refKind?: unknown;
      refId?: unknown;
      refVersionId?: unknown;
    }>().catch(() => null);
    if (!body) return c.json({ success: false, error: 'JSON本文が正しくありません' }, 400);
    const lineAccountId = typeof body.lineAccountId === 'string' ? body.lineAccountId.trim() : '';
    const refId = typeof body.refId === 'string' ? body.refId.trim() : '';
    const expectedVersion = Number(body.expectedVersion);
    const refKind = body.refKind as ConversionDefinitionUsageKind;
    const refVersionId = body.refVersionId === null || body.refVersionId === undefined
      ? null
      : typeof body.refVersionId === 'string' ? body.refVersionId.trim() : '';
    if (!lineAccountId || !refId || refId.length > 200
      || !Number.isInteger(expectedVersion) || expectedVersion < 1
      || !CONVERSION_DEFINITION_USAGE_KINDS.includes(refKind)
      || (refVersionId !== null && (!refVersionId || refVersionId.length > 200))) {
      return c.json({ success: false, error: 'lineAccountId、expectedVersion、refKind、refIdを正しく指定してください' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [lineAccountId])) {
      return c.json({ success: false, error: '成果地点が見つかりません' }, 404);
    }
    const result = await addConversionDefinitionUsage(c.env.DB, {
      conversionPointId: c.req.param('id'),
      lineAccountId,
      expectedVersion,
      refKind,
      refId,
      refVersionId,
      staffId: c.get('staff')!.id,
    });
    auditLog(c, 'conversion.definition.usage.create', {
      kind: `conversion_definition_usage:${refKind}`,
      id: c.req.param('id'),
    });
    return c.json({ success: true, data: result }, result.created ? 201 : 200);
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// GET /api/conversions/export - same filters as the list, bounded to 10,000 rows
conversions.get('/api/conversions/export', conversionPermission('export'), async (c) => {
  try {
    const range = conversionRange(c);
    if (!range.ok) return range.response;
    const filters = definitionFilters(c);
    if (!filters.ok) return filters.response;
    const scope = await conversionDefinitionScope(c, filters.value.lineAccountId);
    if (!scope.ok) return scope.response;
    const items = await listConversionDefinitionsForExport(c.env.DB, {
      scope: scope.value,
      ...filters.value,
      range: range.range,
    });
    const headers = [
      '期間開始', '期間終了', 'タイムゾーン', '純額定義', '成果地点ID', '成果地点名',
      '起点', '状態', '成果件数', '純成果件数', '取消件数', '純金額', '利用先数', '更新日時',
    ];
    const rows = items.map((item) => [
      range.range.from,
      range.range.to,
      range.range.timeZone,
      item.metrics.reversalReason,
      item.id,
      item.name,
      item.sourceType,
      item.status,
      item.metrics.recordedCount,
      item.metrics.netCount,
      item.metrics.reversedCount,
      item.metrics.netValue,
      item.usageCount,
      item.updatedAt,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}\r\n`;
    auditLog(c, 'conversion.report.export', {
      kind: 'conversion_definition_export', id: String(items.length),
    });
    return new Response(csv, {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="conversion-definitions-${jstDate(new Date())}.csv"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// GET /api/conversions/points - list all
conversions.get('/api/conversions/points', async (c) => {
  try {
    const visibleIds = await visibleConversionPointIds(c);
    const items = (await getConversionPoints(c.env.DB)).filter((item) => visibleIds.has(item.id));
    return c.json({
      success: true,
      data: items.map(serializeConversionPoint),
    });
  } catch (err) {
    console.error('GET /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<ConversionPointBody>();

    if (!body.name || !body.eventType) {
      return c.json({ success: false, error: 'name and eventType are required' }, 400);
    }

    const options = readMeasureOptions(body);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [options.value.lineAccountId as string | null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const point = await createConversionPoint(c.env.DB, {
      name: String(body.name),
      eventType: String(body.eventType),
      value: body.value === null || body.value === undefined ? null : Number(body.value),
      ...options.value,
    });
    return c.json({ success: true, data: serializeConversionPoint(point) }, 201);
  } catch (err) {
    console.error('POST /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/conversions/points/:id - update
// 送られた項目だけを触る。画面が「計測方法だけ変える」ような部分更新をするため。
conversions.put('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, async (c) => {
  try {
    const id = c.req.param('id');
    const current = await getConversionPointById(c.env.DB, id);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<ConversionPointBody>();
    const options = readMeasureOptions(body, current);
    if (!options.ok) return c.json({ success: false, error: options.error }, 400);
    if ('lineAccountId' in options.value
      && !await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [options.value.lineAccountId as string | null])) {
      return c.json({ success: false, error: 'このLINEアカウントを操作する権限がありません' }, 403);
    }

    const patch: Record<string, unknown> = { ...options.value };
    if (body.name !== undefined) {
      const name = String(body.name).trim();
      if (!name) return c.json({ success: false, error: 'name must not be empty' }, 400);
      patch.name = name;
    }
    if (body.eventType !== undefined) patch.eventType = String(body.eventType);
    if ('value' in body) {
      patch.value = body.value === null || body.value === '' ? null : Number(body.value);
    }

    const point = await updateConversionPoint(c.env.DB, id, patch);
    if (!point) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeConversionPoint(point) });
  } catch (err) {
    console.error('PUT /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/conversions/points/:id - stop tracking and preserve history
conversions.delete('/api/conversions/points/:id', requireRole('owner', 'admin'), requireVisibleConversionPoint, async (c) => {
  try {
    await stopConversionPoint(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
conversions.post('/api/conversions/track', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      conversionPointId: string;
      friendId: string;
      userId?: string | null;
      affiliateCode?: string | null;
      metadata?: Record<string, unknown> | null;
      idempotencyKey?: string | null;
    }>();

    if (!body.conversionPointId || !body.friendId) {
      return c.json(
        { success: false, error: 'conversionPointId and friendId are required' },
        400,
      );
    }

    const [pointAccount, friendAccount] = await Promise.all([
      c.env.DB.prepare('SELECT line_account_id, status FROM conversion_points WHERE id = ?')
        .bind(body.conversionPointId).first<{ line_account_id: string | null; status: string }>(),
      c.env.DB.prepare('SELECT line_account_id FROM friends WHERE id = ?')
        .bind(body.friendId).first<{ line_account_id: string | null }>(),
    ]);
    if (!pointAccount || !friendAccount || !await canAccessAllLineAccounts(
      c.env.DB,
      c.get('staff'),
      [pointAccount.line_account_id, friendAccount.line_account_id],
    )) {
      return c.json({ success: false, error: 'このコンバージョンを記録する権限がありません' }, 403);
    }
    if (pointAccount.status === 'stopped') {
      return c.json({ success: false, error: 'この成果地点は計測を停止しています' }, 409);
    }
    if (
      body.idempotencyKey !== undefined
      && (typeof body.idempotencyKey !== 'string'
        || body.idempotencyKey.length < 1
        || body.idempotencyKey.length > 200)
    ) {
      return c.json({ success: false, error: 'idempotencyKey must be 1 to 200 characters' }, 400);
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId: body.conversionPointId,
      friendId: body.friendId,
      userId: body.userId,
      affiliateCode: body.affiliateCode,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
      idempotencyKey: body.idempotencyKey ?? null,
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        conversionPointId: event.conversion_point_id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateCode: event.affiliate_code,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/track error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/events - list events with filters
conversions.get('/api/conversions/events', async (c) => {
  try {
    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const events = await getConversionEvents(c.env.DB, {
      scope: { allowedAccountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned },
      conversionPointId: c.req.query('conversionPointId'),
      friendId: c.req.query('friendId'),
      affiliateCode: c.req.query('affiliateCode'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      limit: listLimit(c.req.query('limit'), 100),
      offset: listOffset(c.req.query('offset')),
    });

    return c.json({
      success: true,
      data: events.map((e) => ({
        id: e.id,
        conversionPointId: e.conversion_point_id,
        friendId: e.friend_id,
        userId: e.user_id,
        affiliateCode: e.affiliate_code,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/report - V6 report; keep the old date-query response for the current screen
conversions.get('/api/conversions/report', conversionPermission('view'), async (c) => {
  try {
    if (c.req.query('startDate') !== undefined || c.req.query('endDate') !== undefined) {
      const visibleIds = await visibleConversionPointIds(c);
      const report = (await getConversionReport(c.env.DB, {
        startDate: c.req.query('startDate'),
        endDate: c.req.query('endDate'),
      })).filter((row) => visibleIds.has(row.conversionPointId));
      return c.json({ success: true, data: report });
    }

    const range = conversionRange(c);
    if (!range.ok) return range.response;
    const lineAccountId = c.req.query('lineAccountId');
    const scope = await conversionDefinitionScope(c, lineAccountId);
    if (!scope.ok) return scope.response;
    const data = await getConversionDefinitionReport(c.env.DB, {
      scope: scope.value,
      lineAccountId,
      range: range.range,
      previousRange: range.previousRange,
    });
    return c.json({ success: true, data });
  } catch (error) {
    return conversionContractError(c, error);
  }
});

// ── Approval Queue (ASP Phase 2) ─────────────────────────────────────────────

const APPROVAL_STATUSES = new Set(['pending', 'approved', 'rejected']);

// GET /api/conversions/approvals?status=pending|approved|rejected
// Affiliate-attributed CVs awaiting/holding an approval decision. duplicateFlag
// reuses the Phase 1 identity_key heuristic scoped per affiliate.
conversions.get('/api/conversions/approvals', async (c) => {
  try {
    const status = c.req.query('status') ?? 'pending';
    if (!APPROVAL_STATUSES.has(status)) {
      return c.json(
        { success: false, error: 'status must be pending, approved, or rejected' },
        400,
      );
    }

    const limit = listLimit(c.req.query('limit'), 200);
    const offset = listOffset(c.req.query('offset'));

    const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
    const rows = await getConversionApprovalQueue(c.env.DB, {
      scope: { allowedAccountIds: scope.allowedAccountIds, includeUnassigned: scope.canSeeUnassigned },
      status: status as 'pending' | 'approved' | 'rejected',
      identityKeySql: IDENTITY_KEY_SQL,
      limit,
      offset,
    });

    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('GET /api/conversions/approvals error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/conversions/events/:id/approval - approve/reject an attributed CV
conversions.patch('/api/conversions/events/:id/approval', requireRole('owner', 'admin'), requireVisibleConversionEvent, async (c) => {
  auditLog(c, 'conversion.approval.update', { kind: 'conversion_event', id: c.req.param('id') });
  try {
    const body = await c.req
      .json<{ status?: string }>()
      .catch(() => ({}) as { status?: string });

    if (body.status !== 'approved' && body.status !== 'rejected') {
      return c.json(
        { success: false, error: 'status must be approved or rejected' },
        400,
      );
    }

    const updated = await setConversionApproval(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );
    if (updated === false) {
      // Missing event OR non-attributed CV (approval flow only applies to
      // affiliate-attributed rows) — both surface as 404.
      return c.json(
        { success: false, error: 'Attributed conversion event not found' },
        404,
      );
    }

    // Mileage projection is retry-safe and runs even for `already_set`. This is
    // deliberate: if an earlier request updated the approval row but failed
    // before writing the ledger, the operator's retry repairs the partial work.
    await syncAffiliateConversionMileage(
      c.env.DB,
      c.req.param('id'),
      body.status,
    );

    if (updated === 'already_set') {
      // Idempotent re-click: the status is already set to the requested value.
      // Return 200 so the UI does not show an error to the operator.
      return c.json({
        success: true,
        data: { id: c.req.param('id'), approvalStatus: body.status },
      });
    }

    // ASP: notify the attributed affiliate on approval only (never on reject).
    // Best-effort — notifyAffiliateApproval swallows its own errors, but guard
    // the info lookup too so a push failure can never fail the approval request.
    if (body.status === 'approved') {
      try {
        const info = await getConversionApprovalNotifyInfo(c.env.DB, c.req.param('id'));
        if (info) {
          await notifyAffiliateApproval(
            c.env.DB,
            c.env,
            info.affiliateId,
            info.offerName,
            info.rewardAmount,
          );
        }
      } catch (err) {
        console.error('Affiliate approval notify failed (non-blocking):', err);
      }
    }

    return c.json({ success: true, data: { id: c.req.param('id'), approvalStatus: body.status } });
  } catch (err) {
    console.error('PATCH /api/conversions/events/:id/approval error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { conversions };
