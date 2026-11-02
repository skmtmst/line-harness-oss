import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '@line-crm/shared';
import { ensureNenRankDefaults, getMileageAdminHistory } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { get__api_mileage_friends_21 } from './scoring-reward-catalog-handlers.js';

let fixture: SqliteD1;
const now = '2026-11-03T00:00:00';
function app(db = fixture.db) {
  const a = new Hono<any>();
  a.use('*', async (c, next) => { c.env = { DB: db }; c.set('staff', { id: 'owner', role: 'owner', tenantId: DEFAULT_TENANT_ID, accountScope: 'all' }); await next(); });
  a.get('/api/mileage/friends', get__api_mileage_friends_21);
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
