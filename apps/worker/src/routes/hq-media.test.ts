import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { installHqStreamPrimitives } from '../test-utils/hq-media-stream.js';
import { hqTemplates } from './hq-templates.js';
import { images } from './images.js';
import { resolveHqBroadcastMaterials } from '../services/hq-broadcast-materials.js';
import { parseBroadcastMessageParts, buildMessages } from '../services/broadcast-message-set.js';
import { readHqMp4Metadata } from '../services/hq-mp4-metadata.js';
import type { HqBroadcastInput } from '@line-crm/shared';
import { hqBroadcasts } from './hq-broadcasts.js';
vi.mock('../services/feature-enforcement.js',()=>({featureJobCanRun:vi.fn(async()=>true)}));

function concat(...parts: Uint8Array[]) { const b=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let o=0;for(const p of parts){b.set(p,o);o+=p.length}return b; }
function box(name: string, body: Uint8Array) {const b=new Uint8Array(8+body.length);new DataView(b.buffer).setUint32(0,b.length);b.set(new TextEncoder().encode(name),4);b.set(body,8);return b;}
function mp4(kind='audio',version=0,atEnd=false) {
  const ftyp=box('ftyp',new TextEncoder().encode('M4A \0\0\0\0isom')),head=new Uint8Array(version ? 32 : 24),handler=new Uint8Array(24);
  head[0]=version;const v=new DataView(head.buffer),offset=version ? 20 : 12;v.setUint32(offset,48000);
  if(version)v.setBigUint64(offset+4,144048n);else v.setUint32(offset+4,144048);
  handler.set(new TextEncoder().encode(kind==='audio'?'soun':'vide'),8);
  const moov=box('moov',box('trak',box('mdia',concat(box('mdhd',head),box('hdlr',handler))))),data=box('mdat',new Uint8Array(64));
  return atEnd ? concat(ftyp,data,moov) : concat(ftyp,moov,data);
}
function png(width=1040,height=520) {const b=new Uint8Array(32);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(16,width);v.setUint32(20,height);return b;}
let sql:ReturnType<typeof createTestD1>,app:Hono<Env>,staff:any,objects:Map<string,any>,bucket:any,env:Env['Bindings'],restore:()=>void;
async function request(path:string,method='GET',body?:unknown) {
  const r=await app.request(`https://worker.test/api/hq/templates${path}`,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)},env);
  return {status:r.status,body:await r.json() as any};
}
async function pending(kind='audio',bytes=mp4(kind)) {
  const s=await request('/media/upload-sessions','POST',{filename:kind==='audio'?'sound.m4a':'video.mp4',mimeType:kind==='audio'?'audio/mp4':'video/mp4',sizeBytes:bytes.length});
  expect(s.status,JSON.stringify(s.body)).toBe(201);
  const row=sql.raw.prepare('SELECT * FROM broadcast_media_upload_sessions WHERE id=?').get(s.body.data.id) as any;
  objects.set(row.r2_key,{key:row.r2_key,bytes,size:bytes.length,etag:'pending',httpMetadata:{contentType:row.mime_type},customMetadata:{'upload-session-id':row.id,'line-account-id':''}});
  return row;
}
async function complete(row:any) {return request(`/media/upload-sessions/${row.id}/complete`,'POST',{etag:'pending'});}
beforeEach(()=>{
  restore=installHqStreamPrimitives();sql=createTestD1({foreignKeys:true});objects=new Map();
  sql.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','HQ'),('other','Other');INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','Owner','owner','test','tenant'),('otherowner','Other','owner','othertest','other')");
  for(const id of ['a','b'])sql.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_access_token,channel_secret,tenant_id) VALUES (?,?,?,'test','test','tenant')").run(id,id,id);
  staff={id:'owner',role:'owner',tenantId:'tenant',readOnly:false};
  bucket={head:vi.fn(async(key:string)=>objects.get(key)??null),get:vi.fn(async(key:string,opts:any)=>{
    const o=objects.get(key);if(!o)return null;if(opts?.onlyIf?.etagMatches && opts.onlyIf.etagMatches!==o.etag)return {...o};
    let bytes=o.bytes;if(opts?.range){const r=opts.range;bytes=r.suffix?bytes.slice(-r.suffix):bytes.slice(r.offset,r.offset+(r.length??bytes.length));}
    return {...o,body:new Blob([bytes]).stream(),arrayBuffer:async()=>bytes.slice().buffer};
  }),put:vi.fn(async(key:string,input:Uint8Array|ReadableStream<Uint8Array>,opts:any)=>{
    if(objects.has(key))return null;const bytes=input instanceof Uint8Array?input: new Uint8Array(await new Response(input).arrayBuffer());
    const o={key,bytes,size:bytes.length,etag:`v${objects.size}`,httpMetadata:opts.httpMetadata,customMetadata:opts.customMetadata};objects.set(key,o);return o;
  }),delete:vi.fn(async(key:string)=>objects.delete(key))};
  const cfImages={input:()=>({transform:({width,height}:any)=>({output:async()=>({image:()=>new Blob([png(width,height)]).stream()})})})};
  env={DB:sql.db,IMAGES:bucket,CF_IMAGES:cfImages,WORKER_URL:'https://worker.test',CF_ACCOUNT_ID:'fixture',MEDIA_R2_ACCESS_KEY_ID:'fixture',MEDIA_R2_SECRET_ACCESS_KEY:'fixture',MEDIA_R2_BUCKET_NAME:'fixture'} as unknown as Env['Bindings'];
  app=new Hono<Env>();app.use('*',async(c,next)=>{c.set('staff',staff);await next()});app.route('/',hqTemplates);app.route('/',images);app.route('/',hqBroadcasts);
});
afterEach(()=>{sql.raw.close();restore();vi.unstubAllGlobals();});
describe('HQ accountless video/audio uploads',()=>{
  test('M4A completion reads exact milliseconds; receipt survives a lost response',async()=>{
    const row=await pending(),first=await complete(row),second=await complete(row);
    expect(first.status,JSON.stringify(first.body)).toBe(201);expect(first.body.data.durationMs).toBe(3001);expect(second).toEqual(first);
    expect(row.line_account_id).toBeNull();expect(first.body.data.r2Key).toMatch(/^hq-templates\/tenant\/uploads\//);expect(bucket.put).toHaveBeenCalledOnce();
    expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
  });
  test.each([0,1])('reads mdhd v%i and moov after the audio data',async version=>{
    const row=await pending('audio',mp4('audio',version,true));expect((await complete(row)).body.data.durationMs).toBe(3001);
  });
  test.each(['size','etag','metadata','mime','expired','malformed','videoAsAudio'])('rejects %s before publishing a receipt',async mode=>{
    const row=await pending(),o=objects.get(row.r2_key);
    if(mode==='size')o.size++;if(mode==='etag')o.etag='changed';if(mode==='metadata')o.customMetadata['upload-session-id']='other';if(mode==='mime')o.httpMetadata.contentType='video/mp4';
    if(mode==='expired')sql.raw.prepare('UPDATE broadcast_media_upload_sessions SET expires_at=?').run('2000-01-01T00:00:00Z');
    if(mode==='malformed')o.bytes[4]=0;
    if(mode==='videoAsAudio'){o.bytes=mp4('video');o.size=o.bytes.length;sql.raw.prepare('UPDATE broadcast_media_upload_sessions SET expected_size=?').run(o.size);}
    expect((await complete(row)).status).toBeGreaterThanOrEqual(400);expect(bucket.put).not.toHaveBeenCalled();
  });
  test.each(['viewer','accountScope','foreignTenant'])('rejects %s before storage writes',async mode=>{
    const row=await pending();if(mode==='viewer')staff.readOnly=true;if(mode==='accountScope')sql.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='owner'");if(mode==='foreignTenant')staff={id:'otherowner',role:'owner',tenantId:'other'};
    expect((await complete(row)).status).toBe(mode==='foreignTenant'?404:403);expect(bucket.put).not.toHaveBeenCalled();
  });
  test('200MB cap, extension and direct-upload configuration fail before session creation',async()=>{
    for(const patch of [{sizeBytes:200*1024*1024+1},{filename:'bad.mp3'},{mimeType:'audio/mpeg'},{filename:'../a.m4a'}])expect((await request('/media/upload-sessions','POST',{filename:'sound.m4a',mimeType:'audio/mp4',sizeBytes:100,...patch})).status).toBe(422);
    delete env.MEDIA_R2_ACCESS_KEY_ID;
    expect((await request('/media/upload-sessions','POST',{filename:'sound.m4a',mimeType:'audio/mp4',sizeBytes:100})).status).toBe(500);
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM broadcast_media_upload_sessions').get()).toEqual({n:0});
  });
  test('cancel revokes a pending session; pending objects are never publicly served',async()=>{
    const row=await pending();expect((await app.request(`https://worker.test/images/${row.r2_key}`,{},env)).status).toBe(404);
    expect((await request(`/media/upload-sessions/${row.id}`,'DELETE')).status).toBe(200);
    expect((await complete(row)).status).toBe(409);expect(objects.has(row.r2_key)).toBe(false);
  });
  test('public serving respects scans and generic image deletion cannot bypass HQ ownership',async()=>{
    const media=(await complete(await pending())).body.data;
    const url=`https://worker.test/images/${media.r2Key}`;
    sql.raw.exec("UPDATE media_file_scans SET status='quarantined'");expect((await app.request(url,{},env)).status).toBe(409);
    sql.raw.exec('DELETE FROM media_file_scans');expect((await app.request(url,{},env)).status).toBe(409);
    expect((await app.request(`https://worker.test/api/images/${encodeURIComponent(media.r2Key)}`,{method:'DELETE'},env)).status).toBe(403);
    expect(objects.has(media.r2Key)).toBe(true);
  });
});
describe('store materialization',()=>{
  test('broadcast HTTP preflight/test/send use the owned audio and each store URL',async()=>{
    const media=(await complete(await pending())).body.data;
    sql.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('fa','Ua','a'),('fb','Ub','b');INSERT INTO account_settings(line_account_id,key,value) VALUES('a','test_recipients','[\"fa\"]')");
    const bodies:any[]=[];
    vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{
      if(url.endsWith('/push')){bodies.push(JSON.parse(String(init.body)));return new Response('{}',{headers:{'x-line-request-id':'fixture'}});}
      return new Response(JSON.stringify(url.endsWith('consumption')?{totalUsage:0}:{type:'limited',value:100}));
    }));
    const call=async(path:string,body?:unknown,confirm=false)=>{
      const r=await app.request(`https://worker.test/api/hq/broadcasts${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(confirm?{'X-Confirm-Irreversible':'broadcast-send'}:{})},body:body?JSON.stringify(body):undefined},env);
      return {status:r.status,body:await r.json() as any};
    };
    const input={requestId:'audio-send',title:'音声',messageType:'text',messageContent:'',accountIds:['a','b'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null,messageBubbles:[{id:'sound',type:'audio',content:{state:{audio:{originalContentUrl:media.publicUrl,duration:3.001,hqMediaKey:media.r2Key}}}}]};
    const r=await call('',input);expect(r.status,JSON.stringify(r.body)).toBe(201);const id=r.body.data.id;
    const p=await call(`/${id}/preflight`,{});expect(p.status).toBe(200);expect(p.body.data.map((s:any)=>s.blockedReasons)).toEqual([[],[]]);expect(sql.raw.prepare('SELECT COUNT(*) n FROM media').get()).toEqual({n:0});
    const t=await call(`/${id}/test-send`,{accountId:'a'});expect(t.status,JSON.stringify(t.body)).toBe(200);
    expect(bodies[0].messages.find((m:any)=>m.type==='audio')).toMatchObject({duration:3001,originalContentUrl:expect.stringContaining('/images/media/a/hq-audio/')});
    const sent=await call(`/${id}/send`,{expectedVersion:1},true);expect(sent.status,JSON.stringify(sent.body)).toBe(200);
    for(const row of sql.raw.prepare('SELECT line_account_id,message_bubbles_json FROM broadcasts').all() as any[]) {
      const content=JSON.parse(row.message_bubbles_json)[0].content;expect(content.state.audio.originalContentUrl).toContain(`/images/media/${row.line_account_id}/hq-audio/`);expect(content.state.audio.duration).toBe(3.001);
    }
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM broadcasts').get()).toEqual({n:2});
  });
  test('HQ audio preflight does not copy, send copies per store and replaces forged duration',async()=>{
    const r=await complete(await pending()),media=r.body.data;
    const input={messageBubbles:[{id:'sound',type:'audio',content:{state:{audio:{originalContentUrl:media.publicUrl,duration:99,hqMediaKey:media.r2Key}}}}]} as unknown as HqBroadcastInput;
    const runtime={bucket,publicBaseUrl:'https://worker.test'};
    const check=await resolveHqBroadcastMaterials(sql.db,'tenant','a',input,runtime);
    expect((check.messageBubbles![0].content.state as any).audio).toMatchObject({duration:3.001});expect(sql.raw.prepare('SELECT COUNT(*) n FROM media').get()).toEqual({n:0});
    for(const account of ['a','b']) {
      const local=await resolveHqBroadcastMaterials(sql.db,'tenant',account,input,{...runtime,copy:true});
      const audio=(local.messageBubbles![0].content.state as any).audio as any;expect(audio.originalContentUrl).toMatch(new RegExp(`/images/media/${account}/hq-audio/`));
      expect(buildMessages(parseBroadcastMessageParts(local))).toMatchObject([{type:'audio',duration:3001}]);
    }
    await resolveHqBroadcastMaterials(sql.db,'tenant','a',input,{...runtime,copy:true});
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM media').get()).toEqual({n:2});expect(bucket.put).toHaveBeenCalledTimes(3);
    expect((input.messageBubbles![0].content.state as any).audio).toMatchObject({duration:99});expect(sql.raw.pragma('foreign_key_check')).toEqual([]);
    const foreign=JSON.parse(JSON.stringify(input));foreign.messageBubbles[0].content.state.audio.hqMediaKey=media.r2Key.replace('/tenant/','/other/');
    await expect(resolveHqBroadcastMaterials(sql.db,'tenant','a',foreign,runtime)).rejects.toMatchObject({status:409});
    sql.raw.exec("UPDATE media_file_scans SET status='quarantined'");
    await expect(resolveHqBroadcastMaterials(sql.db,'tenant','a',input,runtime)).rejects.toMatchObject({status:409});
  });
  test('rich video saves, lists, distributes seven registered objects and sends the store shape',async()=>{
    const media=(await complete(await pending('video'))).body.data;
    const response=await app.request('https://worker.test/api/hq/templates/media?purpose=rich_video_preview&filename=preview.png',{method:'POST',headers:{'Content-Type':'image/png'},body:png()},env);
    const preview=(await response.json() as any).data;expect(response.status).toBe(201);expect(preview.media).toHaveLength(6);
    const payload={altText:'ご案内',baseUrl:preview.payload.baseUrl,baseSize:preview.payload.baseSize,actions:[],video:{originalContentUrl:media.publicUrl,previewImageUrl:preview.payload.imageUrl,area:{x:0,y:0,width:1040,height:520},externalLink:{label:'詳しく見る',linkUri:'https://example.com'}}};
    const definition={schemaVersion:1,template:{id:'hq-authored-message',name:'動画',category:'general',messageType:'imagemap',messageContent:JSON.stringify(payload),carouselActionsJson:null,carouselTapLimitMode:'none',carouselTapLimitText:null,questionJson:null,questionStatus:'draft'},media:[media,...preview.media]};
    const save=await request('','POST',{name:'動画',type:'template',definition,requestId:crypto.randomUUID()});expect(save.status,JSON.stringify(save.body)).toBe(201);
    const id=save.body.data.template.id,list=await request('?kind=rich_video');expect(list.body.data).toHaveLength(1);expect(list.body.kind_counts.rich_video).toBe(1);
    const p=await request(`/${id}/preflight`,'POST',{accountIds:['a','b']});expect(p.status,JSON.stringify(p.body)).toBe(200);
    const resolutions=p.body.data.stores.flatMap((store:any)=>store.items.map((item:any)=>({accountId:store.accountId,sourceId:item.sourceId,mode:'create'})));
    const result=await request(`/${id}/distribute`,'POST',{preflightId:p.body.data.preflightId,resolutions});expect(result.body.data.stores.map((s:any)=>s.status)).toEqual(['succeeded','succeeded']);
    for(const row of sql.raw.prepare('SELECT * FROM templates').all() as any[]) {
      const local=JSON.parse(row.message_content);expect(local.baseUrl).toContain(`/images/media/${row.line_account_id}/hq/`);expect(local.video.originalContentUrl).toContain(`/images/media/${row.line_account_id}/hq/`);expect(local.video.previewImageUrl).toContain(`/images/media/${row.line_account_id}/hq/`);
      expect(buildMessages(parseBroadcastMessageParts({messageType:'imagemap',messageContent:row.message_content}))).toMatchObject([{type:'imagemap',video:{externalLink:payload.video.externalLink}}]);
      for(const width of [240,300,460,700,1040])expect(objects.has(new URL(`${local.baseUrl}/${width}`).pathname.slice(8))).toBe(true);
    }
    expect(sql.raw.prepare('SELECT COUNT(*) n FROM media').get()).toEqual({n:14});
    const richInput = {messageBubbles:[{id:'video',type:'rich_video',content:{...payload,hqTemplateId:id,hqTemplateVersionId:save.body.data.template.current_version_id}}]} as unknown as HqBroadcastInput;
    const mapped = await resolveHqBroadcastMaterials(sql.db,'tenant','a',richInput);
    expect(mapped.messageBubbles![0].content.baseUrl).toContain('/images/media/a/hq/');
    expect(buildMessages(parseBroadcastMessageParts(mapped))).toMatchObject([{type:'imagemap',video:{originalContentUrl:expect.stringContaining('/images/media/a/hq/')}}]);
    expect((await request(`/media?r2Key=${encodeURIComponent(media.r2Key)}`,'DELETE')).status).toBe(409);
    expect((await request(`/${id}/distribute`,'POST',{preflightId:p.body.data.preflightId,resolutions})).body.data.stores.map((s:any)=>s.status)).toEqual(['succeeded','succeeded']);
  });
  test('MP4 metadata corruption cannot force an unbounded range allocation',async()=>{
    const row=await pending(),o=objects.get(row.r2_key);new DataView(o.bytes.buffer).setUint32(20,200*1024*1024);
    await expect(readHqMp4Metadata(bucket,row.r2_key,'pending',o.size,'audio')).rejects.toThrow('INVALID_MEDIA');
    expect(bucket.get.mock.calls.every(([,opts]:any)=>opts.range.length<=8*1024*1024)).toBe(true);
  });
});
