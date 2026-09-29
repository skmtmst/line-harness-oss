import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { drainAdConversionOutbox, sendAdConversions } from './ad-conversion.js';

const NOW = new Date('2026-09-16T00:00:00.000Z');
const requests: Array<{ body: unknown }> = [];

function setup(config: Record<string, unknown> = {}): SqliteD1 {
  const testDb = createTestD1();
  testDb.raw.prepare(`
    INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
    VALUES ('a1', 'c1', 'A1', 'token', 'secret')
  `).run();
  insertFriend(testDb.raw, 'f1', { line_account_id: 'a1' });
  testDb.raw.prepare(`
    INSERT INTO ad_platforms
      (id, name, display_name, config, is_active, line_account_id, created_at, updated_at)
    VALUES ('p1', 'meta', 'Meta', ?, 1, 'a1', '2026-09-01', '2026-09-01')
  `).run(JSON.stringify({ pixel_id: 'pixel', access_token: 'token', click_id_validity_days: 30, ...config }));
  return testDb;
}

function insertClick(
  testDb: SqliteD1,
  input: { id: string; clickId?: string | null; createdAt: string; consentAt?: string | null },
): void {
  testDb.raw.prepare(`
    INSERT INTO ref_tracking
      (id, ref_code, friend_id, line_account_id, fbclid, ad_conversion_consent_at, created_at)
    VALUES (?, 'ref', 'f1', 'a1', ?, ?, ?)
  `).run(
    input.id,
    input.clickId ?? null,
    input.consentAt === undefined ? input.createdAt : input.consentAt,
    input.createdAt,
  );
}

function stubFetch(fail = false): void {
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: { body?: string }) => {
    requests.push({ body: init?.body ? JSON.parse(init.body) : null });
    return { ok: !fail, status: fail ? 500 : 200, text: async () => fail ? 'down' : 'ok' };
  }));
}

function outbox(testDb: SqliteD1): Record<string, unknown> {
  return testDb.raw.prepare(`SELECT * FROM ad_conversion_outbox WHERE ad_platform_id = 'p1'`).get() as Record<string, unknown>;
}

afterEach(() => {
  vi.unstubAllGlobals();
  requests.length = 0;
});

describe('広告送信のクリック選択snapshot', () => {
  it.each([
    ['同意なし', { clickId: 'fb-no-consent', createdAt: '2026-09-15T00:00:00.000Z', consentAt: null }, 'missing_consent'],
    ['期限切れ', { clickId: 'fb-expired', createdAt: '2026-08-16T23:59:59.999Z' }, 'expired'],
    ['IDなし', { clickId: null, createdAt: '2026-09-15T00:00:00.000Z' }, 'missing_click_id'],
  ] as const)('%sは外部送信せず理由を台帳へ残す', async (_label, click, reason) => {
    const testDb = setup();
    insertClick(testDb, { id: `ref-${reason}`, ...click });
    stubFetch();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, {
      idempotencyKey: `evt-${reason}`, now: NOW,
    });

    expect(requests).toHaveLength(0);
    expect(outbox(testDb)).toMatchObject({
      status: 'failed', selection_reason: reason, last_error: reason, is_retryable: 0,
    });
  });

  it('有効期限設定がない媒体を無期限扱いしない', async () => {
    const testDb = setup({ click_id_validity_days: undefined });
    insertClick(testDb, { id: 'ref-no-validity', clickId: 'fb-1', createdAt: '2026-09-15T00:00:00.000Z' });
    stubFetch();

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, {
      idempotencyKey: 'evt-no-validity', now: NOW,
    });

    expect(requests).toHaveLength(0);
    expect(outbox(testDb)).toMatchObject({
      status: 'failed', selection_reason: 'validity_not_configured',
      last_error: 'validity_not_configured', is_retryable: 0,
    });
  });

  it('再試行中に新しいクリックが増えても初回snapshotを使う', async () => {
    const testDb = setup();
    insertClick(testDb, { id: 'ref-first', clickId: 'fb-first', createdAt: '2026-09-15T00:00:00.000Z' });
    stubFetch(true);

    await sendAdConversions(testDb.db, 'f1', 'Purchase', 1000, {
      idempotencyKey: 'evt-retry', now: NOW,
    });
    expect(requests).toHaveLength(1);
    expect(outbox(testDb)).toMatchObject({
      ref_tracking_id: 'ref-first', click_id: 'fb-first', selection_reason: 'eligible',
    });

    insertClick(testDb, { id: 'ref-new', clickId: 'fb-new', createdAt: '2026-09-15T12:00:00.000Z' });
    testDb.raw.prepare(`UPDATE ad_conversion_outbox SET next_attempt_at = '2000-01-01'`).run();
    stubFetch(false);

    expect(await drainAdConversionOutbox(testDb.db)).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(requests).toHaveLength(2);
    const fbcValues = requests.map(({ body }) => (
      body as { data: Array<{ user_data: { fbc: string } }> }
    ).data[0]?.user_data.fbc);
    expect(fbcValues.every((value) => value?.endsWith('.fb-first'))).toBe(true);
    expect(outbox(testDb)).toMatchObject({ status: 'sent', ref_tracking_id: 'ref-first', click_id: 'fb-first' });
  });
});
