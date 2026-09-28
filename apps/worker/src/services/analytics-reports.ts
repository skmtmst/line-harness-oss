import { LineClient } from '@line-crm/line-sdk';
import {
  advanceAnalyticsReportSchedule,
  archiveAnalyticsReportSchedule,
  beginAnalyticsReportRun,
  claimDueAnalyticsReportSchedules,
  createNotification,
  finishAnalyticsReportRun,
  getAnalyticsFriendsOverview,
  getAnalyticsReactionsOverview,
  getAnalyticsRoutesOverview,
  getAnalyticsUsageOverview,
  getLineAccountById,
  getSavedAnalyticsSnapshots,
  getStaffById,
  purgeExpiredAnalyticsReportRuns,
  resolveLineCredential,
  type AnalyticsOverviewContext,
  type AnalyticsReportAlertRule,
  type AnalyticsReportSchedule,
} from '@line-crm/db';
import { sendXServerMail } from './xserver-mail.js';
import { featureJobCanRun } from './feature-enforcement.js';

type AnalyticsReportEnv = {
  DB: D1Database;
  ADMIN_ORIGIN?: string;
  CONTACT_EMAIL?: string;
  XSERVER_MAIL_HOST?: string;
  XSERVER_MAIL_USER?: string;
  XSERVER_MAIL_PASSWORD?: string;
  LINE_CHANNEL_ACCESS_TOKEN: string;
  LINE_CREDENTIAL_ENCRYPTION_KEY?: string;
};

const DAY_MS = 86_400_000;

function dateInZone(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function zoneOffsetMs(value: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((item) => item.type === type)?.value ?? 0);
  return Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second')) - value.getTime();
}

function zonedStart(date: string, timeZone: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 3; attempt += 1) guess = target - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess).toISOString();
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function contextFor(schedule: AnalyticsReportSchedule, now: Date, offsetPeriods = 0): AnalyticsOverviewContext {
  const today = dateInZone(now, schedule.timeZone);
  const toDate = addDays(today, -1 - offsetPeriods * schedule.periodDays);
  const fromDate = addDays(toDate, 1 - schedule.periodDays);
  return {
    lineAccountId: schedule.lineAccountId, timeZone: schedule.timeZone, fromDate, toDate,
    from: zonedStart(fromDate, schedule.timeZone),
    toExclusive: zonedStart(addDays(toDate, 1), schedule.timeZone),
    dataCutoffAt: now.toISOString(),
  };
}

function nextRun(schedule: AnalyticsReportSchedule): string {
  const current = new Date(schedule.nextRunAt);
  if (schedule.cadence === 'weekly') return new Date(current.getTime() + 7 * DAY_MS).toISOString();
  const localDate = new Date(`${dateInZone(current, schedule.timeZone)}T00:00:00.000Z`);
  localDate.setUTCMonth(localDate.getUTCMonth() + 1);
  localDate.setUTCDate(schedule.monthDay ?? 1);
  const [hour, minute] = schedule.sendTime.split(':').map(Number);
  return new Date(Date.parse(zonedStart(localDate.toISOString().slice(0, 10), schedule.timeZone))
    + hour * 3_600_000 + minute * 60_000).toISOString();
}

function reportState(value: unknown): 'available' | 'partial' | 'unavailable' {
  const states: string[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== 'object') return;
    if (Array.isArray(item)) { item.forEach(visit); return; }
    for (const [key, child] of Object.entries(item)) {
      if (key === 'state' && typeof child === 'string') states.push(child);
      else visit(child);
    }
  };
  visit(value);
  if (states.length && states.every((state) => state === 'unavailable' || state === 'failed')) return 'unavailable';
  if (states.some((state) => state !== 'available')) return 'partial';
  return 'available';
}

/**
 * 変化通知の1条件の判定結果（R77）。
 *
 * 要件 v6-20 §4-5: 同じ長さの直前期間と比べ、最低母数を満たすときだけ
 * 判定する。取得待ち・部分データの期間は判定しない。
 */
export type AlertRuleOutcome = 'triggered' | 'ok' | 'skipped';

export interface AlertRuleEvaluation {
  metric: AnalyticsReportAlertRule['metric'];
  operator: AnalyticsReportAlertRule['operator'];
  threshold: number;
  minimumSample: number;
  outcome: AlertRuleOutcome;
  /**
   * 観測値。block_rate は %、friend_adds は前期間比の増減率 %（減少が正）、
   * conversions は 0 件が続いた日数。
   */
  observedValue: number | null;
  /** 判定に使った母数（配信件数・前期間の追加数・前期間の成果数）。 */
  sampleSize: number | null;
  /** 今期間の値（比べたものだけ）。 */
  currentValue: number | null;
  /** 比べた前期間の値（あるものだけ）。 */
  previousValue: number | null;
  /** `skipped` の理由。運用者の言葉。 */
  reason: string | null;
}

/** 集計待ち・部分データの期間は比べない（画面の注意書きと同じ文）。 */
const ALERT_PENDING_REASON = '集計待ちや一部だけ取れた期間は比べず、知らせません';

function envelopeNumber(section: unknown, path: string[]): { value: number | null; state: string } | null {
  let node: unknown = section;
  for (const key of path) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
    node = (node as Record<string, unknown>)[key];
  }
  if (!node || typeof node !== 'object' || Array.isArray(node)) return null;
  const record = node as Record<string, unknown>;
  const value = record.value;
  const state = record.state;
  if ((typeof value !== 'number' && value !== null) || typeof state !== 'string') return null;
  return { value, state };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function evaluateBlockRate(
  rule: AnalyticsReportAlertRule, current: Record<string, unknown>,
): AlertRuleEvaluation {
  const base = {
    metric: rule.metric, operator: rule.operator, threshold: rule.threshold, minimumSample: rule.minimumSample,
    observedValue: null as number | null, sampleSize: null as number | null,
    currentValue: null as number | null, previousValue: null as number | null, reason: null as string | null,
  };
  const removed = envelopeNumber(current.friends, ['metrics', 'removed']);
  const delivered = envelopeNumber(current.reactions, ['metrics', 'delivered']);
  if (!removed || !delivered) {
    return { ...base, outcome: 'skipped', reason: '判定に使う「友だちの増減」または「配信の反応」がレポートに入っていません' };
  }
  if (removed.state !== 'available' || delivered.state !== 'available') {
    return { ...base, outcome: 'skipped', reason: ALERT_PENDING_REASON };
  }
  const sent = delivered.value ?? 0;
  if (sent <= 0) return { ...base, outcome: 'skipped', reason: 'この期間の配信が0件のため比べられません' };
  if (sent < rule.minimumSample) {
    return { ...base, outcome: 'skipped', sampleSize: sent, reason: `配信が${sent}件で、判定に必要な${rule.minimumSample}件に足りません` };
  }
  const observed = round1(((removed.value ?? 0) / sent) * 100);
  return {
    ...base, outcome: observed > rule.threshold ? 'triggered' : 'ok',
    observedValue: observed, sampleSize: sent, currentValue: removed.value ?? 0,
  };
}

function evaluateFriendDecrease(
  rule: AnalyticsReportAlertRule, current: Record<string, unknown>, previous: Record<string, unknown>,
): AlertRuleEvaluation {
  const base = {
    metric: rule.metric, operator: rule.operator, threshold: rule.threshold, minimumSample: rule.minimumSample,
    observedValue: null as number | null, sampleSize: null as number | null,
    currentValue: null as number | null, previousValue: null as number | null, reason: null as string | null,
  };
  const now = envelopeNumber(current.friends, ['metrics', 'added']);
  const prev = envelopeNumber(previous.friends, ['metrics', 'added']);
  if (!now || !prev) {
    return { ...base, outcome: 'skipped', reason: '判定に使う「友だちの増減」がレポートに入っていません' };
  }
  if (now.state !== 'available' || prev.state !== 'available') {
    return { ...base, outcome: 'skipped', reason: ALERT_PENDING_REASON };
  }
  const prevValue = prev.value ?? 0;
  const nowValue = now.value ?? 0;
  if (prevValue <= 0) return { ...base, outcome: 'skipped', reason: '前期間の追加が0件のため比べられません' };
  if (prevValue < rule.minimumSample) {
    return {
      ...base, outcome: 'skipped', sampleSize: prevValue, previousValue: prevValue,
      reason: `前期間の追加が${prevValue}人で、判定に必要な${rule.minimumSample}人に足りません`,
    };
  }
  const decrease = round1(((prevValue - nowValue) / prevValue) * 100);
  return {
    ...base, outcome: decrease >= rule.threshold ? 'triggered' : 'ok',
    observedValue: decrease, sampleSize: prevValue, currentValue: nowValue, previousValue: prevValue,
  };
}

/**
 * 成果0件が続いた日数（R77）。日別の成果集計は期間別レポートに載らないため、
 * ここで直接数える。件数が多すぎるときは数えず `skipped` にする
 * （URLクリック集計の5万件打ち切りと同じ考え）。
 */
const CONVERSION_LOOKUP_CAP = 100_000;

async function dailyConversionCounts(
  db: D1Database, lineAccountId: string, fromISO: string, toExclusiveISO: string, timeZone: string,
): Promise<Map<string, number> | null> {
  const rows = await db.prepare(
    `SELECT ce.created_at AS created_at
       FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
      WHERE f.line_account_id = ?
        AND COALESCE(ce.approval_status, 'approved') != 'rejected'
        AND julianday(ce.created_at) >= julianday(?) AND julianday(ce.created_at) < julianday(?)
      LIMIT ?`,
  ).bind(lineAccountId, fromISO, toExclusiveISO, CONVERSION_LOOKUP_CAP + 1).all<{ created_at: string }>();
  if (rows.results.length > CONVERSION_LOOKUP_CAP) return null;
  const format = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const days = new Map<string, number>();
  for (const row of rows.results) {
    const day = format.format(new Date(row.created_at));
    days.set(day, (days.get(day) ?? 0) + 1);
  }
  return days;
}

async function evaluateConversionStreak(
  db: D1Database, rule: AnalyticsReportAlertRule, schedule: AnalyticsReportSchedule,
  currentContext: AnalyticsOverviewContext, previousContext: AnalyticsOverviewContext,
): Promise<AlertRuleEvaluation> {
  const base = {
    metric: rule.metric, operator: rule.operator, threshold: rule.threshold, minimumSample: rule.minimumSample,
    observedValue: null as number | null, sampleSize: null as number | null,
    currentValue: null as number | null, previousValue: null as number | null, reason: null as string | null,
  };
  const [days, prevRow] = await Promise.all([
    dailyConversionCounts(db, schedule.lineAccountId, currentContext.from, currentContext.toExclusive, schedule.timeZone),
    db.prepare(
      `SELECT COUNT(*) AS c
         FROM conversion_events ce JOIN friends f ON f.id = ce.friend_id
        WHERE f.line_account_id = ?
          AND COALESCE(ce.approval_status, 'approved') != 'rejected'
          AND julianday(ce.created_at) >= julianday(?) AND julianday(ce.created_at) < julianday(?)`,
    ).bind(schedule.lineAccountId, previousContext.from, previousContext.toExclusive).first<{ c: number }>(),
  ]);
  if (!days) return { ...base, outcome: 'skipped', reason: '成果が多く数え切れないため比べません' };
  const prevTotal = Number(prevRow?.c ?? 0);
  if (prevTotal < rule.minimumSample) {
    return {
      ...base, outcome: 'skipped', sampleSize: prevTotal, previousValue: prevTotal,
      reason: `前期間の成果が${prevTotal}件で、判定に必要な${rule.minimumSample}件に足りません`,
    };
  }
  // 期間末からさかのぼり、0件の日が何日続いているかを見る。
  let zeros = 0;
  for (let date = currentContext.toDate; date >= currentContext.fromDate; date = addDays(date, -1)) {
    if ((days.get(date) ?? 0) !== 0) break;
    zeros += 1;
  }
  return {
    ...base, outcome: zeros >= rule.threshold ? 'triggered' : 'ok',
    observedValue: zeros, sampleSize: prevTotal, currentValue: zeros, previousValue: prevTotal,
  };
}

/**
 * 知らせの決めごとを、前期間と実際に比べる（R77）。
 * 以前は設定値をそのまま「判定済み」として写していた。
 */
export async function evaluateAlertRules(
  db: D1Database, schedule: AnalyticsReportSchedule,
  current: Record<string, unknown>, previous: Record<string, unknown>,
  currentContext: AnalyticsOverviewContext, previousContext: AnalyticsOverviewContext,
): Promise<AlertRuleEvaluation[]> {
  const results: AlertRuleEvaluation[] = [];
  for (const rule of schedule.alertRules) {
    if (rule.metric === 'block_rate' && rule.operator === 'greater_than') {
      results.push(evaluateBlockRate(rule, current));
    } else if (rule.metric === 'friend_adds' && rule.operator === 'decrease_percent') {
      results.push(evaluateFriendDecrease(rule, current, previous));
    } else if (rule.metric === 'conversions' && rule.operator === 'zero_streak_days') {
      results.push(await evaluateConversionStreak(db, rule, schedule, currentContext, previousContext));
    } else {
      results.push({
        metric: rule.metric, operator: rule.operator, threshold: rule.threshold, minimumSample: rule.minimumSample,
        outcome: 'skipped', observedValue: null, sampleSize: null, currentValue: null, previousValue: null,
        reason: 'この条件の判定にはまだ対応していません',
      });
    }
  }
  return results;
}

async function buildReport(db: D1Database, schedule: AnalyticsReportSchedule, now: Date) {
  const currentContext = contextFor(schedule, now);
  const previousContext = contextFor(schedule, now, 1);
  const loaders = {
    friends: getAnalyticsFriendsOverview,
    reactions: getAnalyticsReactionsOverview,
    routes: getAnalyticsRoutesOverview,
    usage: getAnalyticsUsageOverview,
  } as const;
  const current: Record<string, unknown> = {};
  const previous: Record<string, unknown> = {};
  for (const section of schedule.sections) {
    if (section === 'mileage') {
      current.mileage = { state: 'unavailable', reason: 'マイル集計の期間別読取は未接続です', value: null };
      previous.mileage = current.mileage;
      continue;
    }
    const load = loaders[section];
    current[section] = await load(db, currentContext);
    previous[section] = await load(db, previousContext);
  }
  const savedAnalyses = [];
  for (const id of schedule.savedAnalysisIds) {
    const snapshots = await getSavedAnalyticsSnapshots(db, schedule.lineAccountId, id);
    savedAnalyses.push({ savedAnalysisId: id, snapshot: snapshots?.[0] ?? null });
  }
  const result = {
    period: { from: currentContext.fromDate, to: currentContext.toDate },
    previousPeriod: { from: previousContext.fromDate, to: previousContext.toDate },
    timeZone: schedule.timeZone,
    dataCutoffAt: currentContext.dataCutoffAt,
    current, previous, savedAnalyses,
    alertEvaluation: reportState(current) === 'available'
      ? { state: 'evaluated', results: await evaluateAlertRules(db, schedule, current, previous, currentContext, previousContext) }
      : { state: 'skipped', reason: '未取得または一部集計中の数字があるため変化通知を行いません' },
  };
  return { context: currentContext, result, state: reportState(current) };
}

const jaNumber = new Intl.NumberFormat('ja-JP');

/** 見出しの数値を1行にする。集計できていない節は行ごと出さない（R78）。 */
function headlineLines(schedule: AnalyticsReportSchedule, report: Awaited<ReturnType<typeof buildReport>>): string[] {
  const lines: string[] = [];
  const current = report.result.current as Record<string, unknown>;
  if (schedule.sections.includes('friends')) {
    const added = envelopeNumber(current.friends, ['metrics', 'added']);
    const removed = envelopeNumber(current.friends, ['metrics', 'removed']);
    const net = envelopeNumber(current.friends, ['metrics', 'net']);
    if (added?.state === 'available' && removed?.state === 'available' && net?.state === 'available') {
      const netValue = net.value ?? 0;
      lines.push(`・友だちの増減: ${netValue >= 0 ? `${jaNumber.format(netValue)}人増加` : `${jaNumber.format(-netValue)}人減少`}（新規${jaNumber.format(added.value ?? 0)}・解除${jaNumber.format(removed.value ?? 0)}）`);
    }
  }
  if (schedule.sections.includes('reactions')) {
    const delivered = envelopeNumber(current.reactions, ['metrics', 'delivered']);
    const opened = envelopeNumber(current.reactions, ['metrics', 'opened']);
    // 監査 R225: シナリオは届いた人数が取れないため、シナリオを含む期間は
    // delivered が partial（取れた一斉配信だけの合計）になる。行を消さず、
    // 取れた分だけだと分かる添え書きを付けて出す。
    if (delivered && (delivered.state === 'available' || delivered.state === 'partial')
        && typeof delivered.value === 'number') {
      const openedPart = opened?.state === 'available' && typeof opened.value === 'number'
        ? `・開封${jaNumber.format(opened.value)}件` : '';
      const scope = delivered.state === 'partial' ? '（一斉配信のみ）' : '';
      lines.push(`・配信の反応: ${jaNumber.format(delivered.value)}件配信${openedPart}${scope}`);
    }
  }
  if (schedule.sections.includes('routes')) {
    const routes = (current.routes as { routes?: Array<{
      name?: unknown; friendAdds?: { value: number | null; state: string };
      conversions?: { approved?: { value: number | null; state: string }; pending?: { value: number | null; state: string } };
      revenue?: { value: number | null; state: string };
    }> } | null)?.routes;
    if (Array.isArray(routes)) {
      let conversions: number | null = 0;
      let revenue: number | null = 0;
      let top: { name: string; adds: number } | null = null;
      for (const route of routes.filter((item) => item.name !== '経路不明')) {
        const approved = route.conversions?.approved;
        const pending = route.conversions?.pending;
        const routeRevenue = route.revenue;
        if (approved?.state !== 'available' || pending?.state !== 'available'
          || typeof approved.value !== 'number' || typeof pending.value !== 'number') {
          conversions = null;
        } else if (conversions !== null) {
          conversions += approved.value + pending.value;
        }
        if (routeRevenue?.state !== 'available' || typeof routeRevenue.value !== 'number') {
          revenue = null;
        } else if (revenue !== null) {
          revenue += routeRevenue.value;
        }
        const adds = route.friendAdds;
        if (typeof route.name === 'string' && adds?.state === 'available' && typeof adds.value === 'number'
          && (!top || adds.value > top.adds)) {
          top = { name: route.name, adds: adds.value };
        }
      }
      if (conversions !== null) {
        lines.push(`・経路と成果: 成果${jaNumber.format(conversions)}件${
          revenue !== null ? `・売上${jaNumber.format(revenue)}円` : ''}`);
      }
      if (top) lines.push(`・いちばんの流入: ${top.name}（友だち${jaNumber.format(top.adds)}人）`);
    }
  }
  if (schedule.sections.includes('usage')) {
    const unused = envelopeNumber(current.usage, ['summary', 'unusedItems']);
    if (unused?.state === 'available' && typeof unused.value === 'number') {
      lines.push(`・使われ方: 使っていないもの${jaNumber.format(unused.value)}件`);
    }
  }
  return lines;
}

/** 条件に一致した知らせだけを行にする。無ければ空配列。 */
function alertLines(evaluation: { state: string; results?: AlertRuleEvaluation[] }): string[] {
  if (evaluation.state !== 'evaluated' || !Array.isArray(evaluation.results)) return [];
  const lines: string[] = [];
  for (const item of evaluation.results) {
    if (item.outcome !== 'triggered') continue;
    if (item.metric === 'block_rate') {
      lines.push(`・ブロック率 ${item.observedValue}% がしきい値 ${item.threshold}% を超えました（配信${item.sampleSize !== null ? jaNumber.format(item.sampleSize) : '—'}件）`);
    } else if (item.metric === 'friend_adds') {
      lines.push(`・友だちの追加が前期間より ${item.observedValue}% 減りました（前期間${item.previousValue !== null ? jaNumber.format(item.previousValue) : '—'}人→今回${item.currentValue !== null ? jaNumber.format(item.currentValue) : '—'}人）`);
    } else if (item.metric === 'conversions') {
      lines.push(`・成果0件が ${item.observedValue}日続いています（しきい値 ${item.threshold}日）`);
    }
  }
  return lines;
}

export function reportText(
  schedule: AnalyticsReportSchedule, report: Awaited<ReturnType<typeof buildReport>>,
  adminOrigin: string | null = null,
) {
  const lines = [
    `【${schedule.name}】`,
    `${report.context.fromDate}〜${report.context.toDate} のまとめ`,
    `状態: ${report.state === 'available' ? '集計済み' : report.state === 'partial' ? '一部集計中' : '未取得'}`,
    `データ締切: ${report.context.dataCutoffAt}`,
    ...headlineLines(schedule, report),
  ];
  const alerts = alertLines(report.result.alertEvaluation as { state: string; results?: AlertRuleEvaluation[] });
  if (alerts.length > 0) lines.push('▼すぐの知らせ', ...alerts);
  // 要件 v6-20 §4-5: 通知に顧客本文・秘密値・URLクエリは入れない。
  // ここで付けるのは運用者自身の管理画面への固定の行き先だけで、
  // 顧客の値や追跡用のクエリは付けない。
  if (adminOrigin) lines.push(`くわしく見る: ${adminOrigin.replace(/\/+$/, '')}/analytics?tab=saved`);
  else lines.push('管理画面の「分析」で詳細を確認してください。');
  return lines.join('\n');
}

async function deliver(env: AnalyticsReportEnv, schedule: AnalyticsReportSchedule, text: string) {
  const results: Array<{ channel: string; recipient: string; status: 'sent' | 'failed'; reason?: string }> = [];
  const staff = new Map<string, Awaited<ReturnType<typeof getStaffById>>>();
  for (const recipient of schedule.recipients) {
    if (recipient.kind === 'staff' && recipient.staffId) staff.set(recipient.staffId, await getStaffById(env.DB, recipient.staffId));
  }
  if (schedule.channels.includes('dashboard')) {
    try {
      await createNotification(env.DB, {
        eventType: 'analytics_report_ready', title: schedule.name, body: text,
        channel: 'dashboard', lineAccountId: schedule.lineAccountId, category: 'info',
        metadata: JSON.stringify({ scheduleId: schedule.id, recipientStaffIds: [...staff.keys()] }),
      });
      results.push({ channel: 'dashboard', recipient: 'notification-center', status: 'sent' });
    } catch (error) {
      results.push({ channel: 'dashboard', recipient: 'notification-center', status: 'failed', reason: error instanceof Error ? error.message : 'dashboard_failed' });
    }
  }
  if (schedule.channels.includes('email')) {
    const emails = new Set(schedule.recipients.flatMap((recipient) => recipient.kind === 'email' && recipient.email
      ? [recipient.email] : recipient.staffId && staff.get(recipient.staffId)?.email ? [staff.get(recipient.staffId)!.email!] : []));
    for (const email of emails) {
      try {
        await sendXServerMail(env, { to: email, from: env.CONTACT_EMAIL || env.XSERVER_MAIL_USER || '', subject: schedule.name, body: text });
        results.push({ channel: 'email', recipient: email, status: 'sent' });
      } catch (error) {
        results.push({ channel: 'email', recipient: email, status: 'failed', reason: error instanceof Error ? error.message : 'email_failed' });
      }
    }
  }
  if (schedule.channels.includes('line')) {
    const account = await getLineAccountById(env.DB, schedule.lineAccountId);
    const token = account ? await resolveLineCredential(
      account.channel_access_token_encrypted, account.channel_access_token || env.LINE_CHANNEL_ACCESS_TOKEN,
      { lineAccountId: schedule.lineAccountId, field: 'channel_access_token' }, env.LINE_CREDENTIAL_ENCRYPTION_KEY,
    ) : '';
    for (const [staffId, member] of staff) {
      if (!member?.line_user_id) continue;
      try {
        if (!token) throw new Error('line_token_missing');
        await new LineClient(token).pushMessage(member.line_user_id, [{ type: 'text', text }]);
        results.push({ channel: 'line', recipient: staffId, status: 'sent' });
      } catch (error) {
        results.push({ channel: 'line', recipient: staffId, status: 'failed', reason: error instanceof Error ? error.message : 'line_failed' });
      }
    }
  }
  return results;
}

export async function processDueAnalyticsReports(env: AnalyticsReportEnv, now = new Date()) {
  const due = await claimDueAnalyticsReportSchedules(env.DB, now.toISOString());
  let processed = 0;
  let failed = 0;
  for (const schedule of due) {
    // 機能オフ中は作らず予約のまま残す。再オンで再開する。
    if (!await featureJobCanRun(env.DB, { accountId: schedule.lineAccountId, featureId: 'analytics', job: 'analytics scheduled reports' })) {
      continue;
    }
    const context = contextFor(schedule, now);
    const runId = await beginAnalyticsReportRun(env.DB, {
      scheduleId: schedule.id, lineAccountId: schedule.lineAccountId,
      scheduledFor: schedule.nextRunAt, periodFrom: context.fromDate, periodTo: context.toDate,
      timeZone: schedule.timeZone, dataCutoffAt: context.dataCutoffAt,
    });
    if (!runId) continue;
    try {
      const report = await buildReport(env.DB, schedule, now);
      const deliveryResults = await deliver(
        env, schedule, reportText(schedule, report, env.ADMIN_ORIGIN ?? null));
      const deliveryFailed = deliveryResults.some((item) => item.status === 'failed');
      await finishAnalyticsReportRun(env.DB, {
        id: runId, state: deliveryFailed && report.state === 'available' ? 'partial' : report.state,
        result: report.result, deliveryResults, completedAt: new Date().toISOString(),
      });
      processed += 1;
    } catch (error) {
      await finishAnalyticsReportRun(env.DB, {
        id: runId, state: 'failed', result: {}, deliveryResults: [],
        errorCode: error instanceof Error ? error.message.slice(0, 120) : 'analytics_report_failed',
        completedAt: new Date().toISOString(),
      });
      failed += 1;
    } finally {
      if (schedule.isOneTime) await archiveAnalyticsReportSchedule(env.DB, schedule.id, now.toISOString());
      else await advanceAnalyticsReportSchedule(env.DB, schedule.id, schedule.nextRunAt, nextRun(schedule), now.toISOString());
    }
  }
  const retention = new Date(now);
  retention.setUTCMonth(retention.getUTCMonth() - 13);
  const purged = await purgeExpiredAnalyticsReportRuns(env.DB, retention.toISOString());
  return { processed, failed, purged };
}
