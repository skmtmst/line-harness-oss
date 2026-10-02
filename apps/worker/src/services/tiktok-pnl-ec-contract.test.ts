/**
 * TikTok利益計算：EC-CUBE取り込みの「署名契約」回帰テスト。
 *
 * この契約はWorkerとEC-CUBE（nen-petfood-eccube の
 * Customize/Controller/LineHarnessTikTokOrderExportController）で別々に実装してある。
 * 片方だけ変えると取り込みが401で止まり、利用者から見ると
 * 「シートが更新されない」形でしか分からない。
 * そのため、パス・ヘッダ名・署名対象・16進小文字の形まで固定する。
 *
 * 固定する契約:
 *   POST <NEN_EC_BASE_URL>/line-harness/tiktok-order-export
 *   X-Nen-Timestamp: <エポック秒>
 *   X-Nen-Signature: sha256=<HMAC-SHA256(ECCUBE_WEBHOOK_SECRET, `${timestamp}.${body}`) の小文字hex>
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { encryptCredential } from '@line-crm/db';
import type { Env } from '../index.js';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { syncTiktokPnlForAccount } from './tiktok-pnl.js';
import type { GoogleSheetsIntegrationRow } from './google-sheets.js';

const ENCRYPTION_KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const NOW = '2026-09-29T06:00:00Z';
const EC_BASE_URL = 'https://ec.example.com';
/** EC側も同じ値を `LINE_HARNESS_EVENT_SECRET` として読む。32文字以上であること。 */
const EC_SECRET = 'x'.repeat(40);

/** 取り込みリクエストの記録。 */
interface EcRequest {
  url: string;
  method: string;
  /** 送られたままのヘッダ（名前の大小もそのまま見る）。 */
  headers: Record<string, string>;
  body: string;
}

function makeServer(): { fetch: (url: string, init?: RequestInit) => Promise<Response>;
  ecRequests: EcRequest[] } {
  const ecRequests: EcRequest[] = [];
  const rows: (string | number)[][] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const fetchFn = async (url: string, init?: RequestInit): Promise<Response> => {
    if (url === 'https://oauth2.googleapis.com/token') {
      return json({ access_token: 'at-1', expires_in: 3600 });
    }
    if (url.includes('/line-harness/')) {
      ecRequests.push({
        url,
        method: init?.method ?? 'GET',
        headers: { ...(init?.headers as Record<string, string> | undefined) },
        body: String(init?.body ?? ''),
      });
      return json({
        success: true,
        orders: [{
          tiktok_order_id: 'order-1',
          ordered_at: '2026-09-28T01:00:00Z',
          paid_at: '2026-09-28T01:05:00Z',
          status: 'AWAITING_SHIPMENT',
          buyer_key: 'buyer-1',
          updated_at: '2026-09-28T01:05:00Z',
          lines: [{
            index: 0, sku: 'SKU-1', product_name: '鹿肉ミンチ 1kg',
            quantity: 1, unit_price_yen: 3980, line_amount_yen: 3980,
          }],
        }],
        next_since: null,
        has_more: false,
      });
    }

    // 以降はシート側。契約テストでは中身を見ないので最小限で応じる。
    const u = new URL(url);
    if (u.pathname.includes('/values/') && (init?.method ?? 'GET') === 'GET') {
      return json({ values: rows.length > 0 ? [rows.map((row) => String(row[0]))] : [] });
    }
    if (/:append$/.test(u.pathname)) {
      const body = JSON.parse(String(init?.body)) as { values: (string | number)[][] };
      rows.push(...body.values);
      return json({});
    }
    if (u.pathname.endsWith(':batchUpdate')) return json({});
    return json({ error: { message: `unhandled ${url}` } }, 400);
  };

  return { fetch: fetchFn, ecRequests };
}

/** テスト側で独立に署名を作り直す。実装のヘルパーは使わない。 */
async function expectedSignature(timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(EC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const digest = await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`),
  );
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function seedSettings(testDb: SqliteD1, accountId: string): void {
  testDb.raw.prepare(
    `INSERT INTO tiktok_pnl_settings
       (line_account_id, enabled, spreadsheet_id, spreadsheet_url, status, template_filled_at)
     VALUES (?, 1, 'sheet-1', 'https://docs.google.com/spreadsheets/d/sheet-1', 'ready', ?)`,
  ).run(accountId, NOW);
}

function envFor(testDb: SqliteD1): Env['Bindings'] {
  return {
    DB: testDb.db,
    LINE_CREDENTIAL_ENCRYPTION_KEY: ENCRYPTION_KEY,
    GOOGLE_SHEETS_OAUTH_CLIENT_ID: 'client-id',
    GOOGLE_SHEETS_OAUTH_CLIENT_SECRET: 'client-secret',
    NEN_EC_BASE_URL: EC_BASE_URL,
    ECCUBE_WEBHOOK_SECRET: EC_SECRET,
  } as Env['Bindings'];
}

describe('TikTok利益計算：EC-CUBE取り込みの署名契約', () => {
  let testDb: SqliteD1;
  let server: ReturnType<typeof makeServer>;

  beforeEach(async () => {
    testDb = createTestD1();
    seedAccount(testDb, 'acc-1');
    seedSettings(testDb, 'acc-1');
    server = makeServer();
    const integration = await makeIntegration(testDb, 'acc-1');
    const result = await syncTiktokPnlForAccount(envFor(testDb), integration, {
      now: NOW, fetch: server.fetch as never,
    });
    // 署名が契約どおりでないとEC側が401を返すため、まず成功していることを確かめる。
    expect(result.status).toBe('ok');
  });

  it('EC-CUBE側のパスとメソッドを変えない', () => {
    expect(server.ecRequests).toHaveLength(1);
    const request = server.ecRequests[0]!;
    // 末尾一致ではなく完全一致で見る。接頭辞を変えた時にも落とす。
    expect(request.url).toBe(`${EC_BASE_URL}/line-harness/tiktok-order-export`);
    expect(request.method).toBe('POST');
    expect(JSON.parse(request.body)).toEqual({ since: null, limit: expect.any(Number) });
  });

  it('ヘッダ名を X-Nen-Timestamp / X-Nen-Signature のまま送る', () => {
    const request = server.ecRequests[0]!;
    // EC側は大小を区別しない読み取りだが、送出名自体を契約として固定する。
    expect(Object.keys(request.headers).sort()).toEqual(
      ['Content-Type', 'X-Nen-Signature', 'X-Nen-Timestamp'],
    );
    expect(request.headers['Content-Type']).toBe('application/json');
    // エポック秒。ミリ秒やISO文字列に変わるとEC側の±300秒判定が常に外れる。
    expect(request.headers['X-Nen-Timestamp']).toMatch(/^\d{10}$/);
    const skewSeconds = Math.abs(
      Number(request.headers['X-Nen-Timestamp']) - Math.floor(Date.now() / 1000),
    );
    expect(skewSeconds).toBeLessThanOrEqual(5);
  });

  it('署名は sha256= と小文字hex 64桁で、timestamp.body を対象にする', async () => {
    const request = server.ecRequests[0]!;
    const signature = request.headers['X-Nen-Signature']!;
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    // 署名対象と連結子（ドット）まで固定する。
    const expected = await expectedSignature(request.headers['X-Nen-Timestamp']!, request.body);
    expect(signature).toBe(`sha256=${expected}`);
    // 取り違え防止。別のtimestampで作った署名とは一致しない。
    const other = await expectedSignature('1700000000', request.body);
    expect(signature).not.toBe(`sha256=${other}`);
  });
});
