import { Hono } from 'hono';
import { expect,it,vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
vi.mock('../services/account-access.js',()=>({canAccessAllLineAccounts:vi.fn(async(_db,_staff,ids)=>ids.every((id:string)=>id==='a'))}));
import { adEventMappings } from './ad-event-mappings.js';
it('validates manual override, scope, role and concurrent versions',async()=>{
 const{raw,db}=createTestD1();raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','t','s'); INSERT INTO conversion_points(id,name,event_type,line_account_id) VALUES('p','Purchase','purchase','a');`);
 let role:'owner'|'staff'='owner';const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',{id:'s',name:'Staff',role,readOnly:false});await next()});app.route('/',adEventMappings);
 const put=(data:unknown)=>app.request('/api/ad-platforms/mappings/p',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)},{DB:db});
 const input={account_id:'a',provider:'meta',mode:'manual',eventName:'Subscribe',expectedVersion:0};expect((await put(input)).status).toBe(200);expect((await put(input)).status).toBe(409);
 expect((await put({...input,eventName:'bad name'})).status).toBe(422);expect((await put({...input,account_id:'b'})).status).toBe(404);expect((await put({...input,provider:'google',googleActionId:'wrong'})).status).toBe(422);
 role='staff';expect((await put({...input,expectedVersion:1})).status).toBe(403);
 const list=await app.request('/api/ad-platforms/mappings?account_id=a',{}, {DB:db});expect(list.status).toBe(200);expect(await list.json()).toMatchObject({data:expect.arrayContaining([expect.objectContaining({provider:'meta',eventName:'Subscribe'})])});
});
