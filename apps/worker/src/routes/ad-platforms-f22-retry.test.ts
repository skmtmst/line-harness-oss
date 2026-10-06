import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { adConversionRetryExpired, drainAdConversionOutbox, retryAdConversion, sendAdConversions } from '../services/ad-conversion';
import type { Env } from '../index';

vi.mock('../services/account-access.js', () => ({
  canAccessAllLineAccounts: async (_db: unknown, _staff: unknown, ids: unknown[]) => ids.every(id => id === 'account-a'),
}));
const { adPlatforms } = await import('./ad-platforms.js');
let testDb: SqliteD1;
const now = new Date('2026-10-06T10:00:00.000Z');
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  testDb = createTestD1({ foreignKeys: true });
  testDb.raw.exec(`
    INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
      VALUES ('account-a', '試験の接続', 'fixture-channel', '', '');
    INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('friend-a', 'fixture-line-id', 'account-a');
    INSERT INTO ref_tracking (id, ref_code, friend_id, fbclid, line_account_id, created_at, ad_conversion_consent_at)
      VALUES ('ref-a', 'fixture-ref', 'friend-a', 'fixture-click', 'account-a', '2026-10-05T10:00:00Z', '2026-10-05T10:00:00Z');
  `);
  testDb.raw.prepare(`INSERT INTO ad_platforms (id, name, config, is_active, line_account_id)
    VALUES ('platform-a', 'meta', ?, 1, 'account-a')`).run(JSON.stringify({
      pixel_id: 'fixture-pixel', access_token: crypto.randomUUID(), click_id_validity_days: 3650,
    }));
  fetchMock = vi.fn(async () => ({ ok: false, text: async () => '試験の送信失敗' }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); testDb.raw.close(); });
async function failedLog() {
  await sendAdConversions(testDb.db, 'friend-a', 'Purchase', 120, { idempotencyKey: 'fixture-event-a' });
  const log = testDb.raw.prepare('SELECT id, provider_event_id FROM ad_conversion_logs').get() as { id: string; provider_event_id: string };
  fetchMock.mockClear();
  fetchMock.mockImplementation(async () => ({ ok: true, text: async () => 'ok' }));
  return log;
}
async function post(logId: string, role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<Env>();
  app.use('*', async (c, next) => { c.set('staff', { id: 'operator-a', name: '試験', role, readOnly: false }); await next(); });
  app.route('/', adPlatforms);
  return app.request(`/api/ad-platforms/logs/${logId}/retry`, { method: 'POST' }, { DB: testDb.db } as Env['Bindings']);
}

describe('F-22 広告の同じ送信をやり直す', () => {
  it('失敗した1件を同じ目印・金額で送り、再操作は再送しない', async () => {
    const original = await failedLog();
    const firstCreatedAt = (testDb.raw.prepare('SELECT created_at FROM ad_conversion_outbox').get() as { created_at: string }).created_at;
    const response = await post(original.id, 'owner');
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: {
      logId: original.id, status: 'sent', providerEventId: original.provider_event_id, replayed: false,
    } });
    const sent = JSON.parse(fetchMock.mock.calls[0]![1].body as string);
    expect(sent.data[0]).toMatchObject({ event_id: original.provider_event_id, custom_data: { value: 120, currency: 'JPY' } });
    const second = await post(original.id);
    expect(await second.json()).toMatchObject({ data: { status: 'sent', replayed: true } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM ad_conversion_logs').get()).toMatchObject({ n: 1 });
    expect(testDb.raw.prepare('SELECT created_at FROM ad_conversion_outbox').get()).toMatchObject({ created_at: firstCreatedAt });
  });
  it('同時操作の送信は1件だけに収まる', async () => {
    const log = await failedLog();
    const responses = await Promise.all([post(log.id), post(log.id)]);
    expect(responses.map(r => r.status)).toContain(200);
    expect(responses.every(r => [200, 409].includes(r.status))).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([90, 91])('%i日経った送信は、ログ日時が新しくても拒む', async days => {
    const log = await failedLog();
    testDb.raw.prepare('UPDATE ad_conversion_outbox SET created_at = ?').run(new Date(now.getTime() - days * 86_400_000).toISOString());
    const response = await post(log.id);
    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({ code: 'retry_expired' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testDb.raw.prepare('SELECT status FROM ad_conversion_outbox').get()).toMatchObject({ status: 'failed' });
  });
  it('90日直前の送信は期限内、壊れた日時・未来の日時は期限内と見なさない', () => {
    expect(adConversionRetryExpired(new Date(now.getTime() - 90 * 86_400_000 + 1).toISOString(), now)).toBe(false);
    expect(adConversionRetryExpired('invalid', now)).toBe(true);
    expect(adConversionRetryExpired(new Date(now.getTime() + 1).toISOString(), now)).toBe(true);
  });
  it('自動の再試行でも90日を過ぎた送信を外へ出さない', async () => {
    await failedLog();
    testDb.raw.prepare(`UPDATE ad_conversion_outbox SET created_at = ?, next_attempt_at = NULL`).run(new Date(now.getTime() - 91 * 86_400_000).toISOString());
    await drainAdConversionOutbox(testDb.db);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testDb.raw.prepare('SELECT is_retryable, last_error FROM ad_conversion_outbox').get()).toMatchObject({ is_retryable: 0, last_error: 'retry_expired' });
  });
  it.each(['admin', 'staff'] as const)('広告設定を変更できない%sの再送を拒む', async role => {
    const log = await failedLog();
    expect((await post(log.id, role)).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(testDb.raw.prepare('SELECT status FROM ad_conversion_outbox').get()).toMatchObject({ status: 'failed' });
  });
  it('別アカウント・存在しない記録を拒む', async () => {
    const log = await failedLog();
    expect((await post('missing')).status).toBe(404);
    await expect(retryAdConversion(testDb.db, { logId: log.id, lineAccountId: 'account-b' })).rejects.toMatchObject({ code: 'not_found' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('保存した目印の不一致を拒み、推測した値で再送しない', async () => {
    const log = await failedLog();
    testDb.raw.exec(`UPDATE ad_conversion_logs SET provider_event_id = 'different-fixture-event'`);
    const response = await post(log.id);
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ code: 'retry_snapshot_unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('閲覧できないアカウントの記録はHTTPでも見つからない扱いにする', async () => {
    const log = await failedLog();
    testDb.raw.exec(`INSERT INTO line_accounts (id, name, channel_id, channel_access_token, channel_secret)
      VALUES ('account-b', '別の試験接続', 'fixture-channel-b', '', '');
      UPDATE ad_conversion_logs SET line_account_id = 'account-b';
      UPDATE ad_conversion_outbox SET line_account_id = 'account-b';`);
    expect((await post(log.id)).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('緊急停止中は手動の再送も外へ出さない', async () => {
    const log = await failedLog();
    testDb.raw.prepare(`INSERT INTO operation_control_sets (scope_key, line_account_id, states_json, updated_at)
      VALUES ('account-a', 'account-a', ?, ?)`).run(JSON.stringify({ ad_postback: 'stopped' }), now.toISOString());
    const response = await post(log.id);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'sending_stopped' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('媒体の停止中と、固定情報が無い古い送信を拒む', async () => {
    const log = await failedLog();
    testDb.raw.exec('UPDATE ad_platforms SET is_active = 0');
    expect((await post(log.id)).status).toBe(409);
    testDb.raw.exec(`UPDATE ad_platforms SET is_active = 1; UPDATE ad_conversion_outbox SET selection_reason = 'legacy_unsnapshotted'`);
    expect((await post(log.id)).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('再送が失敗しても、同じ行・同じ目印を維持して失敗を返す', async () => {
    const log = await failedLog();
    fetchMock.mockImplementation(async () => ({ ok: false, text: async () => '試験の送信失敗' }));
    const response = await post(log.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { status: 'failed', providerEventId: log.provider_event_id } });
    expect(testDb.raw.prepare('SELECT COUNT(*) AS n FROM ad_conversion_outbox').get()).toMatchObject({ n: 1 });
  });
});
