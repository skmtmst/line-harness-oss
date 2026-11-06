import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {broadcastSimulation} from './broadcast-simulation.js';
import {broadcasts} from './broadcasts.js';
import {scheduleSimulation,processBroadcastSimulation,simulationPreview,saveSimulationDraft} from '../features/broadcasts/broadcast-simulation.js';
import {processBroadcastSend,processScheduledBroadcasts,processQueuedBroadcasts} from '../features/broadcasts/broadcast.js';
import {countBroadcastLedger,getRetryableRecipientIds} from '@line-crm/db/src/broadcast-send-claims.js';
let d:ReturnType<typeof gapFixture>;const now=new Date('2026-10-16T03:00:00Z');
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
const draft={title:'ご案内',text:'お知らせです',purpose:'notice',testMode:true};
const client={pushMessage:vi.fn(()=>{throw new Error('real_send_forbidden');}),broadcast:vi.fn(()=>{throw new Error('real_send_forbidden');}),multicast:vi.fn(()=>{throw new Error('real_send_forbidden');})} as any;
async function create(purpose='notice',key='create'){return (await saveSimulationDraft(d.db,'a','o',key,{...draft,purpose})).id;}
async function schedule(id:string,key='send'){const p=await simulationPreview(d.db,id);return scheduleSimulation(d.db,id,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},key,now);}
test('Q-10/PURPOSE-01: 目的を保存して人数と実行が一致、模擬は既存台帳に1回、送信成功0',async()=>{
 d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f','marketing','revoked','本人','liff')");
 const id=await create();expect(await create()).toBe(id);expect((await simulationPreview(d.db,id)).recipients).toBe(2);
 const marketing=await create('marketing','marketing');expect((await simulationPreview(d.db,marketing)).recipients).toBe(1);
 await schedule(id);d.raw.exec("INSERT INTO friend_delivery_consents(line_account_id,friend_id,purpose,state,reason,source) VALUES('a','f2','notice','revoked','本人','liff')");
 await Promise.all([processBroadcastSimulation(d.db,id,now),processBroadcastSimulation(d.db,id,now)]);
 expect(await simulationPreview(d.db,id)).toMatchObject({state:'completed',simulated:1,sent:0,testMode:true});expect(d.raw.prepare('SELECT friend_id,error_code,dispatched_at FROM broadcast_send_claims WHERE broadcast_id=? ORDER BY friend_id').all(id)).toEqual([{friend_id:'f',error_code:'simulation_only',dispatched_at:null},{friend_id:'f2',error_code:'simulation_suppressed',dispatched_at:null}]);
 expect(await countBroadcastLedger(d.db,id)).toEqual({sent:0,failed:0,unknown:0,claimed:0});expect(await getRetryableRecipientIds(d.db,id)).toEqual([]);
 expect(d.raw.prepare('SELECT success_count FROM broadcasts WHERE id=?').get(id)).toEqual({success_count:0});expect(d.raw.prepare('SELECT count(*) n FROM messages_log').get()).toEqual({n:0});
 expect(()=>d.raw.prepare("UPDATE broadcast_send_claims SET dispatched_at='now' WHERE broadcast_id=?").run(id)).toThrow('simulation_transport_forbidden');
});
test('PURPOSE-02: 既存の即時・予約・キュー・再試行からも実送信へ落ちない',async()=>{
 const id=await create();await schedule(id);await processBroadcastSend(d.db,client,id);await processScheduledBroadcasts(d.db,client);await processQueuedBroadcasts(d.db,client);expect(client.broadcast).not.toHaveBeenCalled();expect(client.multicast).not.toHaveBeenCalled();expect(client.pushMessage).not.toHaveBeenCalled();
 const app=gapApp(d,[broadcasts]);for(const action of ['test-send','send-segment','resume','retry-failed'])expect((await gapCall(app,`/api/broadcasts/${id}/${action}`,'POST',{})).status).toBe(409);
});
test('PURPOSE-03/版と人数が変われば拒否、閲覧・代理不可、別店不可、模擬指定必須',async()=>{
 const id=await create();await expect(scheduleSimulation(d.db,id,{expectedVersion:0,confirmedRecipientCount:2,testMode:true},'s',now)).rejects.toMatchObject({code:'SEND_PREVIEW_CHANGED'});
 const api=()=>gapApp(d,[broadcastSimulation]);const path='/api/broadcasts/simulation-drafts?account_id=a';
 for(const [staff,im] of [[{...gapOwner,readOnly:true},false],[gapOwner,true]] as const)expect((await gapCall(gapApp(d,[broadcastSimulation],staff,im),path,'POST',draft)).status).toBe(403);
 expect((await gapCall(api(),path.replace('=a','=b'),'POST',draft)).status).toBe(404);expect((await gapCall(api(),path,'POST',{...draft,testMode:false})).status).toBe(409);
 await schedule(id);expect(await scheduleSimulation(d.db,id,{expectedVersion:1,confirmedRecipientCount:2,testMode:true},'send',now)).toMatchObject({replayed:true});await expect(scheduleSimulation(d.db,id,{expectedVersion:1,confirmedRecipientCount:1,testMode:true},'send',now)).rejects.toMatchObject({code:'idempotency_conflict'});
});
