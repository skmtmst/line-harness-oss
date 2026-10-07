import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { updateScenario } from '../src/scenarios.js';
import { asD1 } from './d1-test-helper.js';

let raw: Database.Database;
let db: D1Database;
beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
  raw.prepare("INSERT INTO scenarios (id, name, trigger_type) VALUES ('sc-1', '配信', 'manual')").run();
  db = asD1(raw);
});
afterEach(() => raw.close());

describe('最後のシナリオ停止記録', () => {
  test('停止と記録を一緒に保存し、再開・編集後も保持する', async () => {
    const stopped = await updateScenario(db, 'sc-1', { is_active: 0 }, {
      stop: { reason: '画像を差し替えるため', staffId: 'staff-1' },
    });
    expect(stopped).toMatchObject({ is_active: 0, stopped_reason: '画像を差し替えるため', stopped_by: 'staff-1' });
    expect(stopped?.stopped_at).toMatch(/\+09:00$/);
    const resumed = await updateScenario(db, 'sc-1', { is_active: 1, name: '再開した配信' });
    expect(resumed).toMatchObject({ is_active: 1, stopped_reason: stopped!.stopped_reason, stopped_by: stopped!.stopped_by, stopped_at: stopped!.stopped_at });
  });

  test('同時停止・再試行は最初の停止記録を上書きしない', async () => {
    await Promise.all([
      updateScenario(db, 'sc-1', { is_active: 0 }, { stop: { reason: '最初', staffId: 'staff-1' } }),
      updateScenario(db, 'sc-1', { is_active: 0 }, { stop: { reason: '後から', staffId: 'staff-2' } }),
    ]);
    expect(raw.prepare('SELECT is_active, stopped_reason, stopped_by FROM scenarios').get())
      .toEqual({ is_active: 0, stopped_reason: '最初', stopped_by: 'staff-1' });
  });

  test('再開後の次の停止は、理由なしでも新しい担当者と日時を保存する', async () => {
    await updateScenario(db, 'sc-1', { is_active: 0 }, { stop: { reason: '最初', staffId: 'staff-1' } });
    raw.prepare("UPDATE scenarios SET stopped_at = '2026-01-01T00:00:00+09:00'").run();
    await updateScenario(db, 'sc-1', { is_active: 1 });
    const stopped = await updateScenario(db, 'sc-1', { is_active: 0 }, { stop: { reason: null, staffId: 'staff-2' } });
    expect(stopped).toMatchObject({ is_active: 0, stopped_reason: null, stopped_by: 'staff-2' });
    expect(stopped?.stopped_at).not.toBe('2026-01-01T00:00:00+09:00');
  });

  test('草稿を既存行へ適用しても配信状態を変えず、200字の制約を守る', () => {
    const legacy = new Database(':memory:');
    try {
      legacy.exec("CREATE TABLE scenarios (id TEXT PRIMARY KEY, is_active INTEGER); INSERT INTO scenarios VALUES ('active', 1), ('paused', 0);");
      legacy.exec(readFileSync(new URL('../migrations/590_scenario_stop_reason.sql', import.meta.url), 'utf8'));
      expect(legacy.prepare('SELECT * FROM scenarios ORDER BY id').all()).toEqual([
        { id: 'active', is_active: 1, stopped_reason: null, stopped_by: null, stopped_at: null },
        { id: 'paused', is_active: 0, stopped_reason: null, stopped_by: null, stopped_at: null },
      ]);
      legacy.prepare('UPDATE scenarios SET stopped_reason = ?').run('😀'.repeat(200));
      expect(() => legacy.prepare('UPDATE scenarios SET stopped_reason = ?').run('あ'.repeat(201))).toThrow(/CHECK/);
    } finally { legacy.close(); }
  });
});
