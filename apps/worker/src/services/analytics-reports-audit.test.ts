import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createAnalyticsReportSchedule,
  getAnalyticsReportRuns,
  getAnalyticsReportSchedules,
  type AnalyticsReportSchedule,
} from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * 定期レポートの監査 R449〜R452・R457〜R460。
 *
 * 実SQLite（bootstrap.sql済み）＋実DB関数で processDueAnalyticsReports を
 * 通し、送信の口だけ差し替える。実メール・実LINEは送らない。
 */
const pushMessage = vi.fn(async () => ({}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

const sendXServerMail = vi.fn(async () => undefined);
vi.mock('./xserver-mail.js', () => ({ sendXServerMail }));

vi.mock('./feature-enforcement.js', () => ({ featureJobCanRun: async () => true }));

const { isClaimStale, processDueAnalyticsReports, reportText } = await import('./analytics-reports.js');
const { zonedWallTime } = await import('./zoned-time.js');

let sqlite: SqliteD1;

function seedAccount() {
  sqlite.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, timezone)
     VALUES ('acc-1','ch-1','A','tok-1','sec-1','Asia/Tokyo')`,
  ).run();
}

function seedStaff(input: {
  id: string; active?: boolean; scope?: 'all' | 'accounts'; scopeAccounts?: string[];
  email?: string | null; lineUserId?: string | null;
}) {
  sqlite.raw.prepare(
    `INSERT INTO staff_members (id, name, email, role, api_key, is_active, invite_status, line_user_id, account_scope)
     VALUES (?, ?, ?, 'staff', ?, ?, 'active', ?, ?)`,
  ).run(
    input.id, input.id, input.email ?? `${input.id}@example.com`, `key-${input.id}`,
    input.active === false ? 0 : 1, input.lineUserId ?? null, input.scope ?? 'all',
  );
  for (const accountId of input.scopeAccounts ?? []) {
    sqlite.raw.prepare(
      `INSERT INTO staff_account_scopes (staff_id, line_account_id, created_at)
       VALUES (?, ?, '2026-09-01T00:00:00.000Z')`,
    ).run(input.id, accountId);
  }
}

async function seedSchedule(over: Partial<AnalyticsReportSchedule> = {}) {
  return createAnalyticsReportSchedule(sqlite.db, {
    lineAccountId: 'acc-1', name: '週次まとめ', sections: [], savedAnalysisIds: [],
    cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '09:00',
    timeZone: 'Asia/Tokyo', periodDays: 7,
    recipients: [{ kind: 'staff' as const, staffId: 'u-1', label: '担当1' }],
    channels: ['dashboard', 'email', 'line'], alertRules: [],
    nextRunAt: '2026-09-28T00:00:00.000Z', now: '2026-09-27T00:00:00.000Z',
    ...over, createdBy: over.createdBy ?? 'owner-1',
  });
}

const envOf = () => ({
  DB: sqlite.db, LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
  CONTACT_EMAIL: 'from@example.com', XSERVER_MAIL_HOST: 'h', XSERVER_MAIL_USER: 'u', XSERVER_MAIL_PASSWORD: 'p',
});

beforeEach(() => {
  vi.clearAllMocks();
  sqlite = createTestD1();
  seedAccount();
});

describe('R449 保存後に止めた・範囲を外した担当者へ送らない', () => {
  it('監査の再現: is_active=0 の担当者のメール・LINEへ送らず理由を残す', async () => {
    seedStaff({ id: 'u-1', active: false, lineUserId: 'U1' });
    await seedSchedule();
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(result.processed).toBe(1);
    expect(sendXServerMail).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
    const schedules = await getAnalyticsReportSchedules(sqlite.db, 'acc-1');
    const runs = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedules[0].id, lineAccountId: 'acc-1' });
    expect(runs).toHaveLength(1);
    const skipped = runs[0].deliveryResults.filter(
      (item) => (item as { status: string }).status === 'skipped',
    ) as Array<{ channel: string; reason: string }>;
    expect(skipped.length).toBeGreaterThan(0);
    expect(skipped.every((item) => item.reason.includes('利用停止中'))).toBe(true);
  });

  it('閲覧範囲から外れた担当者へ送らない', async () => {
    seedStaff({ id: 'u-1', scope: 'accounts', scopeAccounts: ['acc-other'], lineUserId: 'U1' });
    sqlite.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, timezone)
       VALUES ('acc-other','ch-2','B','tok-2','sec-2','Asia/Tokyo')`,
    ).run();
    await seedSchedule();
    await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(sendXServerMail).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('有効な宛先へは一度だけ届き、直接メール指定は区別する', async () => {
    seedStaff({ id: 'u-1', lineUserId: 'U1' });
    seedStaff({ id: 'u-2', active: false, lineUserId: 'U2' });
    await seedSchedule({
      recipients: [
        { kind: 'staff', staffId: 'u-1', label: '担当1' },
        { kind: 'staff', staffId: 'u-2', label: '担当2' },
        { kind: 'email', email: 'direct@example.com', label: 'direct@example.com' },
      ],
    });
    await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    // 担当1のメール＋直接メールに各1回、担当2は除外
    const sentTo = sendXServerMail.mock.calls.map(
      (call) => (call as unknown as [unknown, { to: string }])[1].to,
    );
    expect(sentTo.sort()).toEqual(['direct@example.com', 'u-1@example.com']);
    expect(pushMessage).toHaveBeenCalledTimes(1);
    expect(pushMessage).toHaveBeenCalledWith('U1', expect.anything());
  });
});

describe('R450 次回更新の失敗・取り残しから回復する', () => {
  it('送信済み＋予定だけ古いままなら送り直さず予定を未来へ進める', async () => {
    seedStaff({ id: 'u-1' });
    const schedule = await seedSchedule({ channels: ['dashboard'] });
    await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    // 次回予定の更新だけ失敗した状態を再現する（予定を古いままに戻す）
    sqlite.raw.prepare(`UPDATE analytics_report_schedules SET next_run_at = ? WHERE id = ?`)
      .run(schedule.nextRunAt, schedule.id);
    const before = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    expect(before).toHaveLength(1);
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-10-12T00:00:01.000Z'));
    expect(result.repaired).toBe(1);
    const after = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    // 同じ通知は増やさない
    expect(after).toHaveLength(1);
    const current = await getAnalyticsReportSchedules(sqlite.db, 'acc-1');
    expect(new Date(current[0].nextRunAt).getTime()).toBeGreaterThan(new Date('2026-10-12T00:00:01.000Z').getTime());
  });

  it('取り残された実行中は回収して次回以降を止めない', async () => {
    seedStaff({ id: 'u-1' });
    const schedule = await seedSchedule({ channels: ['dashboard'] });
    // 実行開始だけ記録して処理が失われた状態を用意する
    sqlite.raw.prepare(
      `INSERT INTO analytics_report_runs (
         id, schedule_id, line_account_id, scheduled_for, period_from, period_to,
         time_zone, data_cutoff_at, state, result_json, started_at
       ) VALUES ('orphan', ?, 'acc-1', ?, '2026-09-21', '2026-09-27',
         'Asia/Tokyo', '2026-09-28T00:00:00.000Z', 'running', '{}', '2026-09-28T00:00:00.000Z')`,
    ).run(schedule.id, schedule.nextRunAt);
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-10-12T00:00:01.000Z'));
    expect(result.reclaimed).toBe(1);
    const runs = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    const orphan = runs.find((run) => run.id === 'orphan');
    expect(orphan?.state).toBe('failed');
    expect(orphan?.errorCode).toBe('worker_interrupted');
  });

  it('開始直後の実行中は正常な同時実行として回収しない', async () => {
    seedStaff({ id: 'u-1' });
    const schedule = await seedSchedule({ channels: ['dashboard'] });
    sqlite.raw.prepare(
      `INSERT INTO analytics_report_runs (
         id, schedule_id, line_account_id, scheduled_for, period_from, period_to,
         time_zone, data_cutoff_at, state, result_json, started_at
       ) VALUES ('fresh', ?, 'acc-1', ?, '2026-09-21', '2026-09-27',
         'Asia/Tokyo', '2026-09-28T00:00:00.000Z', 'running', '{}', '2026-09-28T00:00:00.000Z')`,
    ).run(schedule.id, schedule.nextRunAt);
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:30:00.000Z'));
    expect(result.reclaimed).toBe(0);
    // 同じ予定の二重実行はしない
    expect(result.processed).toBe(0);
  });
});

describe('R451 読み取り後の変更を見分ける', () => {
  const base = {
    id: 's-1', lineAccountId: 'acc-1', name: '週次まとめ', sections: [], savedAnalysisIds: [],
    cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo',
    periodDays: 7, recipients: [], channels: ['dashboard'], alertRules: [],
    status: 'active', isOneTime: false, nextRunAt: '2026-09-28T00:00:00.000Z',
    createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
  } as AnalyticsReportSchedule;

  it('変わっていなければ送ってよい', () => {
    expect(isClaimStale(base, { ...base })).toBe(false);
  });

  it('停止・保管は古いとみなす', () => {
    expect(isClaimStale(base, { ...base, status: 'paused' })).toBe(true);
    expect(isClaimStale(base, null)).toBe(true);
  });

  it('宛先変更（版ずれ）は古いとみなす', () => {
    expect(isClaimStale(base, { ...base, updatedAt: '2026-09-28T00:00:00.000Z' })).toBe(true);
    expect(isClaimStale(base, { ...base, nextRunAt: '2026-10-05T00:00:00.000Z' })).toBe(true);
  });
});

describe('R451 止める・しまう・変えた後は旧設定で送らない', () => {
  it('実行直前の停止を検知して送らない', async () => {
    seedStaff({ id: 'u-1', lineUserId: 'U1' });
    const schedule = await seedSchedule();
    // 読み取り後に停止した状態を再現する
    sqlite.raw.prepare(`UPDATE analytics_report_schedules SET status = 'paused' WHERE id = ?`).run(schedule.id);
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(result.processed).toBe(0);
    expect(sendXServerMail).not.toHaveBeenCalled();
    expect(pushMessage).not.toHaveBeenCalled();
  });

  it('宛先変更後に旧宛先へ送らない', async () => {
    seedStaff({ id: 'u-1', lineUserId: 'U1' });
    seedStaff({ id: 'u-9', lineUserId: 'U9' });
    const schedule = await seedSchedule();
    sqlite.raw.prepare(`UPDATE analytics_report_schedules SET recipients_json = ?, updated_at = ? WHERE id = ?`).run(
      JSON.stringify([{ kind: 'staff', staffId: 'u-9', label: '担当9' }]),
      '2026-09-28T00:00:00.500Z', schedule.id,
    );
    // 読み取った版（scheduleオブジェクト）は古いまま渡される想定だが、
    // 実Workerは最新を読み直すため、ここでは最新で実行される
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(result.processed).toBe(1);
    expect(pushMessage).toHaveBeenCalledWith('U9', expect.anything());
    expect(pushMessage).not.toHaveBeenCalledWith('U1', expect.anything());
  });
});

describe('R452 履歴保存の失敗で送信結果を空にしない', () => {
  it('catch 側でも確認済みの送信結果を引き継ぐ', async () => {
    seedStaff({ id: 'u-1', lineUserId: 'U1' });
    const schedule = await seedSchedule();
    // finish の最初の保存だけ失敗させる（2回目は通す）
    const raw = sqlite.raw;
    const originalPrepare = raw.prepare.bind(raw);
    let finishCalls = 0;
    vi.spyOn(raw, 'prepare').mockImplementation(((sql: string, ...rest: unknown[]) => {
      const stmt = (originalPrepare as (...args: unknown[]) => { run: (...a: unknown[]) => unknown })(
        sql, ...rest,
      ) as { run: (...args: unknown[]) => { changes: number } };
      if (typeof sql === 'string' && sql.includes('UPDATE analytics_report_runs SET state')) {
        finishCalls += 1;
        if (finishCalls === 1) {
          return { ...stmt, run: () => { throw new Error('synthetic_db_failure'); } };
        }
      }
      return stmt;
    }) as typeof raw.prepare);
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(result.failed).toBe(1);
    const runs = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    expect(runs).toHaveLength(1);
    // 送った3経路の記録が残る（空配列にならない）
    const channels = runs[0].deliveryResults.map((item) => (item as { channel: string }).channel).sort();
    expect(channels).toEqual(['dashboard', 'email', 'line']);
  });
});

describe('R457 滞留しても同じ期間を繰り返し送らない', () => {
  it('3週滞留後は最新期間を1回だけ送り、次回を未来へ進める', async () => {
    seedStaff({ id: 'u-1' });
    const schedule = await seedSchedule({ channels: ['dashboard'], nextRunAt: '2026-09-07T00:00:00.000Z' });
    const result = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    expect(result.processed).toBe(1);
    const runs = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    expect(runs).toHaveLength(1);
    // 最新の期間（9/21〜9/27）で1回だけ
    expect(runs[0].periodFrom).toBe('2026-09-21');
    expect(runs[0].periodTo).toBe('2026-09-27');
    const backlog = runs[0].result as { backlog?: { sentPeriods: number; skippedPeriods: number } };
    expect(backlog.backlog?.sentPeriods).toBe(1);
    expect(backlog.backlog?.skippedPeriods).toBeGreaterThan(0);
    const current = await getAnalyticsReportSchedules(sqlite.db, 'acc-1');
    expect(new Date(current[0].nextRunAt).getTime()).toBeGreaterThan(new Date('2026-09-28T00:00:01.000Z').getTime());
    // 同じ時計でもう一度回しても送らない
    const again = await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:02.000Z'));
    expect(again.processed).toBe(0);
  });
});

describe('R458 夏時間でも指定時刻を保つ', () => {
  it('NYの日曜09:00が切替日も09:00のまま', () => {
    // 3/8はEDT（UTC-4）なので09:00=13:00Z、11/1はEST（UTC-5）なので09:00=14:00Z。
    // どちらも現地09:00を保つ。旧実装は0時のオフセットに時分を足すため
    // 3/8は10:00・11/1は08:00（現地）にずれていた。
    expect(zonedWallTime('2026-03-08', '09:00', 'America/New_York')).toBe('2026-03-08T13:00:00.000Z');
    expect(zonedWallTime('2026-11-01', '09:00', 'America/New_York')).toBe('2026-11-01T14:00:00.000Z');
  });

  it('JSTは従来どおり', () => {
    expect(zonedWallTime('2026-09-28', '09:00', 'Asia/Tokyo')).toBe('2026-09-28T00:00:00.000Z');
  });
});

describe('R459 保存済み分析だけでも状態を正しく付ける', () => {
  it('失敗の保存済み分析だけのレポートを集計済みにしない', async () => {
    sqlite.raw.prepare(
      `INSERT INTO analytics_cross_runs (
         id, line_account_id, query_json, state, result_json, period_from, period_to,
         time_zone, data_cutoff_at, created_at, completed_at
       ) VALUES ('cross-f','acc-1','{}','failed','{}',
         '2026-09-21T00:00:00.000Z','2026-09-27T00:00:00.000Z','Asia/Tokyo',
         '2026-09-28T00:00:00.000Z','2026-09-28T00:00:00.000Z','2026-09-28T00:00:00.000Z')`,
    ).run();
    sqlite.raw.prepare(
      `INSERT INTO analytics_saved_analyses (id, line_account_id, name, kind, current_version_number, status, created_by, created_by_name, created_at, updated_at)
       VALUES ('saved-f','acc-1','失敗した分析','cross',1,'active',NULL,'担当','2026-09-28T00:00:00.000Z','2026-09-28T00:00:00.000Z')`,
    ).run();
    sqlite.raw.prepare(
      `INSERT INTO analytics_saved_analysis_versions (id, saved_analysis_id, line_account_id, version_number, definition_json, created_at)
       VALUES ('saved-f-v1','saved-f','acc-1',1,'{}','2026-09-28T00:00:00.000Z')`,
    ).run();
    sqlite.raw.prepare(
      `INSERT INTO analytics_saved_analysis_snapshots (
         id, saved_analysis_id, analysis_version_id, line_account_id, source_kind, source_result_id,
         period_from, period_to, time_zone, data_cutoff_at, state, result_json, created_at
       ) VALUES ('saved-f-s1','saved-f','saved-f-v1','acc-1','cross','cross-f',
         '2026-09-21','2026-09-27','Asia/Tokyo','2026-09-28T00:00:00.000Z','failed','{}','2026-09-28T00:00:00.000Z')`,
    ).run();
    seedStaff({ id: 'u-1' });
    const schedule = await seedSchedule({ channels: ['dashboard'], savedAnalysisIds: ['saved-f'] });
    await processDueAnalyticsReports(envOf(), new Date('2026-09-28T00:00:01.000Z'));
    const runs = await getAnalyticsReportRuns(sqlite.db, { scheduleId: schedule.id, lineAccountId: 'acc-1' });
    expect(runs).toHaveLength(1);
    expect(runs[0].state).not.toBe('available');
  });
});

describe('R460 古い保存結果の期間を通知で示す', () => {
  it('1月の保存結果を9月に添えても1月分と分かる', () => {
    const schedule = {
      id: 's-1', lineAccountId: 'acc-1', name: '月次まとめ', sections: [], savedAnalysisIds: ['saved-jan'],
      cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo',
      periodDays: 7, recipients: [], channels: ['dashboard'], alertRules: [],
      status: 'active', isOneTime: false, nextRunAt: '2026-09-28T00:00:00.000Z',
      createdBy: null, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    } as AnalyticsReportSchedule;
    const text = reportText(schedule, {
      context: {
        lineAccountId: 'acc-1', timeZone: 'Asia/Tokyo', fromDate: '2026-09-21', toDate: '2026-09-27',
        from: '2026-09-20T15:00:00.000Z', toExclusive: '2026-09-27T15:00:00.000Z',
        dataCutoffAt: '2026-09-28T00:00:00.000Z',
      },
      result: {
        period: { from: '2026-09-21', to: '2026-09-27' },
        previousPeriod: { from: '2026-09-14', to: '2026-09-20' },
        timeZone: 'Asia/Tokyo', dataCutoffAt: '2026-09-28T00:00:00.000Z',
        current: {}, previous: {},
        savedAnalyses: [{
          savedAnalysisId: 'saved-jan', name: '1月の導線',
          snapshot: {
            periodFrom: '2026-01-01', periodTo: '2026-01-07',
            dataCutoffAt: '2026-01-08T00:00:00.000Z', state: 'available',
          },
        }],
        alertEvaluation: { state: 'skipped' as const, reason: 'x' },
      },
      state: 'available',
    } as unknown as Parameters<typeof reportText>[1]);
    expect(text).toContain('2026-01-01〜2026-01-07');
    expect(text).toContain('保存した時点のもの');
  });
});
