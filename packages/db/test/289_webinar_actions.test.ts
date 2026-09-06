import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import { archiveWebinar, getWebinarActions, replaceWebinarActions } from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

describe('289 webinar actions and archive safety', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (id TEXT PRIMARY KEY);
      CREATE TABLE webinars (
        id TEXT PRIMARY KEY, account_id TEXT, title TEXT NOT NULL, slug TEXT NOT NULL,
        status TEXT NOT NULL, video_prefix TEXT, duration_seconds INTEGER NOT NULL,
        schedule_json TEXT NOT NULL, cta_json TEXT, tag_on_attend TEXT, tag_on_cta_click TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE webinar_viewers (id TEXT PRIMARY KEY, webinar_id TEXT NOT NULL);
      INSERT INTO webinars VALUES
        ('webinar-1', 'account-1', '講座', 'seminar', 'draft', 'videos/1', 1800,
         '[]', NULL, NULL, NULL, '2026-09-06', '2026-09-06');
      INSERT INTO webinar_viewers VALUES ('viewer-1', 'webinar-1');
    `);
    sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/289_webinar_actions.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  test('アーカイブしても視聴履歴を残す', async () => {
    const archived = await archiveWebinar(db, 'webinar-1');
    expect(archived?.status).toBe('archived');
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM webinar_viewers').get()).toEqual({ count: 1 });
  });

  test('設定変更は旧版を残して新しい版を有効にする', async () => {
    await replaceWebinarActions(db, 'webinar-1', [{
      trigger: 'completed', actionType: 'add_tag', config: { tagId: 'tag-1' },
    }]);
    await replaceWebinarActions(db, 'webinar-1', [{
      trigger: 'completed', actionType: 'start_scenario', config: { scenarioId: 'scenario-1' },
    }]);

    const active = await getWebinarActions(db, 'webinar-1');
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ action_type: 'start_scenario', version: 2, enabled: 1 });
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM webinar_actions').get()).toEqual({ count: 2 });
  });

  test('実行キーの重複をDBで拒否する', () => {
    sqlite.prepare(`INSERT INTO friends (id) VALUES ('friend-1')`).run();
    sqlite.prepare(`INSERT INTO webinar_actions
      (id, webinar_id, trigger, action_type, config_json, position, version, enabled, created_at, updated_at)
      VALUES ('action-1', 'webinar-1', 'completed', 'add_tag', '{}', 0, 1, 1, 'x', 'x')`).run();
    const insert = sqlite.prepare(`INSERT INTO webinar_action_executions
      (id, webinar_action_id, webinar_id, friend_id, trigger, status, idempotency_key, created_at, updated_at)
      VALUES (?, 'action-1', 'webinar-1', 'friend-1', 'completed', 'queued', 'same-key', 'x', 'x')`);
    insert.run('execution-1');
    expect(() => insert.run('execution-2')).toThrow(/UNIQUE/);
  });
});
