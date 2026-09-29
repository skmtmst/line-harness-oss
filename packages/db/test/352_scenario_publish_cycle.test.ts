import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createScenario,
  createScenarioStep,
  publishScenarioVersion,
  updateScenario,
  updateScenarioStep,
} from '../src/scenarios.js';
import { asD1 } from './d1-test-helper.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
});

async function seedTwoSteps(nextStepOnFalse: number | null = null) {
  const scenario = await createScenario(db, { name: '案内', triggerType: 'manual' });
  await createScenarioStep(db, {
    scenarioId: scenario.id, stepOrder: 0, messageType: 'text', messageContent: '1通目',
  });
  await createScenarioStep(db, {
    scenarioId: scenario.id, stepOrder: 1, messageType: 'text', messageContent: '2通目',
    nextStepOnFalse,
  });
  return scenario;
}

/*
 * 分岐の循環は保存はできるが公開は止める。
 *
 * 循環したまま公開すると、購読した友だちに同じ通が回り続ける事故になる。
 * 下書きの保存自体は止めない（直している途中の保存を奪わない）。公開操作
 * だけが 409 で止まり、どこが回っているかを理由として返す。
 */
describe('公開前の循環検査 (P1-05)', () => {
  test('分岐が循環していると公開できない (SCENARIO_PUBLISH_CYCLE)', async () => {
    const scenario = await seedTwoSteps(0);
    await expect(
      publishScenarioVersion(db, scenario.id, { staffId: null, idempotencyKey: 'key-cycle-1' }),
    ).rejects.toThrow('SCENARIO_PUBLISH_CYCLE');
  });

  test('循環していても下書きの保存はできる', async () => {
    const scenario = await seedTwoSteps(0);
    const steps = sqlite.prepare(`SELECT * FROM scenario_steps WHERE scenario_id = ?`).all(scenario.id) as Array<{ id: string }>;
    // 保存は通る（公開だけが止まる）。
    await updateScenarioStep(db, steps[1]!.id, { messageContent: '2通目なおし中' });
  });

  test('循環がないときは公開できる', async () => {
    const scenario = await seedTwoSteps(null);
    const version = await publishScenarioVersion(db, scenario.id, { staffId: null, idempotencyKey: 'key-linear-1' });
    expect(version.scenario_id).toBe(scenario.id);
  });

  test('自分自身へ戻る分岐も止める', async () => {
    const scenario = await seedTwoSteps(1);
    await expect(
      publishScenarioVersion(db, scenario.id, { staffId: null, idempotencyKey: 'key-self-1' }),
    ).rejects.toThrow('SCENARIO_PUBLISH_CYCLE');
  });

  test('完了後の移動が循環していると公開できない (A→B→A)', async () => {
    const a = await createScenario(db, { name: 'A', triggerType: 'manual' });
    const b = await createScenario(db, { name: 'B', triggerType: 'manual' });
    for (const scenario of [a, b]) {
      await createScenarioStep(db, {
        scenarioId: scenario.id, stepOrder: 0, messageType: 'text', messageContent: '1通目',
      });
    }
    await updateScenario(db, a.id, { on_complete_mode: 'move', on_complete_scenario_id: b.id });
    await updateScenario(db, b.id, { on_complete_mode: 'move', on_complete_scenario_id: a.id });
    await expect(
      publishScenarioVersion(db, a.id, { staffId: null, idempotencyKey: 'key-xcycle-1' }),
    ).rejects.toThrow('SCENARIO_PUBLISH_CYCLE');
  });

  test('完了後の移動が一方通行なら公開できる', async () => {
    const a = await createScenario(db, { name: 'A', triggerType: 'manual' });
    const b = await createScenario(db, { name: 'B', triggerType: 'manual' });
    for (const scenario of [a, b]) {
      await createScenarioStep(db, {
        scenarioId: scenario.id, stepOrder: 0, messageType: 'text', messageContent: '1通目',
      });
    }
    await updateScenario(db, a.id, { on_complete_mode: 'move', on_complete_scenario_id: b.id });
    const version = await publishScenarioVersion(db, a.id, { staffId: null, idempotencyKey: 'key-xlinear-1' });
    expect(version.scenario_id).toBe(a.id);
  });
});
