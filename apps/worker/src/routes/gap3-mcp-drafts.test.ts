import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {mcpConnections} from './mcp-connections.js';
import {mcpRpc} from './mcp-rpc.js';
import {sha256Hex} from '../middleware/auth.js';
let d:ReturnType<typeof gapFixture>;
const app=()=>gapApp(d,[mcpConnections,mcpRpc]);
beforeEach(async()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));const hash=await sha256Hex('session');d.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at,step_up_at) VALUES(?,?,?,?)').run(hash,'o',new Date(Date.now()+3600000).toISOString(),new Date().toISOString());});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
async function create(level='draft'){
 const r=await app().request('/api/mcp-connections?account_id=a',{method:'POST',headers:{Authorization:'Bearer lh_session:session','Content-Type':'application/json'},body:JSON.stringify({name:'下書き用',level})});expect(r.status).toBe(201);return (await r.json() as any).data;
}
async function rpc(key:string,name:string,args:Record<string,unknown>){const r=await app().request('/mcp',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});if(r.status!==200)return {status:r.status};const result=(await r.json() as any).result;return result.isError?{error:true}:JSON.parse(result.content[0].text);}
const draft={accountId:'a',title:'お知らせ',text:'秘密を含む本文見本',idempotencyKey:'draft1'};
test('MCP-04/05/06/21: 下書きを作る段だけ保存・AI由来を保持・送る依頼は拒否・本文を記録しない',async()=>{
 const read=await create('read');expect(await rpc(read.key,'create_broadcast_draft',draft)).toEqual({error:true});expect(d.raw.prepare('SELECT count(*) n FROM broadcasts').get()).toEqual({n:0});
 const {key,connection}=await create();const result=await rpc(key,'create_broadcast_draft',draft);expect(result).toMatchObject({sent:false,replayed:false,createdVia:'mcp',connectionId:connection.id});
 const saved=d.raw.prepare('SELECT * FROM broadcasts').get() as any;expect(saved).toMatchObject({status:'draft',message_content:draft.text,success_count:0});expect(JSON.parse(saved.draft_payload_json)).toMatchObject({createdVia:'mcp',mcpConnectionId:connection.id});
 expect(await rpc(key,'request_broadcast_send',{accountId:'a',broadcastId:result.broadcastId})).toEqual({error:true});
 expect(JSON.stringify(d.raw.prepare('SELECT * FROM mcp_call_logs').all())).not.toContain(draft.text);
 expect(await rpc(key,'create_broadcast_draft',draft)).toMatchObject({broadcastId:result.broadcastId,replayed:true});expect(await rpc(key,'create_broadcast_draft',{...draft,text:'changed'})).toEqual({error:true});
 expect(d.raw.prepare("SELECT count(*) n FROM mcp_call_logs WHERE tool='create_broadcast_draft' AND result='ok'").get()).toEqual({n:1});
 expect(await rpc(key,'create_broadcast_draft',{...draft,idempotencyKey:'other',accountId:'b'})).toEqual({error:true});
 expect(await rpc(key,'create_broadcast_draft',{...draft,idempotencyKey:'scheduled',scheduledAt:'2027-01-01'})).toEqual({error:true});
});
test('MCP-05/09/20: この接続の下書きだけ変更・古い版と承認中は拒否・停止と現在の権限を毎回確認',async()=>{
 const a=await create(),b=await create();const first=await rpc(a.key,'create_broadcast_draft',draft);
 const update={accountId:'a',broadcastId:first.broadcastId,expectedVersion:1,title:'直した題',text:'直した文'};
 expect(await rpc(b.key,'update_broadcast_draft',update)).toEqual({error:true});expect(await rpc(a.key,'update_broadcast_draft',update)).toMatchObject({version:2,sent:false});expect(await rpc(a.key,'update_broadcast_draft',update)).toEqual({error:true});
 d.raw.exec("UPDATE broadcasts SET approval_status='pending'");expect(await rpc(a.key,'update_broadcast_draft',{...update,expectedVersion:2})).toEqual({error:true});d.raw.exec("UPDATE broadcasts SET approval_status='none',status='scheduled'");expect(await rpc(a.key,'update_broadcast_draft',{...update,expectedVersion:2})).toEqual({error:true});
 d.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='o'");expect(await rpc(a.key,'create_broadcast_draft',{...draft,idempotencyKey:'new'})).toEqual({status:401});d.raw.exec("UPDATE staff_members SET access_level='full',account_scope='accounts' WHERE id='o'");
 expect(await rpc(a.key,'create_broadcast_draft',{...draft,idempotencyKey:'scoped'})).toEqual({error:true});
 d.raw.exec("UPDATE staff_members SET account_scope='all' WHERE id='o'");expect((await gapCall(app(),`/api/mcp-connections/${a.connection.id}/stop?account_id=a`,'POST',{expectedVersion:1})).status).toBe(200);expect(await rpc(a.key,'create_broadcast_draft',{...draft,idempotencyKey:'stopped'})).toEqual({status:401});
 expect(d.raw.prepare('SELECT count(*) n FROM broadcasts').get()).toEqual({n:1});
});
test('MCP-05: 保存と出自の記録は同時。記録の失敗で本文も残らない',async()=>{
 const {key}=await create();d.raw.exec("CREATE TRIGGER fail_origin BEFORE INSERT ON mcp_call_logs WHEN NEW.tool='create_broadcast_draft' AND NEW.result='ok' BEGIN SELECT RAISE(ABORT,'fail_origin'); END");
 expect(await rpc(key,'create_broadcast_draft',draft)).toEqual({error:true});expect(d.raw.prepare('SELECT count(*) n FROM broadcasts').get()).toEqual({n:0});
});
