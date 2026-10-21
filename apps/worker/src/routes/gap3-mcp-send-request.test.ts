import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp} from '../test-utils/gap1.js';
import {broadcastApprovals} from './broadcast-approvals.js';
import {mcpConnections} from './mcp-connections.js';
import {mcpRpc} from './mcp-rpc.js';
import {sha256Hex} from '../middleware/auth.js';
import {scheduleSimulation,simulationPreview,processBroadcastSimulation,saveSimulationDraft} from '../features/broadcasts/broadcast-simulation.js';
let d:ReturnType<typeof gapFixture>;
const app=()=>gapApp(d,[mcpConnections,mcpRpc]);
beforeEach(async()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));d.raw.exec("INSERT INTO staff_members(id,name,role,tenant_id,api_key) VALUES('approver','承認者','admin','t','approve-key')");d.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at,step_up_at) VALUES(?,?,?,?)').run(await sha256Hex('session'),'o',new Date(Date.now()+3600000).toISOString(),new Date().toISOString());});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
async function connect(level='send_request'){const r=await app().request('/api/mcp-connections?account_id=a',{method:'POST',headers:{Authorization:'Bearer lh_session:session','Content-Type':'application/json'},body:JSON.stringify({name:'AI接続',level})});expect(r.status).toBe(201);return (await r.json() as any).data;}
async function rpc(key:string,name:string,args:Record<string,unknown>){const r=await app().request('/mcp',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});if(r.status!==200)return {status:r.status};const result=(await r.json() as any).result;return result.isError?{error:true}:JSON.parse(result.content[0].text);}
async function draft(key:string){return rpc(key,'create_broadcast_draft',{accountId:'a',title:'AIから',text:'本文はログへ残さない',idempotencyKey:'create'});}
function request(broadcastId:string,extra={}){return {accountId:'a',broadcastId,expectedVersion:1,approverStaffId:'approver',idempotencyKey:'request',testMode:true,...extra};}
test('MCP-04/07/16/21: send_requestだけ、人が2人しか送らなくても承認待ち・同じキー1回・実送信0',async()=>{
 const c=await connect();const b=await draft(c.key);const first=await rpc(c.key,'request_broadcast_send',request(b.broadcastId));expect(first).toMatchObject({approvalStatus:'pending',version:2,sent:false,testMode:true});expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId))).toMatchObject({replayed:true});
 const p=await simulationPreview(d.db,b.broadcastId);await expect(scheduleSimulation(d.db,b.broadcastId,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'run')).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
 expect(d.raw.prepare('SELECT approval_status,status,success_count FROM broadcasts').get()).toEqual({approval_status:'pending',status:'draft',success_count:0});expect(d.raw.prepare("SELECT count(*) n FROM broadcast_approval_events WHERE action='requested'").get()).toEqual({n:1});expect(JSON.stringify(d.raw.prepare('SELECT * FROM mcp_call_logs').all())).not.toContain('本文はログへ残さない');
 d.raw.exec("UPDATE broadcasts SET approval_status='approved',approval_decided_by_staff_id='approver'");await scheduleSimulation(d.db,b.broadcastId,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'run');await processBroadcastSimulation(d.db,b.broadcastId,new Date(Date.now()+86400000));expect(await simulationPreview(d.db,b.broadcastId)).toMatchObject({state:'completed',sent:0});
});
test('MCP-04/07/09: read/draftは依頼不可・他接続・他店・現在権限と停止を確認',async()=>{
 const c=await connect(),other=await connect(),read=await connect('read'),draftOnly=await connect('draft');const b=await draft(c.key);
 for(const key of [read.key,draftOnly.key,other.key])expect(await rpc(key,'request_broadcast_send',request(b.broadcastId))).toEqual({error:true});
 expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId,{accountId:'b'}))).toEqual({error:true});
 d.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='o'");expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId))).toEqual({status:401});
 d.raw.exec("UPDATE staff_members SET access_level='full' WHERE id='o';UPDATE mcp_connections SET status='stopped'");expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId))).toEqual({status:401});
});
test('MCP-16/20: 承認済みでも接続停止は予定の実行を止める、記録失敗なら依頼も残さない',async()=>{
 const c=await connect(),b=await draft(c.key);d.raw.exec("CREATE TRIGGER request_fail BEFORE INSERT ON mcp_call_logs WHEN NEW.tool='request_broadcast_send' AND NEW.result='ok' BEGIN SELECT RAISE(ABORT,'request failure');END");
 expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId))).toEqual({error:true});expect(d.raw.prepare('SELECT approval_status FROM broadcasts').get()).toEqual({approval_status:'none'});d.raw.exec('DROP TRIGGER request_fail');await rpc(c.key,'request_broadcast_send',request(b.broadcastId));
 const p=await simulationPreview(d.db,b.broadcastId);d.raw.exec("UPDATE broadcasts SET approval_status='approved',approval_decided_by_staff_id='approver'");await scheduleSimulation(d.db,b.broadcastId,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'run');d.raw.exec("UPDATE mcp_connections SET status='stopped'");await processBroadcastSimulation(d.db,b.broadcastId,new Date(Date.now()+86400000));expect((await simulationPreview(d.db,b.broadcastId)).state).toBe('scheduled');
});

test('MCP-06/16: 人がAIの下書きを直すと出自を保ち、前の承認を無効にする',async()=>{
 const c=await connect(),b=await draft(c.key);await rpc(c.key,'request_broadcast_send',request(b.broadcastId));
 await saveSimulationDraft(d.db,'a','o','edit',{title:'人が直した',text:'確認済みの文',purpose:'notice',testMode:true,expectedVersion:2},b.broadcastId);
 expect(d.raw.prepare('SELECT approval_status,lock_version FROM broadcasts').get()).toEqual({approval_status:'none',lock_version:3});expect(d.raw.prepare('SELECT purpose,created_via FROM broadcast_execution_contexts').get()).toEqual({purpose:'notice',created_via:'mcp'});
 expect(d.raw.prepare("SELECT count(*) n FROM broadcast_approval_events WHERE action='cancelled'").get()).toEqual({n:1});
});

test('MCP-08/G9-6: 作った人も人として再確認後に承認できる。MCPの鍵では承認できない',async()=>{
 const c=await connect(),b=await draft(c.key);
 expect(await rpc(c.key,'request_broadcast_send',request(b.broadcastId,{approverStaffId:'o'}))).toMatchObject({approvalStatus:'pending'});
 expect(await rpc(c.key,'approve_broadcast',{accountId:'a',broadcastId:b.broadcastId})).toEqual({error:true});
 const human=gapApp(d,[broadcastApprovals]);const path=`/api/broadcasts/${b.broadcastId}/approval-approve`;
 expect((await human.request(path,{method:'POST'})).status).toBe(401);
 const viewed=d.raw.prepare('SELECT lock_version FROM broadcasts WHERE id=?').get(b.broadcastId) as {lock_version:number};
 const approved=await human.request(path,{method:'POST',headers:{Authorization:'Bearer lh_session:session','Content-Type':'application/json'},body:JSON.stringify({expectedVersion:viewed.lock_version})});expect(approved.status,await approved.clone().text()).toBe(200);
 expect(d.raw.prepare("SELECT approval_status,approval_decided_by_staff_id FROM broadcasts WHERE id=?").get(b.broadcastId)).toEqual({approval_status:'approved',approval_decided_by_staff_id:'o'});
 const p=await simulationPreview(d.db,b.broadcastId);await scheduleSimulation(d.db,b.broadcastId,{expectedVersion:p.version,confirmedRecipientCount:p.recipients,testMode:true},'human-run');
 await processBroadcastSimulation(d.db,b.broadcastId,new Date(Date.now()+86400000));expect(await simulationPreview(d.db,b.broadcastId)).toMatchObject({state:'completed',sent:0});
});

test('MCP-MIGRATION-01: 旧版で下書き作成の再送記録が複数でも725の移行は1行にまとめる',async()=>{
 const c=await connect(),b=await draft(c.key);
 d.raw.exec("INSERT INTO mcp_call_logs(id,connection_id,tool,account_id,kind,result,target_type,target_id,summary,at) SELECT id||'-retry',connection_id,tool,account_id,kind,result,target_type,target_id,summary,at FROM mcp_call_logs WHERE tool='create_broadcast_draft' AND result='ok';DROP TRIGGER broadcast_simulation_dispatch_insert;DROP TRIGGER broadcast_simulation_dispatch_update;DROP TABLE broadcast_execution_contexts;");
 const sql=readFileSync(new URL('../../../../packages/db/migrations/725_broadcast_execution_contexts.sql',import.meta.url),'utf8').split('-- B-354')[0];
 expect(()=>d.raw.exec(sql)).not.toThrow();
 expect(d.raw.prepare('SELECT broadcast_id,execution_mode FROM broadcast_execution_contexts').all()).toEqual([{broadcast_id:b.broadcastId,execution_mode:'simulation'}]);
});
