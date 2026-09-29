/**
 * TikTok利益計算シートの「同期が壊れない」回帰テスト。
 *
 * ここで守るのは、利用者から見て金額が狂う・シートが増える・同期が止まる
 * といった形で表に出る不具合。いずれも一度起きると手作業の修正が必要になる。
 *   - 手動同期と定期実行が重なった時の二重追記
 *   - EC側のカーソルが進まない時の同一ページ無限取り込み
 *   - 途中ページで失敗した時の取り込みやり直し
 *   - 雛形書き込み失敗後に2つ目のスプレッドシートを作ってしまう
 *   - Google認可切れが連携状態に反映されない
 *   - SKUだけ変えた時にシートへ反映されない
 *   - 月次PnLの月が日付になり明細と突き合わせできない
 *   - 有効化していないアカウントに勝手にシートを作る
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import {
  processTiktokPnlTick,
  syncTiktokPnlForAccount,
  type TiktokPnlSettingsRow,
} from './tiktok-pnl.js';
import type { GoogleSheetsIntegrationRow } from './google-sheets.js';

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOW = '2026-09-29T06:00:00Z';

interface EcLine {
  index: number;
  sku: string;
  product_name: string;
  quantity: number;
  unit_price_yen: number;
  line_amount_yen: number;
}

interface EcOrder {
  tiktok_order_id: string;
  ordered_at: string;
  paid_at: string | null;
  status: string;
  buyer_key: string;
  updated_at: string;
  lines: EcLine[];
}

/** EC側の1回分の応答。カーソルと has_more を明示できるようにする。 */
interface EcPage {
  orders: EcOrder[];
  next_since: string | null;
  has_more: boolean;
  /** 指定するとこの応答をHTTPエラーにする（途中ページの失敗を再現）。 */
  fail?: boolean;
}

interface FakeServer {
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  /** spreadsheetId → 明細タブに積まれた行。 */
  sheets: Map<string, (string | number)[][]>;
  /** 作成されたスプレッドシートIDの順番。2つ目が作られたら長さで分かる。 */
  created: string[];
  /** 雛形書き込み（values:batchUpdate、範囲指定つき）の記録。 */
  templateWrites: Array<{ spreadsheetId: string; valueInputOption: string; ranges: string[];
    values: (string | number)[][][] }>;
  /** EC側が呼ばれた回数。無限ループの検出に使う。 */
  ecCalls: number;
}

function makeServer(pages: EcPage[], options?: { sheetsTokenExpired?: boolean }): FakeServer {
  const sheets = new Map<string, (string | number)[][]>();
  const created: string[] = [];
  const templateWrites: FakeServer['templateWrites'] = [];
  const server = { sheets, created, templateWrites, ecCalls: 0 } as FakeServer;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  server.fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === 'https://oauth2.googleapis.com/token') {
      if (options?.sheetsTokenExpired) {
        return json({ error: 'invalid_grant' }, 400);
      }
      return json({ access_token: 'at-1', expires_in: 3600 });
    }
    if (url.endsWith('/line-harness/tiktok-order-export')) {
      server.ecCalls += 1;
      // 用意したページを使い切ったら、それ以上は何も無いことにする。
      const page = pages.shift();
      if (!page) return json({ success: true, orders: [], next_since: null, has_more: false });
      if (page.fail) return json({ success: false, error: 'boom' }, 500);
      return json({
        success: true,
        orders: page.orders,
        next_since: page.next_since,
        has_more: page.has_more,
      });
    }

    const u = new URL(url);
    // 新規スプレッドシートの作成。
    if (u.pathname === '/v4/spreadsheets' && (init?.method ?? 'GET') === 'POST') {
      const id = `sheet-new-${created.length + 1}`;
      created.push(id);
      sheets.set(id, []);
      return json({ spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}` });
    }

    const spreadsheetId = /\/v4\/spreadsheets\/([^/]+)/.exec(u.pathname)?.[1] ?? '';
    const rows = sheets.get(spreadsheetId) ?? [];

    // キー列の読み取り（既存行の位置解決）。
    if (u.pathname.includes('/values/') && (init?.method ?? 'GET') === 'GET') {
      return json({ values: rows.length > 0 ? [rows.map((row) => String(row[0]))] : [] });
    }
    if (/:append$/.test(u.pathname)) {
      const body = JSON.parse(String(init?.body)) as { values: (string | number)[][] };
      rows.push(...body.values);
      sheets.set(spreadsheetId, rows);
      return json({});
    }
    if (u.pathname.endsWith(':batchUpdate')) {
      const body = JSON.parse(String(init?.body)) as {
        valueInputOption?: string;
        data?: Array<{ range: string; values: (string | number)[][] }>;
      };
      const data = body.data ?? [];
      // 明細行の更新（`!A<行>:` 形式）と雛形の書き込みを見分ける。
      const isDetailUpdate = data.every((entry) => /!A\d+:/.test(entry.range));
      if (isDetailUpdate) {
        for (const entry of data) {
          const rowNumber = Number(/!A(\d+):/.exec(entry.range)?.[1] ?? 0);
          if (rowNumber >= 2) rows[rowNumber - 2] = entry.values[0] ?? [];
        }
        sheets.set(spreadsheetId, rows);
      } else {
        templateWrites.push({
          spreadsheetId,
          valueInputOption: body.valueInputOption ?? '',
          ranges: data.map((entry) => entry.range),
          values: data.map((entry) => entry.values),
        });
      }
      return json({});
    }
    return json({ error: { message: `unhandled ${url}` } }, 400);
  };

  return server;
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

function seedSettings(
  testDb: SqliteD1,
  accountId: string,
  patch: Partial<TiktokPnlSettingsRow> = {},
): void {
  const row = {
    enabled: 1,
    spreadsheet_id: 'sheet-1' as string | null,
    spreadsheet_url: 'https://docs.google.com/spreadsheets/d/sheet-1' as string | null,
    status: 'ready',
    template_filled_at: NOW as string | null,
    sync_started_at: null as string | null,
    ...patch,
  };
  testDb.raw.prepare(
    `INSERT INTO tiktok_pnl_settings
       (line_account_id, enabled, spreadsheet_id, spreadsheet_url, status,
        template_filled_at, sync_started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(accountId, row.enabled, row.spreadsheet_id, row.spreadsheet_url, row.status,
    row.template_filled_at, row.sync_started_at);
}

function envFor(testDb: SqliteD1, withEc = true): Env['Bindings'] {
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

function orderFor(id: string, patch: Partial<EcLine> = {}): EcOrder {
  return {
    tiktok_order_id: id,
    ordered_at: '2026-09-28T01:00:00Z',
    paid_at: '2026-09-28T01:05:00Z',
    status: 'AWAITING_SHIPMENT',
    buyer_key: `buyer-${id}`,
    updated_at: '2026-09-28T01:05:00Z',
    lines: [{
      index: 0,
      sku: 'SKU-1',
      product_name: '鹿肉ミンチ 1kg',
      quantity: 1,
      unit_price_yen: 3980,
      line_amount_yen: 3980,
      ...patch,
    }],
  };
}

async function settingsOf(testDb: SqliteD1, accountId: string): Promise<TiktokPnlSettingsRow> {
  return (await testDb.db.prepare('SELECT * FROM tiktok_pnl_settings WHERE line_account_id = ?')
    .bind(accountId).first<TiktokPnlSettingsRow>())!;
}

describe('TikTok利益計算：同期の安全性', () => {
  let testDb: SqliteD1;
  beforeEach(() => {
    testDb = createTestD1();
    seedAccount(testDb, 'acc-1');
  });

  it('同期中の目印が立っていれば、重ねて走らせない（二重追記を防ぐ）', async () => {
    // 手動同期が走っている最中に定期実行が来た状況。
    seedSettings(testDb, 'acc-1', { sync_started_at: '2026-09-29T05:59:00Z' });
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([{ orders: [orderFor('order-1')], next_since: 'c1', has_more: false }]);

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.status).toBe('skipped');
    expect(result.error).toBe('sync_in_progress');
    // 何も取り込まず、シートにも書かない。
    expect(server.ecCalls).toBe(0);
    expect(server.sheets.get('sheet-1') ?? []).toEqual([]);
    // 先に走っている方の目印を消さない。
    expect((await settingsOf(testDb, 'acc-1')).sync_started_at).toBe('2026-09-29T05:59:00Z');
  });

  it('古い目印は期限切れとして扱い、次の同期を通す', async () => {
    // 30分より前に落ちた実行の目印が残っている状況。
    seedSettings(testDb, 'acc-1', { sync_started_at: '2026-09-29T04:00:00Z' });
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([{ orders: [orderFor('order-1')], next_since: 'c1', has_more: false }]);

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.status).toBe('ok');
    expect(result.importedOrders).toBe(1);
    // 終わったら目印を外す。外さないと次の6時間後も skipped になる。
    expect((await settingsOf(testDb, 'acc-1')).sync_started_at).toBeNull();
  });

  it('カーソルが進まないまま has_more=true が返っても、同じページを取り込み続けない', async () => {
    seedSettings(testDb, 'acc-1');
    const integration = await makeIntegration(testDb, 'acc-1');
    // EC側の不具合で next_since が同じ値のまま has_more=true を返し続ける。
    const server = makeServer(Array.from({ length: 10 }, () => ({
      orders: [orderFor('order-1')], next_since: 'c1', has_more: true,
    })));

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.status).toBe('ok');
    // 1ページ目でカーソルは進むが、2ページ目で進まないので打ち切る。
    expect(server.ecCalls).toBe(2);
    // 明細は1行だけ。二重に増えない。
    expect(server.sheets.get('sheet-1')?.length).toBe(1);
  });

  it('複数ページはカーソルを進めながら全件取り込む', async () => {
    seedSettings(testDb, 'acc-1');
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([
      { orders: [orderFor('order-1')], next_since: 'c1', has_more: true },
      { orders: [orderFor('order-2')], next_since: 'c2', has_more: true },
      { orders: [orderFor('order-3')], next_since: 'c3', has_more: false },
    ]);

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.importedOrders).toBe(3);
    expect((await settingsOf(testDb, 'acc-1')).import_cursor).toBe('c3');
    expect(server.sheets.get('sheet-1')?.length).toBe(3);
  });

  it('途中ページで失敗しても、成功したページ分のカーソルは保存する', async () => {
    seedSettings(testDb, 'acc-1');
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([
      { orders: [orderFor('order-1')], next_since: 'c1', has_more: true },
      { orders: [], next_since: null, has_more: true, fail: true },
    ]);

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    // 取り込みは途中で失敗したが、シート反映までは進む。
    expect(result.status).toBe('partial');
    // ここが null のままだと、次tickで1ページ目をもう一度取り直す。
    expect((await settingsOf(testDb, 'acc-1')).import_cursor).toBe('c1');
    expect(server.sheets.get('sheet-1')?.length).toBe(1);
  });

  it('雛形書き込みが未完了なら、2つ目のスプレッドシートを作らず書き込みだけやり直す', async () => {
    // 前回、作成はできたが雛形書き込みの前後で落ちた状況。
    seedSettings(testDb, 'acc-1', {
      spreadsheet_id: 'sheet-new-1',
      spreadsheet_url: 'https://docs.google.com/spreadsheets/d/sheet-new-1',
      status: 'pending',
      template_filled_at: null,
    });
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([]);
    server.sheets.set('sheet-new-1', []);

    const result = await syncTiktokPnlForAccount(envFor(testDb, false), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.status).toBe('ok');
    // 新規作成は呼ばれない。
    expect(server.created).toEqual([]);
    // 雛形は既存のスプレッドシートへ書き込まれる。
    expect(server.templateWrites.map((write) => write.spreadsheetId))
      .toEqual(['sheet-new-1', 'sheet-new-1']);
    const after = await settingsOf(testDb, 'acc-1');
    expect(after.template_filled_at).toBe(NOW);
    expect(after.status).toBe('ready');
  });

  it('月次PnLの月はRAWで書き、文字列として保存する', async () => {
    seedSettings(testDb, 'acc-1', {
      spreadsheet_id: null, spreadsheet_url: null, status: 'pending', template_filled_at: null,
    });
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([]);

    await syncTiktokPnlForAccount(envFor(testDb, false), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(server.created).toEqual(['sheet-new-1']);
    // 月の列だけは別呼び出しでRAW。USER_ENTEREDだと ja_JP のシートが
    // "2026-09" を日付に変換し、明細のO列（文字列）とSUMIFSが一致しなくなる。
    const monthWrite = server.templateWrites.find((write) =>
      write.ranges.some((range) => range.includes('月次PnL') && range.endsWith('!A1')));
    expect(monthWrite?.valueInputOption).toBe('RAW');
    const monthColumn = (monthWrite?.values[0] ?? []).map((row) => row[0]);
    expect(monthColumn[0]).toBe('月');
    // 先頭は前月から始まる（当月だけでは前月との比較ができない）。
    expect(monthColumn[1]).toBe('2026-08');
    expect(monthColumn[2]).toBe('2026-09');
    // 数式側は USER_ENTERED でなければ計算されない。
    const formulaWrite = server.templateWrites.find((write) =>
      write.ranges.some((range) => range.includes('月次PnL') && range.endsWith('!B1')));
    expect(formulaWrite?.valueInputOption).toBe('USER_ENTERED');
  });

  it('SKUだけが変わった場合もシートへ書き出す', async () => {
    seedSettings(testDb, 'acc-1');
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([
      { orders: [orderFor('order-1', { sku: 'SKU-1' })], next_since: 'c1', has_more: false },
      // 同じ注文でSKUだけ差し替える（TikTok側で商品を紐づけ直した等）。
      { orders: [orderFor('order-1', { sku: 'SKU-2' })], next_since: 'c2', has_more: false },
    ]);

    await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });
    const second = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    // sheet_dirty が立たないとここが0になり、シートのSKU列が古いままになる。
    expect(second.wroteRows).toBe(1);
    expect(server.sheets.get('sheet-1')?.map((row) => row[4])).toEqual(['SKU-2']);
  });

  it('Google認可切れは連携状態を expired にする', async () => {
    seedSettings(testDb, 'acc-1');
    const integration = await makeIntegration(testDb, 'acc-1');
    const server = makeServer([], { sheetsTokenExpired: true });

    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });

    expect(result.status).toBe('error');
    expect(result.error).toBe('auth_expired');
    const after = await testDb.db.prepare(
      'SELECT status, last_sync_error FROM google_sheets_integrations WHERE id = ?',
    ).bind(integration.id).first<{ status: string; last_sync_error: string | null }>();
    // ここが connected のままだと、管理画面に再接続の案内が出ない。
    expect(after?.status).toBe('expired');
    expect(after?.last_sync_error).toBe('auth_expired');
    // 失敗しても目印は外す。外さないと30分間どの同期も通らない。
    expect((await settingsOf(testDb, 'acc-1')).sync_started_at).toBeNull();
  });

  it('定期実行は有効化していないアカウントのシートを作らない', async () => {
    seedAccount(testDb, 'acc-2');
    // acc-1 は未有効化（Google Sheets連携は他機能で繋いでいるだけ）。
    seedSettings(testDb, 'acc-1', {
      enabled: 0, spreadsheet_id: null, spreadsheet_url: null,
      status: 'pending', template_filled_at: null,
    });
    // acc-2 は手動同期を押して有効化済み。
    seedSettings(testDb, 'acc-2', {
      enabled: 1, spreadsheet_id: null, spreadsheet_url: null,
      status: 'pending', template_filled_at: null,
    });
    await makeIntegration(testDb, 'acc-1');
    await makeIntegration(testDb, 'acc-2');
    const server = makeServer([]);

    const result = await processTiktokPnlTick(envFor(testDb, false), {
      now: NOW, fetch: server.fetch as never,
    });

    // 作られたのは acc-2 の分だけ。
    expect(server.created).toEqual(['sheet-new-1']);
    expect(result.createdSheets).toBe(1);
    expect((await settingsOf(testDb, 'acc-1')).spreadsheet_id).toBeNull();
    expect((await settingsOf(testDb, 'acc-2')).spreadsheet_id).toBe('sheet-new-1');
  });
});
