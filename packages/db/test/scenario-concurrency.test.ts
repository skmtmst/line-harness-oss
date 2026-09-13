import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScenario, enrollFriendInScenario, publishScenarioVersion, updateScenario } from '../src/scenarios.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

let sqlite: Database.Database;
let db: D1Database;

function insertFriend(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'テスト', '2026-08-16', '2026-08-16')`,
    )
    .run(id, `U${id.padEnd(32, '0').slice(0, 32)}`);
}

async function withStep(name: string, allowConcurrent?: boolean) {
  const scenario = await createScenario(db, {
    name,
    triggerType: 'manual',
    allowConcurrent,
  });
  // ステップが無いシナリオは即 completed になるので、1つ入れておく。
  sqlite
    .prepare(
      `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content)
       VALUES (?, ?, 0, 60, 'text', 'こんにちは')`,
    )
    .run(crypto.randomUUID(), scenario.id);
  // 参加には明示公開が要る（351）。購読の条件ではなく場の準備。
  await publishScenarioVersion(db, scenario.id, { staffId: null, idempotencyKey: `conc-${name}` });
  return scenario;
}

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
  insertFriend('f-1');
});

describe('シナリオの並行購読', () => {
  test('同じ受信行動の再試行は完了済み購読を再開しない', async () => {
    const scenario = await withStep('webhook-retry');
    const first = await enrollFriendInScenario(db, 'f-1', scenario.id, 'stable-webhook-action');
    expect(first).not.toBeNull();
    sqlite.prepare(`UPDATE friend_scenarios SET status='completed' WHERE id=?`).run(first!.id);
    const retry = await enrollFriendInScenario(db, 'f-1', scenario.id, 'stable-webhook-action');
    expect(retry?.id).toBe(first!.id);
    expect(retry?.status).toBe('completed');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM friend_scenarios').get()).toEqual({ n: 1 });
  });

  test('既定では並行を許す（従来どおり）', async () => {
    // ここを既定で塞ぐと、いま複数のシナリオに入っている人への配信が止まる。
    const a = await withStep('A');
    const b = await withStep('B');
    expect(a.allow_concurrent).toBe(1);
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).not.toBeNull();
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('並行を止めたシナリオは、他が動いていたら登録しない', async () => {
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    // 例外ではなく null。呼び出し口が友だち追加などの副作用の中にあり、
    // throw すると本来の処理まで巻き添えで失敗する。
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).toBeNull();
  });

  test('他が動いていなければ登録できる', async () => {
    const b = await withStep('B', false);
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('前のシナリオが終わっていれば登録できる', async () => {
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    sqlite.prepare(`UPDATE friend_scenarios SET status = 'completed'`).run();
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).not.toBeNull();
  });

  test('同じシナリオへの二重登録は、並行を許していても起きない', async () => {
    // これは部分UNIQUE索引が防いでいる。allow_concurrent とは別の話。
    const a = await withStep('A');
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).not.toBeNull();
    expect(await enrollFriendInScenario(db, 'f-1', a.id)).toBeNull();
  });

  test('あとから並行を止められる', async () => {
    const a = await withStep('A');
    const b = await withStep('B');
    await enrollFriendInScenario(db, 'f-1', a.id);
    await updateScenario(db, b.id, { allow_concurrent: 0 });
    expect(await enrollFriendInScenario(db, 'f-1', b.id)).toBeNull();
  });

  test('別の友だちには影響しない', async () => {
    insertFriend('f-2');
    const a = await withStep('A');
    const b = await withStep('B', false);
    await enrollFriendInScenario(db, 'f-1', a.id);
    expect(await enrollFriendInScenario(db, 'f-2', b.id)).not.toBeNull();
  });
});
