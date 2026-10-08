import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { resolveHqBroadcastMaterials } from './hq-broadcast-materials.js';
import type { HqBroadcastInput } from '@line-crm/shared';
let f: SqliteD1;
const definition={template:{id:'source-template'},media:[{id:'source-media',publicUrl:'https://example.test/source/image',r2Key:'media/source/image'}]};
const input:HqBroadcastInput={requestId:'request',title:'Notice',accountIds:['a','b'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null,messageType:'text',messageContent:'notice',messageBubbles:[{id:'bubble',type:'carousel',content:{hqTemplateId:'hq',hqTemplateVersionId:'v',templateId:'source-template',columnsJson:JSON.stringify([{text:'same',thumbnailImageUrl:'https://example.test/source/image',actions:[{type:'postback',label:'choose',data:'ctpl=source-template&c=0&a=0'}]}])}}]};
beforeEach(()=>{
 f=createTestD1({foreignKeys:true});f.raw.exec("INSERT INTO tenants(id,name) VALUES('tenant','HQ'),('other','Other')");
 for(const account of ['a','b'])f.raw.prepare("INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES(?,?,?,'secret','token','tenant')").run(account,account,account);
 f.raw.exec("INSERT INTO hq_templates(id,tenant_id,template_type,name) VALUES('hq','tenant','template','HQ')");
 f.raw.prepare("INSERT INTO hq_template_versions(id,tenant_id,template_id,version,definition_json,content_hash) VALUES('v','tenant','hq',1,?,'hash')").run(JSON.stringify(definition));
 for(const account of ['a','b']){
  const preflight='pf-'+account,run='run-'+account;
  f.raw.prepare("INSERT INTO hq_template_distribution_runs(id,tenant_id,template_id,template_version_id,idempotency_fingerprint,status) VALUES(?,'tenant','hq','v',?,'completed')").run(run,run);
  f.raw.prepare("INSERT INTO hq_template_preflights(id,tenant_id,template_id,template_version_id,target_account_id,distribution_mode,idempotency_fingerprint,snapshot_token,status) VALUES(?,'tenant','hq','v',?,'create',?,'snapshot','ready')").run(preflight,account,run);
  f.raw.prepare("INSERT INTO hq_template_distribution_results(run_id,tenant_id,template_id,template_version_id,target_account_id,preflight_id,idempotency_fingerprint,snapshot_token,status) VALUES(?,'tenant','hq','v',?,?,?,'snapshot','succeeded')").run(run,account,preflight,run);
  for(const kind of ['template','media'])f.raw.prepare("INSERT INTO hq_template_preflight_resolutions(preflight_id,tenant_id,template_id,template_version_id,target_account_id,idempotency_fingerprint,snapshot_token,source_id,item_kind,resolution_mode,target_id) VALUES(?,'tenant','hq','v',?,?,'snapshot',?,?,'create',?)").run(preflight,account,run,kind+':source-'+kind,kind,account+'-'+kind);
  f.raw.prepare("INSERT INTO templates(id,name,message_type,message_content,line_account_id) VALUES(?,'local','text','local',?)").run(account+'-template',account);
  f.raw.prepare("INSERT INTO media(id,kind,filename,mime_type,size_bytes,r2_key,public_url,line_account_id) VALUES(?,'image','image','image/png',1,?,?,?)").run(account+'-media','media/'+account+'/image','https://example.test/'+account+'/image',account);
 }
});
afterEach(()=>f.raw.close());
it('同じ統括版の配布記録で各店舗のID・画像URL・postbackを付け替え、入力を変えない',async()=>{
 for(const account of ['a','b']){
  const result=await resolveHqBroadcastMaterials(f.db,'tenant',account,input);
  const content=(result.messageBubbles![0].content as any),column=JSON.parse(content.columnsJson)[0];
  expect(content.templateId).toBe(account+'-template');expect(column.thumbnailImageUrl).toBe('https://example.test/'+account+'/image');
  expect(column.actions[0].data).toBe('ctpl='+account+'-template&c=0&a=0');
 }
 expect((input.messageBubbles![0].content as any).templateId).toBe('source-template');
});
it('別テナント・未配布の版・別店舗の素材・削除した素材は送らない',async()=>{
 await expect(resolveHqBroadcastMaterials(f.db,'other','a',input)).rejects.toMatchObject({status:409});
 const changed=JSON.parse(JSON.stringify(input));changed.messageBubbles[0].content.hqTemplateVersionId='uninstalled';
 await expect(resolveHqBroadcastMaterials(f.db,'tenant','a',changed)).rejects.toMatchObject({status:409});
 f.raw.exec("UPDATE media SET line_account_id='b' WHERE id='a-media'");
 await expect(resolveHqBroadcastMaterials(f.db,'tenant','a',input)).rejects.toMatchObject({status:409});
 f.raw.exec("UPDATE media SET line_account_id='a',archived_at=datetime('now') WHERE id='a-media'");
 await expect(resolveHqBroadcastMaterials(f.db,'tenant','a',input)).rejects.toMatchObject({status:409});
});
it('統括の元の版が指定されていない吹き出しは確認を求める',async()=>{
 const changed=JSON.parse(JSON.stringify(input));delete changed.messageBubbles[0].content.hqTemplateVersionId;
 await expect(resolveHqBroadcastMaterials(f.db,'tenant','a',changed)).rejects.toMatchObject({status:409});
});

it('クーポン・リッチ素材の店舗用IDと画像のベースURLを付け替える',async()=>{
 for(const kind of ['coupon','rich_message']){
  f.raw.prepare("UPDATE hq_template_versions SET definition_json=? WHERE id='v'").run(JSON.stringify({...definition,asset:{kind,payload:{baseUrl:'https://example.test/source/image'}}}));
  for(const account of ['a','b']){
   f.raw.prepare(`INSERT OR REPLACE INTO broadcast_message_assets(id,line_account_id,kind,name,payload_json,created_at,updated_at) VALUES(?,?,?,'local','{}','2026-10-08','2026-10-08')`).run(account+'-template',account,kind);
   if(kind==='rich_message'){
    f.raw.prepare("UPDATE hq_template_versions SET definition_json=? WHERE id='v'").run(JSON.stringify({...definition,media:[{...definition.media[0],publicUrl:'https://example.test/source/image/1040'}],asset:{kind,payload:{baseUrl:'https://example.test/source/image'}}}));
    f.raw.prepare("UPDATE media SET public_url=? WHERE id=?").run('https://example.test/'+account+'/imagemap/1040',account+'-media');
   }
   const changed=JSON.parse(JSON.stringify(input));changed.messageBubbles[0]={id:'asset',type:kind,content:{hqTemplateId:'hq',hqTemplateVersionId:'v',assetId:'hq',baseUrl:'https://example.test/source/image'}};
   const content=(await resolveHqBroadcastMaterials(f.db,'tenant',account,changed)).messageBubbles![0].content as any;
   expect(content.assetId).toBe(account+'-template');
   if(kind==='rich_message')expect(content.baseUrl).toBe('https://example.test/'+account+'/imagemap');
  }
 }
});
