import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { getWebinarDailyStats } from '../src/webinars/analytics.js';
import { asD1 } from './d1-test-helper.js';

it('時差なし UTC の回答をウェビナーの開始と日本時間の日付で比較する', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE webinars (id TEXT, created_at TEXT);
    CREATE TABLE webinar_ctas (webinar_id TEXT, form_id TEXT);
    CREATE TABLE webinar_registrations (webinar_id TEXT, friend_id TEXT, created_at TEXT);
    CREATE TABLE webinar_viewers (webinar_id TEXT, friend_id TEXT, joined_at TEXT, cta_clicked_at TEXT);
    CREATE TABLE form_submissions (form_id TEXT, friend_id TEXT, created_at TEXT);
    INSERT INTO webinars VALUES ('w','2026-11-01T00:00:00+09:00');
    INSERT INTO webinar_ctas VALUES ('w','f');
    INSERT INTO form_submissions VALUES ('f','old','2026-10-31 14:59:59'),
      ('f','new','2026-10-31 15:00:00');`);
  const result = await getWebinarDailyStats(asD1(sqlite), 'w');
  expect(result).toEqual([{ stat_date: '2026-11-01', reservations: 0, viewers: 0, cta_clicks: 0, form_submissions: 1 }]);
  sqlite.close();
});
