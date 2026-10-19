import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { emptyLayout } from '@line-crm/shared';
import type { Env } from '../worker-env.js';
import { createTestD1, insertFriend, type SqliteD1 } from '../test-utils/d1-sqlite.js';
vi.mock('../services/liff-auth.js',()=>({verifyCallerLineIdentity:vi.fn(async()=>({lineUserId:'Uf',lineAccountId:'a'}))}));
const {forms}=await import('./forms.js');
let fixture:SqliteD1;
beforeEach(()=>{
 fixture=createTestD1();insertFriend(fixture.raw,'f',{line_account_id:'a',metadata:'{"keep":"既存"}'});
 fixture.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret) VALUES('a','人工','a','fake','fake')").run();
 const layout=emptyLayout();layout.sections[0].blocks=['left','right'].map(name=>({id:name,name,kind:'input',type:'text',label:name}));
 fixture.raw.prepare('INSERT INTO forms(id,name,layout) VALUES(?,?,?)').run('form','人工',JSON.stringify(layout));
 fixture.raw.prepare("INSERT INTO form_accounts(form_id,line_account_id) VALUES('form','a')").run();
 vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('real transport forbidden')}));
});
afterEach(()=>{fixture.raw.close();vi.unstubAllGlobals()});
test('CS-C01: 同じ旧情報を読んだ2つの下書き更新が別項目を消さない',async()=>{
 const app=new Hono<Env>();app.route('/',forms);
 const post=(data:unknown)=>app.request('/api/forms/form/partial',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer fake'},body:JSON.stringify({data})},{DB:fixture.db} as Env['Bindings']);
 const results=await Promise.all([post({left:'A'}),post({right:'B'})]);
 expect(results.map(r=>r.status)).toEqual([200,200]);
 const row=fixture.raw.prepare("SELECT metadata FROM friends WHERE id='f'").get() as {metadata:string};
 expect(JSON.parse(row.metadata)).toEqual({keep:'既存',left:'A',right:'B'});
});
