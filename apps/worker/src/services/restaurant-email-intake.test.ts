import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { routeInboundEmail } from './inbound-email-router.js';
import {
  deleteExpiredRestaurantRawEmails,
  issueRestaurantIntakeAddress,
} from './restaurant-email-intake.js';

type StoredObject = { body: string; customMetadata?: Record<string, string> };

let testDb: SqliteD1;
let rawObjects: Map<string, StoredObject>;
let rawPut: ReturnType<typeof vi.fn>;
let rawDelete: ReturnType<typeof vi.fn>;
let imagePut: ReturnType<typeof vi.fn>;
let env: Env['Bindings'];

function fakeRawMailBucket(): R2Bucket {
  rawPut = vi.fn(async (key: string, value: ReadableStream, options?: R2PutOptions) => {
    const body = await new Response(value).text();
    rawObjects.set(key, { body, customMetadata: options?.customMetadata });
    return { key } as R2Object;
  });
  rawDelete = vi.fn(async (keys: string | string[]) => {
    for (const key of Array.isArray(keys) ? keys : [keys]) rawObjects.delete(key);
  });
  return {
    put: rawPut,
    delete: rawDelete,
  } as unknown as R2Bucket;
}

function email(
  to: string,
  raw = 'Subject: Reservation\r\n\r\n2 guests',
  messageId = `<${crypto.randomUUID()}@example.test>`,
): ForwardableEmailMessage {
  return {
    from: 'sender@example.test',
    to,
    raw: new Blob([raw]).stream(),
    rawSize: new TextEncoder().encode(raw).byteLength,
    headers: new Headers({ subject: 'Reservation', 'message-id': messageId }),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

beforeEach(() => {
  testDb = createTestD1();
  testDb.raw.prepare("INSERT INTO rt_organizations (id, account_id, name) VALUES ('org-1', 'account-1', 'Test')").run();
  testDb.raw.prepare("INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store-1', 'org-1', 'Store', 'STORE')").run();
  rawObjects = new Map();
  imagePut = vi.fn();
  env = {
    DB: testDb.db,
    IMAGES: { put: imagePut } as unknown as R2Bucket,
    RAW_MAIL: fakeRawMailBucket(),
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
    expect([...rawObjects.keys()][0]).toMatch(/^restaurant-intake\/store-1\/.+\.eml$/);
    expect(rawPut).toHaveBeenCalledOnce();
    expect(imagePut).not.toHaveBeenCalled();
    expect(testDb.raw.prepare(`SELECT store_id, status, size_bytes, r2_key
      FROM rt_inbound_emails`).get()).toMatchObject({
        store_id: 'store-1',
        status: 'received',
        size_bytes: expect.any(Number),
        r2_key: expect.stringMatching(/^restaurant-intake\/store-1\//),
      });
  });

  it('未知の取り込みアドレスは例外で落とさずR2へ隔離する', async () => {
    const message = email('r-unknown@intake.example.test');
    await expect(routeInboundEmail(message, env)).resolves.toBeUndefined();

    const [key] = [...rawObjects.keys()];
    expect(key).toMatch(/^restaurant-intake-quarantine\/.+\.eml$/);
    expect(rawObjects.get(key)?.customMetadata).toMatchObject({
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

    const [key] = [...rawObjects.keys()];
    expect(key).toMatch(/^restaurant-intake-quarantine\/.+\.eml$/);
    expect(rawObjects.get(key)?.customMetadata?.reason).toBe('address_revoked');
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

  it('同一message_idを2回受信しても原文台帳は1行だけ増える', async () => {
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    const messageId = '<duplicate@example.test>';

    await routeInboundEmail(email(recipient, undefined, messageId), env);
    await routeInboundEmail(email(recipient, undefined, messageId), env);

    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_inbound_emails').get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_sync_events WHERE provider = 'email'").get()).toEqual({ count: 1 });
    expect(rawPut).toHaveBeenCalledOnce();
  });

  it('R2保存が失敗したら台帳へ失敗を残し、予約として扱わない', async () => {
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    rawPut.mockRejectedValueOnce(new Error('R2 unavailable'));
    const message = email('r-12345678901234567890123456789012@intake.example.test');

    await routeInboundEmail(message, env);

    expect(message.setReject).toHaveBeenCalledWith('予約メール受信処理に失敗しました');
    expect(testDb.raw.prepare(`SELECT status, r2_key FROM rt_inbound_emails`).get()).toEqual({
      status: 'storage_failed',
      r2_key: '',
    });
    expect(testDb.raw.prepare("SELECT COUNT(*) AS count FROM rt_sync_events WHERE provider = 'email'").get()).toEqual({ count: 0 });
    expect(imagePut).not.toHaveBeenCalled();
  });

  it('保持期間を過ぎた原文をR2から削除し、台帳行は破棄済みで残す', async () => {
    const key = 'restaurant-intake/store-1/expired.eml';
    rawObjects.set(key, { body: 'expired' });
    testDb.raw.prepare(`INSERT INTO rt_inbound_emails
      (id, message_id, store_id, r2_key, received_at, status, size_bytes)
      VALUES ('mail-1', '<expired@example.test>', 'store-1', ?, '2025-01-01 00:00:00', 'received', 7)`).run(key);

    const result = await deleteExpiredRestaurantRawEmails(env, {
      now: new Date('2026-08-22T00:00:00.000Z'),
    });

    expect(result).toEqual({ checked: 1, deleted: 1, failed: 0, retentionDays: 90 });
    expect(rawDelete).toHaveBeenCalledWith([key]);
    expect(rawObjects.has(key)).toBe(false);
    expect(testDb.raw.prepare(`SELECT status, r2_key FROM rt_inbound_emails WHERE id = 'mail-1'`).get()).toEqual({
      status: 'raw_deleted',
      r2_key: '',
    });
  });

  it('RESTAURANT_INTAKE_DOMAIN未設定でも従来どおり原文を隔離する', async () => {
    delete env.RESTAURANT_INTAKE_DOMAIN;
    const message = email('r-unknown@intake.example.test');

    await routeInboundEmail(message, env);

    const row = testDb.raw.prepare(`SELECT status, quarantine_reason, r2_key FROM rt_inbound_emails`).get() as {
      status: string; quarantine_reason: string | null; r2_key: string;
    };
    expect(row).toMatchObject({ status: 'quarantined', quarantine_reason: 'domain_not_configured' });
    expect(row.r2_key).toMatch(/^restaurant-intake-quarantine\//);
    expect(rawObjects.has(row.r2_key)).toBe(true);
    expect(message.setReject).not.toHaveBeenCalled();
  });
});
