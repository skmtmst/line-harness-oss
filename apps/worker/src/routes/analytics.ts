import { Hono, type Context } from 'hono';
import {
  getDailyMessageCounts,
  getLinkClickSummary,
  getTrackedLinkStats,
  getBroadcastSummary,
  buildFunnelResult,
  getFunnelsWithCurrentVersions,
  getLegacyFunnels,
  getFunnelById,
  getFunnelSteps,
  createFunnel,
  deleteFunnel,
  countFunnelStep,
  createVersionedFunnel,
  createFunnelVersion,
  runChronologicalFunnel,
  getLatestFunnelRun,
  createFunnelResultAudience,
  createAnalyticsCrossRun,
  getAnalyticsCrossRun,
  createAnalyticsCrossAudience,
  getCurrentFunnelVersion,
  getAnalyticsFriendsOverview,
  getAnalyticsReactionsOverview,
  getAnalyticsRoutesOverview,
  getAnalyticsUrlClicksOverview,
  getAnalyticsUsageOverview,
  createSavedAnalyticsFromResult,
  getSavedAnalytics,
  getSavedAnalyticsSnapshots,
  ANALYTICS_REPORT_SECTIONS,
  createAnalyticsReportSchedule,
  getAnalyticsReportSchedules,
  getStaffMembers,
  getStaffAccountScopeIds,
  getLineAccountById,
  DEFAULT_TENANT_ID,
  FUNNEL_STEP_KINDS,
  type Funnel,
  type FunnelStepKind,
  type AnalyticsOverviewContext,
  type AnalyticsReportAlertRule,
  type AnalyticsReportChannel,
  type AnalyticsReportRecipient,
  type AnalyticsReportSection,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';

/**
 * 集計。
 *
 * 新しいテーブルは作らず、既にあるデータをその場で数える。
 * 外部APIも叩かないので、ここが外の障害で落ちることはない。
 */
const analytics = new Hono<Env>();

async function resolveAccount(c: Context<Env>): Promise<
  { ok: true; accountId: string } | { ok: false; response: Response }
> {
  const accountId = c.req.query('account_id')?.trim();
  if (!accountId) {
    return {
      ok: false,
      response: c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400),
    };
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(accountId)) {
    return { ok: false, response: c.json({ success: false, error: 'Not found' }, 404) };
  }
  return { ok: true, accountId };
}

/**
 * 期間を読む。
 *
 * 既定は直近30日。上限を置いているのは、期間を長くするほど
 * 走査する行が増えるため。1年を超える集計が要るなら、
 * 貯める仕組みを作ってからにする。
 */
const MAX_RANGE_DAYS = 366;

function readRange(
  c: { req: { query: (k: string) => string | undefined } },
): { ok: true; value: { from: string; to: string } } | { ok: false; error: string } {
  const jstNow = new Date(Date.now() + 9 * 3600_000);
  const toRaw = c.req.query('to') ?? jstNow.toISOString().slice(0, 10);
  const fromRaw =
    c.req.query('from') ??
    new Date(jstNow.getTime() - 30 * 24 * 3600_000).toISOString().slice(0, 10);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) {
    return { ok: false, error: '期間は 2026-08-01 の形で指定してください' };
  }
  if (fromRaw > toRaw) {
    return { ok: false, error: '開始日が終了日より後になっています' };
  }
  const days = (Date.parse(`${toRaw}T00:00:00Z`) - Date.parse(`${fromRaw}T00:00:00Z`)) / 86_400_000;
  if (days > MAX_RANGE_DAYS) {
    return { ok: false, error: `期間は ${MAX_RANGE_DAYS} 日までにしてください` };
  }
  // 終了日はその日いっぱいを含める。'2026-08-16' で切ると、その日のぶんが
  // まるごと落ちる。
  return { ok: true, value: { from: fromRaw, to: `${toRaw}T23:59:59.999` } };
}

const MAX_OVERVIEW_RANGE_DAYS = 397;

function isDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function addDateDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateInZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function zoneOffsetMs(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value);
  const number = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(
    number('year'), number('month') - 1, number('day'),
    number('hour'), number('minute'), number('second'),
  ) - value.getTime();
}

function zonedDateStart(value: string, timeZone: string): string {
  const [year, month, day] = value.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    guess = target - zoneOffsetMs(new Date(guess), timeZone);
  }
  return new Date(guess).toISOString();
}

function nextReportRun(input: {
  cadence: 'weekly' | 'monthly'; weekday: number | null; monthDay: number | null;
  sendTime: string; timeZone: string; now: Date;
}): string {
  const currentDate = dateInZone(input.now, input.timeZone);
  const [hour, minute] = input.sendTime.split(':').map(Number);
  const candidateDate = new Date(`${currentDate}T00:00:00.000Z`);
  if (input.cadence === 'weekly') {
    const currentWeekday = new Date(`${currentDate}T12:00:00.000Z`).getUTCDay();
    candidateDate.setUTCDate(candidateDate.getUTCDate() + ((input.weekday! - currentWeekday + 7) % 7));
  } else {
    candidateDate.setUTCDate(input.monthDay!);
    if (candidateDate.toISOString().slice(0, 10) < currentDate) candidateDate.setUTCMonth(candidateDate.getUTCMonth() + 1);
  }
  const asDate = candidateDate.toISOString().slice(0, 10);
  let instant = Date.parse(zonedDateStart(asDate, input.timeZone)) + hour * 3_600_000 + minute * 60_000;
  if (instant <= input.now.getTime()) {
    if (input.cadence === 'weekly') instant += 7 * 86_400_000;
    else {
      candidateDate.setUTCMonth(candidateDate.getUTCMonth() + 1);
      instant = Date.parse(zonedDateStart(candidateDate.toISOString().slice(0, 10), input.timeZone))
        + hour * 3_600_000 + minute * 60_000;
    }
  }
  return new Date(instant).toISOString();
}

function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) && value.length <= 254;
}

function parseReportBody(raw: unknown): { ok: true; value: {
  name: string; sections: AnalyticsReportSection[]; savedAnalysisIds: string[];
  cadence: 'weekly' | 'monthly'; weekday: number | null; monthDay: number | null;
  sendTime: string; timeZone: string; periodDays: number;
  recipients: AnalyticsReportRecipient[]; channels: AnalyticsReportChannel[];
  alertRules: AnalyticsReportAlertRule[];
} } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: '入力内容が正しくありません' };
  const body = raw as Record<string, unknown>;
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name || name.length > 120) return { ok: false, error: 'レポート名は1〜120文字で入力してください' };
  const sections = Array.isArray(body.sections)
    ? [...new Set(body.sections.filter((item): item is AnalyticsReportSection =>
      typeof item === 'string' && (ANALYTICS_REPORT_SECTIONS as readonly string[]).includes(item)))]
    : [];
  const savedAnalysisIds = Array.isArray(body.savedAnalysisIds)
    ? [...new Set(body.savedAnalysisIds.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim()))]
    : [];
  if (!sections.length && !savedAnalysisIds.length) return { ok: false, error: 'レポートに入れる項目を選んでください' };
  const cadence = body.cadence === 'monthly' ? 'monthly' : body.cadence === 'weekly' ? 'weekly' : null;
  const weekday = Number.isInteger(body.weekday) ? Number(body.weekday) : null;
  const monthDay = Number.isInteger(body.monthDay) ? Number(body.monthDay) : null;
  if (!cadence || (cadence === 'weekly' && (weekday === null || weekday < 0 || weekday > 6))
    || (cadence === 'monthly' && (monthDay === null || monthDay < 1 || monthDay > 28))) {
    return { ok: false, error: '送信間隔と日を確認してください' };
  }
  const sendTime = typeof body.sendTime === 'string' ? body.sendTime : '';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(sendTime)) return { ok: false, error: '送信時刻を確認してください' };
  const timeZone = typeof body.timeZone === 'string' ? body.timeZone.trim() : '';
  try { new Intl.DateTimeFormat('ja-JP', { timeZone }).format(new Date()); } catch { return { ok: false, error: 'タイムゾーンが正しくありません' }; }
  const periodDays = Number(body.periodDays);
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 397) return { ok: false, error: '集計期間は1〜397日で指定してください' };
  const channels = Array.isArray(body.channels)
    ? [...new Set(body.channels.filter((item): item is AnalyticsReportChannel => item === 'dashboard' || item === 'email' || item === 'line'))]
    : [];
  if (!channels.length) return { ok: false, error: '通知方法を選んでください' };
  const recipients: AnalyticsReportRecipient[] = [];
  for (const item of Array.isArray(body.recipients) ? body.recipients : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const value = item as Record<string, unknown>;
    const label = typeof value.label === 'string' ? value.label.trim().slice(0, 120) : '';
    if (value.kind === 'staff' && typeof value.staffId === 'string' && value.staffId.trim()) {
      recipients.push({ kind: 'staff', staffId: value.staffId.trim(), label: label || 'ログインユーザー' });
    } else if (value.kind === 'email' && typeof value.email === 'string' && isEmail(value.email.trim())) {
      recipients.push({ kind: 'email', email: value.email.trim().toLowerCase(), label: label || value.email.trim() });
    }
  }
  if (!recipients.length) return { ok: false, error: '受け取る人を選んでください' };
  const alertRules = Array.isArray(body.alertRules) ? body.alertRules.flatMap((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    const metric = value.metric;
    const operator = value.operator;
    const threshold = Number(value.threshold);
    const minimumSample = Number(value.minimumSample);
    if ((metric !== 'block_rate' && metric !== 'friend_adds' && metric !== 'conversions')
      || (operator !== 'greater_than' && operator !== 'decrease_percent' && operator !== 'zero_streak_days')
      || !Number.isFinite(threshold) || threshold < 0
      || !Number.isInteger(minimumSample) || minimumSample < 1) return [];
    return [{ metric, operator, threshold, minimumSample } as AnalyticsReportAlertRule];
  }) : [];
  return { ok: true, value: { name, sections, savedAnalysisIds, cadence, weekday: cadence === 'weekly' ? weekday : null,
    monthDay: cadence === 'monthly' ? monthDay : null, sendTime, timeZone, periodDays, recipients, channels, alertRules } };
}

export function readAnalyticsOverviewRange(
  query: (key: string) => string | undefined,
  timeZone: string,
  now = new Date(),
): { ok: true; value: Omit<AnalyticsOverviewContext, 'lineAccountId'> } |
   { ok: false; error: string } {
  const toDate = query('to') ?? dateInZone(now, timeZone);
  const fromDate = query('from') ?? addDateDays(toDate, -29);
  if (!isDateOnly(fromDate) || !isDateOnly(toDate)) {
    return { ok: false, error: '期間は 2026-08-01 の形で指定してください' };
  }
  if (fromDate > toDate) {
    return { ok: false, error: '開始日が終了日より後になっています' };
  }
  const days = Math.round(
    (Date.parse(`${toDate}T00:00:00.000Z`) - Date.parse(`${fromDate}T00:00:00.000Z`)) /
      86_400_000,
  ) + 1;
  if (days > MAX_OVERVIEW_RANGE_DAYS) {
    return { ok: false, error: '詳細な分析は13か月までにしてください' };
  }
  return {
    ok: true,
    value: {
      timeZone,
      fromDate,
      toDate,
      from: zonedDateStart(fromDate, timeZone),
      toExclusive: zonedDateStart(addDateDays(toDate, 1), timeZone),
      dataCutoffAt: now.toISOString(),
    },
  };
}

async function overviewContext(
  c: Context<Env>,
  accountId: string,
): Promise<{ ok: true; value: AnalyticsOverviewContext } | { ok: false; response: Response }> {
  const selected = await getLineAccountById(c.env.DB, accountId);
  if (!selected) return { ok: false, response: c.json({ success: false, error: 'Not found' }, 404) };
  const range = readAnalyticsOverviewRange(
    (key) => c.req.query(key),
    selected.timezone || 'Asia/Tokyo',
  );
  if (!range.ok) {
    return { ok: false, response: c.json({ success: false, error: range.error }, 400) };
  }
  return { ok: true, value: { lineAccountId: accountId, ...range.value } };
}

function serializeFunnel(f: Funnel) {
  return {
    id: f.id,
    name: f.name,
    windowDays: f.window_days,
    createdAt: f.created_at,
  };
}

function explicitTimestamp(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/(Z|[+-]\d{2}:?\d{2})$/.test(value)) throw new Error(code);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(code);
  return parsed.toISOString();
}

function funnelErrorStatus(error: unknown): 404 | 422 | 500 {
  const message = error instanceof Error ? error.message : '';
  if (message.endsWith('_not_found')) return 404;
  if (message.startsWith('analytics_funnel_')
      || message.startsWith('analytics_cross_')
      || message.startsWith('analytics_saved_')) return 422;
  return 500;
}

analytics.get('/api/analytics/friends', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const context = await overviewContext(c, account.accountId);
    if (!context.ok) return context.response;
    return c.json({ success: true, data: await getAnalyticsFriendsOverview(c.env.DB, context.value) });
  } catch (error) {
    console.error('GET /api/analytics/friends error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.get('/api/analytics/reactions', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const context = await overviewContext(c, account.accountId);
    if (!context.ok) return context.response;
    return c.json({ success: true, data: await getAnalyticsReactionsOverview(c.env.DB, context.value) });
  } catch (error) {
    console.error('GET /api/analytics/reactions error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.get('/api/analytics/routes', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const context = await overviewContext(c, account.accountId);
    if (!context.ok) return context.response;
    return c.json({ success: true, data: await getAnalyticsRoutesOverview(c.env.DB, context.value) });
  } catch (error) {
    console.error('GET /api/analytics/routes error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.get('/api/analytics/url-clicks', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const context = await overviewContext(c, account.accountId);
    if (!context.ok) return context.response;
    const limitRaw = c.req.query('limit');
    const limit = limitRaw === undefined ? 200 : Number(limitRaw);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      return c.json({ success: false, error: '表示件数は1〜200で指定してください' }, 400);
    }
    return c.json({
      success: true,
      data: await getAnalyticsUrlClicksOverview(c.env.DB, context.value, limit),
    });
  } catch (error) {
    console.error('GET /api/analytics/url-clicks error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.get('/api/analytics/usage', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const context = await overviewContext(c, account.accountId);
    if (!context.ok) return context.response;
    return c.json({ success: true, data: await getAnalyticsUsageOverview(c.env.DB, context.value) });
  } catch (error) {
    console.error('GET /api/analytics/usage error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/messages — 日ごとの送受信数
analytics.get('/api/analytics/messages', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getDailyMessageCounts(c.env.DB, account.accountId, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/messages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/tracked-links — 測定中のURLと、その期間のクリック
// link-clicks と違い、1回も押されていないURLも返す。
analytics.get('/api/analytics/tracked-links', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getTrackedLinkStats(c.env.DB, account.accountId, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/tracked-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/link-clicks — リンクごとのクリック
analytics.get('/api/analytics/link-clicks', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getLinkClickSummary(c.env.DB, account.accountId, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/link-clicks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/analytics/broadcasts — 配信ごとの成績
analytics.get('/api/analytics/broadcasts', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);
    const items = await getBroadcastSummary(c.env.DB, account.accountId, range.value);
    return c.json({ success: true, data: items });
  } catch (err) {
    console.error('GET /api/analytics/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// V6: クロス分析はCronで非同期実行し、HTTPの処理時間とD1負荷を固定する。
analytics.post('/api/analytics/cross/query', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const selectedAccount = await getLineAccountById(c.env.DB, account.accountId);
    if (!selectedAccount) return c.json({ success: false, error: 'Not found' }, 404);
    // 実行は重い。終わっていない自分の集計がある間は受け付けない。
    // 実行ボタンは運用担当にも出しているので、権限ではなく間隔で守る。
    const busy = await c.env.DB
      .prepare(
        `SELECT id FROM analytics_cross_runs
          WHERE line_account_id = ? AND state IN ('pending', 'running')
          LIMIT 1`,
      )
      .bind(account.accountId)
      .first<{ id: string }>();
    if (busy) return c.json({ success: false, error: 'analytics_cross_busy' }, 429);
    const body = await c.req.json<unknown>();
    const result = await createAnalyticsCrossRun(c.env.DB, {
      lineAccountId: account.accountId,
      query: body,
      timeZone: selectedAccount.timezone || 'Asia/Tokyo',
      dataCutoffAt: new Date().toISOString(),
      createdBy: c.get('staff').id,
    });
    return c.json({ success: true, data: result }, 202);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/cross/query error:', error);
    return c.json({
      success: false,
      error: status === 500 ? 'Internal server error' : (error as Error).message,
    }, status);
  }
});

analytics.get('/api/analytics/cross/results/:id', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const result = await getAnalyticsCrossRun(c.env.DB, account.accountId, c.req.param('id'));
    if (!result) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: result });
  } catch (error) {
    console.error('GET /api/analytics/cross/results/:id error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 保存した分析 ─────────────────────────────────────────────

analytics.get('/api/analytics/saved', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    return c.json({ success: true, data: await getSavedAnalytics(c.env.DB, account.accountId) });
  } catch (error) {
    console.error('GET /api/analytics/saved error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.post('/api/analytics/saved', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const body = await c.req.json<{
      name?: unknown;
      sourceKind?: unknown;
      sourceResultId?: unknown;
    }>();
    if (body.sourceKind !== 'cross' && body.sourceKind !== 'funnel') {
      return c.json({ success: false, error: '分析の種類が不正です' }, 422);
    }
    if (typeof body.sourceResultId !== 'string' || !body.sourceResultId.trim()) {
      return c.json({ success: false, error: '保存する分析結果が必要です' }, 422);
    }
    const staff = c.get('staff');
    const result = await createSavedAnalyticsFromResult(c.env.DB, {
      lineAccountId: account.accountId,
      name: typeof body.name === 'string' ? body.name : '',
      sourceKind: body.sourceKind,
      sourceResultId: body.sourceResultId.trim(),
      createdBy: staff.id,
      createdByName: staff.name,
      createdAt: new Date().toISOString(),
    });
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/saved error:', error);
    return c.json({
      success: false,
      error: status === 500 ? 'Internal server error' : (error as Error).message,
    }, status);
  }
});

analytics.get('/api/analytics/saved/:id/snapshots', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const items = await getSavedAnalyticsSnapshots(c.env.DB, account.accountId, c.req.param('id'));
    if (!items) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: items });
  } catch (error) {
    console.error('GET /api/analytics/saved/:id/snapshots error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 定期レポート ────────────────────────────────────────────

async function reportRecipientOptions(c: Context<Env>, accountId: string) {
  const signedIn = c.get('staff');
  const members = await getStaffMembers(c.env.DB, signedIn.tenantId ?? DEFAULT_TENANT_ID);
  const visible = [];
  for (const member of members) {
    if (!member.is_active || member.invite_status !== 'active') continue;
    if (member.account_scope === 'accounts') {
      const scope = await getStaffAccountScopeIds(c.env.DB, member.id);
      if (!scope.includes(accountId)) continue;
    }
    visible.push({
      id: member.id, name: member.name, role: member.role,
      email: member.email, lineLinked: Boolean(member.line_user_id),
    });
  }
  return visible;
}

analytics.get('/api/analytics/report-schedules', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const selected = await getLineAccountById(c.env.DB, account.accountId);
    if (!selected) return c.json({ success: false, error: 'Not found' }, 404);
    const [items, savedAnalyses, recipients] = await Promise.all([
      getAnalyticsReportSchedules(c.env.DB, account.accountId),
      getSavedAnalytics(c.env.DB, account.accountId),
      reportRecipientOptions(c, account.accountId),
    ]);
    return c.json({
      success: true,
      data: {
        items,
        options: {
          timeZone: selected.timezone || 'Asia/Tokyo',
          savedAnalyses: savedAnalyses.map((item) => ({ id: item.id, name: item.name, kind: item.kind })),
          recipients,
        },
      },
    });
  } catch (error) {
    console.error('GET /api/analytics/report-schedules error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.post('/api/analytics/report-schedules', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const rawBody = await c.req.json<unknown>();
    const parsed = parseReportBody(rawBody);
    if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 422);
    const selected = await getLineAccountById(c.env.DB, account.accountId);
    if (!selected) return c.json({ success: false, error: 'Not found' }, 404);
    if ((selected.timezone || 'Asia/Tokyo') !== parsed.value.timeZone) {
      return c.json({ success: false, error: '選択中のLINEアカウントとタイムゾーンが一致しません' }, 422);
    }
    const [saved, recipientOptions] = await Promise.all([
      getSavedAnalytics(c.env.DB, account.accountId),
      reportRecipientOptions(c, account.accountId),
    ]);
    const visibleSavedIds = new Set(saved.map((item) => item.id));
    if (!parsed.value.savedAnalysisIds.every((id) => visibleSavedIds.has(id))) {
      return c.json({ success: false, error: '選べない保存済み分析が含まれています' }, 422);
    }
    const staffById = new Map(recipientOptions.map((item) => [item.id, item]));
    if (!parsed.value.recipients.every((recipient) => recipient.kind === 'email'
      || Boolean(recipient.staffId && staffById.has(recipient.staffId)))) {
      return c.json({ success: false, error: 'このLINEアカウントを見られない宛先が含まれています' }, 422);
    }
    if (parsed.value.channels.includes('email')) {
      const hasEmail = parsed.value.recipients.some((recipient) => recipient.kind === 'email'
        || Boolean(recipient.staffId && staffById.get(recipient.staffId)?.email));
      if (!hasEmail) return c.json({ success: false, error: 'メールを受け取れる宛先がありません' }, 422);
    }
    if (parsed.value.channels.includes('line')) {
      const hasLine = parsed.value.recipients.some((recipient) => recipient.kind === 'staff'
        && Boolean(recipient.staffId && staffById.get(recipient.staffId)?.lineLinked));
      if (!hasLine) return c.json({ success: false, error: 'LINE連携済みの宛先がありません' }, 422);
    }
    const now = new Date();
    const sendOnce = Boolean(rawBody && typeof rawBody === 'object' && !Array.isArray(rawBody)
      && (rawBody as Record<string, unknown>).sendOnce === true);
    const item = await createAnalyticsReportSchedule(c.env.DB, {
      lineAccountId: account.accountId,
      ...parsed.value,
      nextRunAt: sendOnce ? now.toISOString() : nextReportRun({
        cadence: parsed.value.cadence, weekday: parsed.value.weekday,
        monthDay: parsed.value.monthDay, sendTime: parsed.value.sendTime,
        timeZone: parsed.value.timeZone, now,
      }),
      createdBy: c.get('staff').id,
      now: now.toISOString(),
      isOneTime: sendOnce,
    });
    return c.json({ success: true, data: item }, 201);
  } catch (error) {
    console.error('POST /api/analytics/report-schedules error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── ファネル ────────────────────────────────────────────────

analytics.get('/api/funnels', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const items = await getLegacyFunnels(c.env.DB, account.accountId);
    return c.json({ success: true, data: items.map(serializeFunnel) });
  } catch (err) {
    console.error('GET /api/funnels error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// V6: 作成時点の段・期間・比較条件を第1版として固定する。
analytics.get('/api/analytics/funnels', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const page = Number(c.req.query('page') ?? 1);
    const pageSize = Number(c.req.query('pageSize') ?? 200);
    if (!Number.isInteger(page) || page < 1) {
      return c.json({ success: false, error: 'ページは1以上の整数で指定してください' }, 400);
    }
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 200) {
      return c.json({ success: false, error: '表示件数は1〜200で指定してください' }, 400);
    }
    const result = await getFunnelsWithCurrentVersions(
      c.env.DB,
      account.accountId,
      { page, pageSize },
    );
    const items = result.items.map((funnel) => ({
      ...serializeFunnel(funnel),
      currentVersion: funnel.currentVersion,
      migrationState: funnel.currentVersion ? 'ready' : 'needs_migration',
    }));
    return c.json({
      success: true,
      data: items,
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
    });
  } catch (error) {
    console.error('GET /api/analytics/funnels error:', error);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.post('/api/analytics/funnels', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const body = await c.req.json<{
      name?: unknown; windowDays?: unknown; steps?: unknown;
      segment?: unknown; comparisonGroups?: unknown;
    }>();
    const created = await createVersionedFunnel(c.env.DB, {
      lineAccountId: account.accountId,
      name: typeof body.name === 'string' ? body.name : '',
      windowDays: body.windowDays === undefined ? 30 : Number(body.windowDays),
      steps: body.steps,
      segment: body.segment,
      comparisonGroups: body.comparisonGroups,
      createdBy: c.get('staff').id,
      createdAt: new Date().toISOString(),
    });
    return c.json({ success: true, data: created }, 201);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/funnels error:', error);
    return c.json({ success: false, error: status === 500 ? 'Internal server error' : (error as Error).message }, status);
  }
});

analytics.post('/api/analytics/funnels/:id/versions', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const body = await c.req.json<{
      windowDays?: unknown; steps?: unknown; segment?: unknown; comparisonGroups?: unknown;
    }>();
    const version = await createFunnelVersion(c.env.DB, {
      lineAccountId: account.accountId,
      funnelId: c.req.param('id'),
      windowDays: Number(body.windowDays),
      steps: body.steps,
      segment: body.segment,
      comparisonGroups: body.comparisonGroups,
      createdBy: c.get('staff').id,
      createdAt: new Date().toISOString(),
    });
    return c.json({ success: true, data: version }, 201);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/funnels/:id/versions error:', error);
    return c.json({ success: false, error: status === 500 ? 'Internal server error' : (error as Error).message }, status);
  }
});

analytics.post('/api/analytics/funnels/:id/run', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const selectedAccount = await getLineAccountById(c.env.DB, account.accountId);
    if (!selectedAccount) return c.json({ success: false, error: 'Not found' }, 404);
    // 再集計はHTTPの中で時系列計算を同期実行する。連打がD1負荷に直結するので、
    // 同一ファネルは前回から60秒は受け付けない。再集計ボタンは運用担当にも
    // 出しているので、権限ではなく間隔で守る。
    const lastRun = await c.env.DB
      .prepare(
        `SELECT created_at FROM analytics_funnel_runs
          WHERE line_account_id = ? AND funnel_id = ?
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      )
      .bind(account.accountId, c.req.param('id'))
      .first<{ created_at: string }>();
    if (lastRun && Date.now() - Date.parse(lastRun.created_at) < 60_000) {
      return c.json({ success: false, error: 'analytics_funnel_too_soon' }, 429);
    }
    const body = await c.req.json<{ cohortFrom?: unknown; cohortTo?: unknown }>();
    const result = await runChronologicalFunnel(c.env.DB, {
      lineAccountId: account.accountId,
      funnelId: c.req.param('id'),
      cohortFrom: explicitTimestamp(body.cohortFrom, 'analytics_funnel_cohort_from_invalid'),
      cohortTo: explicitTimestamp(body.cohortTo, 'analytics_funnel_cohort_to_invalid'),
      timeZone: selectedAccount.timezone || 'Asia/Tokyo',
      dataCutoffAt: new Date().toISOString(),
      createdBy: c.get('staff').id,
      persist: true,
    });
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/funnels/:id/run error:', error);
    return c.json({ success: false, error: status === 500 ? 'Internal server error' : (error as Error).message }, status);
  }
});

// 画面を開くだけでは再計算せず、最後に固定した結果を返す。
analytics.get('/api/analytics/funnels/:id/runs/latest', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const result = await getLatestFunnelRun(c.env.DB, account.accountId, c.req.param('id'));
    if (!result) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: result });
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('GET /api/analytics/funnels/:id/runs/latest error:', error);
    return c.json({
      success: false,
      error: status === 500 ? 'Internal server error' : (error as Error).message,
    }, status);
  }
});

analytics.post('/api/analytics/results/:id/audiences', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const body = await c.req.json<{
      sourceKind?: unknown; groupKey?: unknown; stepOrder?: unknown; selection?: unknown;
      rowKey?: unknown; columnKey?: unknown;
    }>();
    if (body.sourceKind === 'cross') {
      const result = await createAnalyticsCrossAudience(c.env.DB, {
        lineAccountId: account.accountId,
        runId: c.req.param('id'),
        rowKey: typeof body.rowKey === 'string' ? body.rowKey : '',
        columnKey: typeof body.columnKey === 'string' ? body.columnKey : '',
        createdBy: c.get('staff').id,
        now: new Date(),
      });
      return c.json({ success: true, data: result }, 201);
    }
    if (!['reached', 'stopped', 'in_progress'].includes(String(body.selection))) {
      return c.json({ success: false, error: '対象者の種類が不正です' }, 422);
    }
    const result = await createFunnelResultAudience(c.env.DB, {
      lineAccountId: account.accountId,
      runId: c.req.param('id'),
      groupKey: typeof body.groupKey === 'string' ? body.groupKey : undefined,
      stepOrder: Number(body.stepOrder),
      selection: body.selection as 'reached' | 'stopped' | 'in_progress',
      createdBy: c.get('staff').id,
      now: new Date(),
    });
    return c.json({ success: true, data: result }, 201);
  } catch (error) {
    const status = funnelErrorStatus(error);
    if (status === 500) console.error('POST /api/analytics/results/:id/audiences error:', error);
    return c.json({ success: false, error: status === 500 ? 'Internal server error' : (error as Error).message }, status);
  }
});

analytics.post('/api/funnels', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const body = await c.req.json<{
      name?: unknown;
      windowDays?: unknown;
      steps?: unknown;
    }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);

    if (!Array.isArray(body.steps) || body.steps.length < 2) {
      // 1段のファネルは「ただの件数」で、離脱を見るという目的を果たさない。
      return c.json({ success: false, error: '段は2つ以上にしてください' }, 422);
    }
    if (body.steps.length > 10) {
      return c.json({ success: false, error: '段は10個までです' }, 422);
    }

    const steps: Array<{ label: string; kind: FunnelStepKind; match: unknown }> = [];
    for (const raw of body.steps as unknown[]) {
      const step = raw as { label?: unknown; kind?: unknown; match?: unknown };
      const label = typeof step.label === 'string' ? step.label.trim() : '';
      if (!label) return c.json({ success: false, error: '段の名前を入力してください' }, 422);
      if (!(FUNNEL_STEP_KINDS as readonly string[]).includes(String(step.kind))) {
        return c.json({ success: false, error: `知らない段の種類です: ${String(step.kind)}` }, 422);
      }
      steps.push({ label, kind: step.kind as FunnelStepKind, match: step.match ?? {} });
    }

    const windowDays = body.windowDays === undefined ? 30 : Number(body.windowDays);
    if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 365) {
      return c.json({ success: false, error: '期間は1〜365日で指定してください' }, 422);
    }

    const funnel = await createFunnel(c.env.DB, {
      lineAccountId: account.accountId,
      name,
      windowDays,
      steps,
    });
    return c.json({ success: true, data: serializeFunnel(funnel) }, 201);
  } catch (err) {
    console.error('POST /api/funnels error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

analytics.delete('/api/funnels/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const version = await getCurrentFunnelVersion(c.env.DB, account.accountId, c.req.param('id'));
    if (version) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteFunnel(c.env.DB, account.accountId, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/funnels/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/funnels/:id/result — 段ごとの到達人数
analytics.get('/api/funnels/:id/result', async (c) => {
  try {
    const account = await resolveAccount(c);
    if (!account.ok) return account.response;
    const funnel = await getFunnelById(c.env.DB, account.accountId, c.req.param('id'));
    if (!funnel) return c.json({ success: false, error: 'Not found' }, 404);

    const range = readRange(c);
    if (!range.ok) return c.json({ success: false, error: range.error }, 400);

    // 現行画面は過去の業務台帳を読む互換APIを維持する。
    // V6の時系列結果は POST /api/analytics/funnels/:id/run で作り、
    // 取得不可・部分データを表示できるV6画面と同時に切り替える。
    const steps = await getFunnelSteps(c.env.DB, funnel.id);
    const reachedPerStep: string[][] = [];
    let scope: string[] | undefined;
    for (const step of steps) {
      const reached = await countFunnelStep(c.env.DB, step, {
        from: range.value.from,
        to: range.value.to,
        lineAccountId: account.accountId,
        friendIds: scope,
      });
      reachedPerStep.push(reached);
      scope = reached;
      if (reached.length === 0) {
        for (let i = reachedPerStep.length; i < steps.length; i++) reachedPerStep.push([]);
        break;
      }
    }

    return c.json({
      success: true,
      data: {
        funnel: serializeFunnel(funnel),
        steps: buildFunnelResult(steps, reachedPerStep),
      },
    });
  } catch (err) {
    console.error('GET /api/funnels/:id/result error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { analytics };
