import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  appendConversionReversal,
  createMeasurementSite,
  getReversalMetricsByPoint,
  getReversedEventIds,
  isConversionEventReversed,
  listConversionReversals,
  listMeasurementSites,
  normalizeSiteHost,
  recordAnonymousConversionDay,
  recordDomainRejection,
  resumeMeasurementSite,
  siteAllowsHost,
  stopMeasurementSite,
  updateMeasurementSiteDomains,
} from '../src/web-measurement.js';
import { asD1 } from './d1-test-helper.js';

/*
 * #819: Web計測の公開口。サイトごとの公開ID・許可ドメイン・
 * 許可外の拒否集計・匿名の日次集計・成果の取消台帳を確かめる。
 */

function setup(): Database.Database {
  const sqlite = new Database(':memory:');
  sqlite.exec(`
    CREATE TABLE line_accounts (id TEXT PRIMARY KEY, tenant_id TEXT);
    CREATE TABLE conversion_points (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, event_type TEXT NOT NULL, value REAL,
      measure_method TEXT NOT NULL DEFAULT 'manual', target_url TEXT,
      count_repeat INTEGER NOT NULL DEFAULT 1, attribution_days INTEGER,
      line_account_id TEXT, tenant_id TEXT, version INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL, updated_at TEXT
    );
    CREATE TABLE conversion_events (
      id TEXT PRIMARY KEY, conversion_point_id TEXT NOT NULL,
      friend_id TEXT NOT NULL, value_snapshot REAL, tenant_id TEXT,
      created_at TEXT NOT NULL
    );
    INSERT INTO line_accounts (id, tenant_id) VALUES ('a1', 'tenant-1');
    INSERT INTO conversion_points (id, name, event_type, created_at)
      VALUES ('point-1', '購入完了', 'purchase', '2026-09-01 00:00:00');
    INSERT INTO conversion_events (id, conversion_point_id, friend_id, value_snapshot, created_at)
      VALUES ('ev-1', 'point-1', 'friend-1', 1000, '2026-09-02 10:00:00'),
             ('ev-2', 'point-1', 'friend-2', 2000, '2026-09-02 11:00:00');
  `);
  // R275の465は表の作成(503)より前の番号。新しいDBではこの順で流れるため、
  // ここでも同じ順で当てて「表が無くても止まらない」ことを固定する。
  for (const file of ['465_inflow_stop_cancel.sql', '503_measurement_sites.sql', '504_conversion_reversal_ledger.sql']) {
    sqlite.exec(
      readFileSync(join(import.meta.dirname, '..', 'migrations', file), 'utf8'),
    );
  }
  return sqlite;
}

describe('計測サイトと許可ドメイン', () => {
  it('サイトを作ると公開IDとドメインが返る', async () => {
    const db = asD1(setup());
    const site = await createMeasurementSite(db, {
      lineAccountId: 'a1',
      label: '公式ショップ',
      domains: ['shop.example.com', 'example.com'],
    });
    expect(site.id).toMatch(/^site_[a-f0-9]{32}$/);
    expect(site.domains).toEqual(['example.com', 'shop.example.com']);
    expect(site.rejectedTotal).toBe(0);

    const sites = await listMeasurementSites(db, 'a1');
    expect(sites).toHaveLength(1);
    expect(sites[0].label).toBe('公式ショップ');
  });

  it('許可ドメインは www の有無を同一視する', async () => {
    const db = asD1(setup());
    const site = await createMeasurementSite(db, {
      lineAccountId: 'a1', label: 's', domains: ['example.com'],
    });
    expect(await siteAllowsHost(db, site.id, 'example.com')).toBe(true);
    expect(await siteAllowsHost(db, site.id, 'www.example.com')).toBe(true);
    expect(await siteAllowsHost(db, site.id, 'evil.example.org')).toBe(false);
    expect(await siteAllowsHost(db, site.id, 'sub.example.com')).toBe(false);
  });

  it('R279 wwwつき・なしの既存登録と来訪ホスト4通りを同じサイトとして扱う', async () => {
    const db = asD1(setup());
    for (const [index, stored] of ['example.com', 'www.example.com'].entries()) {
      const site = await createMeasurementSite(db, { lineAccountId: 'a1', label: `site-${index}`, domains: [stored] });
      for (const visiting of ['example.com', 'www.example.com']) {
        expect(await siteAllowsHost(db, site.id, visiting)).toBe(true);
      }
      expect(await siteAllowsHost(db, site.id, 'sub.example.com')).toBe(false);
      expect(await siteAllowsHost(db, site.id, 'evil-example.com')).toBe(false);
    }
  });

  it('ドメインの更新は差し替えになる', async () => {
    const db = asD1(setup());
    const site = await createMeasurementSite(db, {
      lineAccountId: 'a1', label: 's', domains: ['a.example.com'],
    });
    await updateMeasurementSiteDomains(db, site.id, ['b.example.com'], '改名');
    const [after] = await listMeasurementSites(db, 'a1');
    expect(after.label).toBe('改名');
    expect(after.domains).toEqual(['b.example.com']);
    expect(await siteAllowsHost(db, site.id, 'a.example.com')).toBe(false);
  });
});

describe('ドメイン名の検査', () => {
  it('URL・末尾ドット・ポート・大文字を正規化する', () => {
    expect(normalizeSiteHost('https://Shop.Example.com/path')).toBe('shop.example.com');
    expect(normalizeSiteHost('example.com.')).toBe('example.com');
    expect(normalizeSiteHost('example.com:8443')).toBe('example.com');
    expect(normalizeSiteHost('EXAMPLE.COM')).toBe('example.com');
    expect(normalizeSiteHost('https://WWW.Example.COM/path')).toBe('example.com');
  });

  it('ドメインでない入力は弾く', () => {
    expect(normalizeSiteHost('')).toBeNull();
    expect(normalizeSiteHost('localhost')).toBeNull();
    expect(normalizeSiteHost('not a domain')).toBeNull();
    expect(normalizeSiteHost(123)).toBeNull();
    expect(normalizeSiteHost(undefined)).toBeNull();
  });
});

describe('許可外ドメインの拒否集計', () => {
  it('件数と最後の来た先だけを残す', async () => {
    const db = asD1(setup());
    const site = await createMeasurementSite(db, {
      lineAccountId: 'a1', label: 's', domains: ['example.com'],
    });
    await recordDomainRejection(db, site.id, 'bad.example.org');
    await recordDomainRejection(db, site.id, 'bad.example.org');
    await recordDomainRejection(db, site.id, 'worse.example.net');
    const [after] = await listMeasurementSites(db, 'a1');
    expect(after.rejectedTotal).toBe(3);
    expect(after.lastRejectedHost).toBe('worse.example.net');
    expect(after.lastRejectedAt).not.toBeNull();
  });
});

describe('匿名の成果の日次集計', () => {
  it('同じ日は件数だけが増える', async () => {
    const db = asD1(setup());
    await recordAnonymousConversionDay(db, 'point-1');
    await recordAnonymousConversionDay(db, 'point-1');
    const row = await db
      .prepare('SELECT anonymous_count FROM conversion_anonymous_days WHERE conversion_point_id = ?')
      .bind('point-1')
      .first<{ anonymous_count: number }>();
    expect(row?.anonymous_count).toBe(2);
  });
});

describe('成果の取消台帳', () => {
  it('取り消しは追記になり、元の成果行は消えない', async () => {
    const db = asD1(setup());
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'reverse', reason: '重複して届いた', actorName: 'admin',
    });
    expect(await isConversionEventReversed(db, 'ev-1')).toBe(true);
    const event = await db
      .prepare('SELECT id, value_snapshot FROM conversion_events WHERE id = ?')
      .bind('ev-1')
      .first<{ id: string; value_snapshot: number }>();
    // 元の行はそのまま残る
    expect(event).toEqual({ id: 'ev-1', value_snapshot: 1000 });
  });

  it('取消の取消で元に戻り、履歴はすべて残る', async () => {
    const db = asD1(setup());
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'reverse', reason: '一旦取り消し',
    });
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'restore', reason: '確認したら正しかった',
    });
    expect(await isConversionEventReversed(db, 'ev-1')).toBe(false);
    const history = await listConversionReversals(db, 'ev-1');
    expect(history.map((r) => r.kind)).toEqual(['restore', 'reverse']);
    expect(history.map((r) => r.reason)).toEqual(['確認したら正しかった', '一旦取り消し']);
  });

  it('二重の取り消しと、取り消していない成果への取消の取消は弾く', async () => {
    const db = asD1(setup());
    await expect(
      appendConversionReversal(db, { conversionEventId: 'ev-2', kind: 'restore', reason: 'x' }),
    ).rejects.toThrow('conversion_event_not_reversed');
    await appendConversionReversal(db, {
      conversionEventId: 'ev-2', kind: 'reverse', reason: '取り消し',
    });
    await expect(
      appendConversionReversal(db, { conversionEventId: 'ev-2', kind: 'reverse', reason: 'もう一度' }),
    ).rejects.toThrow('conversion_event_already_reversed');
  });

  it('一覧用の取消状態は一括で取れる', async () => {
    const db = asD1(setup());
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'reverse', reason: 'r',
    });
    await appendConversionReversal(db, {
      conversionEventId: 'ev-2', kind: 'reverse', reason: 'r',
    });
    await appendConversionReversal(db, {
      conversionEventId: 'ev-2', kind: 'restore', reason: 'r',
    });
    const reversed = await getReversedEventIds(db, ['ev-1', 'ev-2', 'ev-none']);
    expect(reversed.has('ev-1')).toBe(true);
    expect(reversed.has('ev-2')).toBe(false);
  });
});

describe('地点ごとの取消集計(純数から引く分)', () => {
  it('いま取り消されている成果の件数と金額(保存時点の値)を返す', async () => {
    const db = asD1(setup());
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'reverse', reason: 'r',
    });
    const metrics = await getReversalMetricsByPoint(db, ['point-1']);
    expect(metrics.get('point-1')).toEqual({ count: 1, value: 1000 });
  });

  it('取消を戻した成果は集計から外れる', async () => {
    const db = asD1(setup());
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'reverse', reason: 'r',
    });
    await appendConversionReversal(db, {
      conversionEventId: 'ev-1', kind: 'restore', reason: '戻し',
    });
    const metrics = await getReversalMetricsByPoint(db, ['point-1']);
    expect(metrics.get('point-1')).toBeUndefined();
  });

  it('同じ時刻の追記は後に入った行が勝つ', async () => {
    const sqlite = setup();
    const db = asD1(sqlite);
    const sameTime = '2026-09-10T12:00:00.000';
    // 手動で同時刻の reverse → restore を書き、rowid が後勝ちであることを確かめる。
    const ins = sqlite.prepare(
      `INSERT INTO conversion_event_reversals (id, conversion_event_id, kind, reason, created_at)
       VALUES (?, 'ev-1', ?, 'r', ?)`,
    );
    ins.run('rev-1', 'reverse', sameTime);
    ins.run('rev-2', 'restore', sameTime);
    expect(await isConversionEventReversed(db, 'ev-1')).toBe(false);
    // restore を消して reverse だけ残すと「取り消し中」に戻る
    sqlite.prepare(`DELETE FROM conversion_event_reversals WHERE id = 'rev-2'`).run();
    expect(await isConversionEventReversed(db, 'ev-1')).toBe(true);
    const metrics = await getReversalMetricsByPoint(db, ['point-1']);
    expect(metrics.get('point-1')).toEqual({ count: 1, value: 1000 });
  });
});

describe('計測サイトの停止・再開 (R275)', () => {
  it('止めると日時と理由が残り、一覧は「停止中」を返す。再開で戻る', async () => {
    const db = asD1(setup());
    const site = await createMeasurementSite(db, {
      lineAccountId: 'a1', label: '公式ショップ', domains: ['example.com'],
    });

    const stopped = await stopMeasurementSite(db, site.id, 'サイトを閉じたため');
    expect(stopped).toBe('stopped');
    // 重ねて止めても状態は1つだけ
    expect(await stopMeasurementSite(db, site.id, 'もう一度')).toBe('already_stopped');

    const listed = await listMeasurementSites(db, 'a1');
    expect(listed[0].stopped_at).toBeTruthy();
    expect(listed[0].stopped_reason).toBe('サイトを閉じたため');
    // 行と許可ドメインは消えない
    expect(listed[0].domains).toEqual(['example.com']);

    expect(await resumeMeasurementSite(db, site.id)).toBe('resumed');
    expect(await resumeMeasurementSite(db, site.id)).toBe('not_stopped');
    const after = await listMeasurementSites(db, 'a1');
    expect(after[0].stopped_at).toBeNull();
    expect(after[0].stopped_reason).toBeNull();
  });
});
