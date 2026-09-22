import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  getAutomationExecutionRun,
  getAutomationExecutionRuns,
  getAutomationExecutionRunSteps,
} from '../src/automations.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const make = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => make(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() { return (statement.get(...params) as T | undefined) ?? null; },
      async run<T>() {
        const info = statement.run(...params);
        return { success: true, meta: { changes: info.changes }, results: [] } as T;
      },
      raw: async () => [],
    } as unknown as D1PreparedStatement);
    return make([]);
  }
  return { prepare } as unknown as D1Database;
}

/*
 * #942 N-354: 実行の詳細で出す項目をDBヘルパーへ固定する。
 * - 実行時に固定された版番号（version_number）とテスト実行の印（is_test）
 * - 処理ごとの結果・試行数・共通アクション版の固定
 * - 入力・出力の生JSONは API へ出さない（SELECT 列に入れない）
 */
describe('実行記録の詳細（#942 N-354）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
    // 実D1と同じく参照整合性は既定で切る（worker の createTestD1 と同じ）。
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(`
      INSERT INTO line_accounts
        (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc-1', 'ch-1', '本店', '', ''),
             ('acc-2', 'ch-2', '二号店', '', '');
      INSERT INTO friends
        (id, line_user_id, display_name, line_account_id)
      VALUES ('friend-1', 'U-friend-1', '田中さん', 'acc-1');
      INSERT INTO automation_definitions
        (id, line_account_id, name, status, current_published_version_id)
      VALUES ('auto-1', 'acc-1', '予約案内', 'active', 'ver-3'),
             ('auto-2', 'acc-2', '別店舗のもの', 'active', 'ver-x');
      INSERT INTO automation_versions
        (id, automation_id, version_number, status, trigger_type, action_config, published_at)
      VALUES ('ver-3', 'auto-1', 3, 'published', 'friend_add', '[]', '2026-08-28T00:00:00.000Z'),
             ('ver-x', 'auto-2', 1, 'published', 'friend_add', '[]', '2026-08-28T00:00:00.000Z');
      INSERT INTO automation_runs
        (id, line_account_id, automation_id, automation_version_id, friend_id,
         source_event_id, idempotency_key, status, is_test,
         started_at, completed_at, created_at)
      VALUES ('run-1', 'acc-1', 'auto-1', 'ver-3', 'friend-1',
              'event-1', 'key-1', 'partial', 1,
              '2026-08-28T01:00:00.000Z', '2026-08-28T01:00:02.000Z', '2026-08-28T01:00:00.000Z'),
             ('run-outside', 'acc-2', 'auto-2', 'ver-x', NULL,
              'event-x', 'key-x', 'success', 0,
              '2026-08-28T01:00:00.000Z', '2026-08-28T01:00:01.000Z', '2026-08-28T01:00:00.000Z');
      INSERT INTO common_actions (id, line_account_id, name, status)
      VALUES ('ca-1', 'acc-1', '共通処理', 'published');
      INSERT INTO common_action_versions
        (id, common_action_id, version_number, status, action_config, published_at)
      VALUES ('cv-9', 'ca-1', 9, 'published', '[]', '2026-08-28T00:00:00.000Z');
      INSERT INTO automation_run_steps
        (id, automation_run_id, step_key, action_type, common_action_version_id,
         attempt_number, idempotency_key, status, input_json, output_json,
         error_code, error_message, started_at, completed_at)
      VALUES ('s1', 'run-1', 'shared', 'common_action_marker', 'cv-9',
              1, 's1', 'success', '{"friend":"秘密の入力"}', '{"out":"秘密の出力"}',
              NULL, NULL, '2026-08-28T01:00:00.000Z', '2026-08-28T01:00:00.500Z'),
             ('s2', 'run-1', 'send', 'send_message', NULL,
              3, 's2', 'failed', '{"friend":"秘密の入力"}', NULL,
              'line_api_error', 'provider raw detail',
              '2026-08-28T01:00:00.500Z', '2026-08-28T01:00:02.000Z');
    `);
    db = asD1(sqlite);
  });

  afterEach(() => sqlite.close());

  it('実行時に固定した版番号・テスト実行の印と処理の集計を返す', async () => {
    const row = await getAutomationExecutionRun(db, {
      runId: 'run-1', allowedAccountIds: ['acc-1'],
    });
    expect(row).toMatchObject({
      id: 'run-1',
      automation_version_id: 'ver-3',
      version_number: 3,
      is_test: 1,
      status: 'partial',
      friend_name: '田中さん',
      successful_actions: 'common_action_marker',
      failed_action: 'send_message',
      failure_code: 'line_api_error',
      duration_ms: 2000,
      // #1043: いまの公開版と、待機中stepの再試行の有無を一緒に返す。
      current_published_version_id: 'ver-3',
      current_version_number: 3,
      has_retry_wait: 0,
    });
  });

  it('待機中stepの retry_at で再試行待ちを区別する（#1043）', async () => {
    sqlite.exec(`
      INSERT INTO automation_runs
        (id, line_account_id, automation_id, automation_version_id, friend_id,
         source_event_id, idempotency_key, status, is_test, created_at)
      VALUES ('run-wait', 'acc-1', 'auto-1', 'ver-3', 'friend-1',
              'event-w', 'key-w', 'waiting', 0, '2026-08-28T02:00:00.000Z'),
             ('run-retry', 'acc-1', 'auto-1', 'ver-3', 'friend-1',
              'event-r', 'key-r', 'waiting', 0, '2026-08-28T02:00:00.000Z');
      INSERT INTO automation_run_steps
        (id, automation_run_id, step_key, action_type, idempotency_key, status, retry_at)
      VALUES ('sw', 'run-wait', 'wait', 'wait', 'sw', 'waiting', NULL),
             ('sr', 'run-retry', 'send', 'send_message', 'sr', 'waiting',
              '2026-08-28T02:05:00.000Z');
    `);
    const wait = await getAutomationExecutionRun(db, {
      runId: 'run-wait', allowedAccountIds: ['acc-1'],
    });
    const retry = await getAutomationExecutionRun(db, {
      runId: 'run-retry', allowedAccountIds: ['acc-1'],
    });
    expect(wait?.has_retry_wait).toBe(0);
    expect(retry?.has_retry_wait).toBe(1);
  });

  it('一覧は既定でテスト実行を除き、includeTest のときだけ含める（#1043）', async () => {
    const base = {
      allowedAccountIds: ['acc-1'],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-09-01T00:00:00.000Z',
      limit: 20,
      offset: 0,
    };
    const withoutTest = await getAutomationExecutionRuns(db, base);
    // run-1 は is_test=1 なので既定では出ない。
    expect(withoutTest.rows.map((row) => row.id)).toEqual([]);
    expect(withoutTest.summary.total).toBe(0);
    const withTest = await getAutomationExecutionRuns(db, { ...base, includeTest: true });
    expect(withTest.rows.map((row) => row.id)).toEqual(['run-1']);
  });

  it('範囲外のアカウントの実行は返さない', async () => {
    expect(await getAutomationExecutionRun(db, {
      runId: 'run-outside', allowedAccountIds: ['acc-1'],
    })).toBeNull();
    expect(await getAutomationExecutionRun(db, {
      runId: 'run-1', allowedAccountIds: [],
    })).toBeNull();
  });

  it('処理ごとの結果・試行数・固定した共通アクション版を順に返し、生JSONは出さない', async () => {
    const steps = await getAutomationExecutionRunSteps(db, 'run-1');
    expect(steps).toEqual([
      {
        step_key: 'shared', action_type: 'common_action_marker',
        common_action_version_id: 'cv-9', status: 'success', attempt_number: 1,
        error_code: null, error_message: null,
        started_at: '2026-08-28T01:00:00.000Z', completed_at: '2026-08-28T01:00:00.500Z',
      },
      {
        step_key: 'send', action_type: 'send_message',
        common_action_version_id: null, status: 'failed', attempt_number: 3,
        error_code: 'line_api_error', error_message: 'provider raw detail',
        started_at: '2026-08-28T01:00:00.500Z', completed_at: '2026-08-28T01:00:02.000Z',
      },
    ]);
    // 友だちの情報を含みうる input_json / output_json は列ごと出さない。
    for (const step of steps) {
      expect(Object.keys(step).sort()).toEqual([
        'action_type', 'attempt_number', 'common_action_version_id',
        'completed_at', 'error_code', 'error_message',
        'started_at', 'status', 'step_key',
      ]);
    }
  });
});
