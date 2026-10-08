import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import type { Env } from '../index.js';
import { getMediaDeleteImpactSnapshot, getMediaReplacementPlan } from '@line-crm/db';
import { scanSingleMediaUsage, scanMediaUsage } from '../services/media-usage-scan.js';
import { images } from './images.js';
import { hqTemplates } from './hq-templates.js';
// The real pure Web authoring functions feed the real HTTP + SQLite executor.
const webAuthoringPath = '../../../web/src/lib/hq-template-authoring.ts';
const { freshDefinition } = await import(/* @vite-ignore */ webAuthoringPath);

let sql: ReturnType<typeof createTestD1>, app: Hono<Env>, staff: any;
let objects: Map<string, any>, bucket: any, workerUrl: string | undefined;
let cfImages:any;
function png(width = 2500, height = 1686) {
  const bytes = new Uint8Array(32); bytes.set([137,80,78,71,13,10,26,10]);
  new DataView(bytes.buffer).setUint32(16, width); new DataView(bytes.buffer).setUint32(20, height); return bytes;
}
async function request(path: string, method = 'GET', body?: unknown) {
  const res = await app.request(`https://worker.test/api/hq/templates${path}`, {method, headers:{'Content-Type':'application/json'}, body:body === undefined ? undefined:JSON.stringify(body)}, {DB:sql.db,IMAGES:bucket,WORKER_URL:workerUrl,CF_IMAGES:cfImages} as Env['Bindings']);
  return {status:res.status,body:await res.json() as any};
}
async function upload(purpose = 'message', bytes = png(), filename = 'test.png', expected?: { width: number; height: number }) {
  const size = expected ? `&width=${expected.width}&height=${expected.height}` : '';
  const res = await app.request(`https://worker.test/api/hq/templates/media?purpose=${purpose}&filename=${encodeURIComponent(filename)}${size}`, {method:'POST',headers:{'Content-Type':'image/png'},body:bytes}, {DB:sql.db,IMAGES:bucket,WORKER_URL:workerUrl,CF_IMAGES:cfImages} as Env['Bindings']);
  return {status:res.status,body:await res.json() as any};
}
async function save(type: string, definition: unknown) {
  const r=await request('','POST',{type,name:'新規ひな形',definition,requestId:crypto.randomUUID()});expect(r.status,JSON.stringify(r.body)).toBe(201);return r.body.data.template.id as string;
}
async function checkCopiedImagesRemainUsed() {
  const media = sql.raw.prepare('SELECT id,r2_key,line_account_id FROM media').all() as any[];
  for (const item of media) {
    const delivered = await app.request(`https://worker.test/images/${item.r2_key}`, {}, {DB:sql.db,IMAGES:bucket} as Env['Bindings']);
    expect(delivered.status).toBe(200);
    expect(delivered.headers.get('content-type')).toBe('image/png');
    expect((await delivered.arrayBuffer()).byteLength).toBeGreaterThan(0);
    const scan = await scanSingleMediaUsage(sql.db, '2026-10-08T02:00:00.000Z', item);
    expect(scan.matched).toBeGreaterThan(0);
    const impact = await getMediaDeleteImpactSnapshot(sql.db, item.id, item.line_account_id, 'now');
    expect(impact?.impact.canDelete).toBe(false);
    expect(impact?.impact.references.every(reference => reference.state === 'available')).toBe(true);
  }
  // 定期点検でも全サイズの使用先を保つ。
  await scanMediaUsage(sql.db, '2026-10-08T02:00:01.000Z');
  expect(sql.raw.prepare('SELECT COUNT(*) AS n FROM media_usages').get()).toEqual({n:media.length});
}
async function distribute(id: string) {
  const p=await request(`/${id}/preflight`,'POST',{accountIds:['a','b','c']});expect(p.status,JSON.stringify(p.body)).toBe(200);
  const body={preflightId:p.body.data.preflightId,resolutions:p.body.data.stores.flatMap((s:any)=>s.items.map((i:any)=>({accountId:s.accountId,sourceId:i.sourceId,mode:i.duplicate?'overwrite':'create'})))};
  const r=await request(`/${id}/distribute`,'POST',body);expect(r.status,JSON.stringify(r.body)).toBe(200);expect(r.body.data.stores.map((s:any)=>s.status),JSON.stringify(r.body)).toEqual(['succeeded','succeeded','succeeded']);
  expect(r.body.data.stores.every((s:any)=>typeof s.createdName==='string')).toBe(true);
  return body;
}
beforeEach(()=>{
  workerUrl='https://worker.test';
  sql=createTestD1({foreignKeys:true});sql.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','HQ'),('other','Other')");
  for(const id of ['a','b','c']) sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES(?,?,?,'fixture','fixture','tenant')").run(id,id,id);
  sql.raw.exec("INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','fixture','tenant')");
  staff={id:'owner',name:'Owner',role:'owner',tenantId:'tenant',readOnly:false};objects=new Map();
  bucket={head:vi.fn(async(key:string)=>objects.get(key)??null),get:vi.fn(async(key:string,opts:any)=>{const o=objects.get(key);if(!o)return null;if(opts?.onlyIf?.etagMatches&&opts.onlyIf.etagMatches!==o.etag)return o;return {...o,body:new ReadableStream({start(c){c.enqueue(o.bytes.slice());c.close()}}),arrayBuffer:async()=>o.bytes.slice().buffer}}),put:vi.fn(async(key:string,bytes:Uint8Array,options:any)=>{if(objects.has(key))return null;const o={key,bytes:bytes.slice(),size:bytes.length,etag:`e${objects.size}`,customMetadata:options.customMetadata,httpMetadata:options.httpMetadata};objects.set(key,o);return o}),delete:vi.fn(async(key:string)=>{objects.delete(key)})};
  app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqTemplates);app.route('/',images);
});
afterEach(()=>sql.raw.close());

function value(kind:string,media:any[]=[]) {
  const base=freshDefinition('template') as any;base.template.name=`種類-${kind}`;base.template.messageContent=kind==='message'?'案内':'';base.media=media;
  if(kind==='question') base.template.questionJson=JSON.stringify({text:'どれ？',tapMode:'single',choices:Array.from({length:4},(_,i)=>({label:`選択${i}`,behavior:'none'}))});
  if(kind==='carousel') base.asset={kind:'card_message',payload:{cards:Array.from({length:3},(_,i)=>({title:`カード${i}`,description:'本文',actionUrl:'https://shop.test',...(media.length?{imageUrl:media[0].publicUrl}:{})}))}};
  if(kind==='coupon') base.asset={kind,payload:{description:'割引',startsAt:'2026-10-01',endsAt:'2026-10-31',imageUrl:media[0]?.publicUrl}};
  if(kind==='research') base.asset={kind,payload:{description:'調査',questions:Array.from({length:5},()=>({text:'どうでしたか',format:'single',required:true,choices:['良い','悪い']}))}};
  return base;
}
describe('統括テンプレート6種類の保存と店への配布',()=>{
  test.each(['message','carousel','question','coupon','research'])('%sを保存して同じ店の種類に配る',async kind=>{
    const media=kind==='carousel'||kind==='coupon' ? [(await upload('message')).body.data] : [];
    const definition=value(kind,media),id=await save('template',definition);
    const list=await request(`?kind=${kind}`);expect(list.body.data).toHaveLength(1);expect(list.body.data[0].kind).toBe(kind);
    expect(list.body.kind_counts[kind]).toBe(1);expect((await request('/kind-counts')).body.data[kind]).toBe(1);
    expect(list.body.data[0].content_summary).toBe(({message:'本文',carousel:'カード 3枚',question:'選択肢 4',coupon:'期限 10/31',research:'質問 5'} as any)[kind]);
    const body=await distribute(id);await request(`/${id}/distribute`,'POST',body);
    const assets=sql.raw.prepare('SELECT * FROM broadcast_message_assets ORDER BY line_account_id').all() as any[];
    const templates=sql.raw.prepare('SELECT * FROM templates ORDER BY line_account_id').all() as any[];
    if(['carousel','coupon','research'].includes(kind)) {
      expect(assets).toHaveLength(3);expect(templates).toHaveLength(0);
      for(const row of assets) {
        expect(row.kind).toBe(kind==='carousel'?'card_message':kind);expect(row.published_version).toBe(1);
        const payload=JSON.parse(row.payload_json);expect(payload.assetId).toBe(row.id);
        const url=kind==='carousel'?payload.cards[0].imageUrl:payload.imageUrl;
        if(url){expect(url).toContain(`/media/${row.line_account_id}/`);expect(objects.has(new URL(url).pathname.slice('/images/'.length))).toBe(true);}
        expect(sql.raw.prepare('SELECT COUNT(*) AS n FROM broadcast_asset_versions WHERE asset_id=?').get(row.id)).toEqual({n:1});
      }
      if (media.length) await checkCopiedImagesRemainUsed();
    } else {
      expect(templates).toHaveLength(3);expect(assets).toHaveLength(0);
      for(const row of templates) expect(Boolean(row.question_json)).toBe(kind==='question');
    }
  });
  test('リッチメッセージの5サイズを統括で生成し、店へコピーして面数を返す',async()=>{
    cfImages={input:()=>({transform:({width,height}:any)=>({output:async()=>({image:()=>new Blob([png(width,height)]).stream()})})})};
    const uploaded=await upload('rich_message',png(1040,1040));expect(uploaded.status,JSON.stringify(uploaded.body)).toBe(201);
    expect(uploaded.body.data.media).toHaveLength(5);
    const definition=value('rich_message',uploaded.body.data.media);definition.asset={kind:'rich_message',payload:{...uploaded.body.data.payload,tapAreas:Array.from({length:6},(_,i)=>({x:i*15,y:0,width:15,height:100,actionType:'uri',uri:'https://shop.test'}))}};
    const id=await save('template',definition);expect((await request('?kind=rich_message')).body.data[0].content_summary).toBe('画像・面 6');
    await distribute(id);
    const rows=sql.raw.prepare('SELECT * FROM broadcast_message_assets ORDER BY line_account_id').all() as any[];
    expect(rows).toHaveLength(3);
    for(const row of rows){const payload=JSON.parse(row.payload_json);for(const width of [240,300,460,700,1040]) expect(objects.has(new URL(`${payload.baseUrl}/${width}`).pathname.slice('/images/'.length))).toBe(true);expect(payload.baseUrl).toContain(`/media/${row.line_account_id}/`);}
    expect(sql.raw.prepare('SELECT COUNT(*) AS n FROM imagemap_images').get()).toEqual({n:15});
    await checkCopiedImagesRemainUsed();
    const copies = sql.raw.prepare("SELECT id FROM media WHERE line_account_id='a' ORDER BY id").all() as any[];
    const replacement = await getMediaReplacementPlan(sql.db, {sourceId:copies[0].id,replacementId:copies[1].id,lineAccountId:'a',checkedAt:'now'});
    expect(replacement?.impact.canReplace).toBe(false);
    expect(replacement?.impact.blockers).toContain('unsupported_reference');
  });
  test('質問のタグ参照を配布先のIDに直し、他統括の参照を拒否する',async()=>{
    sql.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES('source-tag','会員','a')");
    const definition=value('question');const q=JSON.parse(definition.template.questionJson);q.choices[0].addTagIds=['source-tag'];definition.template.questionJson=JSON.stringify(q);
    const id=await save('template',definition);await distribute(id);
    for(const row of sql.raw.prepare('SELECT line_account_id,question_json FROM templates').all() as any[]) {
      const tag=sql.raw.prepare("SELECT id FROM tags WHERE line_account_id=? AND name='会員'").get(row.line_account_id) as any;
      expect(JSON.parse(row.question_json).choices[0].addTagIds).toEqual([tag.id]);
    }
    sql.raw.exec("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES('other-account','Other','other','test','test','other'); INSERT INTO tags(id,name,line_account_id) VALUES('other-tag','機密','other-account')");
    q.choices[0].addTagIds=['other-tag'];definition.template.questionJson=JSON.stringify(q);
    const foreign=await save('template',definition);expect((await request(`/${foreign}/preflight`,'POST',{accountIds:['b']})).status).toBeGreaterThanOrEqual(400);
  });
  test('質問の友だち情報欄を配布先に複製し、値の保存先を配布先のIDに直す',async()=>{
    sql.raw.exec("INSERT INTO friend_fields(id,name,field_key,type) VALUES('field-source','好きな色','favorite_color','text'); INSERT INTO friend_field_scopes(field_id,tenant_id,line_account_id,created_at) VALUES('field-source','tenant','a','now')");
    const definition=value('question'),q=JSON.parse(definition.template.questionJson);q.choices[0].field={fieldId:'field-source',value:'青'};definition.template.questionJson=JSON.stringify(q);
    const id=await save('template',definition);await distribute(id);
    for(const row of sql.raw.prepare('SELECT line_account_id,question_json FROM templates').all() as any[]) {
      const fieldId=JSON.parse(row.question_json).choices[0].field.fieldId;
      expect(sql.raw.prepare('SELECT line_account_id FROM friend_field_scopes WHERE field_id=?').get(fieldId)).toEqual({line_account_id:row.line_account_id});
      expect(sql.raw.prepare('SELECT name,type FROM friend_fields WHERE id=?').get(fieldId)).toEqual({name:'好きな色',type:'text'});
    }
  });
  test('同名素材への上書きと別名配布、配布直前の更新を守る',async()=>{
    const first=await save('template',value('research'));await distribute(first);
    const second=await save('template',value('research'));const p=await request(`/${second}/preflight`,'POST',{accountIds:['b']});
    expect(p.body.data.stores[0].items[0].allowedModes).toEqual(['overwrite','alias']);
    const selected={preflightId:p.body.data.preflightId,resolutions:p.body.data.stores[0].items.map((i:any)=>({accountId:'b',sourceId:i.sourceId,mode:'alias'}))};
    expect((await request(`/${second}/distribute`,'POST',selected)).body.data.stores[0].status).toBe('succeeded');
    expect(sql.raw.prepare("SELECT name FROM broadcast_message_assets WHERE line_account_id='b' ORDER BY name").all()).toEqual([{name:'種類-research'},{name:'種類-research (2)'}]);
    const preflight=await request(`/${second}/preflight`,'POST',{accountIds:['c']});
    sql.raw.exec("UPDATE broadcast_message_assets SET updated_at='changed' WHERE line_account_id='c'");
    expect((await request(`/${second}/distribute`,'POST',{preflightId:preflight.body.data.preflightId,resolutions:preflight.body.data.stores[0].items.map((i:any)=>({accountId:'c',sourceId:i.sourceId,mode:'overwrite'}))})).body.data.stores[0].status).toBe('version_conflict');
  });
  test('種類で絞っても他のタブの件数を返し、編集した最新版の要約を使う', async () => {
    await save('template', value('message'));
    const research = await save('template', value('research'));
    await save('template', value('research'));
    await save('template', value('coupon'));
    const filtered = await request('?kind=message');
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.kind_counts).toEqual({message:1,carousel:0,rich_message:0,question:0,coupon:1,research:2});
    expect((await request('/kind-counts')).body.data).toEqual(filtered.body.kind_counts);
    expect((await request('?type=rich_menu&kind=message')).status).toBe(400);
    const definition = value('research');
    definition.asset.payload.questions = definition.asset.payload.questions.slice(0, 2);
    const detail = await request(`/${research}`);
    expect((await request(`/${research}`, 'PATCH', {name:'編集後',definition,expectedRevision:detail.body.data.template.revision})).status).toBe(200);
    expect((await request('?kind=research')).body.data.find((row:any) => row.id===research).content_summary).toBe('質問 2');
  });
  test('壊れた種類・質問・画像なしイメージマップ・リサーチを保存しない',async()=>{
    expect((await request('?kind=unknown')).status).toBe(400);
    for(const definition of [ {...value('message'),asset:{kind:'unknown',payload:{}}}, {...value('question'),template:{...value('question').template,questionJson:'{}'}}, {...value('message'),asset:{kind:'rich_message',payload:{imageUrl:'https://x/image',baseUrl:'https://x/image',baseSize:{width:1040,height:1040}}}}, {...value('research'),asset:{kind:'research',payload:{description:'調査',questions:[]}}} ]) expect((await request('','POST',{type:'template',name:'不正',definition,requestId:crypto.randomUUID()})).status).toBe(400);
    expect(sql.raw.prepare('SELECT COUNT(*) AS n FROM hq_templates').get()).toEqual({n:0});
  });
});
