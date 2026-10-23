import { afterEach, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1 } from './test-utils/d1-sqlite.js';
import { SCHEDULED_CRONS, type ScheduledJob } from './services/scheduled-job-isolation.js';
import { DELIVERY_DISPATCH_JOB_NAMES, FEATURE_JOB_MANIFEST } from './services/feature-enforcement.js';
import { OPERATION_DISPATCH_JOB_CROSSWALK } from './services/operation-dispatch-health.js';

const observed = vi.hoisted(() => ({ jobs: [] as ScheduledJob[], deliveries: [] as string[],
  scheduled: vi.fn(async () => ({results: []})), overdue: vi.fn(async () => []),
  due: vi.fn(async () => ({processed: 0})), executors: vi.fn(() => ({})),
}));
vi.mock('./services/scheduled-job-isolation.js', async original => ({
  ...await original<typeof import('./services/scheduled-job-isolation.js')>(),
  runIsolatedScheduledJobs: async (jobs: ScheduledJob[]) => { observed.jobs.push(...jobs); return {succeeded: jobs.length, failed: 0}; },
}));
vi.mock('./services/operation-dispatch-health.js', async original => ({
  ...await original<typeof import('./services/operation-dispatch-health.js')>(),
  observeOperationDispatcher: async (_db: unknown, name: string, run: () => Promise<unknown>) => {
    observed.deliveries.push(name);
    if (name !== 'webinar notifications') return run();
  },
}));
vi.mock('./features/automations/automation-triggers/index.js', () => ({
  processScheduledAutomationTriggers: observed.scheduled, processOverdueSupportMarkTriggers: observed.overdue,
}));
vi.mock('./features/automations/automation-engine/index.js', () => ({ processDueAutomationRuns: observed.due }));
vi.mock('./features/automations/automation-action-executors/index.js', () => ({ createAutomationActionExecutors: observed.executors }));
const processors = vi.hoisted(() => Object.fromEntries([
  "processActionScoreInactivity",
  "processDueFriendBulkRuns",
  "processPendingAnalyticsCrossRuns",
  "processPendingMileageEvents",
  "drainAdConversionOutbox",
  "processPendingAnalyticsUrlExposures",
  "refreshRecentAnalyticsProjections",
  "checkAccountHealth",
  "processInsightFetch",
  "processPendingNenRichMenuJobs",
  "syncXServerSupportMailbox",
  "processFriendFieldReminders",
  "processGoogleBusinessHourlyResync",
  "refreshAllNenTags",
  "purgeExpiredAnalyticsReadData",
  "recordFriendSnapshot",
  "scanMediaUsage",
  "enqueueFollowingMileageMilestones",
  "runExpirer",
  "runEventBookingExpirer",
  "syncBillingInvoicesDaily",
  "deleteExpiredRestaurantRawEmails",
  "processGoogleBusinessDailyMetrics",
  "processTenantDataPurge",
  "processDueReminders",
  "processDueEventReminders",
  "processDueMeetConsultationReminders",
  "processWebinarReminders",
  "processNenDeliveries",
  "applyDueCommonVarSchedules",
  "processWebinarFollowups",
  "processStepDeliveries",
  "processScheduledBroadcasts",
  "processQueuedBroadcasts",
  "processReminderDeliveries",
  "sweepOperatorNotifications",
  "sweepOutgoingWebhookDeliveries"
].map(name=>[name,vi.fn(async (...args:unknown[])=>{void args;return {processed:0,failed:0,sent:0,swept:0,failures:[],results:[],items:0,claimed:0,checked:0,deleted:0,matched:0,pruned:0,queued:0,eventsCreated:0,events:0,dailyMetrics:0,reconciliationRuns:0,enrolled:0,hasMore:false,transitions:[]}})])) as Record<string,ReturnType<typeof vi.fn>>);
vi.mock('./features/booking/booking-expirer/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  runExpirer:processors.runExpirer,
}));
vi.mock('./features/booking/booking-reminders/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processDueReminders:processors.processDueReminders,
}));
vi.mock('./features/broadcasts/broadcast/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processScheduledBroadcasts:processors.processScheduledBroadcasts,
  processQueuedBroadcasts:processors.processQueuedBroadcasts,
}));
vi.mock('./features/friends/friend-bulk-runs/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processDueFriendBulkRuns:processors.processDueFriendBulkRuns,
}));
vi.mock('./features/friends/friend-field-reminders/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processFriendFieldReminders:processors.processFriendFieldReminders,
}));
vi.mock('./features/media/media-usage-scan/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  scanMediaUsage:processors.scanMediaUsage,
}));
vi.mock('./features/webinars/webinar-followups/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processWebinarFollowups:processors.processWebinarFollowups,
}));
vi.mock('./features/webinars/webinar-reminders/index.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processWebinarReminders:processors.processWebinarReminders,
}));
vi.mock('./services/ad-conversion.js',async original=>({
  ...await original<Record<string,unknown>>(),
  drainAdConversionOutbox:processors.drainAdConversionOutbox,
}));
vi.mock('./services/analytics-projection.js',async original=>({
  ...await original<Record<string,unknown>>(),
  refreshRecentAnalyticsProjections:processors.refreshRecentAnalyticsProjections,
}));
vi.mock('./services/ban-monitor.js',async original=>({
  ...await original<Record<string,unknown>>(),
  checkAccountHealth:processors.checkAccountHealth,
}));
vi.mock('./services/billing-invoices-sync.js',async original=>({
  ...await original<Record<string,unknown>>(),
  syncBillingInvoicesDaily:processors.syncBillingInvoicesDaily,
}));
vi.mock('./services/event-booking-expirer.js',async original=>({
  ...await original<Record<string,unknown>>(),
  runEventBookingExpirer:processors.runEventBookingExpirer,
}));
vi.mock('./services/event-booking-reminders.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processDueEventReminders:processors.processDueEventReminders,
}));
vi.mock('./services/google-business-resync.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processGoogleBusinessHourlyResync:processors.processGoogleBusinessHourlyResync,
  processGoogleBusinessDailyMetrics:processors.processGoogleBusinessDailyMetrics,
}));
vi.mock('./services/insight-fetcher.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processInsightFetch:processors.processInsightFetch,
}));
vi.mock('./services/meet-consultation-reminders.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processDueMeetConsultationReminders:processors.processDueMeetConsultationReminders,
}));
vi.mock('./services/nen-engagement.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processNenDeliveries:processors.processNenDeliveries,
}));
vi.mock('./services/nen-rich-menu.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processPendingNenRichMenuJobs:processors.processPendingNenRichMenuJobs,
}));
vi.mock('./services/nen-tag-sync.js',async original=>({
  ...await original<Record<string,unknown>>(),
  refreshAllNenTags:processors.refreshAllNenTags,
}));
vi.mock('./services/operator-notification-dispatch.js',async original=>({
  ...await original<Record<string,unknown>>(),
  sweepOperatorNotifications:processors.sweepOperatorNotifications,
}));
vi.mock('./services/outgoing-webhook-delivery.js',async original=>({
  ...await original<Record<string,unknown>>(),
  sweepOutgoingWebhookDeliveries:processors.sweepOutgoingWebhookDeliveries,
}));
vi.mock('./services/reminder-delivery.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processReminderDeliveries:processors.processReminderDeliveries,
}));
vi.mock('./services/restaurant-email-intake.js',async original=>({
  ...await original<Record<string,unknown>>(),
  deleteExpiredRestaurantRawEmails:processors.deleteExpiredRestaurantRawEmails,
}));
vi.mock('./services/step-delivery.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processStepDeliveries:processors.processStepDeliveries,
}));
vi.mock('./services/tenant-data-purge.js',async original=>({
  ...await original<Record<string,unknown>>(),
  processTenantDataPurge:processors.processTenantDataPurge,
}));
vi.mock('./services/xserver-mail.js',()=>({syncXServerSupportMailbox:processors.syncXServerSupportMailbox}));
vi.mock('@line-crm/db',async original=>({
  ...await original<Record<string,unknown>>(),
  processActionScoreInactivity:processors.processActionScoreInactivity,
  processPendingAnalyticsCrossRuns:processors.processPendingAnalyticsCrossRuns,
  processPendingMileageEvents:processors.processPendingMileageEvents,
  processPendingAnalyticsUrlExposures:processors.processPendingAnalyticsUrlExposures,
  purgeExpiredAnalyticsReadData:processors.purgeExpiredAnalyticsReadData,
  recordFriendSnapshot:processors.recordFriendSnapshot,
  enqueueFollowingMileageMilestones:processors.enqueueFollowingMileageMilestones,
  applyDueCommonVarSchedules:processors.applyDueCommonVarSchedules,
}));
const processorCases = [
  ["action score inactivity", "processActionScoreInactivity", "frequentHeavy"],
  ["friend bulk runs", "processDueFriendBulkRuns", "frequentHeavy"],
  ["analytics cross", "processPendingAnalyticsCrossRuns", "frequentHeavy"],
  ["mileage projection", "processPendingMileageEvents", "frequentHeavy"],
  ["ad conversion outbox retry", "drainAdConversionOutbox", "frequentHeavy"],
  ["analytics url exposure projection", "processPendingAnalyticsUrlExposures", "frequentHeavy"],
  ["analytics projection", "refreshRecentAnalyticsProjections", "frequentHeavy"],
  ["account health", "checkAccountHealth", "frequentHeavy"],
  ["broadcast insights", "processInsightFetch", "frequentHeavy"],
  ["NEN rich menu jobs", "processPendingNenRichMenuJobs", "frequentHeavy"],
  ["support email sync", "syncXServerSupportMailbox", "frequentHeavy"],
  ["friend field reminders", "processFriendFieldReminders", "frequentHeavy"],
  ["google business resync", "processGoogleBusinessHourlyResync", "frequentHeavy"],
  ["NEN tag refresh", "refreshAllNenTags", "sixHourlyHeavy"],
  ["analytics retention purge", "purgeExpiredAnalyticsReadData", "sixHourlyHeavy"],
  ["friend snapshot", "recordFriendSnapshot", "frequentHeavy"],
  ["media usage scan", "scanMediaUsage", "sixHourlyHeavy"],
  ["following mileage", "enqueueFollowingMileageMilestones", "sixHourlyHeavy"],
  ["booking expirer", "runExpirer", "sixHourlyHeavy"],
  ["event booking expirer", "runEventBookingExpirer", "sixHourlyHeavy"],
  ["billing invoice sync", "syncBillingInvoicesDaily", "sixHourlyHeavy"],
  ["restaurant raw mail retention", "deleteExpiredRestaurantRawEmails", "sixHourlyHeavy"],
  ["google business metrics", "processGoogleBusinessDailyMetrics", "sixHourlyHeavy"],
  ["tenant data retention purge", "processTenantDataPurge", "sixHourlyHeavy"],
  ["booking reminders", "processDueReminders", "delivery"],
  ["event reminders", "processDueEventReminders", "delivery"],
  ["meet consultation reminders", "processDueMeetConsultationReminders", "delivery"],
  ["webinar reminders", "processWebinarReminders", "delivery"],
  ["NEN campaign deliveries", "processNenDeliveries", "delivery"],
  ["common variable schedules", "applyDueCommonVarSchedules", "delivery"],
  ["webinar followups", "processWebinarFollowups", "delivery"],
  ["scenario deliveries", "processStepDeliveries", "delivery"],
  ["broadcast deliveries", "processScheduledBroadcasts", "delivery"],
  ["broadcast deliveries", "processQueuedBroadcasts", "delivery"],
  ["reminder deliveries", "processReminderDeliveries", "delivery"],
  ["operator notification sweep", "sweepOperatorNotifications", "delivery"],
  ["outgoing webhook sweep", "sweepOutgoingWebhookDeliveries", "delivery"],
] as const;
const { default: worker } = await import('./index.js');
afterEach(() => { observed.jobs.length=0; observed.deliveries.length=0; vi.restoreAllMocks(); });

async function invoke(cron: string, scheduledTime=Date.parse('2026-10-19T15:01:00Z')) {
  const fixture=createTestD1(), pending: Promise<unknown>[]=[];
  const network=vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('external calls forbidden'));
  vi.spyOn(console,'error').mockImplementation(() => {});
  try {
    await worker.scheduled({cron,scheduledTime} as ScheduledEvent, {
      DB:fixture.db, DEPLOY_ENV:'test', RESTAURANT_TEST_ENABLED:'true', GOOGLE_BUSINESS_ENABLED:'true',
      LINE_CHANNEL_ACCESS_TOKEN:'fixture', XSERVER_MAIL_HOST:'fixture.invalid', XSERVER_MAIL_USER:'fixture', XSERVER_MAIL_PASSWORD:'fixture',
    } as import('./index.js').Env['Bindings'], {waitUntil:(p:Promise<unknown>)=>pending.push(p)} as unknown as ExecutionContext);
    await Promise.all(pending);
    const lane=Object.entries(SCHEDULED_CRONS).find(([,expression])=>expression===cron)?.[0];
    const target=processorCases.filter(([, ,expectedLane])=>lane===expectedLane);
    for(const job of observed.jobs)if(target.some(([name])=>name===job.name))await job.run();
    for(const [jobName,name] of target){
      if(!observed.jobs.some(job=>job.name===jobName)&&lane!=='delivery')continue;
      expect(processors[name],name).toHaveBeenCalledOnce();
      const first=processors[name]!.mock.calls[0]?.[0];
      expect(first&&typeof first==='object'&&'DB' in first?first.DB:first,name).toBe(fixture.db);
    }
    expect(network).not.toHaveBeenCalled();
    return { jobs:observed.jobs.map(job=>job.name), deliveries:[...observed.deliveries], scheduledTime };
  } finally { await Promise.allSettled(pending); fixture.raw.close(); }
}

test('設定済みのCron式は実際のレーンを呼び、通知は重いレーンへ混ざらない', async () => {
  const config=readFileSync(new URL('../wrangler.toml',import.meta.url),'utf8');
  const crons=JSON.parse(config.match(/^crons\s*=\s*(\[[^\n]+\])/m)![1]!) as string[];
  expect(new Set(crons)).toEqual(new Set(Object.values(SCHEDULED_CRONS)));
  const expected = {
    frequentHeavy: ['friend snapshot','friend bulk runs','analytics cross','mileage projection','ad conversion outbox retry','analytics url exposure projection','analytics projection','account health','broadcast insights','NEN rich menu jobs','support email sync','friend field reminders','google business resync'],
    sixHourlyHeavy: ['NEN tag refresh','analytics retention purge','media usage scan','following mileage','booking expirer','event booking expirer','billing invoice sync','restaurant raw mail retention','google business metrics','tenant data retention purge'],
  };
  const classified=new Set(FEATURE_JOB_MANIFEST.map(job=>job.name));
  for (const lane of ['frequentHeavy','sixHourlyHeavy'] as const) {
    observed.jobs.length=0;observed.deliveries.length=0;
    const result=await invoke(SCHEDULED_CRONS[lane]);
    expect(result.deliveries).toEqual([]);
    expect(result.jobs).toEqual(expect.arrayContaining(expected[lane]));
    expect(result.jobs.length).toBeGreaterThan(0);
    expect(result.jobs.filter(name=>!classified.has(name))).toEqual([]);
    expect(observed.scheduled).not.toHaveBeenCalled();
  }
  observed.jobs.length=0;
  const result=await invoke(SCHEDULED_CRONS.delivery);
  expect(result.jobs).toEqual([]);
  expect(result.deliveries).toHaveLength(new Set(result.deliveries).size);
  expect([...result.deliveries].sort()).toEqual([...DELIVERY_DISPATCH_JOB_NAMES].sort());
  expect(OPERATION_DISPATCH_JOB_CROSSWALK.map(row=>row.jobName)).toEqual(DELIVERY_DISPATCH_JOB_NAMES);
  expect(observed.executors).toHaveBeenCalledOnce();
  const executors=observed.executors.mock.results[0]!.value;
  for (const call of [observed.scheduled,observed.overdue,observed.due]) {
    expect(call).toHaveBeenCalledOnce();
    expect(call).toHaveBeenCalledWith(expect.anything(),expect.objectContaining({now:new Date(result.scheduledTime).toISOString(),executors,limit:100}));
  }
});

test.each([
  ['2026-10-19T15:01:00Z',true,false],
  ['2026-10-20T01:01:00Z',false,false],
  ['2026-10-19T15:11:00Z',false,true],
  ['2026-10-20T01:11:00Z',false,false],
  ['2026-10-20T01:06:00Z',false,false],
])('既存の日次処理を日本時間の予定した分にだけ登録する: %s',async(time,reminders,inactivity)=>{
  const result=await invoke(SCHEDULED_CRONS.frequentHeavy,Date.parse(time));
  expect(result.jobs.includes('friend field reminders')).toBe(reminders);
  expect(result.jobs.includes('action score inactivity')).toBe(inactivity);
});
