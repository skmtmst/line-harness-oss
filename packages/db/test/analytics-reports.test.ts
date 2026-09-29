import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginAnalyticsReportRun,
  claimDueAnalyticsReportSchedules,
  createAnalyticsReportSchedule,
  finishAnalyticsReportRun,
  getAnalyticsReportRun,
  getAnalyticsReportRuns,
  getAnalyticsReportSchedule,
  getAnalyticsReportScheduleIncludingArchived,
  getAnalyticsReportSchedules,
  reclaimStaleAnalyticsReportRuns,
  requeueOneTimeAnalyticsReportSchedule,
  setAnalyticsReportScheduleStatus,
  updateAnalyticsReportSchedule,
} from '../src/analytics-reports.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

describe('V6 定期レポート', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, timezone)
      VALUES ('account-a','ca','A','ta','sa','Asia/Tokyo'), ('account-b','cb','B','tb','sb','Asia/Tokyo');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('LINEアカウントごとに設定を保存し、別アカウントへ漏らさない', async () => {
    const created = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends', 'routes'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'staff', staffId: 'staff-a', label: '担当A' }],
      channels: ['dashboard'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    expect(created).toMatchObject({ name: '週次まとめ', isOneTime: false, sections: ['friends', 'routes'] });
    expect(await getAnalyticsReportSchedules(db, 'account-a')).toHaveLength(1);
    expect(await getAnalyticsReportSchedules(db, 'account-b')).toEqual([]);
  });

  it('同じ予定時刻を二重実行せず、完了した分析結果を不変にする', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '1回送信', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'report@example.com', label: 'report@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z', isOneTime: true,
    });
    const run = {
      scheduleId: schedule.id, lineAccountId: 'account-a', scheduledFor: schedule.nextRunAt,
      periodFrom: '2026-08-31', periodTo: '2026-09-06', timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-09-07T00:00:00.000Z',
    };
    const id = await beginAnalyticsReportRun(db, run);
    expect(id).toBeTruthy();
    expect(await beginAnalyticsReportRun(db, run)).toBeNull();
    await finishAnalyticsReportRun(db, {
      id: id!, state: 'available', result: { friends: { added: 12 } },
      deliveryResults: [{ channel: 'email', status: 'sent' }],
      completedAt: '2026-09-07T00:01:00.000Z',
    });
    expect(() => sqlite.prepare(
      `UPDATE analytics_report_runs SET result_json = '{}' WHERE id = ?`,
    ).run(id)).toThrow('analytics_report_snapshot_immutable');
  });

  it('読み取った版と違う版への上書きは conflict になり、内容は守られる', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    const first = await updateAnalyticsReportSchedule(db, {
      id: schedule.id, lineAccountId: 'account-a', expectedUpdatedAt: schedule.updatedAt,
      name: '月曜のまとめ', sections: ['friends'], savedAnalysisIds: [],
      cadence: 'weekly', weekday: 1, monthDay: null, sendTime: '10:00',
      timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [],
      nextRunAt: '2026-09-07T01:00:00.000Z', now: '2026-09-06T01:00:00.000Z',
    });
    expect(first).toBe('updated');
    // 古い版を持ったままの2回目の保存は弾く
    const stale = await updateAnalyticsReportSchedule(db, {
      id: schedule.id, lineAccountId: 'account-a', expectedUpdatedAt: schedule.updatedAt,
      name: '上書きされるはずの名前', sections: ['usage'], savedAnalysisIds: [],
      cadence: 'weekly', weekday: 2, monthDay: null, sendTime: '11:00',
      timeZone: 'Asia/Tokyo', periodDays: 30,
      recipients: [{ kind: 'email', email: 'b@example.com', label: 'b@example.com' }],
      channels: ['email'], alertRules: [],
      nextRunAt: '2026-09-08T02:00:00.000Z', now: '2026-09-06T02:00:00.000Z',
    });
    expect(stale).toBe('conflict');
    const saved = await getAnalyticsReportSchedule(db, schedule.id, 'account-a');
    expect(saved?.name).toBe('月曜のまとめ');
    expect(saved?.sendTime).toBe('10:00');
    // 別アカウントの同名IDへは触れない
    expect(await updateAnalyticsReportSchedule(db, {
      id: schedule.id, lineAccountId: 'account-b', expectedUpdatedAt: saved!.updatedAt,
      name: 'x', sections: ['friends'], savedAnalysisIds: [], cadence: 'weekly',
      weekday: 1, monthDay: null, sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [], channels: ['dashboard'], alertRules: [],
      nextRunAt: '2026-09-07T00:00:00.000Z', now: '2026-09-06T03:00:00.000Z',
    })).toBe('missing');
  });

  it('止める・また送る・しまうを版つきで遷移し、再開は次回予定を未来へ置き直す', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    const paused = await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'paused',
      expectedUpdatedAt: schedule.updatedAt, now: '2026-09-06T01:00:00.000Z',
    });
    expect(paused).toBe('updated');
    // 止めている間はcronの対象に入らない
    expect(await claimDueAnalyticsReportSchedules(db, '2027-01-01T00:00:00.000Z')).toHaveLength(0);

    // 古い版での再開は弾く
    expect(await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'active',
      expectedUpdatedAt: schedule.updatedAt, now: '2026-09-06T02:00:00.000Z',
    })).toBe('conflict');

    const current = await getAnalyticsReportSchedule(db, schedule.id, 'account-a');
    // 再開: 止まっていた間の回は送り直さず、未来の次回だけを予約する
    expect(await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'active',
      expectedUpdatedAt: current!.updatedAt, nextRunAt: '2026-09-14T00:00:00.000Z',
      now: '2026-09-06T03:00:00.000Z',
    })).toBe('updated');
    const resumed = await getAnalyticsReportSchedule(db, schedule.id, 'account-a');
    expect(resumed?.status).toBe('active');
    expect(resumed?.nextRunAt).toBe('2026-09-14T00:00:00.000Z');

    // しまうと一覧と詳細から消える
    expect(await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'archived',
      expectedUpdatedAt: resumed!.updatedAt, now: '2026-09-06T04:00:00.000Z',
    })).toBe('updated');
    expect(await getAnalyticsReportSchedule(db, schedule.id, 'account-a')).toBeNull();
    expect(await getAnalyticsReportSchedules(db, 'account-a')).toEqual([]);
    // しまった後の操作は missing
    expect(await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'active',
      expectedUpdatedAt: resumed!.updatedAt, now: '2026-09-06T05:00:00.000Z',
    })).toBe('missing');
  });

  it('別アカウントからは状態変更も更新も触れない', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    expect(await getAnalyticsReportSchedule(db, schedule.id, 'account-b')).toBeNull();
    expect(await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-b', status: 'paused',
      expectedUpdatedAt: schedule.updatedAt, now: '2026-09-06T01:00:00.000Z',
    })).toBe('missing');
    // 実際には何も変わっていない
    const untouched = await getAnalyticsReportSchedule(db, schedule.id, 'account-a');
    expect(untouched?.status).toBe('active');
  });

  it('R450: 同じ予定時刻の完了済み記録を引ける（次回予定の補修に使う）', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    const run = {
      scheduleId: schedule.id, lineAccountId: 'account-a', scheduledFor: schedule.nextRunAt,
      periodFrom: '2026-08-31', periodTo: '2026-09-06', timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-09-07T00:00:00.000Z',
    };
    const id = await beginAnalyticsReportRun(db, run);
    await finishAnalyticsReportRun(db, {
      id: id!, state: 'available', result: { ok: true },
      deliveryResults: [{ channel: 'email', status: 'sent' }],
      completedAt: '2026-09-07T00:01:00.000Z',
    });
    // 二重実行はしない（begin は null）
    expect(await beginAnalyticsReportRun(db, run)).toBeNull();
    // 完了済みと分かるので、送り直さず予定だけ直せる
    const found = await getAnalyticsReportRun(db, { scheduleId: schedule.id, scheduledFor: schedule.nextRunAt });
    expect(found?.state).toBe('available');
    expect(found?.deliveryResults).toEqual([{ channel: 'email', status: 'sent' }]);
    expect(await getAnalyticsReportRun(db, { scheduleId: schedule.id, scheduledFor: '2026-01-01T00:00:00.000Z' })).toBeNull();
  });

  it('R450: 取り残された実行中だけを中断として回収し、開始直後は触らない', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '週次まとめ', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z',
    });
    const run = {
      scheduleId: schedule.id, lineAccountId: 'account-a', scheduledFor: schedule.nextRunAt,
      periodFrom: '2026-08-31', periodTo: '2026-09-06', timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-09-07T00:00:00.000Z',
    };
    const id = await beginAnalyticsReportRun(db, run);
    // 開始直後の running は正常な同時実行かもしれないので回収しない
    expect(await reclaimStaleAnalyticsReportRuns(db, '2026-09-07T00:00:00.000Z')).toBe(0);
    expect((await getAnalyticsReportRun(db, { scheduleId: schedule.id, scheduledFor: schedule.nextRunAt }))?.state).toBe('running');
    // 2週間後の実行では取り残しとみなして回収する
    expect(await reclaimStaleAnalyticsReportRuns(db, '2026-09-21T00:00:00.000Z')).toBe(1);
    const reclaimed = await getAnalyticsReportRun(db, { scheduleId: schedule.id, scheduledFor: schedule.nextRunAt });
    expect(reclaimed?.state).toBe('failed');
    expect(reclaimed?.errorCode).toBe('worker_interrupted');
    expect(id).toBeTruthy();
  });

  it('R454: しまった1回送信の履歴も依頼IDで引ける', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '1回送信', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z', isOneTime: true,
    });
    const id = await beginAnalyticsReportRun(db, {
      scheduleId: schedule.id, lineAccountId: 'account-a', scheduledFor: schedule.nextRunAt,
      periodFrom: '2026-08-31', periodTo: '2026-09-06', timeZone: 'Asia/Tokyo',
      dataCutoffAt: '2026-09-07T00:00:00.000Z',
    });
    await finishAnalyticsReportRun(db, {
      id: id!, state: 'failed', result: {},
      deliveryResults: [{ channel: 'email', recipient: 'a@example.com', status: 'failed', reason: 'synthetic_mail_failed' }],
      errorCode: 'synthetic_mail_failed', completedAt: '2026-09-07T00:01:00.000Z',
    });
    const runs = await getAnalyticsReportRuns(db, { scheduleId: schedule.id, lineAccountId: 'account-a' });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: 'failed', errorCode: 'synthetic_mail_failed' });
    expect(runs[0].deliveryResults).toEqual([
      { channel: 'email', recipient: 'a@example.com', status: 'failed', reason: 'synthetic_mail_failed' },
    ]);
    // 別アカウントからは見えない
    expect(await getAnalyticsReportRuns(db, { scheduleId: schedule.id, lineAccountId: 'account-b' })).toEqual([]);
  });

  it('R454: しまった1回送信も依頼IDで引けて、送り直し待ちに戻せる', async () => {
    const schedule = await createAnalyticsReportSchedule(db, {
      lineAccountId: 'account-a', name: '1回送信', sections: ['friends'],
      savedAnalysisIds: [], cadence: 'weekly', weekday: 1, monthDay: null,
      sendTime: '09:00', timeZone: 'Asia/Tokyo', periodDays: 7,
      recipients: [{ kind: 'email', email: 'a@example.com', label: 'a@example.com' }],
      channels: ['email'], alertRules: [], nextRunAt: '2026-09-07T00:00:00.000Z',
      createdBy: 'staff-a', now: '2026-09-06T00:00:00.000Z', isOneTime: true,
    });
    await setAnalyticsReportScheduleStatus(db, {
      id: schedule.id, lineAccountId: 'account-a', status: 'archived',
      expectedUpdatedAt: schedule.updatedAt, now: '2026-09-07T01:00:00.000Z',
    });
    // 一覧・詳細からは消えるが、依頼IDでは引ける
    expect(await getAnalyticsReportSchedule(db, schedule.id, 'account-a')).toBeNull();
    const archived = await getAnalyticsReportScheduleIncludingArchived(db, schedule.id, 'account-a');
    expect(archived?.status).toBe('archived');
    expect(await getAnalyticsReportScheduleIncludingArchived(db, schedule.id, 'account-b')).toBeNull();
    // 送り直し待ちに戻せる
    expect(await requeueOneTimeAnalyticsReportSchedule(db, {
      id: schedule.id, lineAccountId: 'account-a', now: '2026-09-08T00:00:00.000Z',
    })).toBe('requeued');
    const requeued = await getAnalyticsReportSchedule(db, schedule.id, 'account-a');
    expect(requeued?.status).toBe('active');
    expect(requeued?.nextRunAt).toBe('2026-09-08T00:00:00.000Z');
    // 定期レポートや別アカウントは対象外
    expect(await requeueOneTimeAnalyticsReportSchedule(db, {
      id: schedule.id, lineAccountId: 'account-b', now: '2026-09-08T00:00:00.000Z',
    })).toBe('missing');
  });
});
