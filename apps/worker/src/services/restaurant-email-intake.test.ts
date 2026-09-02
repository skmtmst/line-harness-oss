import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

class TestFixedLengthStream extends TransformStream<Uint8Array, Uint8Array> {
  constructor(expectedLength: number | bigint) {
    const expected = Number(expectedLength);
    let received = 0;
    super({
      transform(chunk, controller) {
        received += chunk.byteLength;
        if (received > expected) throw new Error('fixed-length stream overflow');
        controller.enqueue(chunk);
      },
      flush() {
        if (received !== expected) throw new Error('fixed-length stream underflow');
      },
    });
  }
}

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
    get: vi.fn(async (key: string) => {
      const stored = rawObjects.get(key);
      if (!stored) return null;
      const bytes = new TextEncoder().encode(stored.body);
      return {
        key,
        size: bytes.byteLength,
        body: new Blob([bytes]).stream(),
      } as unknown as R2ObjectBody;
    }),
    delete: rawDelete,
  } as unknown as R2Bucket;
}

function email(
  to: string,
  raw = [
    'From: jp_kanri@hotpepper.jp',
    'Date: Sat, 22 Aug 2026 12:00:00 +0900',
    'Subject: 【即予約】テスト予約の申し込み',
    '',
    '■予約依頼番号：HP-100',
    '■来店日時：2026年8月30日(日) 18:30',
    '■代表者：テスト 太郎様',
    '■コース：テストコース',
    '■席情報：テーブル席',
    '■人数：2名様',
  ].join('\r\n'),
  messageId = `<${crypto.randomUUID()}@example.test>`,
): ForwardableEmailMessage {
  return {
    from: 'jp_kanri@hotpepper.jp',
    to,
    raw: new Blob([raw]).stream(),
    rawSize: new TextEncoder().encode(raw).byteLength,
    headers: new Headers({
      subject: 'reservation',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900',
      'message-id': messageId,
    }),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

function mediaEmail(input: {
  to: string;
  from: string;
  subject: string;
  date: string;
  body: string;
  messageId?: string;
}): ForwardableEmailMessage {
  const messageId = input.messageId ?? `<${crypto.randomUUID()}@example.test>`;
  const raw = [
    `From: ${input.from}`,
    `Date: ${input.date}`,
    `Subject: ${input.subject}`,
    `Message-ID: ${messageId}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    input.body,
  ].join('\r\n');
  return {
    from: input.from,
    to: input.to,
    raw: new Blob([raw]).stream(),
    rawSize: new TextEncoder().encode(raw).byteLength,
    headers: new Headers({ subject: 'reservation', date: input.date, 'message-id': messageId }),
    setReject: vi.fn(),
    forward: vi.fn(),
    reply: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

beforeEach(() => {
  vi.stubGlobal('FixedLengthStream', TestFixedLengthStream);
  testDb = createTestD1();
  testDb.raw.prepare("INSERT INTO rt_organizations (id, account_id, name) VALUES ('org-1', 'account-1', 'Test')").run();
  testDb.raw.prepare("INSERT INTO rt_stores (id, organization_id, name, code) VALUES ('store-1', 'org-1', 'Store', 'STORE')").run();
  testDb.raw.exec(`INSERT INTO rt_media (id, code, name, sender_addresses, parser_key) VALUES
    ('media-retty', 'retty', 'Retty', '["reserve@retty.me","noreply@retty.me"]', 'retty'),
    ('media-gurunavi', 'gurunavi', 'ぐるなび', '["plan-reserve@gnavi.co.jp"]', 'gurunavi'),
    ('media-tabelog', 'tabelog', '食べログ', '["owner_support@tabelog.com"]', 'tabelog'),
    ('media-hotpepper', 'hotpepper', 'ホットペッパーグルメ', '["jp_kanri@hotpepper.jp"]', 'hotpepper')`);
  rawObjects = new Map();
  imagePut = vi.fn();
  env = {
    DB: testDb.db,
    IMAGES: { put: imagePut } as unknown as R2Bucket,
    RAW_MAIL: fakeRawMailBucket(),
    ASSETS: {} as Fetcher,
    RESTAURANT_INTAKE_DOMAIN: 'intake.example.test',
    RESTAURANT_TEST_ENABLED: 'true',
    API_KEY: 'unused',
    LINE_CHANNEL_SECRET: 'unused', LINE_CHANNEL_ACCESS_TOKEN: 'unused',
    LIFF_URL: 'https://example.test', LINE_CHANNEL_ID: 'unused',
    LINE_LOGIN_CHANNEL_ID: 'unused', LINE_LOGIN_CHANNEL_SECRET: 'unused',
    WORKER_URL: 'https://worker.example.test',
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('飲食店向けcatch-all予約メール', () => {
  it('無効な環境では予約メールを取り込まず拒否する', async () => {
    env.RESTAURANT_TEST_ENABLED = 'false';
    const message = email('r-12345678901234567890123456789012@intake.example.test');

    await routeInboundEmail(message, env);

    expect(message.setReject).toHaveBeenCalledWith('予約メール受信は現在利用できません');
    expect(rawPut).not.toHaveBeenCalled();
  });

  it('有効な取り込みアドレスから店舗を特定し、予約取り込みへ渡す', async () => {
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();

    await routeInboundEmail(email('r-12345678901234567890123456789012@intake.example.test'), env);

    const event = testDb.raw.prepare("SELECT store_id, provider, status, payload_json FROM rt_sync_events WHERE provider = 'email'").get() as {
      store_id: string; provider: string; status: string; payload_json: string;
    };
    expect(event).toMatchObject({ store_id: 'store-1', provider: 'email', status: 'processed' });
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

  it('同じ予約番号の2通目で予約を増やさず内容を更新する', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    const body = (guests: number) => [
      '■予約依頼番号：HP-UPDATE-1',
      '■来店日時：2026年8月30日(日) 18:30',
      '■代表者：テスト 太郎様',
      '■コース：テストコース',
      '■席情報：テーブル',
      `■人数：${guests}名様`,
    ].join('\n');

    await routeInboundEmail(mediaEmail({
      to: recipient, from: 'jp_kanri@hotpepper.jp', subject: '【即予約】テストの申し込み',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900', body: body(2),
    }), env);
    await routeInboundEmail(mediaEmail({
      to: recipient, from: 'jp_kanri@hotpepper.jp', subject: '【即予約】テストの申し込み',
      date: 'Sat, 22 Aug 2026 13:00:00 +0900', body: body(3),
    }), env);

    expect(testDb.raw.prepare(`SELECT COUNT(*) AS count FROM rt_reservations
      WHERE external_id = 'HP-UPDATE-1'`).get()).toEqual({ count: 1 });
    expect(testDb.raw.prepare(`SELECT guest_count FROM rt_reservations
      WHERE external_id = 'HP-UPDATE-1'`).get()).toEqual({ guest_count: 3 });
  });

  it('source_updated_atが古い2通目は既存予約を巻き戻さない', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    const body = (guests: number) => [
      '■予約依頼番号：HP-STALE-1',
      '■来店日時：2026年8月30日(日) 18:30',
      '■代表者：テスト 太郎様',
      '■席情報：テーブル',
      `■人数：${guests}名様`,
    ].join('\n');

    await routeInboundEmail(mediaEmail({
      to: recipient, from: 'jp_kanri@hotpepper.jp', subject: '【即予約】テストの申し込み',
      date: 'Sat, 22 Aug 2026 14:00:00 +0900', body: body(4),
    }), env);
    await routeInboundEmail(mediaEmail({
      to: recipient, from: 'jp_kanri@hotpepper.jp', subject: '【即予約】テストの申し込み',
      date: 'Sat, 22 Aug 2026 13:00:00 +0900', body: body(2),
    }), env);

    expect(testDb.raw.prepare(`SELECT guest_count, source_updated_at FROM rt_reservations
      WHERE external_id = 'HP-STALE-1'`).get()).toEqual({
      guest_count: 4,
      source_updated_at: '2026-08-22T05:00:00.000Z',
    });
    const outcomes = testDb.raw.prepare(`SELECT payload_json FROM rt_sync_events
      WHERE provider = 'email' ORDER BY received_at, id`).all() as Array<{ payload_json: string }>;
    expect(outcomes.map((row) => JSON.parse(row.payload_json).outcome)).toContain('stale_ignored');
  });

  it('日次サマリーは予約を作らず件数台帳だけに記録する', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();

    await routeInboundEmail(mediaEmail({
      to: recipient,
      from: 'reserve@retty.me',
      subject: '【予約件数 1件】本日の予約',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900',
      body: '2026年8月30日\n【予約1】テスト 太郎',
    }), env);

    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations').get()).toEqual({ count: 0 });
    expect(testDb.raw.prepare(`SELECT target_date, reported_count FROM rt_email_digests`).get()).toEqual({
      target_date: '2026-08-30',
      reported_count: 1,
    });
  });

  it('未知の差出人はmedia_unknownとして隔離する', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    const message = mediaEmail({
      to: recipient,
      from: 'unknown@example.test',
      subject: '予約通知',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900',
      body: 'ダミー本文',
    });

    await routeInboundEmail(message, env);

    expect(testDb.raw.prepare(`SELECT status, quarantine_reason FROM rt_inbound_emails`).get()).toEqual({
      status: 'quarantined',
      quarantine_reason: 'media_unknown',
    });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations').get()).toEqual({ count: 0 });
    expect(message.setReject).not.toHaveBeenCalled();
  });

  it('年が取得できない予約は推測せず未処理として記録する', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    await routeInboundEmail(mediaEmail({
      to: recipient,
      from: 'reserve@retty.me',
      subject: '新規予約',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900',
      body: [
        '予約番号：RT-NO-YEAR',
        '予約者氏名：テスト 太郎',
        'ご来店日：8月30日',
        'ご来店時間：18:30',
        'ご予約人数：2名',
      ].join('\n'),
    }), env);

    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations').get()).toEqual({ count: 0 });
    expect(testDb.raw.prepare(`SELECT status, error_message FROM rt_sync_events`).get()).toEqual({
      status: 'failed',
      error_message: 'unprocessed:visit_datetime_or_year_missing',
    });
  });

  it('ぐるなびの未知状態は予約化せず未処理として記録する', async () => {
    const recipient = 'r-12345678901234567890123456789012@intake.example.test';
    testDb.raw.prepare(`INSERT INTO rt_intake_addresses (id, local_part, store_id)
      VALUES ('addr-1', 'r-12345678901234567890123456789012', 'store-1')`).run();
    await routeInboundEmail(mediaEmail({
      to: recipient,
      from: 'plan-reserve@gnavi.co.jp',
      subject: '予約通知',
      date: 'Sat, 22 Aug 2026 12:00:00 +0900',
      body: [
        'テスト店舗 様 (test100)',
        '［予約番号］GN-UNKNOWN',
        '［状態］お断り',
        '［来店日時］2026年08月30日(日) 18時30分',
        '［来店人数］2名',
      ].join('\n'),
    }), env);

    expect(testDb.raw.prepare('SELECT COUNT(*) AS count FROM rt_reservations').get()).toEqual({ count: 0 });
    expect(testDb.raw.prepare(`SELECT status, error_message FROM rt_sync_events`).get()).toEqual({
      status: 'failed',
      error_message: 'unprocessed:kind_unknown',
    });
  });
});
