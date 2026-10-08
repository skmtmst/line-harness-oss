import { Hono } from 'hono';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { lineAccountFolders } from './line-account-folders.js';
import { lineAccountTags } from './line-account-tags.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import type { Env } from '../index.js';

let sql:ReturnType<typeof createTestD1>,staff:any;
async function call(path:string,method='GET',body?:unknown) {
  const app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',lineAccountFolders);app.route('/',lineAccountTags);
  const res=await app.request(path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},{DB:sql.db} as Env['Bindings']);
  return {status:res.status,body:await res.json() as any};
}
async function folder(name='渋谷',displayOrder=0) {
  const res=await call('/api/line-account-folders','POST',{name,color:'#2f6fde',displayOrder});expect(res.status).toBe(201);return res.body.data;
}
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true});staff={id:'owner',name:'Owner',role:'owner',readOnly:false,tenantId:DEFAULT_TENANT_ID};
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES('other','別統括');
    INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES
    ('a','本店','a','test','test','${DEFAULT_TENANT_ID}'),('b','支店','b','test','test','${DEFAULT_TENANT_ID}'),('x','他店','x','test','test','other');`);
});
afterEach(()=>sql.raw.close());
describe('統括のアカウントフォルダ',()=>{
  it('店と同じFolder型でCRUD・色・並び順・件数・未分類を返す',async()=>{
    const f=await folder();await call('/api/line-accounts/a/folder','PUT',{folderId:f.id});
    expect((await call('/api/line-account-folders')).body.data).toMatchObject({total:2,unclassifiedCount:1,folders:[{id:f.id,kind:'line_account',parentId:null,itemCount:1,color:'#2f6fde'}]});
    expect((await call(`/api/line-account-folders/${f.id}`,'PATCH',{name:'イベント',color:'#e07b24',displayOrder:4})).body.data).toMatchObject({name:'イベント',color:'#e07b24',displayOrder:4});
    expect((await folder('テスト',2)).name).toBe('テスト');
    expect((await call('/api/line-account-folders')).body.data.folders.map((f:any)=>f.name)).toEqual(['テスト','イベント']);
    expect((await call('/api/line-account-folders','POST',{name:'テスト'})).status).toBe(409);
    expect((await call(`/api/line-account-folders/${f.id}`,'DELETE')).status).toBe(200);
    expect(sql.raw.prepare("SELECT folder_id FROM line_accounts WHERE id='a'").get()).toEqual({folder_id:null});
    expect(sql.raw.prepare("SELECT COUNT(*) AS n FROM line_accounts").get()).toEqual({n:3});
    expect((await call('/api/line-account-folders')).body.data.unclassifiedCount).toBe(2);
  });
  it('移動は1フォルダだけ、未分類へ戻せ、旧タグAPIにも同じ所属を返す',async()=>{
    const a=await folder(),b=await folder('イベント');
    await call('/api/line-accounts/a/folder','PUT',{folderId:a.id});
    expect((await call('/api/line-accounts/a/folder','PUT',{folderId:b.id})).body.data.folder.id).toBe(b.id);
    expect(sql.raw.prepare("SELECT tag_id FROM line_account_tag_links WHERE line_account_id='a'").all()).toEqual([{tag_id:b.id}]);
    expect((await call('/api/line-accounts/a/folder','PUT',{folderId:null})).body.data.folder).toBeNull();
  });
  it('旧タグAPIからの複数タグ登録は決まった先頭だけをフォルダにする',async()=>{
    const a=await folder('A',3),b=await folder('B',1);
    expect((await call('/api/line-accounts/a/tags','PUT',{tagIds:[a.id,b.id]})).body.data.tags).toHaveLength(2);
    expect(sql.raw.prepare("SELECT folder_id FROM line_accounts WHERE id='a'").get()).toEqual({folder_id:b.id});
  });
  it('608の移行SQLは0・1・複数タグを変換し、旧タグのリンクを残す',async()=>{
    const a=await folder('A',1),b=await folder('B',0);
    for(const [account,tag] of [['a',a.id],['a',b.id],['b',a.id]]) sql.raw.prepare('INSERT INTO line_account_tag_links(line_account_id,tag_id,tenant_id) VALUES(?,?,?)').run(account,tag,DEFAULT_TENANT_ID);
    const migration=readFileSync(new URL('../../../../packages/db/migrations/608_line_account_folders.sql',import.meta.url),'utf8');
    sql.raw.exec(migration.slice(migration.indexOf('UPDATE line_accounts'),migration.indexOf('CREATE TRIGGER')));
    expect(sql.raw.prepare('SELECT id,folder_id FROM line_accounts ORDER BY id').all()).toEqual([{id:'a',folder_id:b.id},{id:'b',folder_id:a.id},{id:'x',folder_id:null}]);
    expect(sql.raw.prepare('SELECT COUNT(*) AS n FROM line_account_tag_links').get()).toEqual({n:3});
  });
  it('閲覧のみは件数を読めるが変更できず、スタッフも変更できない',async()=>{
    const f=await folder();staff.readOnly=true;
    expect((await call('/api/line-account-folders')).status).toBe(200);
    for(const role of ['owner','admin','staff']) {
      staff.role=role;
      for(const [path,method,body] of [['/api/line-account-folders','POST',{name:'追加'}],[`/api/line-account-folders/${f.id}`,'PATCH',{color:null}],[`/api/line-account-folders/${f.id}`,'DELETE',undefined],['/api/line-accounts/a/folder','PUT',{folderId:f.id}]] as const) expect((await call(path,method,body)).status).toBe(403);
    }
  });
  it('統括違い・不正ID・複数指定・アーカイブ済みは変更しない',async()=>{
    const f=await folder();
    expect((await call('/api/line-accounts/x/folder','PUT',{folderId:f.id})).status).toBe(404);
    for(const body of [{folderId:'missing'},{folderId:[f.id]},{folderId:4},{}]) expect((await call('/api/line-accounts/a/folder','PUT',body)).status).toBe(400);
    expect(()=>sql.raw.prepare("UPDATE line_accounts SET folder_id=? WHERE id='x'").run(f.id)).toThrow('ACCOUNT_FOLDER_SCOPE_INVALID');
    sql.raw.exec("UPDATE line_accounts SET archived_at='2026-10-08' WHERE id='a'");
    expect((await call('/api/line-accounts/a/folder','PUT',{folderId:f.id})).status).toBe(409);
    expect((await call('/api/line-account-folders')).body.data.total).toBe(1);
  });
});
