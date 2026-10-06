import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { asD1 } from './d1-test-helper.js';
import { getBroadcasts } from '../src/broadcasts.js';
import { listAutoReplyEvaluationRuns, getAutoReplyEvaluationSummary, getAutoReplyTriggerBreakdown } from '../src/auto-reply-runs.js';

const range = { from: '2026-09-30T00:00:00+09:00', until: '2026-10-01T00:00:00+09:00' };
it('一斉配信の期間は全件と所属条件に適用され、UTC表記も同じ日に入る', async () => {
  const raw = new Database(':memory:');
  try {
    raw.exec(`CREATE TABLE broadcasts (id TEXT, sent_at TEXT, scheduled_at TEXT, created_at TEXT, line_account_id TEXT, target_type TEXT, account_ids TEXT);
      CREATE TABLE broadcast_insights (id TEXT, broadcast_id TEXT, created_at TEXT, status TEXT, delivered INTEGER, unique_impression INTEGER, unique_click INTEGER, open_rate REAL, click_rate REAL);`);
    const add = raw.prepare('INSERT INTO broadcasts VALUES (?, ?, NULL, ?, ?, ?, NULL)');
    for (const [id, time, account] of [['before', '2026-09-29T23:59:59+09:00', 'a'], ['start', '2026-09-29T15:00:00Z', 'a'], ['end', '2026-09-30T23:59:59+09:00', 'a'], ['after', '2026-10-01T00:00:00+09:00', 'a'], ['private', '2026-09-30T12:00:00+09:00', 'b']]) add.run(id, time, time, account, 'all');
    expect((await getBroadcasts(asD1(raw), undefined, { allowedAccountIds: ['a'], canSeeUnassigned: false }, range)).map(x => x.id)).toEqual(['end', 'start']);
  } finally { raw.close(); }
});

describe('自動応答の期間', () => {
  it('ページ数・集計・内訳は同じ境界と可視範囲を使う', async () => {
    const raw = new Database(':memory:');
    try {
      raw.exec(`CREATE TABLE auto_reply_evaluations (id TEXT, friend_id TEXT, line_account_id TEXT, evaluated_at TEXT, winning_auto_reply_id TEXT, winning_version_id TEXT, status TEXT, matched_keyword TEXT, duration_ms INTEGER);
        CREATE TABLE friends (id TEXT, display_name TEXT);
        CREATE TABLE line_accounts (id TEXT, name TEXT);
        CREATE TABLE auto_replies (id TEXT, name TEXT, keyword TEXT, priority INTEGER);
        CREATE TABLE auto_reply_versions (id TEXT, version_number INTEGER);
        CREATE TABLE auto_reply_action_runs (evaluation_id TEXT, action_type TEXT, status TEXT);
        CREATE TABLE chats (friend_id TEXT, status TEXT);`);
      const add = raw.prepare("INSERT INTO auto_reply_evaluations VALUES (?, 'f', ?, ?, 'r', NULL, 'completed', '予約', 100)");
      add.run('before', 'a', '2026-09-29T23:59:59+09:00');
      add.run('inside', 'a', '2026-09-30T23:59:59+09:00');
      add.run('after', 'a', '2026-10-01T00:00:00+09:00');
      add.run('other', 'b', '2026-09-30T12:00:00+09:00');
      const db = asD1(raw), scope = { lineAccountIds: ['a'], includeUnassigned: false, ...range };
      expect(await listAutoReplyEvaluationRuns(db, { ...scope, limit: 1, offset: 0 })).toMatchObject({ total: 1, items: [{ id: 'inside' }] });
      expect(await getAutoReplyEvaluationSummary(db, { ...scope, monthFrom: range.from, monthTo: range.until })).toMatchObject({ totalHits: 1, monthHits: 1 });
      expect(await getAutoReplyTriggerBreakdown(db, scope)).toEqual([{ trigger: '予約', count: 1 }]);
    } finally { raw.close(); }
  });
});
