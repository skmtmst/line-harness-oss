import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCommonVar, deleteCommonVar, setCommonVarStatus } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';

/*
 * Q: 期限の14日前・3日前の知らせは「同じ知らせを二度出さない」ことが肝。
 * 通知の送出はモックにして、sweep側の選択と記録だけを確かめる。
 */
const dispatch = vi.hoisted(() => ({
  dispatchOperatorEvent: vi.fn(async (_db: unknown, _env: unknown, _input: unknown) => undefined),
}));
vi.mock('./operator-notification-dispatch.js', () => dispatch);

import { sweepCommonVarExpiryNotices } from './common-var-expiry-sweep.js';

const env = {} as Parameters<typeof sweepCommonVarExpiryNotices>[1];

describe('共通情報の期限の知らせ（Q）', () => {
  let store: SqliteD1;

  beforeEach(() => {
    store = createTestD1();
    store.raw.prepare(
      `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
       VALUES ('account-a', 'channel-a', 'A', 'token', 'secret')`,
    ).run();
    dispatch.dispatchOperatorEvent.mockClear();
  });

  it('14日前と3日前に1回ずつ知らせ、再実行で重複しない', async () => {
    await createCommonVar(store.db, {
      name: 'キャンペーン名', lineAccountId: 'account-a', varKey: 'campaign',
      value: 'x', validUntil: '2026-10-10T00:00:00.000Z',
    });
    // 期限まで13日 → 14日前の知らせだけ。
    const first = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-09-27T00:00:00.000Z'));
    expect(first.notified).toBe(1);
    expect(dispatch.dispatchOperatorEvent).toHaveBeenCalledTimes(1);
    expect(dispatch.dispatchOperatorEvent.mock.calls[0]?.[2]).toMatchObject({
      eventType: 'common_var_expiry',
      sourceEventId: expect.stringContaining(':14d:'),
    });
    // もう一度動かしても、印が立っているので送らない。
    const again = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-09-27T01:00:00.000Z'));
    expect(again.notified).toBe(0);

    // 期限まで2日 → 3日前の知らせ。
    const second = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-10-08T00:00:00.000Z'));
    expect(second.notified).toBe(1);
    expect(dispatch.dispatchOperatorEvent).toHaveBeenCalledTimes(2);
    expect(dispatch.dispatchOperatorEvent.mock.calls[1]?.[2]).toMatchObject({
      sourceEventId: expect.stringContaining(':3d:'),
    });
    const third = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-10-08T01:00:00.000Z'));
    expect(third.notified).toBe(0);
  });

  it('止めた・下書き・期限切れ・期限なしの共通情報は拾わない', async () => {
    const base = { name: 'x', lineAccountId: 'account-a', value: 'x' };
    const stopped = await createCommonVar(store.db, {
      ...base, varKey: 'stopped', validUntil: '2026-10-01T00:00:00.000Z',
    });
    await setCommonVarStatus(store.db, stopped.id, 'account-a', { to: 'stopped', changeReason: '止め' });
    await createCommonVar(store.db, {
      ...base, varKey: 'draft', status: 'draft', validUntil: '2026-10-01T00:00:00.000Z',
    });
    await createCommonVar(store.db, {
      ...base, varKey: 'expired', validUntil: '2026-09-26T00:00:00.000Z',
    });
    await createCommonVar(store.db, { ...base, varKey: 'no_expiry' });
    const archived = await createCommonVar(store.db, {
      ...base, varKey: 'archived', validUntil: '2026-10-01T00:00:00.000Z',
    });
    await deleteCommonVar(store.db, archived.id, 'account-a', 'staff-1', '整理');

    const result = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-09-27T00:00:00.000Z'));
    expect(result).toEqual({ notified: 0, candidates: 0, errors: 0 });
    expect(dispatch.dispatchOperatorEvent).not.toHaveBeenCalled();
  });

  it('期限内でも14日より先は拾わない', async () => {
    await createCommonVar(store.db, {
      name: 'x', lineAccountId: 'account-a', varKey: 'far',
      value: 'x', validUntil: '2026-12-31T00:00:00.000Z',
    });
    const result = await sweepCommonVarExpiryNotices(store.db, env, new Date('2026-09-27T00:00:00.000Z'));
    expect(result.candidates).toBe(0);
  });
});
