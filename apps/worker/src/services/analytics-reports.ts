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
  type AnalyticsReportSchedule,
} from '@line-crm/db';
import { sendXServerMail } from './xserver-mail.js';

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
      ? { state: 'evaluated', rules: schedule.alertRules }
      : { state: 'skipped', reason: '未取得または一部集計中の数字があるため変化通知を行いません' },
  };
  return { context: currentContext, result, state: reportState(current) };
}

function reportText(schedule: AnalyticsReportSchedule, report: Awaited<ReturnType<typeof buildReport>>) {
  return [
    `【${schedule.name}】`,
    `${report.context.fromDate}〜${report.context.toDate} のまとめ`,
    `状態: ${report.state === 'available' ? '集計済み' : report.state === 'partial' ? '一部集計中' : '未取得'}`,
    `データ締切: ${report.context.dataCutoffAt}`,
    '管理画面の「分析」で詳細を確認してください。',
  ].join('\n');
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
    const context = contextFor(schedule, now);
    const runId = await beginAnalyticsReportRun(env.DB, {
      scheduleId: schedule.id, lineAccountId: schedule.lineAccountId,
      scheduledFor: schedule.nextRunAt, periodFrom: context.fromDate, periodTo: context.toDate,
      timeZone: schedule.timeZone, dataCutoffAt: context.dataCutoffAt,
    });
    if (!runId) continue;
    try {
      const report = await buildReport(env.DB, schedule, now);
      const deliveryResults = await deliver(env, schedule, reportText(schedule, report));
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
