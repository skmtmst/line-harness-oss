import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  upsertAdCostEntry,
  recordAdCostImportRun,
  hasSuccessfulAdCostImport,
  getAdCostSummary,
  getAdCostTotalsByRoute,
  getAdCostImportStatus,
  isValidCostDay,
  normalizeCostCurrency,
} from '../src/ad-costs.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');

let sqlite: Database.Database;
let db: D1Database;

function asD1(sqliteDb: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqliteDb.prepare(query);
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
        async run() {
          const info = sqliteDb.prepare(query).run();
          return { results: [], success: true, meta: { changes: info.changes } };
        },
        async first<T>() {
          return (sqliteDb.prepare(query).get() as T) ?? null;
        },
        async all<T>() {
          return { results: sqliteDb.prepare(query).all() as T[], success: true, meta: {} };
        },
      };
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      sqliteDb.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqliteDb.exec('COMMIT');
        return results;
      } catch (error) {
        sqliteDb.exec('ROLLBACK');
        throw error;
      }
    },
  } as unknown as D1Database;
}

function insertRoute(id: string, accountId: string): void {
  sqlite
    .prepare(
      `INSERT INTO entry_routes (id, ref_code, name, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, '2026-08-16', '2026-08-16')`,
    )
    .run(id, `ref-${id}`, `route-${id}`, accountId);
}

function insertFriendAddEvent(
  id: string,
  friendId: string,
  routeId: string,
  occurredAt: string,
  accountId = 'account-1',
): void {
  sqlite
    .prepare(
      `INSERT INTO friend_add_events
         (id, line_account_id, friend_id, webhook_event_id, friend_kind,
          attribution_status, entry_route_id, occurred_at)
       VALUES (?, ?, ?, ?, 'first_time', 'captured', ?, ?)`,
    )
    .run(id, accountId, friendId, `wh-${id}`, routeId, occurredAt);
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(PKG_ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`
    INSERT INTO line_accounts
      (id, channel_id, name, channel_access_token, channel_secret, tenant_id)
    VALUES
      ('account-1', 'channel-1', '店舗1', 'token-1', 'secret-1', '00000000-0000-4000-8000-000000000001'),
      ('account-2', 'channel-2', '店舗2', 'token-2', 'secret-2', '00000000-0000-4000-8000-000000000001');
    INSERT INTO ad_platforms (id, name, display_name, line_account_id)
    VALUES ('meta-1', 'meta', 'Meta広告', 'account-1'), ('meta-2', 'meta', 'Meta広告2', 'account-2');
    INSERT INTO friends (id, line_user_id, line_account_id, display_name, created_at, updated_at)
    VALUES
      ('f-1', 'Uf100000000000000000000000000000', 'account-1', '友だち1', '2026-09-01', '2026-09-01'),
      ('f-2', 'Uf200000000000000000000000000000', 'account-1', '友だち2', '2026-09-01', '2026-09-01');
  `);
  insertRoute('route-1', 'account-1');
  insertFriendAddEvent('ev-1', 'f-1', 'route-1', '2026-09-20T10:00:00.000');
  insertFriendAddEvent('ev-2', 'f-2', 'route-1', '2026-09-20T11:00:00.000');
  db = asD1(sqlite);
});

describe('広告費の台帳', () => {
  test('手入力と取込を区別して記録し、流入元の「1人あたり」に使う追加数を付ける', async () => {
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1',
      sourceLabel: 'チラシ',
      day: '2026-09-20',
      amountMinor: 8000,
      currency: 'JPY',
      source: 'manual',
    });
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1',
      adPlatformId: 'meta-1',
      entryRouteId: 'route-1',
      sourceLabel: 'Meta広告',
      day: '2026-09-20',
      amountMinor: 2000,
      currency: 'JPY',
      source: 'import',
    });

    const summary = await getAdCostSummary(db, {
      lineAccountId: 'account-1', from: '2026-09-20', to: '2026-09-20',
    });
    expect(summary).toHaveLength(2);

    const manual = summary.find((row) => row.source === 'manual')!;
    expect(manual.totals).toEqual([{ currency: 'JPY', amountMinor: 8000 }]);
    expect(manual.friendAdds).toBeNull();

    const imported = summary.find((row) => row.source === 'import')!;
    expect(imported.entryRouteId).toBe('route-1');
    expect(imported.friendAdds).toBe(2);
    expect(imported.lastImportedAt).toBeTruthy();
  });

  test('同じ流入先・同じ日・同じ入り口の取込は行を増やさず上書きする', async () => {
    for (const amount of [2000, 3500]) {
      await upsertAdCostEntry(db, {
        lineAccountId: 'account-1',
        adPlatformId: 'meta-1',
        sourceLabel: 'Meta広告/cmp-1',
        day: '2026-09-20',
        amountMinor: amount,
        currency: 'JPY',
        source: 'import',
      });
    }

    const summary = await getAdCostSummary(db, {
      lineAccountId: 'account-1', from: '2026-09-20', to: '2026-09-20',
    });
    expect(summary).toHaveLength(1);
    expect(summary[0].totals).toEqual([{ currency: 'JPY', amountMinor: 3500 }]);
  });

  test('違う通貨は足し合わせず、通貨ごとの合計で返す', async () => {
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1', sourceLabel: '国内広告',
      day: '2026-09-20', amountMinor: 1000, currency: 'JPY', source: 'manual',
    });
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1', sourceLabel: '海外広告',
      day: '2026-09-20', amountMinor: 500, currency: 'USD', source: 'manual',
    });

    const summary = await getAdCostSummary(db, {
      lineAccountId: 'account-1', from: '2026-09-20', to: '2026-09-20',
    });
    const allTotals = summary.flatMap((row) => row.totals);
    expect(allTotals).toContainEqual({ currency: 'JPY', amountMinor: 1000 });
    expect(allTotals).toContainEqual({ currency: 'USD', amountMinor: 500 });
  });

  test('他のアカウントの費用・追加数は混ざらない', async () => {
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-2', sourceLabel: '別店舗',
      day: '2026-09-20', amountMinor: 99999, currency: 'JPY', source: 'manual',
    });
    const summary = await getAdCostSummary(db, {
      lineAccountId: 'account-1', from: '2026-09-20', to: '2026-09-20',
    });
    expect(summary).toHaveLength(0);
  });

  test('流入元ごとの集計は経路に結びついた分だけ返す', async () => {
    insertRoute('route-2', 'account-1');
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1', entryRouteId: 'route-1', sourceLabel: 'Meta広告',
      day: '2026-09-20', amountMinor: 3000, currency: 'JPY', source: 'import',
      adPlatformId: 'meta-1',
    });
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1', entryRouteId: 'route-2', sourceLabel: '手入力/チラシ',
      day: '2026-09-20', amountMinor: 2000, currency: 'JPY', source: 'manual',
    });
    await upsertAdCostEntry(db, {
      lineAccountId: 'account-1', sourceLabel: '経路なし',
      day: '2026-09-20', amountMinor: 100, currency: 'JPY', source: 'manual',
    });

    const byRoute = await getAdCostTotalsByRoute(db, {
      lineAccountId: 'account-1', from: '2026-09-20', to: '2026-09-20',
    });
    expect(byRoute.get('route-1')).toEqual([{ currency: 'JPY', amountMinor: 3000 }]);
    expect(byRoute.get('route-2')).toEqual([{ currency: 'JPY', amountMinor: 2000 }]);
    expect(byRoute.size).toBe(2);
  });
});

describe('広告費の取込履歴', () => {
  test('成功・失敗と最終取込日時を記録し、同じ日の取り直しは最新に差し替える', async () => {
    await recordAdCostImportRun(db, {
      adPlatformId: 'meta-1', day: '2026-09-20',
      status: 'failed', errorMessage: 'トークン期限切れ',
    });
    expect(await hasSuccessfulAdCostImport(db, 'meta-1', '2026-09-20')).toBe(false);

    await recordAdCostImportRun(db, {
      adPlatformId: 'meta-1', day: '2026-09-20', status: 'success',
    });
    expect(await hasSuccessfulAdCostImport(db, 'meta-1', '2026-09-20')).toBe(true);

    const status = await getAdCostImportStatus(db, ['meta-1', 'meta-2']);
    const meta = status.get('meta-1')!;
    expect(meta.lastRunStatus).toBe('success');
    expect(meta.lastSuccessAt).toBeTruthy();
    // 走ったことのない媒体は null
    const meta2 = status.get('meta-2');
    expect(meta2).toBeUndefined();
  });

  test('失敗の直後は直近の状態が「失敗」で最後の成功は残る', async () => {
    await recordAdCostImportRun(db, {
      adPlatformId: 'meta-1', day: '2026-09-19', status: 'success',
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await recordAdCostImportRun(db, {
      adPlatformId: 'meta-1', day: '2026-09-20',
      status: 'failed', errorMessage: '通信できません',
    });

    const status = (await getAdCostImportStatus(db, ['meta-1'])).get('meta-1')!;
    expect(status.lastRunStatus).toBe('failed');
    expect(status.lastError).toBe('通信できません');
    expect(status.lastSuccessAt).toBeTruthy();
  });
});

describe('入力の検査', () => {
  test('日付と通貨の形を検査する', () => {
    expect(isValidCostDay('2026-09-20')).toBe(true);
    expect(isValidCostDay('2026-9-20')).toBe(false);
    expect(isValidCostDay('not-a-date')).toBe(false);
    expect(normalizeCostCurrency('jpy')).toBe('JPY');
    expect(normalizeCostCurrency('USD')).toBe('USD');
    expect(normalizeCostCurrency('yen')).toBe('YEN');
    expect(normalizeCostCurrency('JPYY')).toBeNull();
    expect(normalizeCostCurrency('')).toBeNull();
  });
});
