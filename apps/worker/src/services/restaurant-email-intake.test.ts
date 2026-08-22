import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { routeInboundEmail } from './inbound-email-router.js';
import { issueRestaurantIntakeAddress } from './restaurant-email-intake.js';

type StoredObject = { body: string; customMetadata?: Record<string, string> };

let testDb: SqliteD1;
let storedObjects: Map<string, StoredObject>;
let env: Env['Bindings'];

function fakeBucket(): R2Bucket {
  return {
    put: vi.fn(async (key: string, value: ReadableStream, options?: R2PutOptions) => {
      const body = await new Response(value).text();
      storedObjects.set(key, { body, customMetadata: options?.customMetadata });
      return { key } as R2Object;
    }),
  } as unknown as R2Bucket;
}

function email(to: string, raw = 'Subject: Reservation\r\n\r\n2 guests'): ForwardableEmailMessage {
  return {
    from: 'sender@example.test',
    to,
    raw: new Blob([raw]).stream(),
    rawSize: new TextEncoder().encode(raw).byteLength,
    headers: new Headers({ subject: 'Reservation', 'message-id': `<${crypto.randomUUID()}@example.test>` }),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare("INSERT INTO rt_organizations (id, account_id, name) VALUES ('org-1', 'account-1', 'Test')").run();
  testDb.raw.prepare("INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store-1', 'org-1', 'Store', 'STORE')").run();
  storedObjects = new Map();
  env = {
    DB: testDb.db,
    IMAGES: fakeBucket(),
    ASSETS: {} as Fetcher,
    RESTAURANT_INTAKE_DOMAIN: 'intake.example.test',
    API_KEY: 'unused',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
  };
});

describe('飲食店向けcatch-all予約メール', () => {
  it('有効な取り込みアドレスから店舗を特定し、予約取り込みへ渡す', async () => {
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();

    await routeInboundEmail(email('r-12345678901234567890123456789012@intake.example.test'), env);

    const event = testDb.raw.prepare("SELECT store_id, provider, status, payload_json FROM rt_sync_events WHERE provider = 'email'").get() as {
      store_id: string; provider: string; status: string; payload_json: string;
    };
    expect(event).toMatchObject({ store_id: 'store-1', provider: 'email', status: 'received' });
    expect(JSON.parse(event.payload_json)).toMatchObject({ rawSize: expect.any(Number) });
    expect([...storedObjects.keys()][0]).toMatch(/^restaurant-intake\/store-1\/.+\.eml$/);
  });

  it('未知の取り込みアドレスは例外で落とさずR2へ隔離する', async () => {
    const message = email('r-unknown@intake.example.test');
    await expect(routeInboundEmail(message, env)).resolves.toBeUndefined();

    const [key] = [...storedObjects.keys()];
    expect(key).toMatch(/^restaurant-intake-quarantine\/.+\.eml$/);
    expect(storedObjects.get(key)?.customMetadata).toMatchObject({
      reason: 'address_unknown_or_expired',
      localPart: 'r-unknown',
    });
    expect(message.setReject).not.toHaveBeenCalled();
  });

  it('r-で始まらない宛先は既存のサポートメール処理だけを呼ぶ', async () => {
    const receiveSupportEmail = vi.fn(async () => ({ threadId: 'thread-1', duplicate: false }));
    const receiveRestaurantIntakeEmail = vi.fn();
    const message = email('support@intake.example.test');

    await routeInboundEmail(message, env, { receiveSupportEmail, receiveRestaurantIntakeEmail });

    expect(receiveSupportEmail).toHaveBeenCalledOnce();
    expect(receiveRestaurantIntakeEmail).not.toHaveBeenCalled();
  });

  it('失効した取り込みアドレスはR2へ隔離する', async () => {
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id, status, revoked_at)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1', 'revoked', datetime('now'))`).run();

    await routeInboundEmail(email('r-12345678901234567890123456789012@intake.example.test'), env);

    const [key] = [...storedObjects.keys()];
    expect(key).toMatch(/^restaurant-intake-quarantine\/.+\.eml$/);
    expect(storedObjects.get(key)?.customMetadata?.reason).toBe('address_revoked');
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_sync_events WHERE provider = 'email'").get()).toEqual({ count: 0 });
  });

  it('2回発行すると異なるランダムアドレスになり、旧アドレスは90日間activeで残る', async () => {
    const first = await issueRestaurantIntakeAddress(env, 'store-1');
    const second = await issueRestaurantIntakeAddress(env, 'store-1');

    expect(first.localPart).toMatch(/^r-[a-z0-9]{32}$/);
    expect(second.localPart).toMatch(/^r-[a-z0-9]{32}$/);
    expect(first.localPart).not.toBe(second.localPart);
    expect(first.address).toBe(`${first.localPart}@intake.example.test`);
    const rows = testDb.raw.prepare(`SELECT local_part, status, revoked_at,
        CASE WHEN revoked_at IS NULL THEN NULL ELSE julianday(revoked_at) - julianday(created_at) END AS grace_days
      FROM rt_intake_addresses
      WHERE store_id = 'store-1' ORDER BY created_at, id`).all() as Array<{
        local_part: string; status: string; revoked_at: string | null; grace_days: number | null;
      }>;
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.local_part === first.localPart)).toMatchObject({ status: 'active' });
    expect(rows.find((row) => row.local_part === first.localPart)?.revoked_at).not.toBeNull();
    expect(rows.find((row) => row.local_part === first.localPart)?.grace_days).toBeCloseTo(90, 5);
    expect(rows.find((row) => row.local_part === second.localPart)?.revoked_at).toBeNull();
  });
});
