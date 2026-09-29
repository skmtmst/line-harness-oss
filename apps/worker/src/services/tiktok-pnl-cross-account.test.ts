/**
 * TikTok利益計算シートの「アカウント間の混入」回帰テスト。
 *
 * TikTokの注文IDは別アカウント（別ショップ）で同じ値になり得る。
 * 明細行のキーは `<注文ID>:<行番号>` なので、キーだけを主キーにすると
 * 先に取り込んだアカウントが行を占有し、
 *   - もう片方の注文内容で上書きされる（混入）
 *   - もう片方のシートには永久に出てこない（欠落）
 * の両方が起きる。ここはSQLそのものが仕様なので、実SQLiteに当てて確かめる。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { syncTiktokPnlForAccount, type TiktokPnlSettingsRow } from './tiktok-pnl.js';
import type { GoogleSheetsIntegrationRow } from './google-sheets.js';

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOW = '2026-09-29T06:00:00Z';
/** 2つのアカウントが同じTikTok注文IDを持っている状況。 */
const SHARED_ORDER_ID = '576461234567890123';

interface EcOrder {
  tiktok_order_id: string;
  ordered_at: string;
  paid_at: string | null;
  status: string;
  buyer_key: string;
  updated_at: string;
  lines: Array<{
    index: number;
    sku: string;
    product_name: string;
    quantity: number;
    unit_price_yen: number;
    line_amount_yen: number;
  }>;
}

/** EC側が返す注文（アカウントではなく呼び出し順で切り替える）とシートの中身を持つ偽サーバー。 */
function makeFetch(ecOrdersQueue: EcOrder[][]) {
  /** spreadsheetId → 明細タブに積まれた行。 */
  const sheets = new Map<string, (string | number)[][]>();
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'at-1', expires_in: 3600 });
    }
    if (url.endsWith('/line-harness/tiktok-order-export')) {
      const orders = ecOrdersQueue.shift() ?? [];
      return json({ success: true, orders, next_since: 'cursor-1', has_more: false });
    }

    const u = new URL(url);
    const spreadsheetId = /\/v4\/spreadsheets\/([^/]+)/.exec(u.pathname)?.[1] ?? '';
    const rows = sheets.get(spreadsheetId) ?? [];

    // キー列の読み取り（既存行の位置解決）。まだ何も書いていなければ空。
    if (u.pathname.includes('/values/') && (init?.method ?? 'GET') === 'GET') {
      return json({ values: rows.length > 0 ? [rows.map((row) => String(row[0]))] : [] });
    }
    // 追記。
    if (/:append$/.test(u.pathname)) {
      const body = JSON.parse(String(init?.body)) as { values: (string | number)[][] };
      rows.push(...body.values);
      sheets.set(spreadsheetId, rows);
      return json({});
    }
    // 既存行の更新。
    if (u.pathname.endsWith(':batchUpdate')) {
      const body = JSON.parse(String(init?.body)) as {
        data?: Array<{ range: string; values: (string | number)[][] }>;
      };
      for (const entry of body.data ?? []) {
        const rowNumber = Number(/!A(\d+):/.exec(entry.range)?.[1] ?? 0);
        if (rowNumber >= 2) rows[rowNumber - 2] = entry.values[0] ?? [];
      }
      sheets.set(spreadsheetId, rows);
      return json({});
    }
    return json({ error: { message: `unhandled ${url}` } }, 400);
  };

  return { fetch: fetchFn, sheets };
}

function seedAccount(testDb: SqliteD1, accountId: string): void {
  testDb.raw.prepare(
    `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret, is_active)
     VALUES (?, ?, ?, 'tok', 'sec', 1)`,
  ).run(accountId, `ch-${accountId}`, accountId);
}

async function makeIntegration(
  testDb: SqliteD1,
  accountId: string,
): Promise<GoogleSheetsIntegrationRow> {
  const enc = await encryptCredential('refresh-token-1', ENCRYPTION_KEY);
  testDb.raw.prepare(
    `INSERT INTO google_sheets_integrations
       (id, line_account_id, google_account_email, refresh_token_enc, status, connected_at)
     VALUES (?, ?, ?, ?, 'connected', ?)`,
  ).run(`int-${accountId}`, accountId, `owner-${accountId}@example.com`, enc, NOW);
  return (await testDb.db.prepare('SELECT * FROM google_sheets_integrations WHERE line_account_id = ?')
    .bind(accountId).first<GoogleSheetsIntegrationRow>())!;
}

/** 雛形作成・書き込みを通らないよう、利益計算シートは既にある状態にしておく。 */
function seedSettings(testDb: SqliteD1, accountId: string, spreadsheetId: string): void {
  testDb.raw.prepare(
    `INSERT INTO tiktok_pnl_settings
       (line_account_id, enabled, spreadsheet_id, spreadsheet_url, status, template_filled_at)
     VALUES (?, 1, ?, ?, 'ready', ?)`,
  ).run(accountId, spreadsheetId, `https://docs.google.com/spreadsheets/d/${spreadsheetId}`, NOW);
}

function envFor(testDb: SqliteD1, withEc: boolean): Env['Bindings'] {
  return {
    DB: testDb.db,
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    GOOGLE_SHEETS_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_SHEETS_OAUTH_CLIENT_SECRET: 'client-secret',
    ...(withEc
      ? { NEN_EC_BASE_URL: 'https://ec.example.com', ECCUBE_WEBHOOK_SECRET: 'x'.repeat(40) }
      : {}),
  } as Env['Bindings'];
}

function orderFor(productName: string, unitPrice: number): EcOrder {
  return {
    tiktok_order_id: SHARED_ORDER_ID,
    ordered_at: '2026-09-28T01:00:00Z',
    paid_at: '2026-09-28T01:05:00Z',
    status: 'AWAITING_SHIPMENT',
    buyer_key: 'buyer-1',
    updated_at: '2026-09-28T01:05:00Z',
    lines: [{
      index: 0,
      sku: 'SKU-1',
      product_name: productName,
      quantity: 1,
      unit_price_yen: unitPrice,
      line_amount_yen: unitPrice,
    }],
  };
}

describe('TikTok利益計算：アカウント間の混入', () => {
  let testDb: SqliteD1;
  beforeEach(() => {
    testDb = createTestD1();
    seedAccount(testDb, 'acc-1');
    seedAccount(testDb, 'acc-2');
    seedSettings(testDb, 'acc-1', 'sheet-1');
    seedSettings(testDb, 'acc-2', 'sheet-2');
  });

  it('同じTikTok注文IDでも、アカウントごとに別の行として保持する', async () => {
    const integration1 = await makeIntegration(testDb, 'acc-1');
    const integration2 = await makeIntegration(testDb, 'acc-2');
    // 1回目の呼び出しがacc-1、2回目がacc-2。中身は別商品にして上書きを見分ける。
    const { fetch, sheets } = makeFetch([
      [orderFor('鹿肉ミンチ 1kg', 3980)],
      [orderFor('鹿肉ジャーキー 200g', 2480)],
    ]);

    const first = await syncTiktokPnlForAccount(envFor(testDb, true), integration1, {
      now: NOW, fetch: fetch as never,
    });
    const second = await syncTiktokPnlForAccount(envFor(testDb, true), integration2, {
      now: NOW, fetch: fetch as never,
    });

    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    expect(first.importedOrders).toBe(1);
    expect(second.importedOrders).toBe(1);
    // 混入していれば片方が0行になる。
    expect(first.wroteRows).toBe(1);
    expect(second.wroteRows).toBe(1);

    const lines = await testDb.db.prepare(
      `SELECT line_account_id, line_key, product_name, unit_price_yen
         FROM tiktok_pnl_order_lines ORDER BY line_account_id`,
    ).all<{ line_account_id: string; line_key: string; product_name: string; unit_price_yen: number }>();
    expect(lines.results).toEqual([
      {
        line_account_id: 'acc-1',
        line_key: `${SHARED_ORDER_ID}:0`,
        product_name: '鹿肉ミンチ 1kg',
        unit_price_yen: 3980,
      },
      {
        line_account_id: 'acc-2',
        line_key: `${SHARED_ORDER_ID}:0`,
        product_name: '鹿肉ジャーキー 200g',
        unit_price_yen: 2480,
      },
    ]);

    // それぞれのシートに自分の商品だけが載る。
    expect(sheets.get('sheet-1')?.map((row) => row[3])).toEqual(['鹿肉ミンチ 1kg']);
    expect(sheets.get('sheet-2')?.map((row) => row[3])).toEqual(['鹿肉ジャーキー 200g']);
  });

  it('片方のシート書き出しで、もう片方の未反映フラグを消さない', async () => {
    const integration1 = await makeIntegration(testDb, 'acc-1');
    await makeIntegration(testDb, 'acc-2');
    // 同じキーの未反映行を両アカウントに用意する。
    for (const accountId of ['acc-1', 'acc-2']) {
      testDb.raw.prepare(
        `INSERT INTO tiktok_pnl_order_lines
           (line_key, line_account_id, tiktok_order_id, line_index, order_date_jst,
            product_name, quantity, fetched_at, sheet_dirty)
         VALUES (?, ?, ?, 0, '2026-09-28', ?, 1, ?, 1)`,
      ).run(`${SHARED_ORDER_ID}:0`, accountId, SHARED_ORDER_ID, `商品-${accountId}`, NOW);
    }

    const { fetch, sheets } = makeFetch([]);
    // EC未設定でも、取り込みを飛ばしてシート書き出しは行う。
    const result = await syncTiktokPnlForAccount(envFor(testDb, false), integration1, {
      now: NOW, fetch: fetch as never,
    });
    expect(result.wroteRows).toBe(1);
    expect(sheets.get('sheet-1')?.map((row) => row[3])).toEqual(['商品-acc-1']);

    const dirty = await testDb.db.prepare(
      'SELECT line_account_id, sheet_dirty FROM tiktok_pnl_order_lines ORDER BY line_account_id',
    ).all<{ line_account_id: string; sheet_dirty: number }>();
    expect(dirty.results).toEqual([
      { line_account_id: 'acc-1', sheet_dirty: 0 },
      // ここが1のままでないと、acc-2のシートには永久に書き出されない。
      { line_account_id: 'acc-2', sheet_dirty: 1 },
    ]);
  });

  it('取り込みカーソルはアカウントごとに別で進む', async () => {
    const integration1 = await makeIntegration(testDb, 'acc-1');
    await makeIntegration(testDb, 'acc-2');
    const { fetch } = makeFetch([[orderFor('鹿肉ミンチ 1kg', 3980)]]);
    await syncTiktokPnlForAccount(envFor(testDb, true), integration1, {
      now: NOW, fetch: fetch as never,
    });

    const settings = await testDb.db.prepare(
      'SELECT line_account_id, import_cursor FROM tiktok_pnl_settings ORDER BY line_account_id',
    ).all<Pick<TiktokPnlSettingsRow, 'line_account_id' | 'import_cursor'>>();
    expect(settings.results).toEqual([
      { line_account_id: 'acc-1', import_cursor: 'cursor-1' },
      { line_account_id: 'acc-2', import_cursor: null },
    ]);
  });
});
