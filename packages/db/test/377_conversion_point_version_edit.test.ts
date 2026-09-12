import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';
import { beforeEach, describe, expect, it } from 'vitest';

import { asD1 } from './d1-test-helper.js';
import {
  ConversionDefinitionError,
  createConversionDefinition,
  reviseConversionDefinition,
  stopConversionDefinition,
  listConversionDefinitions,
} from '../src/conversion-definitions.js';
import { trackConversion } from '../src/conversions.js';

/*
 * N-252 成果地点の編集・新版化（移行377）。
 *
 * 判定は「関数が例外を投げたか」ではなく、**DBに何が残ったか**で見る。
 * 版・利用先・過去の成果は別々の表にあるので、片方だけ進む壊れ方をここで捕まえる。
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCOPE = { allowedAccountIds: ['acc-a'], includeUnassigned: false };

let sqlite: Database.Database;
let db: D1Database;

function jst(offsetMs = 0): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + offsetMs).toISOString().slice(0, -1) + '+09:00';
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.pragma('foreign_keys = OFF');
  sqlite.exec(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
      VALUES ('acc-a','ch-a','店A','t','s'), ('acc-b','ch-b','店B','t','s');
    INSERT INTO friends (id, line_user_id, display_name, line_account_id, created_at, updated_at)
      VALUES ('fr-1','U1','友1','acc-a','2026-01-01T00:00:00.000+09:00','2026-01-01T00:00:00.000+09:00');
  `);
  db = asD1(sqlite);
});

async function makePoint(over: Partial<Parameters<typeof createConversionDefinition>[1]> = {}) {
  return createConversionDefinition(db, {
    name: '購入', sourceType: 'ec.order.confirmed', sourceConfig: {},
    measureMethod: 'manual', deduplicationMode: 'every', valueMode: 'fixed',
    fixedValue: 100, reversalPolicy: 'manual', lineAccountId: 'acc-a',
    usages: [], staffId: 'st-1', ...over,
  });
}

function baseRevision(id: string, expectedVersion: number) {
  return {
    id, scope: SCOPE, expectedVersion, staffId: 'st-1',
    name: '購入（改）', sourceType: 'ec.order.confirmed', sourceConfig: {},
    measureMethod: 'manual' as const, deduplicationMode: 'every' as const,
    valueMode: 'fixed' as const, fixedValue: 500, reversalPolicy: 'manual' as const,
  };
}

function pointRow(id: string) {
  return sqlite.prepare('SELECT * FROM conversion_points WHERE id = ?').get(id) as Record<string, unknown>;
}

describe('N-252 成果地点の編集・新版化', () => {
  it('編集すると版が1つ進み、前後の設定が監査に残る', async () => {
    const created = await makePoint();
    const result = await reviseConversionDefinition(db, baseRevision(created.id, 1));

    expect(result.version).toBe(2);
    const row = pointRow(created.id);
    expect(row.name).toBe('購入（改）');
    expect(row.value).toBe(500);
    expect(row.version).toBe(2);

    const rev = sqlite.prepare('SELECT * FROM conversion_definition_revisions WHERE conversion_point_id = ?')
      .get(created.id) as Record<string, string | number>;
    expect(rev.from_version).toBe(1);
    expect(rev.to_version).toBe(2);
    expect(JSON.parse(String(rev.before_config_json)).fixedValue).toBe(100);
    expect(JSON.parse(String(rev.after_config_json)).fixedValue).toBe(500);
    expect(rev.performed_by).toBe('st-1');
  });

  it('過去の成果は計測時の版と値を保ち、値を編集しても集計額が変わらない', async () => {
    const created = await makePoint();
    await trackConversion(db, { conversionPointId: created.id, friendId: 'fr-1' });

    const netValue = async () => {
      const list = await listConversionDefinitions(db, {
        scope: SCOPE, range: { from: '2000-01-01T00:00:00.000+09:00', to: '2999-01-01T00:00:00.000+09:00' },
        sort: 'updated_desc', cursor: 0, limit: 50,
      });
      return list.items.find((item) => item.id === created.id)?.metrics.netValue;
    };

    expect(await netValue()).toBe(100);
    await reviseConversionDefinition(db, baseRevision(created.id, 1));
    expect(await netValue()).toBe(100);

    const ev = sqlite.prepare('SELECT value_snapshot, point_version_snapshot FROM conversion_events WHERE conversion_point_id = ?')
      .get(created.id) as { value_snapshot: number; point_version_snapshot: number };
    expect(ev.value_snapshot).toBe(100);
    expect(ev.point_version_snapshot).toBe(1);
  });

  it('稼働中の利用先は同じIDのまま次の版へ付け替わる', async () => {
    const created = await makePoint({
      usages: [{ refKind: 'automation', refId: 'auto-1', refVersionId: null }],
    });
    const before = sqlite.prepare('SELECT id, definition_version FROM conversion_definition_usages WHERE conversion_point_id = ?')
      .get(created.id) as { id: string; definition_version: number };
    expect(before.definition_version).toBe(1);

    const result = await reviseConversionDefinition(db, baseRevision(created.id, 1));
    expect(result.movedUsages).toBe(1);

    const after = sqlite.prepare('SELECT id, definition_version, conversion_point_id FROM conversion_definition_usages WHERE conversion_point_id = ?')
      .get(created.id) as { id: string; definition_version: number; conversion_point_id: string };
    // 利用先の行そのものは作り直さない。安定IDのまま版だけが進む。
    expect(after.id).toBe(before.id);
    expect(after.conversion_point_id).toBe(created.id);
    expect(after.definition_version).toBe(2);
    // 旧版に取り残された利用先は無い（参照切れを作らない）。
    const orphan = sqlite.prepare('SELECT COUNT(*) AS n FROM conversion_definition_usages WHERE conversion_point_id = ? AND definition_version != ?')
      .get(created.id, 2) as { n: number };
    expect(orphan.n).toBe(0);
  });

  it('同じ版を狙う同時編集は片方だけ通り、負けた側は副作用を残さない', async () => {
    const created = await makePoint({
      usages: [{ refKind: 'automation', refId: 'auto-1', refVersionId: null }],
    });
    const settled = await Promise.allSettled([
      reviseConversionDefinition(db, { ...baseRevision(created.id, 1), name: 'A が付けた名前', staffId: 'st-a' }),
      reviseConversionDefinition(db, { ...baseRevision(created.id, 1), name: 'B が付けた名前', staffId: 'st-b' }),
    ]);
    const won = settled.filter((r) => r.status === 'fulfilled');
    const lost = settled.filter((r) => r.status === 'rejected');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const error = (lost[0] as PromiseRejectedResult).reason as ConversionDefinitionError;
    expect(error).toBeInstanceOf(ConversionDefinitionError);
    expect(error.code).toBe('version_conflict');

    // 版は1つしか進まない。監査も利用先も二重に動かない（後勝ちで上書きしない）。
    expect(pointRow(created.id).version).toBe(2);
    const revisions = sqlite.prepare('SELECT COUNT(*) AS n FROM conversion_definition_revisions WHERE conversion_point_id = ?')
      .get(created.id) as { n: number };
    expect(revisions.n).toBe(1);
    const usage = sqlite.prepare('SELECT definition_version FROM conversion_definition_usages WHERE conversion_point_id = ?')
      .get(created.id) as { definition_version: number };
    expect(usage.definition_version).toBe(2);
  });

  /*
   * 付け替えるのは「いま超えた版の利用先」だけ。
   *
   * 利用先の `definition_version` は「どの版に付いていたか」の記録なので、
   * 古い版に残っている行まで新しい版へ引き上げると、履歴を書き換えてしまう。
   */
  it('古い版に残っている利用先まで引き上げない', async () => {
    const created = await makePoint({
      usages: [{ refKind: 'automation', refId: 'auto-1', refVersionId: null }],
    });
    await reviseConversionDefinition(db, baseRevision(created.id, 1));
    // 何らかの理由で旧版に取り残された利用先を1件置く。
    sqlite.prepare(`INSERT INTO conversion_definition_usages
      (id, conversion_point_id, definition_version, line_account_id, ref_kind, ref_id, created_by, created_at, updated_at)
      VALUES ('usage-stale', ?, 1, 'acc-a', 'scenario', 'sc-1', 'st-1', ?, ?)`)
      .run(created.id, jst(), jst());

    const result = await reviseConversionDefinition(db, { ...baseRevision(created.id, 2), name: '購入（再改）' });
    expect(result.movedUsages).toBe(1);

    const rows = sqlite.prepare('SELECT id, definition_version FROM conversion_definition_usages WHERE conversion_point_id = ? ORDER BY id')
      .all(created.id) as Array<{ id: string; definition_version: number }>;
    const stale = rows.find((row) => row.id === 'usage-stale');
    const live = rows.find((row) => row.id !== 'usage-stale');
    expect(live?.definition_version).toBe(3);
    // 旧版の記録はそのまま。引き上げない。
    expect(stale?.definition_version).toBe(1);
  });

  it('別の店の視野からは編集できない（見つからない扱い）', async () => {
    const created = await makePoint();
    await expect(reviseConversionDefinition(db, {
      ...baseRevision(created.id, 1),
      scope: { allowedAccountIds: ['acc-b'], includeUnassigned: false },
    })).rejects.toMatchObject({ code: 'not_found', status: 404 });
    // 何も書き換わっていない。
    expect(pointRow(created.id).name).toBe('購入');
    expect(pointRow(created.id).version).toBe(1);
  });

  it('停止済みの地点は編集できない', async () => {
    const created = await makePoint();
    await stopConversionDefinition(db, { id: created.id, scope: SCOPE, expectedVersion: 1, staffId: 'st-1' });
    await expect(reviseConversionDefinition(db, baseRevision(created.id, 2)))
      .rejects.toMatchObject({ code: 'definition_stopped', status: 409 });
    expect(pointRow(created.id).name).toBe('購入');
  });

  it('同じ店に同じ名前の地点があれば編集で重ねられない', async () => {
    const first = await makePoint({ name: '購入' });
    await makePoint({ name: '資料請求' });
    await expect(reviseConversionDefinition(db, { ...baseRevision(first.id, 1), name: '資料請求' }))
      .rejects.toMatchObject({ code: 'duplicate_name', status: 409 });
    expect(pointRow(first.id).version).toBe(1);
  });
});

describe('N-252 計測時の控えは必ず入る（NULL の成果を生まない）', () => {
  beforeEach(() => {
    sqlite.exec(`
      INSERT INTO affiliates (id, name, code, commission_rate, is_active, line_account_id)
        VALUES ('af-1','紹介者','AF1',10,1,'acc-a');
      INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
        VALUES ('al-1','af-1','AF1CODE',1,'2026-01-01T00:00:00.000+09:00');
    `);
    sqlite.prepare('INSERT INTO ref_tracking (id, friend_id, ref_code, created_at) VALUES (?,?,?,?)')
      .run('rt-1', 'fr-1', 'AF1CODE', jst());
  });

  /*
   * `valueMode` が none / source の地点は `conversion_points.value` が NULL になる。
   * 控えに NULL を残すと、affiliate-settlements.ts の
   * `value_snapshot ?? point_value` が**そのときの地点の値**へ落ちるため、
   * 承認前に編集すると過去の成果の報酬額が動く。
   *
   * 「NULL の行を見つけられなかった」ではなく「NULL の行が生まれない」ことを見る。
   */
  for (const valueMode of ['none', 'source', 'fixed'] as const) {
    it(`valueMode=${valueMode} でも value_snapshot は NULL にならない`, async () => {
      const created = await makePoint({
        valueMode, fixedValue: valueMode === 'fixed' ? 100 : null,
      });
      await trackConversion(db, { conversionPointId: created.id, friendId: 'fr-1' });
      const ev = sqlite.prepare('SELECT affiliate_id, value_snapshot, point_version_snapshot FROM conversion_events WHERE conversion_point_id = ?')
        .get(created.id) as Record<string, unknown>;
      // 紹介者が付いた成果であること（精算の経路に乗る形）を先に確かめる。
      expect(ev.affiliate_id).toBe('af-1');
      expect(ev.value_snapshot).not.toBeNull();
      expect(ev.value_snapshot).toBe(valueMode === 'fixed' ? 100 : 0);
      expect(ev.point_version_snapshot).toBe(1);
    });
  }

  it('一人一回だけ数える地点（claim経路）でも控えは入る', async () => {
    const created = await makePoint({ deduplicationMode: 'once_per_friend', valueMode: 'none', fixedValue: null });
    await trackConversion(db, { conversionPointId: created.id, friendId: 'fr-1' });
    const ev = sqlite.prepare('SELECT value_snapshot, point_version_snapshot FROM conversion_events WHERE conversion_point_id = ?')
      .get(created.id) as Record<string, unknown>;
    expect(ev.value_snapshot).toBe(0);
    expect(ev.point_version_snapshot).toBe(1);
  });

  it('控えが入るので、編集しても過去の成果は現在の地点値を参照しない', async () => {
    const created = await makePoint({ valueMode: 'none', fixedValue: null });
    await trackConversion(db, { conversionPointId: created.id, friendId: 'fr-1' });
    const before = sqlite.prepare('SELECT value_snapshot FROM conversion_events WHERE conversion_point_id = ?')
      .get(created.id) as { value_snapshot: number };

    await reviseConversionDefinition(db, {
      ...baseRevision(created.id, 1), valueMode: 'fixed', fixedValue: 9999,
    });

    expect(pointRow(created.id).value).toBe(9999);
    const after = sqlite.prepare('SELECT value_snapshot FROM conversion_events WHERE conversion_point_id = ?')
      .get(created.id) as { value_snapshot: number };
    expect(after.value_snapshot).toBe(before.value_snapshot);
    expect(after.value_snapshot).toBe(0);
  });
});
