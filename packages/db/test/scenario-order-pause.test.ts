import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createScenario,
  createScenarioStep,
  enrollFriendInScenario,
  pauseFriendScenario,
  reorderScenarios,
  getScenarios,
} from '../src/scenarios.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => ({
    async run() {
      const info = sqlite.prepare(query).run(...params);
      return { results: [], success: true, meta: { changes: info.changes } };
    },
    async first<T>() {
      return (sqlite.prepare(query).get(...params) as T) ?? null;
    },
    async all<T>() {
      return { results: sqlite.prepare(query).all(...params) as T[], success: true, meta: {} };
    },
  });
  return {
    prepare(query: string) {
      return {
        bind: (...params: unknown[]) => wrap(query, params),
        ...wrap(query, []),
      };
    },
    async batch(stmts: Array<{ run: () => Promise<unknown> }>) {
      for (const st of stmts) await st.run();
      return [];
    },
  } as unknown as D1Database;
}

let sqlite: Database.Database;
let db: D1Database;

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  db = asD1(sqlite);
});

function insertFriend(id: string): void {
  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, created_at, updated_at)
       VALUES (?, ?, 'テスト', '2026-08-18', '2026-08-18')`,
    )
    .run(id, `U-${id}`);
}

describe('シナリオの並び順（113）', () => {
  test('渡した順に並び替わる', async () => {
    const a = await createScenario(db, { name: 'A', triggerType: 'manual' });
    const b = await createScenario(db, { name: 'B', triggerType: 'manual' });
    const c = await createScenario(db, { name: 'C', triggerType: 'manual' });

    await reorderScenarios(db, [c.id, a.id, b.id]);

    const rows = sqlite
      .prepare(`SELECT id, display_order FROM scenarios ORDER BY display_order ASC`)
      .all() as Array<{ id: string; display_order: number }>;
    expect(rows.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
  });

  test('既定は 0。触っていないシナリオの並びは変わらない', async () => {
    await createScenario(db, { name: 'A', triggerType: 'manual' });
    const rows = await getScenarios(db);
    expect(rows.every((r) => r.display_order === 0)).toBe(true);
  });

  test('空を渡しても壊れない', async () => {
    await expect(reorderScenarios(db, [])).resolves.toBeUndefined();
  });
});

describe('送信後 一時停止（113）', () => {
  test('既定は continue。これまでどおり次へ進む', async () => {
    const sc = await createScenario(db, { name: 'S', triggerType: 'manual' });
    const step = await createScenarioStep(db, {
      scenarioId: sc.id,
      stepOrder: 1,
      messageType: 'text',
      messageContent: 'こんにちは',
    });
    expect(step.after_send).toBe('continue');
  });

  test('pause を指定すると、その通に印が残る', async () => {
    const sc = await createScenario(db, { name: 'S', triggerType: 'manual' });
    const step = await createScenarioStep(db, {
      scenarioId: sc.id,
      stepOrder: 1,
      messageType: 'text',
      messageContent: '体調を教えてください',
      afterSend: 'pause',
    });
    expect(step.after_send).toBe('pause');
  });

  test('止めると次の配信日時が消え、続きの位置は残る', async () => {
    // 返事を待つあいだに次の通が届かないよう、時間が来ても進まない状態にする。
    // 再開したときに続きから流せるよう、どこまで送ったかは残す。
    const sc = await createScenario(db, { name: 'S', triggerType: 'manual' });
    insertFriend('f-1');
    const fs = await enrollFriendInScenario(db, 'f-1', sc.id);
    expect(fs).not.toBeNull();

    await pauseFriendScenario(db, fs!.id, 3);

    const row = sqlite
      .prepare(`SELECT status, current_step_order, next_delivery_at FROM friend_scenarios WHERE id = ?`)
      .get(fs!.id) as { status: string; current_step_order: number; next_delivery_at: string | null };
    expect(row.status).toBe('paused');
    expect(row.current_step_order).toBe(3);
    expect(row.next_delivery_at).toBeNull();
  });
});
