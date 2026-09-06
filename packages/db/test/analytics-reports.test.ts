import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  beginAnalyticsReportRun,
  createAnalyticsReportSchedule,
  finishAnalyticsReportRun,
  getAnalyticsReportSchedules,
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
});
