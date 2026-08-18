import { describe, expect, it } from 'vitest';
import { updateScenario } from '../src/scenarios.js';

/**
 * 配信方式を更新できるようにしたぶんの確かめ。
 *
 * 設計（配信方式の選択）は、シナリオを作ってから方式を選ぶ流れ。
 * それまで `updateScenario` は delivery_mode を無視していたので、
 * 選んでも保存されなかった。
 *
 * **通があるときに変えてよいかの判断は、ここではしない。** それは呼ぶ側
 * （worker の PUT）の仕事で、通の件数を数えてから渡す。ここは
 * 「渡されたら書く」ことだけを見る。
 */

/** 実行された SQL と値を覚えるだけの D1。 */
function recordingDb() {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        run: async () => {
          calls.push({ sql, values });
          return { meta: { changes: 1 } };
        },
        first: async () => ({ id: 's1', delivery_mode: 'elapsed' }),
      }),
    }),
  } as unknown as D1Database;
  return { db, calls };
}

describe('updateScenario の delivery_mode', () => {
  it('渡すと UPDATE に含まれる', async () => {
    const { db, calls } = recordingDb();
    await updateScenario(db, 's1', { delivery_mode: 'absolute_time' });
    const update = calls.find((c) => c.sql.includes('UPDATE scenarios'));
    expect(update, 'UPDATE が実行されていない').toBeDefined();
    expect(update!.sql).toContain('delivery_mode = ?');
    expect(update!.values).toContain('absolute_time');
  });

  it('渡さなければ UPDATE に含まれない', async () => {
    // 他の項目を直すたびに配信方式まで書き換わると、通の予定と食い違う。
    const { db, calls } = recordingDb();
    await updateScenario(db, 's1', { name: '名前だけ' });
    const update = calls.find((c) => c.sql.includes('UPDATE scenarios'));
    expect(update!.sql).not.toContain('delivery_mode');
  });

  it('他の項目と一緒でも書ける', async () => {
    const { db, calls } = recordingDb();
    await updateScenario(db, 's1', { name: '両方', delivery_mode: 'elapsed' });
    const update = calls.find((c) => c.sql.includes('UPDATE scenarios'))!;
    expect(update.sql).toContain('name = ?');
    expect(update.sql).toContain('delivery_mode = ?');
    expect(update.values).toContain('elapsed');
  });
});
