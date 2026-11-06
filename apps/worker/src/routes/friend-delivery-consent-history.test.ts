import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {friends} from './friends.js';
import {liffNotificationPreferences} from './liff-notification-preferences.js';
vi.mock('../services/liff-auth.js',()=>({verifyCallerLineIdentity:vi.fn(async()=>({lineUserId:'Uf',lineAccountId:'a'}))}));
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();});afterEach(()=>d.raw.close());
const path='/api/friends/f/delivery-consents/history';
test('本人/店の変更を前後の値・理由・日時つきで返し、他人の履歴を混ぜない',async()=>{
 const app=gapApp(d,[friends,liffNotificationPreferences]);
 expect((await gapCall(app,'/api/friends/f/delivery-consents/marketing','PUT',{state:'granted',reason:'店頭で本人に確認',expectedVersion:0})).status).toBe(200);
 expect((await gapCall(app,'/api/liff/notification-preferences/marketing?lineAccountId=a','PUT',{enabled:false,expectedVersion:1})).status).toBe(200);
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f2','marketing','granted','別人','manual')");
 const r=await gapCall(app,path);expect(r.status).toBe(200);expect(r.headers.get('Cache-Control')).toBe('no-store');
 const data=(await r.json() as any).data;expect(data.total).toBe(2);expect(data.nextCursor).toBeNull();
 expect(data.items[0]).toMatchObject({purpose:'marketing',operation:'update',before:{state:'granted',version:1},after:{state:'revoked',version:2},actor:{kind:'self',id:'f'},reason:'本人がお知らせの受け取りを停止',createdAt:expect.stringMatching(/^\d{4}-/)});
 expect(data.items[1]).toMatchObject({before:null,after:{state:'granted',version:1},actor:{kind:'store',id:'o'},reason:'店頭で本人に確認'});
});
test('目的・カーソルでページ送り、閲覧のみ/代理も読めるが担当外は404',async()=>{
 const app=gapApp(d,[friends]);
 for(let n=0;n<12;n++)d.raw.prepare(`INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f',?,'revoked','確認','manual')`).run('purpose'+n);
 const first=(await (await gapCall(app,path+'?limit=10')).json() as any).data;expect(first.items).toHaveLength(10);expect(first.total).toBe(12);
 const second=(await (await gapCall(app,path+'?limit=10&cursor='+first.nextCursor)).json() as any).data;expect(second.items).toHaveLength(2);expect(second.nextCursor).toBeNull();expect(new Set([...first.items,...second.items].map(x=>x.id)).size).toBe(12);
 expect((await (await gapCall(app,path+'?purpose=purpose1')).json() as any).data.items).toHaveLength(1);
 for(const q of ['limit=999','cursor=-1','cursor=no','purpose=bad!'])expect((await gapCall(app,path+'?'+q)).status).toBe(400);
 for(const [s,im]of [[{...gapOwner,readOnly:true},false],[gapOwner,true]]as const)expect((await gapCall(gapApp(d,[friends],s,im),path)).status).toBe(200);
 d.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('outside','U-out','b')");
 expect((await gapCall(app,'/api/friends/outside/delivery-consents/history')).status).toBe(404);
});
test('削除は前の値を残し、操作者や理由が未記録なら捏造しない',async()=>{
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人希望','manual'); DELETE FROM friend_delivery_consents WHERE friend_id='f'");
 const data=(await (await gapCall(gapApp(d,[friends]),path)).json() as any).data;
 expect(data.items[0]).toMatchObject({operation:'delete',before:{state:'revoked'},after:null,actor:{kind:'unknown',id:null},reason:null});
});
