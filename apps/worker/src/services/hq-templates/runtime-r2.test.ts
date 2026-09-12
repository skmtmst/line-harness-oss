import { afterEach, describe, expect, test, vi } from 'vitest';
import { createTestD1 } from '../../test-utils/d1-sqlite.js';
import { inspectR2RuntimeStore, executeR2RuntimeStore, type R2RuntimeBinding } from './runtime-r2.js';
import type { HqTemplateAdapterContext, HqTemplateAuthority } from './contract.js';
const resources:ReturnType<typeof createTestD1>[]=[];
afterEach(()=>{for(const f of resources.splice(0))f.raw.close()});
const digest=async(v:string|Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof v==='string'?new TextEncoder().encode(v):v)),n=>n.toString(16).padStart(2,'0')).join('');
const authority:HqTemplateAuthority={tenantId:'tenant',actorId:'owner',role:'owner',readOnly:false,accountScoped:false};
async function fixture(type:'template'|'rich_menu'='rich_menu') {
  const sql=createTestD1({foreignKeys:true});resources.push(sql);
  sql.raw.exec("INSERT INTO tenants(id,name) VALUES ('tenant','Tenant'),('other','Other')");
  for(const id of ['source','a','b','c','foreign'])sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id,liff_id) VALUES (?,?,?,'fixture','fixture',?,?)").run(id,id,id,id==='foreign'?'other':'tenant',`liff-${id}`);
  const bytes=new Uint8Array([1,2,3]),contentHash=await digest(bytes);
  const objects=new Map<string,{bytes:Uint8Array;etag:string;size:number;httpMetadata:{contentType:string};customMetadata?:Record<string,string>}>();
  for(const n of [1,2])objects.set(`hq-templates/tenant/image${n}`,{bytes,etag:`source-${n}`,size:3,httpMetadata:{contentType:'image/png'}});
  let putNo=0;
  const bucket={
    head:vi.fn(async(key:string)=>objects.get(key)??null),
    get:vi.fn(async(key:string,options?:R2GetOptions)=>{const o=objects.get(key);if(!o)return null;if((options?.onlyIf as R2Conditional)?.etagMatches!==o.etag)return o;return {...o,body:new ReadableStream<Uint8Array>({start(c){c.enqueue(o.bytes.slice());c.close()}}),arrayBuffer:async()=>o.bytes.slice().buffer}}),
    put:vi.fn(async(key:string,data:Uint8Array,options:R2PutOptions)=>{putNo++;if(objects.has(key))return null;const o={bytes:data.slice(),size:data.length,etag:`put-${putNo}`,httpMetadata:options.httpMetadata as {contentType:string},customMetadata:options.customMetadata};objects.set(key,o);return o}),
    delete:vi.fn(async(key:string)=>{objects.delete(key)}),
  };
  const rich={schemaVersion:1,richMenu:{id:'menu',name:'Menu',chatBarText:'Open',size:'large',defaultPageId:'p1',pages:[1,2].map(n=>({id:`p${n}`,name:`Page ${n}`,imageR2Key:`hq-templates/tenant/image${n}`,areas:[{id:`a${n}`,bounds:{x:0,y:0,width:100,height:100},actionType:'message',actionData:{text:'Hello'},intent:'text'}]}))}};
  const message={schemaVersion:1,template:{id:'source-template',name:'Message',category:'general',messageType:'image',messageContent:'hq-templates/tenant/image1',carouselActionsJson:null,carouselTapLimitMode:'none',carouselTapLimitText:null,questionJson:null,questionStatus:'draft'},media:[{id:'source-media',kind:'image',filename:'image.png',mimeType:'image/png',sizeBytes:3,width:null,height:null,durationMs:null,r2Key:'hq-templates/tenant/image1',publicUrl:null,versionId:'media-v1',versionNo:1,contentHash}]};
  sql.raw.exec("INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES ('source-template','Source','text','fixture','source');INSERT INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,r2_key) VALUES ('source-media','source','image','image.png','image/png',3,'media/source/original')");
  sql.raw.prepare("INSERT INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes,content_hash,scan_status) VALUES ('media-v1','source-media',1,'media/source/original','image/png',3,?,'verified')").run(contentHash);
  const json=JSON.stringify(type==='template'?message:rich);
  sql.raw.prepare('INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES (?,?,?,?)').run('hq','tenant',type,'HQ');
  sql.raw.prepare("INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES ('v','tenant','hq',1,?,?)").run(json,await digest(json));
  const binding:R2RuntimeBinding={db:sql.db,bucket:bucket as unknown as R2Bucket,authority,templateId:'hq',templateVersionId:'v',publicBaseUrl:'https://example.invalid'};
  async function preflight(account='a',mode:'create'|'overwrite'|'alias'='create'){
    const info=await inspectR2RuntimeStore(binding,account),id=`preflight-${account}`;
    sql.raw.prepare("INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status,created_by,expires_at) VALUES (?,'tenant','hq','v',?,?,'run',?,'ready','owner','2099-01-01T00:00:00Z')").run(id,account,mode,info.snapshotToken);
    for(const item of info.items)sql.raw.prepare("INSERT INTO hq_template_preflight_resolutions(preflight_id,tenant_id,template_id,template_version_id,target_account_id,idempotency_fingerprint,snapshot_token,source_id,item_kind,resolution_mode,target_id,expected_revision) VALUES (?,'tenant','hq','v',?,'run',?,?,?,'create',?,?)").run(id,account,info.snapshotToken,item.sourceId,item.itemKind,item.targetId,item.expectedRevision);
    const context:HqTemplateAdapterContext={tenantId:'tenant',targetAccountId:account,preflightId:id,idempotencyFingerprint:'run',snapshotToken:info.snapshotToken,mode,resolutions:info.items.map(item=>({sourceId:item.sourceId,itemKind:item.itemKind,mode:item.duplicate?mode:'create'}))};return context;
  }
  const execute=(context:HqTemplateAdapterContext,db=sql.db)=>executeR2RuntimeStore({...binding,db,runId:'run',context});
  return {...sql,binding,bucket,objects,preflight,execute,rich,message};
}
describe('DB-bound R2 store executor',()=>{
  test('three stores get independent draft rich menus and committed owned objects',async()=>{
    const f=await fixture();for(const a of ['a','b','c'])expect((await f.execute(await f.preflight(a))).status).toBe('succeeded');
    expect(f.raw.prepare("SELECT COUNT(*) n FROM rich_menu_groups WHERE status='draft'").get()).toEqual({n:3});
    const rows=f.raw.prepare('SELECT p.image_r2_key,p.line_richmenu_id,g.account_id FROM rich_menu_pages p JOIN rich_menu_groups g ON g.id=p.group_id').all()as any[];
    expect(rows).toHaveLength(6);expect(rows.every(r=>r.line_richmenu_id===null&&r.image_r2_key.startsWith(`rich-menus/${r.account_id}/hq/`))).toBe(true);
    expect(f.raw.prepare("SELECT COUNT(*) n FROM hq_template_owned_r2_keys WHERE state='committed'").get()).toEqual({n:6});expect(f.bucket.delete).not.toHaveBeenCalled();expect(f.raw.pragma('foreign_key_check')).toEqual([]);
  });
  test('message copies actual image into destination media and rewrites exact locator',async()=>{
    const f=await fixture('template'),c=await f.preflight();expect((await f.execute(c)).status).toBe('succeeded');
    const t=f.raw.prepare("SELECT message_content FROM templates WHERE line_account_id='a'").get()as any,m=f.raw.prepare("SELECT id,r2_key FROM media WHERE line_account_id='a'").get()as any;
    expect(m.r2_key.startsWith('media/a/hq/')).toBe(true);expect(t.message_content).toBe(m.r2_key);expect(f.objects.get(m.r2_key)?.bytes).toEqual(new Uint8Array([1,2,3]));expect((await f.execute(c)).reused).toBe(true);expect(f.bucket.put).toHaveBeenCalledTimes(1);
  });
  test('simultaneous submissions and completed replay cannot duplicate execution',async()=>{
    const f=await fixture(),c=await f.preflight();const r=await Promise.all([f.execute(c),f.execute(c)]);expect(r.some(x=>x.status==='succeeded')).toBe(true);expect(f.bucket.put).toHaveBeenCalledTimes(2);expect((await f.execute(c)).status).toBe('succeeded');expect(f.bucket.put).toHaveBeenCalledTimes(2);
  });
  test('lost successful DB response preserves images and recovers committed result',async()=>{
    const f=await fixture(),c=await f.preflight();const db={prepare:f.db.prepare.bind(f.db),batch:async(s:D1PreparedStatement[])=>{await f.db.batch(s);throw new Error('lost response')}}as unknown as D1Database;
    expect((await f.execute(c,db)).status).toBe('succeeded');expect(f.bucket.delete).not.toHaveBeenCalled();expect(f.raw.prepare("SELECT COUNT(*) n FROM hq_template_owned_r2_keys WHERE state='committed'").get()).toEqual({n:2});
  });
  test('unknown DB failure retains staged images and cannot replay batch',async()=>{
    const f=await fixture(),c=await f.preflight();f.raw.exec("CREATE TRIGGER reject_menu BEFORE INSERT ON rich_menu_groups BEGIN SELECT RAISE(ABORT,'fixture'); END");
    expect(await f.execute(c)).toMatchObject({status:'staged',cleanupPending:true});expect(f.bucket.delete).not.toHaveBeenCalled();expect(f.raw.prepare('SELECT COUNT(*) n FROM rich_menu_groups').get()).toEqual({n:0});expect(f.raw.prepare("SELECT COUNT(*) n FROM hq_template_owned_r2_keys WHERE state='staged'").get()).toEqual({n:2});
    f.raw.exec('DROP TRIGGER reject_menu');expect((await f.execute(c)).status).toBe('staged');expect(f.bucket.put).toHaveBeenCalledTimes(2);
  });
  test('unknown PUT keeps ownership record and never deletes pending data',async()=>{
    const f=await fixture(),c=await f.preflight(),put=f.bucket.put.getMockImplementation()!;f.bucket.put.mockImplementationOnce(async(...args)=>{await put(...args);throw new Error('lost PUT response')});
    expect(await f.execute(c)).toMatchObject({status:'staged',cleanupPending:true});expect(f.bucket.delete).not.toHaveBeenCalled();expect(f.raw.prepare("SELECT COUNT(*) n FROM hq_template_owned_r2_keys WHERE state='staged'").get()).toEqual({n:1});
  });
  test('definite owner conflict cleans only this attempt earlier objects',async()=>{
    const f=await fixture(),c=await f.preflight(),put=f.bucket.put.getMockImplementation()!;let calls=0,foreignKey='';
    f.bucket.put.mockImplementation(async(key,data,opts)=>{if(++calls===2){foreignKey=key;f.objects.set(key,{bytes:data,etag:'other',size:data.length,httpMetadata:{contentType:'image/png'},customMetadata:{ownerToken:'other',contentHash:'other'}});return null}return put(key,data,opts)});
    expect(await f.execute(c)).toMatchObject({status:'failed',cleanupPending:true});expect(f.objects.has(foreignKey)).toBe(true);expect(f.bucket.delete).toHaveBeenCalledTimes(1);expect(f.bucket.delete).not.toHaveBeenCalledWith(foreignKey);expect(f.raw.prepare('SELECT COUNT(*) n FROM rich_menu_groups').get()).toEqual({n:0});
  });
  test('foreign source account or prefix fails before any image writes',async()=>{
    const f=await fixture('template');f.raw.exec("UPDATE templates SET line_account_id='foreign' WHERE id='source-template'");await expect(f.preflight()).rejects.toMatchObject({code:'SOURCE_ACCOUNT_UNAVAILABLE'});expect(f.bucket.put).not.toHaveBeenCalled();
    const g=await fixture();g.rich.richMenu.pages[0].imageR2Key='hq-templates/other/image1';const json=JSON.stringify(g.rich);g.raw.prepare("UPDATE hq_template_versions SET definition_json=?,content_hash=? WHERE id='v'").run(json,await digest(json));await expect(g.preflight()).rejects.toThrow('IMAGE_SCOPE_MISMATCH');expect(g.bucket.put).not.toHaveBeenCalled();
  });
  test('published overwrite rejected without writing images',async()=>{
    const f=await fixture();f.raw.exec("INSERT INTO rich_menu_groups(id,account_id,name,chat_bar_text,size,status) VALUES ('existing','a','Menu','Open','large','published')");expect((await f.execute(await f.preflight('a','overwrite'))).status).toBe('failed');expect(f.bucket.put).not.toHaveBeenCalled();expect(f.raw.prepare("SELECT status FROM rich_menu_groups WHERE id='existing'").get()).toEqual({status:'published'});
  });
  test('actual source hash is checked even when byte count is unchanged',async()=>{
    const f=await fixture('template'),c=await f.preflight();f.objects.get('hq-templates/tenant/image1')!.bytes=new Uint8Array([9,9,9]);expect((await f.execute(c)).status).toBe('failed');expect(f.bucket.put).not.toHaveBeenCalled();
  });
  test('actual stream overflow is stopped before writing copied images',async()=>{
    const f=await fixture(),c=await f.preflight();
    f.bucket.get.mockImplementation(async(key)=>{const o=f.objects.get(key)!;return {...o,body:new ReadableStream<Uint8Array>({start(c){c.enqueue(new Uint8Array(4));c.close()}}),arrayBuffer:async()=>new Uint8Array(4).buffer}});
    expect((await f.execute(c)).status).toBe('failed');expect(f.bucket.put).not.toHaveBeenCalled();
  });
  test('rich references reuse only exact destination same-name resources',async()=>{
    const f=await fixture();
    f.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES ('source-tag','ＶＩＰ','source'),('local-tag','vip','a'),('foreign-tag','vip','foreign')");
    (f.rich.richMenu.pages[0].areas[0] as unknown as Record<string,unknown>).tagIds=['source-tag'];
    const json=JSON.stringify(f.rich);f.raw.prepare("UPDATE hq_template_versions SET definition_json=?,content_hash=? WHERE id='v'").run(json,await digest(json));
    expect((await f.execute(await f.preflight())).status).toBe('succeeded');
    expect(f.raw.prepare("SELECT tag_ids FROM rich_menu_areas WHERE tag_ids<>'[]' AND tag_ids IS NOT NULL").get()).toEqual({tag_ids:'["local-tag"]'});
  });
  test('scenario reference remains unsupported and makes no network or image writes',async()=>{
    const f=await fixture();(f.rich.richMenu.pages[0].areas[0] as unknown as Record<string,unknown>).scenarioId='source-scenario';
    const json=JSON.stringify(f.rich);f.raw.prepare("UPDATE hq_template_versions SET definition_json=?,content_hash=? WHERE id='v'").run(json,await digest(json));
    await expect(f.preflight()).rejects.toThrow();expect(f.bucket.put).not.toHaveBeenCalled();
  });

});
