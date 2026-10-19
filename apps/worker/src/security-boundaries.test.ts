import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from './test-utils/d1-sqlite.js';
import { FOLDER_KINDS, getFolders, createUser, getUserByEmailForAccess, linkFriendToUser, getMergedMetadataByUserId, consumeStaffLineLinkCode, createTrackedLink } from '@line-crm/db';
import { storeSupportEmail } from './services/support-email.js';
import { buildOgForLiffPath } from './liff-open-graph.js';
import { app } from './index.js';
import { type Env } from './worker-env.js';

let f: SqliteD1;
beforeEach(() => {
  f = createTestD1();
  f.raw.exec(`INSERT INTO tenants(id,name) VALUES('tenant-a','A'),('tenant-b','B');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id,liff_id)
    VALUES('a','ch-a','A','','','tenant-a','100-a'),('b','ch-b','B','','','tenant-b','200-b');
    INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES('fa','Ua','a','A','{"phone":"A"}'),('fb','Ub','b','B','{"phone":"B"}');`);
});
afterEach(() => f.raw.close());

describe('tenant and public boundaries', () => {
  it('F12: lookup, linking and interpolation cannot cross tenants', async () => {
    const user = await createUser(f.db, { tenantId: 'tenant-a', email: 'same@example.test' });
    expect(await getUserByEmailForAccess(f.db, 'same@example.test', { tenantId: 'tenant-b', allowedAccountIds: ['b'], includeUnlinked: true })).toBeNull();
    expect(await linkFriendToUser(f.db, 'fa', user.id)).toBe(true);
    expect(await linkFriendToUser(f.db, 'fb', user.id)).toBe(false);
    f.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('a2','ch-a2','A2','','','tenant-a'); INSERT INTO friends(id,line_user_id,line_account_id,metadata) VALUES('fa2','Ua2','a2','{\"vip\":\"yes\"}')");
    expect(await linkFriendToUser(f.db, 'fa2', user.id)).toBe(true);
    // Also isolate already contaminated legacy records rather than trusting a shared UUID.
    f.raw.prepare('UPDATE friends SET user_id=? WHERE id=?').run(user.id, 'fb');
    expect(await getMergedMetadataByUserId(f.db, user.id, 'a')).toEqual({ phone: 'A', vip: 'yes' });
    expect(await getMergedMetadataByUserId(f.db, user.id, 'b')).toEqual({ phone: 'B' });
    expect(await getMergedMetadataByUserId(f.db, user.id)).toEqual({});
  });
  it.each(FOLDER_KINDS)('F22: NULL %s folders are visible only to platform scope', async kind => {
    f.raw.prepare('INSERT INTO folders(id,kind,name) VALUES(?,?,?)').run('legacy', kind, 'Secret');
    expect(await getFolders(f.db, kind, undefined, { allowedAccountIds: ['a'], canSeeUnassigned: false })).toEqual([]);
    expect(await getFolders(f.db, kind, undefined, { allowedAccountIds: [], canSeeUnassigned: true })).toHaveLength(1);
  });
  it('F23: duplicate Message-ID cannot overwrite or join another sender’s conversation', async () => {
    const original = await storeSupportEmail({ DB: f.db }, { customerEmail: 'owner@example.test', messageId: '<original>', subject: 'Original', bodyText: 'private' });
    await expect(storeSupportEmail({ DB: f.db }, { customerEmail: 'attacker@example.test', messageId: '<original>', bodyText: 'changed' })).rejects.toThrow('COLLISION');
    const other = await storeSupportEmail({ DB: f.db }, { customerEmail: 'attacker@example.test', messageId: '<new>', inReplyTo: '<original>', bodyText: 'new' });
    expect(other.threadId).not.toBe(original.threadId);
    expect(f.raw.prepare('SELECT customer_email FROM support_email_threads WHERE id=?').get(original.threadId)).toEqual({ customer_email: 'owner@example.test' });
    expect(f.raw.prepare('SELECT body_text FROM support_email_messages WHERE message_id=?').get('<original>')).toEqual({ body_text: 'private' });
    expect((await storeSupportEmail({ DB: f.db }, { customerEmail: 'OWNER@example.test', messageId: '<original>', bodyText: 'corrected' })).duplicate).toBe(true);
  });
  function code() {
    f.raw.exec(`INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('staff','Private name','owner','key','tenant-a');
      INSERT INTO staff_line_link_codes(code,staff_id,expires_at,created_at) VALUES('123456','staff','2099-01-01','2026-01-01');`);
  }
  it('F24: sender code attempts are bounded and valid codes stay unused after exhaustion', async () => {
    code();
    for (let i = 0; i < 5; i++) expect(await consumeStaffLineLinkCode(f.db, { code: '000000', friendId: 'fa' })).toBeNull();
    expect(await consumeStaffLineLinkCode(f.db, { code: '123456', friendId: 'fa' })).toBeNull();
    expect(f.raw.prepare('SELECT used_at FROM staff_line_link_codes').get()).toEqual({ used_at: null });
  });
  it('F26: global attempts and concurrent consumption cannot steal an already used code', async () => {
    code();
    const results = await Promise.all(['fa', 'fb'].map(friendId => consumeStaffLineLinkCode(f.db, { code: '123456', friendId })));
    expect(results.filter(Boolean)).toHaveLength(1);
    for (let i = 0; i < 25; i++) await consumeStaffLineLinkCode(f.db, { code: '000000', friendId: `new-${i}` });
    f.raw.exec("UPDATE staff_line_link_codes SET used_at=NULL");
    expect(await consumeStaffLineLinkCode(f.db, { code: '123456', friendId: 'fresh' })).toBeNull();
  });
  it('F31: OG renders the published version only, with account and suspension checks', async () => {
    f.raw.exec(`INSERT INTO forms(id,name) VALUES('form','Public title');
      INSERT INTO form_accounts(form_id,line_account_id) VALUES('form','a');
      UPDATE forms SET name='PRIVATE DRAFT' WHERE id='form';`);
    const get = (liff = '100-a') => buildOgForLiffPath(f.db, new URL(`https://worker.test/o?page=form&id=form&liffId=${liff}`));
    expect(await get()).toContain('Public title');
    expect(await get()).not.toContain('PRIVATE DRAFT');
    expect(await get('200-b')).not.toContain('Public title');
    f.raw.exec("UPDATE tenants SET status='suspended' WHERE id='tenant-a'");
    expect(await get()).not.toContain('Public title');
    f.raw.exec("UPDATE tenants SET status='active' WHERE id='tenant-a'; UPDATE forms SET current_published_version_id=NULL");
    expect(await get()).not.toContain('PRIVATE DRAFT');
  });
  it('F2: a saved legacy LIFF attribute payload cannot create markup in the mobile landing page', async () => {
    const payload = '100-a" onclick="alert(1)';
    f.raw.prepare('UPDATE line_accounts SET liff_id=? WHERE id=?').run(payload, 'a');
    f.raw.exec("INSERT INTO entry_routes(id,ref_code,name,line_account_id,coupon_enabled,coupon_asset_id) VALUES('r','ref','R','a',1,'coupon')");
    const result = await app.request('https://worker.test/r/ref', { headers: { 'User-Agent': 'Mozilla iPhone' } }, { DB: f.db, LIFF_URL: 'https://liff.line.me/100-a' } as Env['Bindings']);
    expect(result.status).toBe(503);
    expect(await result.text()).not.toContain('onclick=');
  });
  it('F6: app link script delimiters cannot escape the inline string', async () => {
    const link = await createTrackedLink(f.db, { name: 'X', originalUrl: 'https://x.com/</script><script>alert(1)</script>', lineAccountId: 'a' });
    const pending: Promise<unknown>[] = [];
    const result = await app.request(`https://worker.test/t/${link.id}`, { headers: { 'User-Agent': 'Mozilla/5.0 Safari' } }, { DB: f.db, WORKER_URL: 'https://worker.test' } as Env['Bindings'], { props: {}, waitUntil: (p: Promise<unknown>) => { pending.push(p); }, passThroughOnException() {} } as ExecutionContext);
    await Promise.allSettled(pending);
    expect(result.status).toBe(200);
    const html = await result.text();
    expect(html).not.toContain('</script><script>');
    expect(html).toContain('window.location.href=');
  });
});
