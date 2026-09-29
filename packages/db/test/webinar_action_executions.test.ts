import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  finishWebinarActionExecution,
  insertWebinarActionExecutionIgnore,
} from '../src/webinars.js';
import { asD1 } from './d1-test-helper.js';

/*
 * R97: 視聴後アクションの実行記録は冪等キーで1件にまとめる。
 * 直しを戻す（INSERT OR IGNORE を外す・結末更新を消す）と赤くなる。
 */
describe('webinar action executions idempotency', () => {
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
      INSERT INTO friends VALUES ('friend-1');
      INSERT INTO webinars VALUES
        ('webinar-1', 'account-1', '講座', 'seminar', 'draft', 'videos/1', 1800,
         '[]', NULL, NULL, NULL, '2026-09-06', '2026-09-06');
    `);
    sqlite.exec(readFileSync(join(import.meta.dirname, '../migrations/289_webinar_actions.sql'), 'utf8'));
    sqlite.exec(`
      INSERT INTO webinar_actions
        (id, webinar_id, trigger, action_type, config_json, position, version, enabled, created_at, updated_at)
      VALUES
        ('action-1', 'webinar-1', 'completed', 'add_tag', '{"tagId":"tag-done"}', 0, 1, 1, '2026-09-06', '2026-09-06');
    `);
    db = asD1(sqlite);
  });

  test('初回は記録し true、同じ冪等キーの再送は書かず false', async () => {
    const input = {
      webinarActionId: 'action-1', webinarId: 'webinar-1', friendId: 'friend-1',
      sessionStartAt: 1754000000, trigger: 'completed' as const,
      status: 'queued' as const, idempotencyKey: 'webinar-1:action-1:friend-1:1754000000:completed',
    };
    expect(await insertWebinarActionExecutionIgnore(db, input)).toBe(true);
    expect(await insertWebinarActionExecutionIgnore(db, input)).toBe(false);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM webinar_action_executions').get()).toEqual({ count: 1 });
  });

  test('見送りは理由つきで記録する', async () => {
    const claimed = await insertWebinarActionExecutionIgnore(db, {
      webinarActionId: 'action-1', webinarId: 'webinar-1', friendId: 'friend-1',
      sessionStartAt: 1754000000, trigger: 'completed' as const,
      status: 'skipped' as const, idempotencyKey: 'skip-key-1', lastError: 'unsupported_action_type',
    });
    expect(claimed).toBe(true);
    expect(sqlite.prepare('SELECT status, last_error AS lastError FROM webinar_action_executions WHERE idempotency_key = ?').get('skip-key-1'))
      .toEqual({ status: 'skipped', lastError: 'unsupported_action_type' });
  });

  test('結末の更新は冪等キーの1件だけに届く', async () => {
    await insertWebinarActionExecutionIgnore(db, {
      webinarActionId: 'action-1', webinarId: 'webinar-1', friendId: 'friend-1',
      sessionStartAt: 1754000000, trigger: 'completed' as const,
      status: 'queued' as const, idempotencyKey: 'finish-key-1',
    });
    await finishWebinarActionExecution(db, 'finish-key-1', 'succeeded', null);
    expect(sqlite.prepare('SELECT status, last_error AS lastError FROM webinar_action_executions WHERE idempotency_key = ?').get('finish-key-1'))
      .toEqual({ status: 'succeeded', lastError: null });
  });
});
