import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createScenario,
  createScenarioStep,
  enrollFriendInScenario,
  ensureScenarioPublishedVersion,
  getScenarioPublishedVersion,
  getStepsForDelivery,
  publishScenarioVersion,
  updateScenarioStep,
} from '../src/scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
            async all<T>() {
              return { results: stmt.all(...params) as T[], success: true, meta: {} };
            },
          };
        },
      };
    },
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      const out: unknown[] = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

function insertFriend(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'テスト', '2026-08-16', '2026-08-16')`,
    )
    .run(id, `U-${id}`);
}

async function seedScenarioWithSteps() {
  const scenario = await createScenario(db, { name: '案内', triggerType: 'manual' });
  const step1 = await createScenarioStep(db, {
    scenarioId: scenario.id,
    stepOrder: 0,
    messageType: 'text',
    messageContent: '1通目',
  });
  const step2 = await createScenarioStep(db, {
    scenarioId: scenario.id,
    stepOrder: 1,
    messageType: 'text',
    messageContent: '2通目',
  });
  return { scenario, step1, step2 };
}

function countVersions(scenarioId: string): number {
  return (
    sqlite
      .prepare(`SELECT COUNT(*) AS n FROM scenario_versions WHERE scenario_id = ?`)
      .get(scenarioId) as { n: number }
  ).n;
}

beforeEach(() => {
  sqlite = setupDb();
  db = asD1(sqlite);
});

/**
 * 票 #644（点検 #495 / N-050）の再発防止。
 *
 * 公開版がなく編集が進行中の友だちへ即時反映され、文面差替え・通の飛ばし・
 * 二重送信が起こり得た。下書きと公開版を分け、購読は開始時の版へ固定する。
 */
describe('シナリオ公開版の固定（#644）', () => {
  test('登録は開始時の公開版へ固定される', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');

    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);

    expect(enrollment?.published_version_id).toBeTruthy();
    const source = await getStepsForDelivery(db, scenario.id, enrollment!.published_version_id);
    expect(source.pinnedVersionId).toBe(enrollment!.published_version_id);
    expect(source.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('稼働中の下書き編集は既存配信へ混入しない', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);

    // 公開せずに文面を変え、通を足す。
    await updateScenarioStep(db, step1.id, { message_content: '書き換えた1通目' });
    await createScenarioStep(db, {
      scenarioId: scenario.id,
      stepOrder: 2,
      messageType: 'text',
      messageContent: '足した3通目',
    });

    const source = await getStepsForDelivery(db, scenario.id, enrollment!.published_version_id);
    expect(source.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('2回目の保存（変更あり公開）が残り、新旧の購読が別の版を見る', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    insertFriend('f-2');

    await publishScenarioVersion(db, scenario.id, { staffId: null, idempotencyKey: 'key-0001' });
    const first = await enrollFriendInScenario(db, 'f-1', scenario.id);

    await updateScenarioStep(db, step1.id, { message_content: '公開した1通目' });
    const v2 = await publishScenarioVersion(db, scenario.id, {
      staffId: null,
      idempotencyKey: 'key-0002',
    });
    const second = await enrollFriendInScenario(db, 'f-2', scenario.id);

    expect(Number(v2.version_number)).toBe(2);
    expect(second?.published_version_id).toBe(v2.id);
    expect(first?.published_version_id).not.toBe(v2.id);

    const oldSource = await getStepsForDelivery(db, scenario.id, first!.published_version_id);
    const newSource = await getStepsForDelivery(db, scenario.id, second!.published_version_id);
    expect(oldSource.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
    expect(newSource.steps.map((s) => s.message_content)).toEqual(['公開した1通目', '2通目']);
  });

  test('同じ内容の再公開は版を増やさない', async () => {
    const { scenario } = await seedScenarioWithSteps();

    const v1 = await publishScenarioVersion(db, scenario.id, {
      staffId: null,
      idempotencyKey: 'key-0001',
    });
    const again = await publishScenarioVersion(db, scenario.id, {
      staffId: null,
      idempotencyKey: 'key-0002',
    });

    expect(again.id).toBe(v1.id);
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('同じ確認キーの再実行は同じ版を返す', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();

    const v1 = await publishScenarioVersion(db, scenario.id, {
      staffId: null,
      idempotencyKey: 'key-retry-1',
    });
    await updateScenarioStep(db, step1.id, { message_content: '再試行のあいだの編集' });
    const replay = await publishScenarioVersion(db, scenario.id, {
      staffId: null,
      idempotencyKey: 'key-retry-1',
    });

    expect(replay.id).toBe(v1.id);
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('版より前の購読（固定なし）は live の表を読む', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    sqlite
      .prepare(
        `INSERT INTO friend_scenarios (id, friend_id, scenario_id, current_step_order, status, started_at, next_delivery_at, updated_at)
         VALUES ('legacy-1', 'f-1', ?, -1, 'active', '2026-08-16', NULL, '2026-08-16')`,
      )
      .run(scenario.id);

    const source = await getStepsForDelivery(db, scenario.id, null);

    expect(source.pinnedVersionId).toBeNull();
    expect(source.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('初回登録で内容が同じなら版を増やさない', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    insertFriend('f-2');

    const ensured = await ensureScenarioPublishedVersion(db, scenario.id);
    await enrollFriendInScenario(db, 'f-1', scenario.id);
    await enrollFriendInScenario(db, 'f-2', scenario.id);

    expect(countVersions(scenario.id)).toBe(1);
    const current = await getScenarioPublishedVersion(db, scenario.id);
    expect(current?.id).toBe(ensured.id);
  });
});
