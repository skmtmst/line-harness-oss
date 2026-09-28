import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createScenario,
  deleteScenario,
  getScenarioById,
  listMoveReferrers,
  updateScenario,
} from './scenarios.js';

const packageRoot = join(import.meta.dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  function prepare(query: string): D1PreparedStatement {
    const statement = sqlite.prepare(query);
    const bound = (params: unknown[]): D1PreparedStatement => ({
      bind: (...next: unknown[]) => bound(next),
      async all<T>() {
        return { results: statement.all(...params) as T[], success: true, meta: {} };
      },
      async first<T>() {
        return (statement.get(...params) as T | undefined) ?? null;
      },
      async run<T>() {
        const result = statement.run(...params);
        return { success: true, meta: { changes: result.changes }, results: [] } as T;
      },
    } as unknown as D1PreparedStatement);
    return bound([]);
  }
  return {
    prepare,
    async batch<T>(statements: D1PreparedStatement[]) {
      const results: unknown[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results as T;
    },
  } as unknown as D1Database;
}

describe('終了後の移動先の参照（R250）', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(packageRoot, 'bootstrap.sql'), 'utf8'));
    db = asD1(sqlite);
  });

  it('移動先を指しているシナリオを名前で返す', async () => {
    const a = await createScenario(db, { name: 'A', triggerType: 'manual' });
    const b = await createScenario(db, { name: 'B', triggerType: 'manual' });
    await updateScenario(db, a.id, { on_complete_mode: 'move', on_complete_scenario_id: b.id });

    expect(await listMoveReferrers(db, b.id)).toEqual([
      { id: a.id, name: 'A', lineAccountId: null },
    ]);
    expect(await listMoveReferrers(db, a.id)).toEqual([]);
  });

  it('移動先を消すと参照元の終了後の処理が「一時停止」に戻り、移動先なしの移動を残さない', async () => {
    const a = await createScenario(db, { name: 'A', triggerType: 'manual' });
    const b = await createScenario(db, { name: 'B', triggerType: 'manual' });
    await updateScenario(db, a.id, { on_complete_mode: 'move', on_complete_scenario_id: b.id });

    await deleteScenario(db, b.id);

    expect(await getScenarioById(db, b.id)).toBeNull();
    const after = await db
      .prepare(`SELECT on_complete_mode, on_complete_scenario_id FROM scenarios WHERE id = ?`)
      .bind(a.id)
      .first<{ on_complete_mode: string; on_complete_scenario_id: string | null }>();
    expect(after).toMatchObject({ on_complete_mode: 'pause', on_complete_scenario_id: null });
    expect(await listMoveReferrers(db, b.id)).toEqual([]);
  });
});
