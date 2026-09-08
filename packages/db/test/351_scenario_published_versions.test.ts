import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createScenario,
  createScenarioStep,
  deleteScenario,
  deleteScenarioStep,
  enrollFriendInScenario,
  getScenarioPublishedVersion,
  getStepsForDelivery,
  publishScenarioVersion,
  resumeFriendScenario,
  updateScenario,
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

async function publish(scenarioId: string, key: string) {
  return publishScenarioVersion(db, scenarioId, { staffId: null, idempotencyKey: key });
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
 * 未公開の下書きは自動公開しない。版が無い・欠損しているときは live の表へ
 * 戻らず送らない（安全停止）。
 */
describe('シナリオ公開版の固定（#644）', () => {
  test('登録は開始時の公開版へ固定される', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-pin-1');

    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);

    expect(enrollment?.published_version_id).toBeTruthy();
    const source = await getStepsForDelivery(db, scenario.id, enrollment!.published_version_id);
    expect(source?.pinnedVersionId).toBe(enrollment!.published_version_id);
    expect(source?.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('未公開のシナリオには登録できない（下書きを自動公開しない）', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');

    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);

    expect(enrollment).toBeNull();
    expect(countVersions(scenario.id)).toBe(0);
    expect(await getScenarioPublishedVersion(db, scenario.id)).toBeNull();
  });

  test('停止中のシナリオには登録できない', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-stop-1');
    await updateScenario(db, scenario.id, { is_active: 0 });

    expect(await enrollFriendInScenario(db, 'f-1', scenario.id)).toBeNull();
  });

  test('重複登録は版側に副作用を起こさない', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-dup-1');

    const first = await enrollFriendInScenario(db, 'f-1', scenario.id);
    const again = await enrollFriendInScenario(db, 'f-1', scenario.id);

    expect(first?.published_version_id).toBeTruthy();
    expect(again).toBeNull();
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('稼働中の下書き編集は既存配信へ混入しない', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-draft-1');
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
    expect(source?.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('2回目の保存（変更あり公開）が残り、新旧の購読が別の版を見る', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    insertFriend('f-2');

    await publish(scenario.id, 'key-0001');
    const first = await enrollFriendInScenario(db, 'f-1', scenario.id);

    await updateScenarioStep(db, step1.id, { message_content: '公開した1通目' });
    const v2 = await publish(scenario.id, 'key-0002');
    const second = await enrollFriendInScenario(db, 'f-2', scenario.id);

    expect(Number(v2.version_number)).toBe(2);
    expect(second?.published_version_id).toBe(v2.id);
    expect(first?.published_version_id).not.toBe(v2.id);

    const oldSource = await getStepsForDelivery(db, scenario.id, first!.published_version_id);
    const newSource = await getStepsForDelivery(db, scenario.id, second!.published_version_id);
    expect(oldSource?.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
    expect(newSource?.steps.map((s) => s.message_content)).toEqual(['公開した1通目', '2通目']);
  });

  test('同じ内容の再公開は版を増やさないがキーは残す', async () => {
    const { scenario } = await seedScenarioWithSteps();

    const v1 = await publish(scenario.id, 'key-0001');
    const again = await publish(scenario.id, 'key-0002');

    expect(again.id).toBe(v1.id);
    expect(countVersions(scenario.id)).toBe(1);
    // 残したキーでの再実行は同じ版を返す。
    const replayed = await publish(scenario.id, 'key-0002');
    expect(replayed.id).toBe(v1.id);
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('同じ確認キーの再実行は同じ版を返す（内容が同じ場合）', async () => {
    const { scenario } = await seedScenarioWithSteps();

    const v1 = await publish(scenario.id, 'key-retry-1');
    const replay = await publish(scenario.id, 'key-retry-1');

    expect(replay.id).toBe(v1.id);
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('同じ確認キーで別内容は409（SCENARIO_PUBLISH_KEY_CONFLICT）', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();

    await publish(scenario.id, 'key-conflict-1');
    await updateScenarioStep(db, step1.id, { message_content: '別内容' });

    await expect(publish(scenario.id, 'key-conflict-1')).rejects.toThrow(
      'SCENARIO_PUBLISH_KEY_CONFLICT',
    );
    expect(countVersions(scenario.id)).toBe(1);
  });

  test('版の無い購読・欠損参照は live へ戻らず読めない（安全停止）', async () => {
    const { scenario } = await seedScenarioWithSteps();

    expect(await getStepsForDelivery(db, scenario.id, null)).toBeNull();
    expect(await getStepsForDelivery(db, scenario.id, 'version-missing')).toBeNull();
  });

  test('欠損参照の購読は再開しない', async () => {
    const { scenario } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-resume-1');
    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);
    // 版の行だけを壊す（削除禁止トリガーと外部キー制約を一時的に外して
    // 欠損参照を再現。各テストは新しいDBなので戻さなくてよい）。
    sqlite.exec('PRAGMA foreign_keys = OFF');
    sqlite.exec('DROP TRIGGER trg_scenario_versions_immutable_delete');
    sqlite.prepare(`DELETE FROM scenario_versions WHERE id = ?`).run(enrollment!.published_version_id);
    sqlite.exec('PRAGMA foreign_keys = ON');
    sqlite
      .prepare(`UPDATE friend_scenarios SET status = 'paused' WHERE id = ?`)
      .run(enrollment!.id);

    expect(await resumeFriendScenario(db, 'f-1', scenario.id)).toBeNull();
  });

  test('下書きの通を消しても固定版は読める', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-delstep-1');
    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);

    await deleteScenarioStep(db, step1.id);

    const source = await getStepsForDelivery(db, scenario.id, enrollment!.published_version_id);
    expect(source?.steps.map((s) => s.message_content)).toEqual(['1通目', '2通目']);
  });

  test('確定版（published・retired）は更新・復帰・削除できない', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    const v1 = await publish(scenario.id, 'key-imm-1');
    await updateScenarioStep(db, step1.id, { message_content: '変えた' });
    const v2 = await publish(scenario.id, 'key-imm-2');
    expect(v1.status).toBe('published');

    const retired = sqlite
      .prepare(`SELECT status FROM scenario_versions WHERE id = ?`)
      .get(v1.id) as { status: string };
    expect(retired.status).toBe('retired');

    // retired 版の本文更新は止まる。
    expect(() =>
      sqlite.prepare(`UPDATE scenario_versions SET steps_snapshot = '[]' WHERE id = ?`).run(v1.id),
    ).toThrow();
    // retired → published の復帰は止まる。
    expect(() =>
      sqlite.prepare(`UPDATE scenario_versions SET status = 'published' WHERE id = ?`).run(v1.id),
    ).toThrow();
    // retired 版の削除は止まる。
    expect(() => sqlite.prepare(`DELETE FROM scenario_versions WHERE id = ?`).run(v1.id)).toThrow();
    // published 版の削除も止まる。
    expect(() => sqlite.prepare(`DELETE FROM scenario_versions WHERE id = ?`).run(v2.id)).toThrow();
    // published → retired の引退だけ通る。
    sqlite.prepare(`UPDATE scenario_versions SET status = 'retired' WHERE id = ?`).run(v2.id);
    expect(
      (sqlite.prepare(`SELECT status FROM scenario_versions WHERE id = ?`).get(v2.id) as { status: string }).status,
    ).toBe('retired');
  });

  test('指針の版以外に残った published は次回公開で引退へ寄る（部分失敗の自己修復）', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    const v1 = await publish(scenario.id, 'key-heal-1');
    // 途中失敗の残骸：指針を動かさず published を直接足す。
    sqlite
      .prepare(
        `INSERT INTO scenario_versions
           (id, scenario_id, version_number, delivery_mode, steps_snapshot, status, published_at, created_at, updated_at)
         VALUES ('orphan-1', ?, 99, 'relative', '[]', 'published', '2026-08-16', '2026-08-16', '2026-08-16')`,
      )
      .run(scenario.id);

    await updateScenarioStep(db, step1.id, { message_content: '直した1通目' });
    const v2 = await publish(scenario.id, 'key-heal-2');

    expect(
      (sqlite.prepare(`SELECT status FROM scenario_versions WHERE id = ?`).get('orphan-1') as { status: string }).status,
    ).toBe('retired');
    const pointer = sqlite
      .prepare(`SELECT current_published_version_id AS pointer FROM scenarios WHERE id = ?`)
      .get(scenario.id) as { pointer: string };
    expect(pointer.pointer).toBe(v2.id);
    expect(v1.id).not.toBe(v2.id);
  });

  test('親削除は版・購読ごと消え、ログは残して500にしない', async () => {
    const { scenario, step1 } = await seedScenarioWithSteps();
    insertFriend('f-1');
    await publish(scenario.id, 'key-parent-1');
    const enrollment = await enrollFriendInScenario(db, 'f-1', scenario.id);
    sqlite
      .prepare(
        `INSERT INTO messages_log (id, friend_id, direction, message_type, content, scenario_step_id, source, created_at)
         VALUES ('log-1', 'f-1', 'outgoing', 'text', '1通目', ?, 'scenario', '2026-08-16')`,
      )
      .run(step1.id);

    await deleteScenario(db, scenario.id);

    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM scenarios WHERE id = ?`).get(scenario.id)).toEqual({ n: 0 });
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM scenario_versions WHERE scenario_id = ?`).get(scenario.id) as { n: number }).n,
    ).toBe(0);
    expect(
      (sqlite.prepare(`SELECT COUNT(*) AS n FROM friend_scenarios WHERE id = ?`).get(enrollment!.id) as { n: number }).n,
    ).toBe(0);
    // ログは残り、通の参照は外れる。
    expect(sqlite.prepare(`SELECT COUNT(*) AS n FROM messages_log WHERE id = 'log-1'`).get()).toEqual({ n: 1 });
    expect(
      sqlite.prepare(`SELECT scenario_step_id AS ref FROM messages_log WHERE id = 'log-1'`).get(),
    ).toEqual({ ref: null });
  });
});
