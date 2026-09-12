import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { hqTemplates } from './hq-templates.js';
// The real pure Web authoring functions feed the real HTTP + SQLite executor.
const webAuthoringPath = '../../../web/src/lib/hq-template-authoring.ts';
const { freshDefinition, withUploadedImage } = await import(/* @vite-ignore */ webAuthoringPath);
type MessageTemplateDefinition = import('../services/hq-templates/template.js').MessageTemplateDefinition;
type RichMenuDefinition = { richMenu: { name: string; pages: { imageR2Key: string }[] } };

let sql: ReturnType<typeof createTestD1>, app: Hono<Env>, staff: any;
let objects: Map<string, any>, bucket: any, workerUrl: string | undefined;
function png(width = 2500, height = 1686) {
  const bytes = new Uint8Array(32); bytes.set([137,80,78,71,13,10,26,10]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes;
}
async function request(path: string, method = 'GET', body?: unknown) {
  const res = await app.request(`https://worker.test/api/hq/templates${path}`, {method, headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined:JSON.stringify(body)}, {DB:sql.db,IMAGES:bucket,WORKER_URL:workerUrl} as Env['Bindings']);
  return {status:res.status,body:await res.json() as any};
}
async function upload(purpose = 'message', bytes = png(), filename = 'test.png') {
  const res = await app.request(`https://worker.test/api/hq/templates/media?purpose=${purpose}&filename=${encodeURIComponent(filename)}`, {method:'POST',headers:{'Content-Type':'image/png'},body:bytes}, {DB:sql.db,IMAGES:bucket,WORKER_URL:workerUrl} as Env['Bindings']);
  return {status:res.status,body:await res.json() as any};
}
async function save(type: string, definition: unknown) {
  const r=await request('','POST',{type,name:'新規ひな形',definition,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data.template.id as string;
}
async function distribute(id: string) {
  const p=await request(`/${id}/preflight`,'POST',{accountIds:['a','b','c']});expect(p.status,JSON.stringify(p.body)).toBe(200);
  const body={preflightId:p.body.data.preflightId,resolutions:p.body.data.stores.flatMap((s:any)=>s.items.map((i:any)=>({accountId:s.accountId,sourceId:i.sourceId,mode:i.duplicate?'overwrite':'create'})))};
  const r=await request(`/${id}/distribute`,'POST',body);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.stores.map((s:any)=>s.status)).toEqual(['succeeded','succeeded','succeeded']);
  return body;
}
beforeEach(()=>{
  workerUrl='https://worker.test';
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','HQ'),('other','Other')");
  for(const id of ['a','b','c']) sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,'fixture','fixture','tenant')").run(id,id,id);
  sql.raw.exec("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','tenant')");
  staff={id:'owner',name:'Owner',role:'owner',tenantId:'tenant',readOnly:false};objects=new Map();
  bucket={head:vi.fn(async(key:string)=>objects.get(key)??null),get:vi.fn(async(key:string,opts:any)=>{const o=objects.get(key);if(!o)return null;if(opts?.onlyIf?.etagMatches&&opts.onlyIf.etagMatches!==o.etag)return o;return {...o,body:new ReadableStream({start(c){c.enqueue(o.bytes.slice());c.close()}}),arrayBuffer:async()=>o.bytes.slice().buffer}}),put:vi.fn(async(key:string,bytes:Uint8Array,options:any)=>{if(objects.has(key))return null;const o={key,bytes:bytes.slice(),size:bytes.length,etag:`e${objects.size}`,customMetadata:options.customMetadata,httpMetadata:options.httpMetadata};objects.set(key,o);return o}),delete:vi.fn(async(key:string)=>{objects.delete(key)})};
  app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqTemplates);
});
afterEach(()=>sql.raw.close());
describe('HQ authoring Web payload to HTTP/SQLite/R2 distribution',()=>{
  test('new text needs no source account template and reaches all three stores',async()=>{
    const value=freshDefinition('template') as MessageTemplateDefinition;(value.template as any).name='ご案内';(value.template as any).messageContent='新しい本文';
    expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:0});
    const id=await save('template',value),body=await distribute(id);
    await request(`/${id}/distribute`,'POST',body);expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:3});expect(bucket.put).not.toHaveBeenCalled();
    await distribute(id);expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:3});
  });
  test('uploaded Web image becomes three independent destination media URLs',async()=>{
    const uploaded=await upload();expect(uploaded.status).toBe(201);
    let value=freshDefinition('template') as MessageTemplateDefinition;(value.template as any).name='画像';(value.template as any).messageType='image';value=withUploadedImage(value,uploaded.body.data);
    const id=await save('template',value);await distribute(id);
    const rows=sql.raw.prepare('SELECT t.message_content,m.r2_key,m.public_url,t.line_account_id FROM templates t JOIN media m ON m.line_account_id=t.line_account_id').all() as any[];
    expect(rows).toHaveLength(3);for(const row of rows){expect(row.r2_key).toMatch(new RegExp(`^media/${row.line_account_id}/hq/`));expect(row.message_content).toBe(row.public_url);expect(objects.get(row.r2_key).bytes).toEqual(png())}
    expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
  });
  test('existing request origin is sufficient without adding a WORKER_URL setting',async()=>{
    workerUrl=undefined;const uploaded=await upload();expect(uploaded.status).toBe(201);
    let value=freshDefinition('template') as MessageTemplateDefinition;(value.template as any).name='画像';(value.template as any).messageType='image';value=withUploadedImage(value,uploaded.body.data);
    await distribute(await save('template',value));
  });
  test('rich menu upload supports actual three-store draft and null LINE ID',async()=>{
    const uploaded=await upload('rich_menu');expect(uploaded.status).toBe(201);
    const value=freshDefinition('rich_menu') as RichMenuDefinition;value.richMenu.name='メニュー';value.richMenu.pages[0].imageR2Key=uploaded.body.data.r2Key;
    await distribute(await save('rich_menu',value));
    const rows=sql.raw.prepare('SELECT g.status,g.account_id,p.image_r2_key,p.line_richmenu_id FROM rich_menu_groups g JOIN rich_menu_pages p ON p.group_id=g.id').all() as any[];
    expect(rows).toHaveLength(3);for(const row of rows){expect(row.status).toBe('draft');expect(row.line_richmenu_id).toBeNull();expect(row.image_r2_key).toMatch(new RegExp(`^rich-menus/${row.account_id}/hq/`))}
  });
  test('lost upload response retries exact immutable receipt and never overwrites',async()=>{
    const put=bucket.put.getMockImplementation();bucket.put.mockImplementationOnce(async(...args:any[])=>{await put(...args);throw new Error('lost response')});
    const first=await upload(),second=await upload();expect(first.status).toBe(201);expect(second).toEqual(first);expect(bucket.put).toHaveBeenCalledOnce();expect(objects.size).toBe(1);
  });
  test('unconfirmed upload leaves no optimistic receipt and a later identical retry recovers',async()=>{
    bucket.put.mockRejectedValueOnce(new Error('connection unavailable'));
    expect((await upload()).status).toBe(422);expect(objects.size).toBe(0);expect(bucket.delete).not.toHaveBeenCalled();
    expect((await upload()).status).toBe(201);expect(objects.size).toBe(1);
  });
  test('same-size source byte corruption is rejected before destination writes',async()=>{
    const uploaded=await upload();let value=freshDefinition('template') as MessageTemplateDefinition;(value.template as any).name='画像';(value.template as any).messageType='image';value=withUploadedImage(value,uploaded.body.data);
    const id=await save('template',value),p=await request(`/${id}/preflight`,'POST',{accountIds:['a']});expect(p.status).toBe(200);
    objects.get(uploaded.body.data.r2Key).bytes=new Uint8Array(32);
    const result=await request(`/${id}/distribute`,'POST',{preflightId:p.body.data.preflightId,resolutions:p.body.data.stores[0].items.map((i:any)=>({accountId:'a',sourceId:i.sourceId,mode:'create'}))});
    expect(result.body.data.stores[0].status).toBe('failed');expect(objects.size).toBe(1);expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:0});
  });
  test.each(['readOnly','accountScoped','foreignTenant','missing'])('upload rejects %s authority before R2',async(mode)=>{
    if(mode==='readOnly')staff.readOnly=true;
    if(mode==='accountScoped')sql.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='owner'");
    if(mode==='foreignTenant')staff.tenantId='other';if(mode==='missing')staff=undefined;
    expect((await upload()).status).toBe(403);expect(bucket.put).not.toHaveBeenCalled();
  });
  test('rejects oversize/malformed image, traversal filename, and wrong rich dimensions',async()=>{
    expect((await upload('message',new Uint8Array(8*1024*1024+1))).status).toBe(422);
    expect((await upload('message',new Uint8Array([1,2,3]))).status).toBe(422);
    expect((await upload('message',png(),'../secret.png')).status).toBe(422);
    expect((await upload('rich_menu',png(10,10))).status).toBe(422);expect(bucket.put).not.toHaveBeenCalled();
  });
  test.each(['tenant','manifest','hash','legacySource'])('forged %s provenance cannot use the new HQ path',async(mode)=>{
    const uploaded=await upload(),media=uploaded.body.data;let value=freshDefinition('template') as MessageTemplateDefinition;(value.template as any).name='画像';(value.template as any).messageType='image';value=withUploadedImage(value,media);
    const o=objects.get(media.r2Key);
    if(mode==='tenant')o.customMetadata.hqTenant='other';if(mode==='manifest')delete o.customMetadata.hqMedia;if(mode==='hash')(value.media[0] as any).contentHash='0'.repeat(64);if(mode==='legacySource')(value.template as any).id='missing-existing-source';
    const id=await save('template',value),p=await request(`/${id}/preflight`,'POST',{accountIds:['a']});expect(p.status).toBe(409);expect(sql.raw.prepare('SELECT count(*) n FROM templates').get()).toEqual({n:0});expect(objects.size).toBe(1);
  });
});
