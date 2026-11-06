import { Hono } from 'hono';
import { beforeEach,afterEach,expect,test,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { liffNotificationPreferences } from './liff-notification-preferences.js';
import { verifyCallerLineIdentity } from '../services/liff-auth.js';
import type { Env } from '../worker-env.js';
vi.mock('../services/liff-auth.js',()=>({verifyCallerLineIdentity:vi.fn()}));
let f:SqliteD1,app:Hono<Env>;
interface Preferences {items:Array<{purpose:string;state:string;enabled:boolean|null;recorded:boolean;version:number}>;purposeSpecificEnforcement:boolean}
async function req(path='',body?:unknown,accountId='a') {const r=await app.request(`/api/liff/notification-preferences${path}?lineAccountId=${accountId}`,{method:body===undefined?'GET':'PUT',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.db} as Env['Bindings']);return {status:r.status,cache:r.headers.get('Cache-Control'),body:await r.json() as {data:Preferences}};}
beforeEach(()=>{
 f=createTestD1({foreignKeys:true});
 // 統合した637の実際の表と監査トリガーを使う。
 f.raw.exec(` INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token) VALUES('a','A','a','x','x'),('b','B','b','x','x');
 INSERT INTO friends(id,line_user_id,line_account_id) VALUES('self','U-self','a'),('other','U-other','a'),('same-user-other-shop','U-other-shop','b');`);
 app=new Hono<Env>();app.route('/',liffNotificationPreferences);
 vi.mocked(verifyCallerLineIdentity).mockResolvedValue({lineUserId:'U-self',lineAccountId:'a'});
});
afterEach(()=>{f.raw.close();vi.restoreAllMocks();});
test('未記録を同意済みにせず、本人の目的別の停止・再開と監査だけを保存する',async()=>{
 const initial=await req();expect(initial.status).toBe(200);expect(initial.cache).toBe('no-store');
 expect(initial.body.data.items.every(p=>p.state==='unknown'&&p.enabled===null&&p.version===0&&!p.recorded)).toBe(true);
 expect(initial.body.data.purposeSpecificEnforcement).toBe(false);
 const stop=await req('/marketing',{enabled:false,expectedVersion:0});expect(stop.status).toBe(200);
 expect(stop.body.data.items.find(p=>p.purpose==='marketing')).toMatchObject({state:'revoked',version:1,recorded:true});
 expect(stop.body.data.items.find(p=>p.purpose==='booking_reminders')?.recorded).toBe(false);
 expect(f.raw.prepare('SELECT friend_id,source,updated_by FROM friend_delivery_consents').all()).toEqual([{friend_id:'self',source:'liff_self_service',updated_by:'self'}]);
 expect((await req('/marketing',{enabled:true,expectedVersion:0})).status).toBe(409);
 expect((await req('/marketing',{enabled:true,expectedVersion:1})).status).toBe(200);
 expect(f.raw.prepare('SELECT count(*) n FROM friend_delivery_consent_events').get()).toEqual({n:2});
 expect(f.raw.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({n:0});
});
test('本人確認と店の境界を要求し、本文のfriendId・任意の目的・不正な版を拒む',async()=>{
 expect((await req('',undefined,'b')).status).toBe(401);
 expect((await req('/marketing',{enabled:false,expectedVersion:0,friendId:'other'})).status).toBe(400);
 expect((await req('/global',{enabled:false,expectedVersion:0})).status).toBe(400);
 for(const expectedVersion of [-1,1.2,'0',null])expect((await req('/marketing',{enabled:false,expectedVersion})).status).toBe(400);
 vi.mocked(verifyCallerLineIdentity).mockResolvedValue(null);expect((await req()).status).toBe(401);
 vi.mocked(verifyCallerLineIdentity).mockResolvedValue({lineUserId:'U-self',lineAccountId:'a'});f.raw.exec("INSERT INTO tenants(id,name,status) VALUES('paused','Paused','suspended'); UPDATE line_accounts SET tenant_id='paused' WHERE id='a'");expect((await req()).status).toBe(503);f.raw.exec("UPDATE line_accounts SET tenant_id=NULL WHERE id='a'");f.raw.exec("UPDATE line_accounts SET is_active=0 WHERE id='a'");expect((await req()).status).toBe(404);
});
test('同時変更は1件だけ成功し、削除後にも古い版を再利用できない',async()=>{
 const results=await Promise.all([req('/marketing',{enabled:false,expectedVersion:0}),req('/marketing',{enabled:true,expectedVersion:0})]);expect(results.map(r=>r.status).sort()).toEqual([200,409]);
 f.raw.exec("DELETE FROM friend_delivery_consents WHERE friend_id='self'");
 expect((await req('/marketing',{enabled:true,expectedVersion:0})).status).toBe(409);
 expect((await req()).body.data.items.find(p=>p.purpose==='marketing')).toMatchObject({version:1,recorded:false});
 expect((await req('/marketing',{enabled:true,expectedVersion:1})).status).toBe(200);
 expect((await req()).body.data.items.find(p=>p.purpose==='marketing')).toMatchObject({version:2,recorded:true});
});
test('監査を書けなければ設定も変えず、637が無ければ未取得のまま503',async()=>{
 f.raw.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON friend_delivery_consent_events BEGIN SELECT RAISE(ABORT,'fixture'); END;");
 expect((await req('/marketing',{enabled:false,expectedVersion:0})).status).toBe(503);
 expect(f.raw.prepare('SELECT count(*) n FROM friend_delivery_consents').get()).toEqual({n:0});
 f.raw.exec('DROP TABLE friend_delivery_consents');expect((await req()).status).toBe(503);
});
