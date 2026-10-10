import { afterEach, beforeEach, expect, test } from 'vitest';
import { Hono } from 'hono';
import { DEFAULT_TENANT_ID, DEFAULT_ALLERGY_OPTIONS, emptyLayout } from '@line-crm/shared';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite';
import { authMiddleware } from '../middleware/auth';
import { accountSettings } from './account-settings';
import { applyAccountAllergyOptions } from '../services/allergy-options';
import type { Env } from '../index';
let f: SqliteD1, app: Hono<Env>;
beforeEach(()=>{
  f=createTestD1({foreignKeys:true});
  for (const id of ['a','b']) f.raw.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,\'token\',\'secret\',?)').run(id,id,id,DEFAULT_TENANT_ID);
  f.raw.prepare("INSERT INTO staff_members(id,name,role,api_key,tenant_id,account_scope,permission_keys) VALUES('owner','店長','owner','owner-key',?,'all','[]'),('staff','担当','admin','staff-key',?,'accounts','[]'),('viewer','閲覧','staff','viewer-key',?,'all','[]')").run(DEFAULT_TENANT_ID,DEFAULT_TENANT_ID,DEFAULT_TENANT_ID);
  f.raw.exec("INSERT INTO staff_account_scopes(staff_id,line_account_id,created_at) VALUES('staff','a','2026-10-11')");
  app=new Hono<Env>();app.use('*',authMiddleware);app.route('/',accountSettings);
});
afterEach(()=>f.raw.close());
const request=(accountId:string,method='GET',body?:unknown,key='owner-key')=>app.request('/api/account-settings/allergy-options?accountId='+accountId,{method,headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})},{DB:f.db} as Env['Bindings']);
test('店別に保存し、旧い版・担当外・閲覧のみを拒む',async()=>{
  expect(await (await request('a')).json()).toMatchObject({data:{version:0,options:[...DEFAULT_ALLERGY_OPTIONS]}});
  expect((await request('a','PUT',{accountId:'a',expectedVersion:0,options:['卵','キウイ']})).status).toBe(200);
  expect((await request('a','PUT',{accountId:'a',expectedVersion:0,options:['乳']})).status).toBe(409);
  expect(await (await request('b')).json()).toMatchObject({data:{version:0,options:[...DEFAULT_ALLERGY_OPTIONS]}});
  expect((await request('b','PUT',{accountId:'b',expectedVersion:0,options:['乳']},'staff-key')).status).toBe(403);
  expect((await request('a','PUT',{accountId:'a',expectedVersion:1,options:['乳']},'viewer-key')).status).toBe(403);
  expect((await request('a','PUT',{accountId:'a',expectedVersion:1,options:[42]})).status).toBe(422);
});
test('配布先の選択肢を読む。統括の選択肢を写さず、元の型は変えない',async()=>{
  await request('a','PUT',{accountId:'a',expectedVersion:0,options:['キウイ']});
  const layout=emptyLayout();layout.sections[0].blocks=[{id:'a',name:'allergy',label:'アレルギー',kind:'input',type:'checkbox',fixedField:'allergy',choices:[{id:'hq',label:'統括の選択肢'}]}];
  const a=await applyAccountAllergyOptions(f.db,'a',layout), b=await applyAccountAllergyOptions(f.db,'b',layout);
  expect(a.sections[0].blocks[0]).toMatchObject({choices:[{label:'キウイ'},{isOther:true}]});
  expect(b.sections[0].blocks[0]).toMatchObject({choices:expect.arrayContaining([{id:'allergy-0',label:'卵'}])});
  expect(layout.sections[0].blocks[0]).toMatchObject({choices:[{label:'統括の選択肢'}]});
});

