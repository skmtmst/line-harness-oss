import Database from 'better-sqlite3';
import { expect, it } from 'vitest';
import { getWebinarDailyStats, getWebinarParticipantStats } from '../src/webinars/analytics.js';
import { getWebinarParticipantOperations } from '../src/webinars/participants.js';
import { getWebinarFormFunnelStats } from '../src/webinars/engagement.js';
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

it('フォームを開いた時と回答した時は有効化された実時刻と比較する', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE webinar_followup_configs (webinar_id TEXT, enabled_at TEXT);
    CREATE TABLE webinar_ctas (webinar_id TEXT, form_id TEXT, at_seconds INTEGER);
    CREATE TABLE webinar_viewers (webinar_id TEXT, friend_id TEXT, joined_at TEXT, last_position_seconds INTEGER, cta_clicked_at TEXT);
    CREATE TABLE webinar_funnel_events (webinar_id TEXT, friend_id TEXT, event_type TEXT, field_name TEXT);
    CREATE TABLE form_submissions (form_id TEXT, friend_id TEXT, created_at TEXT);
    CREATE TABLE form_opens (form_id TEXT, friend_id TEXT, opened_at TEXT);
    INSERT INTO webinar_followup_configs VALUES ('w','2026-11-01T00:00:00Z');
    INSERT INTO webinar_ctas VALUES ('w','f',0);
    INSERT INTO form_submissions VALUES ('f','early','2026-11-01T08:59:59'), ('f','on-time','2026-11-01 00:00:00');
    INSERT INTO form_opens VALUES ('f','early','2026-11-01T08:59:59'), ('f','on-time','2026-11-01 00:00:00');
  `);
  const result = await getWebinarFormFunnelStats(asD1(sqlite), 'w');
  expect(result).toMatchObject({ form_opens: 1, submit_successes: 1 });
  sqlite.close();
});

it('ウェビナー参加者の最新回答は保存形式ではなく実時刻で選ぶ', async () => {
  const sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE webinars (id TEXT, created_at TEXT);
    CREATE TABLE webinar_ctas (webinar_id TEXT, form_id TEXT);
    CREATE TABLE webinar_registrations (webinar_id TEXT, friend_id TEXT, status TEXT);
    CREATE TABLE webinar_viewers (webinar_id TEXT, friend_id TEXT, joined_at TEXT, last_position_seconds INTEGER, cta_clicked_at TEXT, session_start_at INTEGER);
    CREATE TABLE webinar_action_executions (webinar_id TEXT, friend_id TEXT, status TEXT, last_error TEXT, updated_at TEXT);
    CREATE TABLE friends (id TEXT, display_name TEXT, picture_url TEXT);
    CREATE TABLE form_submissions (form_id TEXT, friend_id TEXT, created_at TEXT);
    INSERT INTO webinars VALUES ('w','2026-10-01T00:00:00+09:00');
    INSERT INTO webinar_ctas VALUES ('w','f');
    INSERT INTO webinar_viewers VALUES ('w','friend','2026-10-01T00:00:00Z',0,NULL,0);
    INSERT INTO form_submissions VALUES ('f','friend','2026-10-02T01:00:00'),
      ('f','friend','2026-10-01 17:00:00');`);
  const result = await getWebinarParticipantStats(asD1(sqlite), 'w');
  expect(result[0]?.form_submitted_at).toBe('2026-10-01T17:00:00.000Z');
  const operations = await getWebinarParticipantOperations(asD1(sqlite), 'w');
  expect(operations[0]?.form_submitted_at).toBe('2026-10-01T17:00:00.000Z');
  sqlite.close();
});
