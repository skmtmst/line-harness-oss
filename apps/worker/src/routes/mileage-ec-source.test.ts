import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { ensureNenRankDefaults, getMileageAdminHistory, postMileageEntry, enqueueMileageEvent, processPendingMileageEvents, syncAffiliateConversionMileage } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { get__api_mileage_friends_21 } from './scoring-reward-catalog-handlers.js';
import { get__api_friends_id_mileage_1 } from './friends-summaries-handlers.js';
import { createAutomationActionExecutors } from '../features/automations/automation-action-handlers.js';
import { runActions } from '../features/friends/friend-add-routing-find-friend-add-unusable-references.js';
import * as mileageSourceService from '../services/mileage-ec-source.js';

let fixture: SqliteD1;
const now = '2026-11-03T00:00:00';
function app(db = fixture.db) {
  const a = new Hono<any>();
  a.use('*', async (c, next) => { c.env = { DB: db }; c.set('staff', { id: 'owner', role: 'owner', tenantId: DEFAULT_TENANT_ID, accountScope: 'all' }); await next(); });
  a.get('/api/mileage/friends', get__api_mileage_friends_21);
  a.get('/api/friends/:id/mileage', get__api_friends_id_mileage_1);
  return a;
}
const request = (account: string, extra = '') => app().request(`/api/mileage/friends?accountId=${account}${extra}`);
beforeEach(async () => {
  fixture = createTestD1();
  for (const account of ['nen', 'other', 'empty']) {
    fixture.raw.prepare('INSERT INTO line_accounts (id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES (?,?,?,?,?,?)')
      .run(account, account, `channel-${account}`, 's', 't', DEFAULT_TENANT_ID);
    fixture.raw.prepare('INSERT INTO friends (id,line_user_id,display_name,line_account_id,is_following,created_at,updated_at) VALUES (?,?,?,?,1,?,?)')
      .run(`f-${account}`, `U-${account}`, `会員-${account}`, account, now, now);
  }
  fixture.raw.prepare("INSERT INTO account_settings (id,line_account_id,key,value) VALUES ('other-catalog','other','feature.specialized.catalog','[]')").run();
  fixture.raw.prepare("INSERT INTO ec_connectors (id,line_account_id,provider,shop_domain,created_at,updated_at) VALUES ('connector','nen','ec_cube','example.invalid',?,?)").run(now, now);
  fixture.raw.prepare("INSERT INTO ec_connectors (id,line_account_id,provider,shop_domain,created_at,updated_at) VALUES ('connector-other','other','ec_cube','other.invalid',?,?)").run(now, now);
  fixture.raw.prepare("INSERT INTO nen_ec_member_snapshots (friend_id,customer_id,mile_balance,member_rank_key,member_rank,synced_at) VALUES ('f-nen','123',29,'gold','会員',?)").run(now);
  fixture.raw.prepare("INSERT INTO nen_ec_member_snapshots (friend_id,customer_id,mile_balance,member_rank_key,synced_at) VALUES ('f-other','456',99,'gold',?)").run(now);
  await ensureNenRankDefaults(fixture.db, 'nen');
  await getMileageAdminHistory(fixture.db, { accountId: 'nen', limit: 1 });
  for (const account of ['nen','other','empty']) fixture.raw.prepare(`INSERT INTO mileage_ledger(id,program_id,beneficiary_friend_id,entry_type,status,amount,reason,source,idempotency_key,occurred_at,created_at)
    VALUES(?, 'default', ?, 'grant', 'available', 7, 'test', 'purchase', ?, ?, ?)`).run(`ledger-${account}`, `f-${account}`, `key-${account}`, now, now);
});
afterEach(() => fixture.raw.close());

describe('ECの正本を使うマイル残高', () => {
  it('保留交換の判定は対象店舗と本人に限り完了済みを含めない', async () => {
    fixture.raw.pragma('foreign_keys = OFF');
    const insert = fixture.raw.prepare(`INSERT INTO mileage_redemptions(id,line_account_id,program_id,beneficiary_key,beneficiary_friend_id,reward_id,reward_version_id,idempotency_key,request_fingerprint,status) VALUES(?,?,'default',?,?, 'reward','version',?,? ,?)`);
    insert.run('held','nen','friend:f-nen','f-nen','held-key','fingerprint','reserved');
    insert.run('done','other','friend:f-other','f-other','done-key','fingerprint','succeeded');
    const check = (mileageSourceService as any).hasHeldMileageRedemption;
    expect(await check(fixture.db, 'nen', 'f-nen')).toBe(true);
    expect(await check(fixture.db, 'other', 'f-other')).toBe(false);
    expect(await check(fixture.db, 'nen', 'f-other')).toBe(false);
    expect(await check(fixture.db, 'other', 'f-nen')).toBe(false);
  });
  it('EC管理の自動化付与は成功扱いで飛ばし後続の操作を止めない', async () => {
    const run = createAutomationActionExecutors().grant_mileage!;
    await expect(run({ db: fixture.db, lineAccountId: 'nen', friendId: 'f-nen', action: { id: 'a', type: 'grant_mileage', params: { amount: 10 } }, sourceEventId: 'evt', idempotencyKey: 'i' } as any)).resolves.toBeUndefined();
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE source='automation'").get()).toEqual({ n: 0 });
  });
  it('EC管理の友だち追加付与も失敗として記録しない', async () => {
    expect(await runActions(fixture.db, 'f-nen', [{ kind: 'mile', amount: 10 }])).toEqual({ total: 1, failed: 0 });
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE source='friend_add_routing'").get()).toEqual({ n: 0 });
  });
  it('非EC店の行動は処理し、EC店の紹介者への付与だけ止める', async () => {
    fixture.raw.prepare("INSERT INTO affiliates(id,name,code,is_active,created_at,friend_id) VALUES('ref','紹介者','REF',1,?,'f-nen')").run(now);
    fixture.raw.prepare("INSERT INTO affiliate_links(id,affiliate_id,ref_code,is_active,created_at) VALUES('link','ref','REFCODE',1,?)").run(now);
    fixture.raw.prepare("INSERT INTO ref_tracking(id,ref_code,friend_id,created_at) VALUES('touch','REFCODE','f-other',?)").run(now);
    fixture.raw.prepare("INSERT INTO tags(id,name,color,mileage_reward,referral_mileage_reward) VALUES ('tag','タグ','#000',10,25)").run();
    const event = await enqueueMileageEvent(fixture.db, { friendId: 'f-other', eventType: 'tag_added', source: 'tag', sourceEventId: 'other-tag', subjectKey: 'tag', occurredAt: now });
    await processPendingMileageEvents(fixture.db, { now: '2099-01-01', limit: 10 });
    expect(fixture.raw.prepare('SELECT status FROM mileage_event_queue WHERE engagement_event_id=?').get(event.id)).toEqual({ status: 'processed' });
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE beneficiary_friend_id='f-other' AND source='tag'").get()).toEqual({ n: 1 });
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE beneficiary_friend_id='f-nen' AND source='tag_referral'").get()).toEqual({ n: 0 });
  });
  it('EC管理では紹介成果の承認による付与も行わない', async () => {
    fixture.raw.prepare("INSERT INTO affiliates(id,name,code,is_active,created_at,friend_id) VALUES('aff','紹介者','CODE',1,?,'f-nen')").run(now);
    fixture.raw.prepare("INSERT INTO conversion_points(id,name,event_type,value,created_at) VALUES('cp','成果','custom',1000,?)").run(now);
    fixture.raw.prepare("INSERT INTO conversion_events(id,conversion_point_id,friend_id,affiliate_id,approval_status,approval_reward_miles,created_at) VALUES('ce','cp','f-other','aff','approved',20,?)").run(now);
    await expect(syncAffiliateConversionMileage(fixture.db, 'ce', 'approved')).resolves.toBeUndefined();
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE source_event_id='ce'").get()).toEqual({ n: 0 });
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM engagement_events WHERE source_event_id='ce'").get()).toEqual({ n: 0 });
  });
  it('ECの付与待ちは変更せず他店のキューは進める', async () => {
    const ec = await enqueueMileageEvent(fixture.db, { friendId: 'f-nen', eventType: 'friend_added', source: 'test', sourceEventId: 'ec-queued' });
    const other = await enqueueMileageEvent(fixture.db, { friendId: 'f-other', eventType: 'friend_added', source: 'test', sourceEventId: 'other-queued' });
    fixture.raw.prepare("UPDATE mileage_event_queue SET created_at='2020-01-01' WHERE engagement_event_id=?").run(ec.id);
    const before = fixture.raw.prepare('SELECT * FROM mileage_event_queue WHERE engagement_event_id=?').get(ec.id);
    await processPendingMileageEvents(fixture.db, { limit: 1 });
    expect(fixture.raw.prepare('SELECT * FROM mileage_event_queue WHERE engagement_event_id=?').get(ec.id)).toEqual(before);
    expect(fixture.raw.prepare('SELECT status FROM mileage_event_queue WHERE engagement_event_id=?').get(other.id)).toEqual({ status: 'processed' });
  });
  it('ECの待ち行が多くてもDB呼び出しを増やさず他店の付与を進める', async () => {
    for (let i = 0; i < 300; i++) await enqueueMileageEvent(fixture.db, { friendId: 'f-nen', eventType: 'friend_added', source: 'test', sourceEventId: `ec-bulk-${i}` });
    const other = await enqueueMileageEvent(fixture.db, { friendId: 'f-other', eventType: 'friend_added', source: 'test', sourceEventId: 'other-bulk' });
    fixture.raw.prepare("UPDATE mileage_event_queue SET created_at='2020-01-01' WHERE engagement_event_id != ?").run(other.id);
    let calls = 0;
    const db = new Proxy(fixture.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => { if (++calls > 200) throw new Error('DB budget exceeded'); return target.prepare(sql); };
      return Reflect.get(target, key);
    }});
    await processPendingMileageEvents(db, { limit: 1, now: '2099-01-01' });
    expect(fixture.raw.prepare('SELECT status FROM mileage_event_queue WHERE engagement_event_id=?').get(other.id)).toEqual({ status: 'processed' });
    expect(calls).toBeLessThan(120);
  });
  it('処理直前に管理元が読めなくなったら保留しエラーを記録する', async () => {
    const event = await enqueueMileageEvent(fixture.db, { friendId: 'f-other', eventType: 'friend_added', source: 'test', sourceEventId: 'source-fails-late' });
    let sourceReads = 0;
    const db = new Proxy(fixture.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('feature.specialized.catalog') && ++sourceReads === 2) throw new Error('source read failed');
        return target.prepare(sql);
      };
      return Reflect.get(target, key);
    }});
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await processPendingMileageEvents(db, { now: '2099-01-01' });
      expect(log).toHaveBeenCalledWith('mileage_queue_source_unavailable', 'other', expect.any(Error));
      expect(fixture.raw.prepare('SELECT status FROM mileage_event_queue WHERE engagement_event_id=?').get(event.id)).toEqual({ status: 'pending' });
    } finally { log.mockRestore(); }
  });
  it('ECの会員へ直接付与しても台帳に記録しない', async () => {
    await expect(postMileageEntry(fixture.db, { beneficiaryFriendId: 'f-nen', entryType: 'grant', amount: 10, reason: 'test', source: 'automation', idempotencyKey: 'ec-direct' })).rejects.toThrow('MILEAGE_MANAGED_BY_EC');
    expect(fixture.raw.prepare("SELECT COUNT(*) AS n FROM mileage_ledger WHERE idempotency_key='ec-direct'").get()).toEqual({ n: 0 });
  });
  it('友だち詳細はECの29を返し、未取得は不明として返す', async () => {
    let data = (await (await app().request('/api/friends/f-nen/mileage?accountId=nen')).json() as any).data;
    expect(data.summary).toMatchObject({ available: 29, balanceSource: 'ec', ecRank: 'ゴールド' });
    fixture.raw.prepare("DELETE FROM nen_ec_member_snapshots WHERE friend_id='f-nen'").run();
    data = (await (await app().request('/api/friends/f-nen/mileage?accountId=nen')).json() as any).data;
    expect(data.summary).toMatchObject({ available: null, balanceSource: 'ec' });
  });
  it('EC機能が無効なら会員データが残っていてもmusuboを使う', async () => {
    fixture.raw.prepare("INSERT INTO account_settings (id,line_account_id,key,value) VALUES ('ec-off','nen','feature.ec_commerce','false')").run();
    const data = (await (await request('nen')).json() as any).data;
    expect(data.balanceSource).toBe('musubo');
    expect(data.items[0].available).toBe(7);
  });
  it.each([['shopify', 'connected'], ['ec_cube', 'paused']])('会員データがなく %s / %s の接続だけならmusuboを使う', async (provider, status) => {
    fixture.raw.prepare("DELETE FROM nen_ec_member_snapshots WHERE friend_id='f-nen'").run();
    fixture.raw.prepare("UPDATE ec_connectors SET provider=?, status=? WHERE line_account_id='nen'").run(provider, status);
    expect((await (await request('nen')).json() as any).data.balanceSource).toBe('musubo');
  });
  it('NEN はEC残高と設定名を出し、別のEC店と接続もデータもない店は従来どおり', async () => {
    const nen = await (await request('nen')).json() as any;
    expect(nen.data.balanceSource).toBe('ec');
    expect(nen.data.items[0]).toMatchObject({ friendId: 'f-nen', available: 29, rank: 'ゴールド' });
    for (const id of ['other','empty']) {
      const data = (await (await request(id)).json() as any).data;
      expect(data.balanceSource).toBe('musubo');
      expect(data.items[0].available).toBe(7);
    }
  });
  it('接続が無くてもNENの会員データがあればECを正にする', async () => {
    fixture.raw.prepare("DELETE FROM ec_connectors WHERE line_account_id = 'nen'").run();
    const data = (await (await request('nen')).json() as any).data;
    expect(data.balanceSource).toBe('ec');
    expect(data.items[0].available).toBe(29);
  });
  it('カタログが壊れていたら推測せずエラーにする', async () => {
    fixture.raw.prepare("INSERT INTO account_settings (id,line_account_id,key,value) VALUES ('bad','nen','feature.specialized.catalog','bad-json')").run();
    expect((await request('nen')).status).toBeGreaterThanOrEqual(500);
  });
  it('ECデータが無い友だちを0やmusuboの残高でごまかさない', async () => {
    fixture.raw.prepare('DELETE FROM nen_ec_member_snapshots WHERE friend_id = ?').run('f-nen');
    const data = (await (await request('nen')).json() as any).data;
    expect(data.balanceSource).toBe('ec');
    expect(data.items[0].ecBalance).toBeNull();
    expect(data.summary.available).toBeNull();
  });
  it('EC残高0と未取得を区別し、ランク名はECキーに対応する設定名を優先する', async () => {
    fixture.raw.prepare("UPDATE nen_ec_member_snapshots SET mile_balance = 0, ec_member_rank_name = '古い名前' WHERE friend_id = 'f-nen'").run();
    const data = (await (await request('nen')).json() as any).data;
    expect(data.items[0]).toMatchObject({ available: 0, rank: 'ゴールド' });
    expect(data.ecKnownCount).toBe(1);
  });
  it('ランク表にないキーはECから届いた名前だけを使い、名前がなければ未設定', async () => {
    fixture.raw.prepare("UPDATE nen_ec_member_snapshots SET member_rank_key='vip', ec_member_rank_name='VIP' WHERE friend_id='f-nen'").run();
    expect((await (await request('nen')).json() as any).data.items[0].rank).toBe('VIP');
    fixture.raw.prepare("UPDATE nen_ec_member_snapshots SET ec_member_rank_name=NULL WHERE friend_id='f-nen'").run();
    expect((await (await request('nen')).json() as any).data.items[0].rank).toBe('未設定');
    fixture.raw.prepare("UPDATE nen_ec_member_snapshots SET member_rank_key=NULL, ec_member_rank_name='VIP' WHERE friend_id='f-nen'").run();
    expect((await (await request('nen')).json() as any).data.items[0].rank).toBe('未設定');
  });
  it('友だちIDで他店を検索できず、ページと件数が合う', async () => {
    const data = (await (await request('nen', '&friendId=f-other')).json() as any).data;
    expect(data.items).toEqual([]);
    expect(data.pagination.total).toBe(0);
  });
  it('判定が読めないときはエラーを返し、ECかどうかを推測しない', async () => {
    const broken = new Proxy(fixture.db, { get(target, key) {
      if (key === 'prepare') return (sql: string) => {
        if (sql.includes('feature.specialized.catalog')) throw new Error('injected source failure');
        return target.prepare(sql);
      };
      return Reflect.get(target, key);
    }});
    const response = await app(broken).request('/api/mileage/friends?accountId=nen');
    expect(response.status).toBeGreaterThanOrEqual(500);
  });
});
