import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEntryRouteById, getEntryRouteFunnel, deleteEntryRoute, type Friend } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { receiveEntryRouteCoupon, sendEntryRouteCoupon } from './entry-route-coupon.js';
import type { Message } from '@line-crm/line-sdk';
import { redeemCoupon } from './coupon-redemption.js';

let test: SqliteD1;
const now = new Date('2026-10-10T12:00:00+09:00');
const payload = { description: '500円引き', startsAt: '2026-10-01T00:00', endsAt: '2026-11-01T00:00', oncePerFriend: true };
const friend = { id: 'f', line_account_id: 'a' } as Friend;
async function route() { return (await getEntryRouteById(test.db, 'r'))!; }
function receipts() { return test.raw.prepare('SELECT * FROM entry_route_coupon_receipts').all(); }
beforeEach(() => {
  test = createTestD1({ foreignKeys: true });
  test.raw.exec(`INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','店','ch','token','secret');
    INSERT INTO friends(id,line_user_id,line_account_id,is_following) VALUES('f','u','a',1),('f2','u2','a',1);
    INSERT INTO entry_routes(id,ref_code,name,line_account_id,coupon_enabled,coupon_audience) VALUES('r','qr','店頭','a',1,'new_friends');`);
  test.raw.prepare(`INSERT INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,published_version,created_at,updated_at)
    VALUES('c','a','coupon','割引',?,1,'2026-10-01','2026-10-01')`).run(JSON.stringify(payload));
  test.raw.exec("UPDATE entry_routes SET coupon_asset_id='c' WHERE id='r'");
});
afterEach(() => test.raw.close());

describe('クーポンQR: 受け取り・送信・使用（実SQLite）', () => {
  it('followと再送が並行しても1人1回。別の人は受け取れる', async () => {
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    const r = await route();
    await Promise.all([sendEntryRouteCoupon(test.db, r, friend, send, now), sendEntryRouteCoupon(test.db, r, friend, send, now)]);
    await sendEntryRouteCoupon(test.db, r, friend, send, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(receipts()).toHaveLength(1);
    const receipt = receipts()[0] as { id: string; status: string };
    expect(receipt.status).toBe('sent');
    expect(JSON.stringify(send.mock.calls[0])).toContain(`coupon_use:c:${receipt.id}`);
    expect(send.mock.calls[0][1]).toBe(receipt.id);
    await sendEntryRouteCoupon(test.db, r, { ...friend, id: 'f2' }, send, now);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('新しい人だけの設定では既存友だちへ新規発行しない。追加時に送ったものは開ける', async () => {
    expect(await receiveEntryRouteCoupon(test.db, await route(), friend, now)).toBeNull();
    expect(receipts()).toHaveLength(0);
    await sendEntryRouteCoupon(test.db, await route(), friend, async () => {}, now);
    expect(await receiveEntryRouteCoupon(test.db, await route(), friend, now)).toMatchObject({ assetId: 'c', usedCount: 0 });
    expect(receipts()).toHaveLength(1);
  });

  it('既存友だちにも渡す設定は再読込・同時読取でも同じ受け取りを返す', async () => {
    test.raw.exec("UPDATE entry_routes SET coupon_audience='all_friends'");
    const r = await route();
    const results = await Promise.all([receiveEntryRouteCoupon(test.db, r, friend, now), receiveEntryRouteCoupon(test.db, r, friend, now)]);
    expect(results[0]?.receiptId).toBe(results[1]?.receiptId);
    expect(results[0]?.postbackData).toBe(`coupon_use:c:${results[0]?.receiptId}`);
    expect(receipts()).toHaveLength(1);
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    await sendEntryRouteCoupon(test.db, r, friend, send, now);
    expect(send).not.toHaveBeenCalled();
  });

  it.each([
    "UPDATE broadcast_message_assets SET published_version=0",
    "UPDATE broadcast_message_assets SET line_account_id=NULL",
    "UPDATE broadcast_message_assets SET kind='research'",
    "UPDATE entry_routes SET is_active=0",
    "UPDATE entry_routes SET coupon_enabled=0",
    "UPDATE friends SET is_following=0",
  ])('止めたクーポン・経路・未フォローには送らない: %s', async (sql) => {
    test.raw.exec(sql);
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    expect(await sendEntryRouteCoupon(test.db, await route(), friend, send, now)).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(receipts()).toHaveLength(0);
  });

  it('古い経路の取得後に停止しても発行しない。別アカウント・開始前・終了ちょうども止める', async () => {
    const r = await route();
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    test.raw.exec('UPDATE entry_routes SET is_active=0');
    await sendEntryRouteCoupon(test.db, r, friend, send, now);
    test.raw.exec('UPDATE entry_routes SET is_active=1');
    await sendEntryRouteCoupon(test.db, r, { ...friend, line_account_id: 'other' }, send, now);
    await sendEntryRouteCoupon(test.db, r, friend, send, new Date('2026-09-30T23:59:59+09:00'));
    await sendEntryRouteCoupon(test.db, r, friend, send, new Date('2026-11-01T00:00:00+09:00'));
    expect(send).not.toHaveBeenCalled();
    expect(receipts()).toHaveLength(0);
  });

  it('送達不明は自動再送せず、受け取り数も増やさない。確実な送信失敗は同じIDで再試行', async () => {
    const r = await route();
    const unknown = vi.fn(async (_message: Message, _retryKey: string) => { throw new Error('timeout'); });
    await expect(sendEntryRouteCoupon(test.db, r, friend, unknown, now)).rejects.toThrow('timeout');
    await sendEntryRouteCoupon(test.db, r, friend, unknown, now);
    expect(unknown).toHaveBeenCalledTimes(1);
    expect(receipts()[0]).toMatchObject({ status: 'unknown', received_at: null });
    const denied = vi.fn(async (_message: Message, _retryKey: string) => { throw Object.assign(new Error('denied'), { status: 400 }); });
    const other = { ...friend, id: 'f2' };
    await expect(sendEntryRouteCoupon(test.db, r, other, denied, now)).rejects.toThrow('denied');
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    await sendEntryRouteCoupon(test.db, r, other, send, now);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][1]).toBe(denied.mock.calls[0][1]);
    expect((await getEntryRouteFunnel(test.db, 'r')).coupon_received_count).toBe(1);
  });

  it('送達不明でも本人が実際にカードを使えば、受け取りと使用を確定できる', async () => {
    await expect(sendEntryRouteCoupon(test.db, await route(), friend, async () => { throw new Error('timeout'); }, now)).rejects.toThrow('timeout');
    const receipt = receipts()[0] as { id: string };
    expect((await redeemCoupon(test.db, friend, 'a', 'c', 'actual-use', now, receipt.id)).ok).toBe(true);
    expect(receipts()[0]).toMatchObject({ status: 'received' });
    expect(await getEntryRouteFunnel(test.db, 'r')).toMatchObject({ coupon_received_count: 1, coupon_used_count: 1 });
    const send = vi.fn(async (_message: Message, _retryKey: string) => {});
    await sendEntryRouteCoupon(test.db, await route(), friend, send, now);
    expect(send).not.toHaveBeenCalled();
  });

  it('使った記録を受け取りにつなぎ、別の人の受け取りは使えない。再送でも数は増えない', async () => {
    test.raw.exec("UPDATE entry_routes SET coupon_audience='all_friends'; UPDATE friends SET ref_code='qr' WHERE id='f'");
    const before = await getEntryRouteFunnel(test.db, 'r');
    expect(before.new_friend_add_count).toBe(0);
    test.raw.exec(`INSERT INTO friend_add_events(id,line_account_id,friend_id,webhook_event_id,friend_kind,entry_route_id,occurred_at)
      VALUES('new','a','f2','new-follow','first_time','r','2026-10-10'),('return','a','f','return-follow','returning','r','2026-10-10')`);
    expect((await getEntryRouteFunnel(test.db, 'r')).new_friend_add_count).toBe(1);
    const receipt = (await receiveEntryRouteCoupon(test.db, await route(), friend, now))!;
    expect((await redeemCoupon(test.db, { ...friend, id: 'f2' }, 'a', 'c', 'bad', now, receipt.receiptId)).ok).toBe(false);
    expect((await redeemCoupon(test.db, friend, 'a', 'c', 'use', now, receipt.receiptId)).ok).toBe(true);
    expect((await redeemCoupon(test.db, friend, 'a', 'c', 'use', now, receipt.receiptId)).replayed).toBe(true);
    expect((await getEntryRouteFunnel(test.db, 'r'))).toMatchObject({ coupon_received_count: 1, coupon_used_count: 1, new_friend_add_count: 1 });
    expect((await receiveEntryRouteCoupon(test.db, await route(), friend, now))?.usedCount).toBe(1);
    expect(await deleteEntryRoute(test.db, 'r', '店頭')).toBe('in_use');
    test.raw.exec("DELETE FROM broadcast_message_assets WHERE id='c'");
    expect(receipts()).toHaveLength(1);
    expect(test.raw.prepare('SELECT entry_route_coupon_receipt_id,payload_snapshot FROM coupon_redemptions').get()).toEqual({ entry_route_coupon_receipt_id: receipt.receiptId, payload_snapshot: JSON.stringify(payload) });
  });
});
