import { afterEach, beforeEach, expect, it } from 'vitest';
import { createReminderWithDraftVersion, publishReminderDraftVersion, recordReminderDraftTest } from '@line-crm/db';
import { createTestD1, type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readFollowupEngineGate, readFollowupEngineSnapshot, type FollowupEngine } from './restaurant-followup-engine-approval.js';

let t: SqliteD1;
beforeEach(() => {
  t=createTestD1();
  t.raw.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','店舗','t','s'),('b','b','他社','t','s');
    INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
    INSERT INTO rt_stores(id,organization_id,name,code,line_account_id,timezone) VALUES('store','org','食堂','S','a','Asia/Tokyo');`);
});
afterEach(()=>t.raw.close());

async function configured(engine:FollowupEngine, template=false) {
  if(template)t.raw.exec(`INSERT INTO templates(id,line_account_id,name,message_type,message_content,published_version) VALUES('tpl','a','案内','text','公開した本文',1)`);
  let targetId:string,versionId:string;
  if(engine==='reminder') {
    const draft=await createReminderWithDraftVersion(t.db,{name:'前日',lineAccountId:'a',triggerType:'manual',deliveryMode:'time',
      stopConditions:{bookingCancelled:true,supportMarkCompleted:false,daysAfterTarget:null,friendBlocked:true},
      steps:[{stableStepId:'step',offsetMinutes:0,offsetDays:-1,sendAtTime:'18:00',messageType:'text',messageContent:'予約の案内',templateId:template?'tpl':null}]});
    targetId=draft.reminder.id;
    await recordReminderDraftTest(t.db,draft.version.id,{succeeded:true,staffId:null});
    versionId=(await publishReminderDraftVersion(t.db,targetId,null)).id;
  } else {
    targetId='auto';versionId='v1';
    t.raw.prepare(`INSERT INTO automation_definitions(id,line_account_id,name,status) VALUES(?,'a','来店後','active')`).run(targetId);
    t.raw.prepare(`INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config)
      VALUES(?,?,1,'published','restaurant.departed',?)`).run(versionId,targetId,JSON.stringify([{id:'msg',type:'send_message',params:template?{templateId:'tpl'}:{content:'ありがとうございました'},onFailure:'stop'}]));
    t.raw.prepare('UPDATE automation_definitions SET current_published_version_id=? WHERE id=?').run(versionId,targetId);
  }
  const trigger=engine==='reminder'?'reservation_24h':'post_visit';
  const snapshot=await readFollowupEngineSnapshot(t.db,{engine,targetId,lineAccountId:'a',storeId:'store'});
  expect(snapshot).not.toBeNull();
  t.raw.prepare(`INSERT INTO rt_approval_requests(id,organization_id,store_id,kind,title,status,payload_json)
    VALUES('approval','org','store','line_message','開始','approved',?)`).run(JSON.stringify({operation:'start_restaurant_followup_engines',lineAccountId:'a',targets:[{trigger,engine,targetId,versionId,contentHash:snapshot!.contentHash}]}));
  const column=engine==='reminder'?'reminder_id':'automation_id';
  t.raw.prepare(`INSERT INTO rt_store_followup_targets(store_id,trigger,engine,${column},enabled,sending_status,approved_version_id,approved_content_hash,approval_id)
    VALUES('store',?,?,?,1,'active',?,?,'approval')`).run(trigger,engine,targetId,versionId,snapshot!.contentHash);
  return {engine,targetId,versionId,lineAccountId:'a',snapshot};
}
it.each(['reminder','automation'] as const)('承認した実物と公開版と内容が合う場合だけ通す: %s',async(engine)=>{
  const input=await configured(engine);
  const gate=await readFollowupEngineGate(t.db,input);
  expect(gate).toMatchObject({managed:true,allowed:true,storeId:'store'});
  if(gate.managed&&gate.allowed)expect(await t.db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first()).not.toBeNull();
  expect(await readFollowupEngineGate(t.db,{...input,versionId:'other'})).toEqual({managed:true,allowed:false});
  expect(await readFollowupEngineGate(t.db,{...input,lineAccountId:'b'})).toEqual({managed:true,allowed:false});
});
it.each(['pending','stopped','wrong-owner','wrong-hash','wrong-kind','broken-payload'] as const)('承認や送り手が変わったら止める: %s',async(kind)=>{
  const input=await configured('reminder');
  if(kind==='pending')t.raw.exec("UPDATE rt_approval_requests SET status='pending'");
  if(kind==='stopped')t.raw.exec("UPDATE rt_store_followup_targets SET sending_status='stopped'");
  if(kind==='wrong-owner')t.raw.exec("UPDATE rt_store_followup_targets SET engine='scenario'");
  if(kind==='wrong-hash')t.raw.exec("UPDATE rt_store_followup_targets SET approved_content_hash='other'");
  if(kind==='wrong-kind')t.raw.exec("UPDATE rt_approval_requests SET kind='menu_change'");
  if(kind==='broken-payload')t.raw.exec("UPDATE rt_approval_requests SET payload_json='broken'");
  expect(await readFollowupEngineGate(t.db,input)).toEqual({managed:true,allowed:false});
});
it.each(['reminder','automation'] as const)('テンプレート本文が変わっても承認を引き継がず、準備した本文は写しを保つ: %s',async(engine)=>{
  const input=await configured(engine,true),gate=await readFollowupEngineGate(t.db,input);
  expect(gate.allowed).toBe(true);
  t.raw.exec("UPDATE templates SET message_content='承認していない本文'");
  expect(await readFollowupEngineGate(t.db,input)).toEqual({managed:true,allowed:false});
  if(gate.managed&&gate.allowed){
    expect(gate.snapshot.templates.get('tpl')?.message_content).toBe('公開した本文');
    expect(await t.db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first()).toBeNull();
  }
});
it('下書きを作るだけでも承認した内容の指紋とずれ、準備済みの送信権も失う',async()=>{
  const input=await configured('automation'),gate=await readFollowupEngineGate(t.db,input);
  t.raw.exec(`INSERT INTO automation_versions(id,automation_id,version_number,status,trigger_type,action_config)
    VALUES('draft','auto',2,'draft','restaurant.departed','[]');
    UPDATE automation_definitions SET current_draft_version_id='draft' WHERE id='auto';`);
  expect(await readFollowupEngineGate(t.db,input)).toEqual({managed:true,allowed:false});
  if(gate.managed&&gate.allowed)expect(await t.db.prepare(`SELECT 1 WHERE ${gate.guard.sql}`).bind(...gate.guard.binds).first()).toBeNull();
});
it('実行開始時に固定した計画が承認した計画と違えば止める',async()=>{
  const input=await configured('automation');
  expect((await readFollowupEngineGate(t.db,{...input,executionPlanJson:JSON.stringify(input.snapshot!.plan)})).allowed).toBe(true);
  expect(await readFollowupEngineGate(t.db,{...input,executionPlanJson:'[]'})).toEqual({managed:true,allowed:false});
});
it('対応を外しても、承認履歴のある古い実物を一般の自動化として送らない',async()=>{
  const input=await configured('automation');
  t.raw.exec("UPDATE rt_store_followup_targets SET engine='scenario',enabled=0,sending_status='stopped'");
  expect(await readFollowupEngineGate(t.db,input)).toEqual({managed:true,allowed:false});
});
it('管理しない一般の実物や対応表が未作成の環境では承認を要求しない',async()=>{
  const input={engine:'automation' as const,targetId:'ordinary',lineAccountId:'a',versionId:'v'};
  expect(await readFollowupEngineGate(t.db,input)).toEqual({managed:false,allowed:true});
  const fresh=createTestD1();fresh.raw.exec('DROP TABLE rt_store_followup_targets');
  expect(await readFollowupEngineGate(fresh.db,input)).toEqual({managed:false,allowed:true});fresh.raw.close();
});

it('実行計画のオブジェクトのキーの並びだけでは承認を失わない',async()=>{
 const input=await configured('automation');const plan=input.snapshot!.plan!.map(action=>Object.fromEntries(Object.entries(action).reverse()));
 expect((await readFollowupEngineGate(t.db,{...input,executionPlanJson:JSON.stringify(plan)})).allowed).toBe(true);
});
