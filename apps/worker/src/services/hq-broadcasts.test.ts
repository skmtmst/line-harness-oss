import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import type {HqBroadcastInput} from '@line-crm/shared';
import {prepareHqBroadcast,getHqBroadcastRun,preflightHqBroadcast,dispatchHqBroadcast,excludeHqBroadcastTargets,stopHqBroadcast,retryHqBroadcastTarget,hqBroadcastAuthority} from './hq-broadcasts.js';
vi.mock('./feature-enforcement.js',()=>({featureJobCanRun:vi.fn(async()=>true)}));
const tenant='00000000-0000-4000-8000-000000000001';let f:SqliteD1;
const input:HqBroadcastInput={requestId:'run-1',title:'お知らせ',messageType:'text',messageContent:'{{account.name}}のお知らせ',accountIds:['shop1','shop2'],accountTagIds:[],excludedAccountIds:[],audience:{kind:'all'},scheduledAt:null};
beforeEach(()=>{f=createTestD1();for(const id of ['shop1','shop2']){f.raw.prepare('INSERT INTO line_accounts(id,name,channel_id,channel_secret,channel_access_token,tenant_id) VALUES(?,?,?,\'unused\',?,?)').run(id,id,id,'token-'+id,tenant);f.raw.prepare('INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,?)').run('friend-'+id,'U-'+id,id);}
 f.raw.prepare('INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES(\'owner\',\'管理者\',\'owner\',\'unused\',?)').run(tenant);
 vi.stubGlobal('fetch',vi.fn(async(url:string,init:RequestInit)=>{const two=new Headers(init.headers).get('Authorization')?.includes('shop2');return new Response(JSON.stringify(url.endsWith('consumption')?{totalUsage:two?10:0}:{type:'limited',value:two?10:100}),{status:200});}));
});
afterEach(()=>{f.raw.close();vi.unstubAllGlobals();});
describe('統括の一括配信',()=>{
 it('人数・残枠を店ごとに返し、足りない店を外した後だけ送れる',async()=>{
  let run=await prepareHqBroadcast(f.db,tenant,'owner',input),check=await preflightHqBroadcast(f.db,run);
  expect(check.map(p=>p.remaining)).toEqual([100,0]);expect(check[1].blockedReasons).toContain('今月の送信枠が足りません');
  await expect(dispatchHqBroadcast(f.db,run,'owner',1)).rejects.toThrow('外して');
  await excludeHqBroadcastTargets(f.db,run,'owner',['shop2'],1);run=await getHqBroadcastRun(f.db,tenant,run.id);
  const result=await dispatchHqBroadcast(f.db,run,'owner',2);expect(result.targets.filter(t=>t.broadcastId)).toHaveLength(1);
  const broadcasts=f.raw.prepare('SELECT hq_run_id,status,target_type FROM broadcasts').all();expect(broadcasts).toEqual([{hq_run_id:run.id,status:'scheduled',target_type:'segment'}]);
  await dispatchHqBroadcast(f.db,await getHqBroadcastRun(f.db,tenant,run.id),'owner',3);expect(f.raw.prepare('SELECT COUNT(*) n FROM broadcasts').get()).toEqual({n:1});
 });
 it('対象店は固定され、重複依頼は同じ実行。内容が変わったら409',async()=>{
  const r=await prepareHqBroadcast(f.db,tenant,'owner',input);expect((await prepareHqBroadcast(f.db,tenant,'owner',input)).id).toBe(r.id);
  await expect(prepareHqBroadcast(f.db,tenant,'owner',{...input,title:'変更'})).rejects.toMatchObject({status:409});
  await expect(excludeHqBroadcastTargets(f.db,r,'owner',['other'],1)).rejects.toThrow('固定');
 });
 it('アカウント分類で選び、友だちの同名タグは店ごとのIDで固定する',async()=>{
  f.raw.prepare("INSERT INTO line_account_tags(id,tenant_id,name,created_at,updated_at) VALUES('group',?,'地域',datetime('now'),datetime('now'))").run(tenant);
  f.raw.prepare("INSERT INTO line_account_tag_links(line_account_id,tag_id,tenant_id) VALUES('shop1','group',?)").run(tenant);
  f.raw.exec("INSERT INTO tags(id,name,line_account_id) VALUES('tag-shop1','常連','shop1');INSERT INTO friend_tags(friend_id,tag_id) VALUES('friend-shop1','tag-shop1')");
  const r=await prepareHqBroadcast(f.db,tenant,'owner',{...input,accountIds:[],accountTagIds:['group'],audience:{kind:'tag',tagName:'常連'}});
  expect(f.raw.prepare('SELECT line_account_id,tag_id FROM hq_broadcast_targets WHERE run_id=?').all(r.id)).toEqual([{line_account_id:'shop1',tag_id:'tag-shop1'}]);
  f.raw.prepare("INSERT INTO line_account_tag_links(line_account_id,tag_id,tenant_id) VALUES('shop2','group',?)").run(tenant);
  expect((await preflightHqBroadcast(f.db,r))).toHaveLength(1);
 });
 it('全店の取消は予約を下書きへ戻し、統括の操作記録を店ごとに残す',async()=>{
  const r=await prepareHqBroadcast(f.db,tenant,'owner',{...input,accountIds:['shop1']});await dispatchHqBroadcast(f.db,r,'owner',1);
  const run=await getHqBroadcastRun(f.db,tenant,r.id);await stopHqBroadcast(f.db,run,'owner',true,2);
  expect(f.raw.prepare('SELECT status,scheduled_at FROM broadcasts').get()).toEqual({status:'draft',scheduled_at:null});
  expect(f.raw.prepare("SELECT COUNT(*) n FROM hq_broadcast_audit WHERE action='cancelled'").get()).toEqual({n:1});
 });
 it('店舗のやり直しは一時的な失敗だけを開き、成功・送達不明には送らない',async()=>{
  const r=await prepareHqBroadcast(f.db,tenant,'owner',{...input,accountIds:['shop1']});const sent=await dispatchHqBroadcast(f.db,r,'owner',1),child=sent.targets[0].broadcastId!;
  f.raw.exec("INSERT INTO friends(id,line_user_id,line_account_id) VALUES('success','U-success','shop1'),('unknown','U-unknown','shop1')");
  f.raw.prepare("UPDATE broadcasts SET status='sent' WHERE id=?").run(child);
  const put=f.raw.prepare('INSERT INTO broadcast_send_claims(broadcast_id,friend_id,line_account_id,state,error_code) VALUES(?,?,\'shop1\',?,?)');
  put.run(child,'friend-shop1','failed','line_http_429');put.run(child,'success','sent',null);put.run(child,'unknown','unknown','network_timeout');
  await retryHqBroadcastTarget(f.db,await getHqBroadcastRun(f.db,tenant,r.id),'shop1','owner',1);
  expect(f.raw.prepare('SELECT friend_id,state FROM broadcast_send_claims ORDER BY friend_id').all()).toEqual([{friend_id:'friend-shop1',state:'claimed'},{friend_id:'success',state:'sent'},{friend_id:'unknown',state:'unknown'}]);
  await expect(retryHqBroadcastTarget(f.db,await getHqBroadcastRun(f.db,tenant,r.id),'shop1','owner',1)).rejects.toMatchObject({status:409});
 });
 it('統括全体の権限だけ許可し、店だけ担当する管理者を拒否する',async()=>{
  const staff={id:'owner',name:'管理者',role:'owner' as const,readOnly:false,tenantId:tenant};
  expect((await hqBroadcastAuthority(f.db,staff)).tenantId).toBe(tenant);
  f.raw.exec("UPDATE staff_members SET account_scope='accounts' WHERE id='owner'");await expect(hqBroadcastAuthority(f.db,staff)).rejects.toMatchObject({status:403});
  await expect(hqBroadcastAuthority(f.db,{...staff,tenantId:'other'})).rejects.toMatchObject({status:403});
 });
});
