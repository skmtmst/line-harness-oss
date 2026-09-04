import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  applyPublishedActionScoreRules,
  defaultActionScoreRuleBundle,
  getActionScoreReconciliationIssues,
  getActionScoreRuleConfiguration,
  processActionScoreInactivity,
  publishActionScoreRuleDraft,
  saveActionScoreRuleDraft,
  stopActionScoreRules,
  testActionScoreRuleBundle,
} from '../src/action-score-rules.js';
import { asD1 } from './d1-test-helper.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-08-28T10:00:00.000Z';

function setup(): { sqlite: Database.Database; db: D1Database } {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id, timezone)
    VALUES
      ('account-1', 'channel-1', '公式A', 'token-a', 'secret-a',
       '00000000-0000-4000-8000-000000000001', 'Asia/Tokyo'),
      ('account-2', 'channel-2', '公式B', 'token-b', 'secret-b',
       '00000000-0000-4000-8000-000000000001', 'Asia/Tokyo');
    INSERT INTO friends
      (id, line_user_id, line_account_id, display_name, score, created_at, updated_at)
    VALUES
      ('friend-1', 'U11111111111111111111111111111111', 'account-1', '友だちA', 0,
       '2026-06-01T00:00:00.000Z', '2026-06-01T00:00:00.000Z'),
      ('friend-2', 'U22222222222222222222222222222222', 'account-2', '友だちB', 40,
       '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
  `);
  return { sqlite, db: asD1(sqlite) };
}

async function publishDefaults(db: D1Database, accountId = 'account-1') {
  const saved = await saveActionScoreRuleDraft(db, {
    lineAccountId: accountId,
    expectedDraftVersionId: null,
    configuration: defaultActionScoreRuleBundle(),
    createdBy: 'staff-1',
  });
  return publishActionScoreRuleDraft(db, {
    lineAccountId: accountId,
    draftVersionId: saved.currentDraftVersionId!,
    publishedBy: 'staff-1',
  });
}

describe('V6 action score rule versions', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    ({ sqlite, db } = setup());
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  it('returns a non-persisted safe draft and excludes unavailable LINE read scoring', async () => {
    const config = await getActionScoreRuleConfiguration(db, 'account-1');
    expect(config).toMatchObject({ configured: false, status: 'not_configured' });
    expect(config.editableVersion.rules).toHaveLength(7);
    expect(config.editableVersion.rules.some((rule) => rule.eventType === 'message_opened')).toBe(false);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM action_score_rule_sets`).get()).toEqual({ count: 0 });
  });

  it('saves, publishes, and never mutates a published version', async () => {
    const published = await publishDefaults(db);
    expect(published).toMatchObject({ configured: true, status: 'published', currentDraftVersionId: null });
    expect(published.publishedVersion?.versionNumber).toBe(1);
    expect(() => sqlite.prepare(
      `UPDATE action_score_rule_versions SET normal_min = 40 WHERE id = ?`,
    ).run(published.currentPublishedVersionId)).toThrow('published action score version is immutable');

    const next = defaultActionScoreRuleBundle();
    next.bands = { min: 0, normalMin: 40, highMin: 80, max: 100 };
    const saved = await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-1', expectedDraftVersionId: null, configuration: next, createdBy: 'staff-2',
    });
    expect(saved.editableVersion.versionNumber).toBe(2);
    expect(saved.publishedVersion?.bands.normalMin).toBe(30);
    expect(saved.editableVersion.bands.normalMin).toBe(40);
  });

  it('keeps rule sets isolated by LINE account and detects stale draft writes', async () => {
    const first = await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-1', configuration: defaultActionScoreRuleBundle(),
    });
    const other = await saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-2', configuration: defaultActionScoreRuleBundle(),
    });
    expect(first.currentDraftVersionId).not.toBe(other.currentDraftVersionId);
    await expect(saveActionScoreRuleDraft(db, {
      lineAccountId: 'account-1', expectedDraftVersionId: 'stale', configuration: defaultActionScoreRuleBundle(),
    })).rejects.toMatchObject({ code: 'version_conflict' });
  });

  it('tests delta, set, clamp and bands without writing history', () => {
    const bundle = defaultActionScoreRuleBundle();
    const reply = testActionScoreRuleBundle(bundle, {
      currentScore: 95, eventType: 'message_received', source: 'line_webhook', occurredAt: NOW,
    });
    expect(reply).toMatchObject({ scoreBefore: 95, scoreAfter: 100, bandBefore: 'high', bandAfter: 'high' });
    const blocked = testActionScoreRuleBundle(bundle, {
      currentScore: 80, eventType: 'friend_unfollow', source: 'line_webhook', occurredAt: NOW,
    });
    expect(blocked).toMatchObject({ scoreBefore: 80, scoreAfter: 0, bandBefore: 'high', bandAfter: 'low' });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_scores`).get()).toEqual({ count: 0 });
  });

  it('applies one published immutable version, records before/after and deduplicates source events', async () => {
    await publishDefaults(db);
    const first = await applyPublishedActionScoreRules(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'message_received',
      source: 'line_webhook', sourceEventId: 'message-1', occurredAt: NOW,
    });
    expect(first.applications[0]).toMatchObject({ scoreBefore: 0, scoreAfter: 8, replayed: false });
    expect(sqlite.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get()).toEqual({ score: 8 });
    const history = sqlite.prepare(
      `SELECT event_type, source_event_id, operation, score_before, score_after, rule_version_id
         FROM friend_scores WHERE friend_id = 'friend-1'`,
    ).get();
    expect(history).toMatchObject({
      event_type: 'message_received', source_event_id: 'message-1', operation: 'delta',
      score_before: 0, score_after: 8,
    });

    await applyPublishedActionScoreRules(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'message_received',
      source: 'line_webhook', sourceEventId: 'message-1', occurredAt: NOW,
    });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_scores`).get()).toEqual({ count: 1 });
    expect(sqlite.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get()).toEqual({ score: 8 });
  });

  it('enforces daily and subject caps across different source events', async () => {
    await publishDefaults(db);
    for (const sourceEventId of ['message-1', 'message-2']) {
      await applyPublishedActionScoreRules(db, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'message_received',
        source: 'line_webhook', sourceEventId, occurredAt: NOW,
      });
    }
    for (const sourceEventId of ['click-1', 'click-2']) {
      await applyPublishedActionScoreRules(db, {
        lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'link_clicked',
        source: 'tracked_link', sourceEventId, subjectKey: 'broadcast-1', occurredAt: NOW,
      });
    }
    expect(sqlite.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get()).toEqual({ score: 13 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM friend_scores`).get()).toEqual({ count: 2 });
  });

  it('does not fall back to legacy behavior after a V6 set is stopped', async () => {
    await publishDefaults(db);
    const stopped = await stopActionScoreRules(db, 'account-1');
    expect(stopped.status).toBe('stopped');
    const result = await applyPublishedActionScoreRules(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'message_received',
      source: 'line_webhook', sourceEventId: 'message-1', occurredAt: NOW,
    });
    expect(result).toMatchObject({ configured: true, status: 'stopped', applications: [] });
  });

  it('applies 30-day inactivity once per inactivity period', async () => {
    await publishDefaults(db);
    const first = await processActionScoreInactivity(db, { now: NOW });
    expect(first).toMatchObject({ candidates: 1, applied: 1 });
    expect(sqlite.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get()).toEqual({ score: 0 });
    const replay = await processActionScoreInactivity(db, { now: NOW });
    expect(replay.applied).toBe(0);

    sqlite.prepare(
      `INSERT INTO mileage_programs (id, code, name, status, created_at, updated_at)
       VALUES ('program-1', 'common', '共通', 'active', ?, ?)`,
    ).run(NOW, NOW);
    sqlite.prepare(
      `INSERT INTO engagement_events
         (id, program_id, idempotency_key, event_type, source, source_event_id,
          actor_friend_id, occurred_at, created_at)
       VALUES ('activity-1', 'program-1', 'activity-1', 'message_received', 'line', 'activity-1',
               'friend-1', '2026-08-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z')`,
    ).run();
    const newPeriod = await processActionScoreInactivity(db, { now: '2026-09-02T10:00:00.000Z' });
    expect(newPeriod.applied).toBe(1);
  });

  it('finds snapshot drift without overwriting it', async () => {
    await publishDefaults(db);
    await applyPublishedActionScoreRules(db, {
      lineAccountId: 'account-1', friendId: 'friend-1', eventType: 'message_received',
      source: 'line_webhook', sourceEventId: 'message-1', occurredAt: NOW,
    });
    sqlite.prepare(`UPDATE friends SET score = 99 WHERE id = 'friend-1'`).run();
    const issues = await getActionScoreReconciliationIssues(db, 'account-1');
    expect(issues).toEqual([expect.objectContaining({ friendId: 'friend-1', currentScore: 99, expectedScore: 8 })]);
    expect(sqlite.prepare(`SELECT score FROM friends WHERE id = 'friend-1'`).get()).toEqual({ score: 99 });
  });
});
