import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
const gate = vi.hoisted(() => ({ enabled: true }));
vi.mock('./feature-enforcement.js', () => ({ featureJobCanRun: vi.fn(async () => gate.enabled) }));
import { bookingChannelBounds, getBookingChannels, getBookingAutoAssign, saveBookingAutoAssign, listBookingConflicts, notifyBookingConflicts } from './booking-channels.js';

let db: SqliteD1;
const now = new Date('2026-10-02T10:00:00Z');
beforeEach(() => {
  gate.enabled = true;
  db = createTestD1();
  db.raw.exec(`INSERT INTO tenants (id,name,status) VALUES ('default','店舗統括','active');
    INSERT INTO line_accounts (id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES ('a','c','店','test_token','secret','default'),('other','d','他店','other_token','secret','default');
    INSERT INTO staff_members (id,name,role,api_key,tenant_id,line_user_id) VALUES ('member','担当','staff','key','default','Ustaff');
    INSERT INTO staff (id,line_account_id,name,display_name,staff_member_id) VALUES ('s','a','担当','担当','member'),('s2','a','担当2','担当2',NULL),('s3','other','他店','他店',NULL);
    INSERT INTO menus (id,line_account_id,name,duration_minutes,base_price) VALUES ('m','a','相談',60,0),('m3','other','相談',60,0);`);
});
afterEach(() => { vi.unstubAllGlobals(); db.raw.close(); });
function booking(id: string, start: string, end: string, staff = 's', status = 'confirmed', source = 'liff') {
  db.raw.prepare(`INSERT INTO bookings (id,friend_id,line_account_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at,source) VALUES (?,'friend',?,?,?,?,?,?,?,0,?,?)`).run(id,staff === 's3' ? 'other' : 'a',staff,staff === 's3' ? 'm3' : 'm',start,end,end,status,now.toISOString(),source);
}
describe('予約経路', () => {
  it('店舗の日付で週と今日を区切り、夏時間の23時間の日にも対応する', () => {
    expect(bookingChannelBounds('Asia/Tokyo',now)).toEqual({ todayFrom: '2026-10-01T15:00:00.000Z',todayTo: '2026-10-02T15:00:00.000Z',weekFrom:'2026-09-27T15:00:00.000Z',weekTo:'2026-10-04T15:00:00.000Z' });
    const dst = bookingChannelBounds('America/New_York',new Date('2026-03-08T12:00:00Z'));
    expect(Date.parse(dst.todayTo)-Date.parse(dst.todayFrom)).toBe(23*3600000);
  });
  it('未接続は未取得、メールは準備中、今日の受付をLINEと手入力で数える', async () => {
    booking('b1','2026-10-03T10:00:00Z','2026-10-03T11:00:00Z');
    booking('b2','2026-10-04T10:00:00Z','2026-10-04T11:00:00Z','s','confirmed','phone');
    booking('b3','2026-10-04T12:00:00Z','2026-10-04T13:00:00Z','s3');
    const result = await getBookingChannels(db.db,'a',{},now);
    expect(result.staff[0]).toMatchObject({ status: 'disconnected',externalEventsThisWeek:null,lastReadAt:null });
    expect(result.channels).toEqual([{ key:'line',status:'active',todayCount:1 },{ key:'manual',status:'active',todayCount:1 },...['hot_pepper_beauty','google_reserve','epark'].map((key) => ({ key,status:'preparing',todayCount:null }))]);
  });
  it('Googleの全ページを読み、取消と自社の予約を除く。秘密値や予定の本文を返さない', async () => {
    db.raw.exec(`INSERT INTO google_calendar_connections (id,calendar_id,line_account_id,staff_id,auth_type,access_token) VALUES ('gc','calendar','a','s','oauth','mock_access');`);
    booking('b','2026-10-03T10:00:00Z','2026-10-03T11:00:00Z');
    db.raw.exec(`UPDATE bookings SET external_event_id='own',external_calendar_id='calendar' WHERE id='b'`);
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ items:[{ id:'own' },{ id:'external1' },{ id:'cancelled',status:'cancelled' }],nextPageToken:'page2' })).mockResolvedValueOnce(Response.json({ items:[{ id:'external2' }] }));
    vi.stubGlobal('fetch',fetchMock);
    const result = await getBookingChannels(db.db,'a',{},now);
    expect(result.staff[0]).toMatchObject({ status:'connected',externalEventsThisWeek:2,lastReadAt:now.toISOString(),readError:null });
    expect(fetchMock.mock.calls[1][0]).toContain('pageToken=page2');
    expect(JSON.stringify(result)).not.toMatch(/mock_access|calendar_id|external1/);
    expect(db.raw.prepare("SELECT value FROM account_settings WHERE key='booking_calendar_last_read:s'").get()).toEqual({ value:now.toISOString() });
  });
  it('認証期限切れと通信失敗を分け、失敗時には最後の成功時刻を保つ', async () => {
    db.raw.exec(`INSERT INTO google_calendar_connections (id,calendar_id,line_account_id,staff_id,auth_type,access_token) VALUES ('gc','calendar','a','s','oauth','mock_access');
      INSERT INTO account_settings (id,line_account_id,key,value) VALUES ('last','a','booking_calendar_last_read:s','2026-10-01T10:00:00Z');`);
    vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(new Response('',{ status:401 })).mockRejectedValueOnce(new Error('network')));
    expect((await getBookingChannels(db.db,'a',{},now)).staff[0]).toMatchObject({ status:'expired',externalEventsThisWeek:null,lastReadAt:'2026-10-01T10:00:00Z' });
    expect((await getBookingChannels(db.db,'a',{},now)).staff[0]).toMatchObject({ status:'connected',externalEventsThisWeek:null,readError:'calendar_read_unavailable' });
  });
  it('自動割り当ては初期OFF、店舗ごとに保存される', async () => {
    expect(await getBookingAutoAssign(db.db,'a')).toBe(false);
    await saveBookingAutoAssign(db.db,'a',true);
    expect(await getBookingAutoAssign(db.db,'a')).toBe(true);
    expect(await getBookingAutoAssign(db.db,'other')).toBe(false);
    await saveBookingAutoAssign(db.db,'a',false);
    expect(await getBookingAutoAssign(db.db,'a')).toBe(false);
  });
});
describe('重なった予約', () => {
  beforeEach(() => {
    booking('b1','2026-10-03T10:00:00Z','2026-10-03T11:00:00Z');
    booking('b2','2026-10-03T10:30:00Z','2026-10-03T11:30:00Z');
  });
  it('同じスタッフ・同じ店舗・受付中のみ。隣接、別スタッフ、取消、バッファだけの重なりは除く', async () => {
    booking('b3','2026-10-03T11:30:00Z','2026-10-03T12:30:00Z');
    booking('b4','2026-10-03T10:30:00Z','2026-10-03T11:30:00Z','s2');
    booking('b5','2026-10-03T10:30:00Z','2026-10-03T11:30:00Z','s','cancelled');
    booking('b6','2026-10-03T10:30:00Z','2026-10-03T11:30:00Z','s3');
    db.raw.exec("UPDATE bookings SET block_ends_at='2026-10-03T12:00:00Z' WHERE id='b2'");
    expect(await listBookingConflicts(db.db,'a')).toHaveLength(1);
    expect(await listBookingConflicts(db.db,'other')).toEqual([]);
  });
  it('自動LINE通知はmanualを付けず同じ版に1回だけ。版が変われば再確認する', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('',{ status:200 }));
    vi.stubGlobal('fetch',fetchMock);
    await notifyBookingConflicts(db.db,'a');
    await notifyBookingConflicts(db.db,'a');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [,init] = fetchMock.mock.calls[0];
    expect(init.headers['X-Line-Harness-Source']).toBeUndefined();
    expect(init.headers['X-Line-Retry-Key']).toBeTruthy();
    expect(JSON.parse(init.body).to).toBe('Ustaff');
    db.raw.exec("UPDATE bookings SET lock_version=lock_version+1 WHERE id='b2'");
    await notifyBookingConflicts(db.db,'a');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it('送信止め・機能停止・担当のLINE通知OFF・停止した統括は送らない', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch',fetchMock);
    db.raw.exec(`INSERT INTO operation_control_sets (scope_key,line_account_id,version,states_json,updated_at) VALUES ('*',NULL,1,'{"broadcast_dispatch":"stopped"}','2026-10-02T10:00:00Z')`);
    await notifyBookingConflicts(db.db,'a');
    db.raw.exec('DELETE FROM operation_control_sets');
    gate.enabled=false; await notifyBookingConflicts(db.db,'a');
    gate.enabled=true;
    db.raw.exec(`UPDATE staff_members SET notification_preferences='{"operator":{"line":false}}'`);
    await notifyBookingConflicts(db.db,'a');
    db.raw.exec(`UPDATE staff_members SET notification_preferences='{}'; UPDATE tenants SET status='suspended' WHERE id='default'`);
    await notifyBookingConflicts(db.db,'a');
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it('送信失敗は次回の確認で再試行できる', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(new Response('',{ status:200 })); vi.stubGlobal('fetch',fetchMock);
    await expect(notifyBookingConflicts(db.db,'a')).rejects.toThrow('booking_conflict_notification_failed');
    await notifyBookingConflicts(db.db,'a');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1].headers['X-Line-Retry-Key']).toBe(fetchMock.mock.calls[1][1].headers['X-Line-Retry-Key']);
  });
});
