import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {createTestD1,type SqliteD1} from '../test-utils/d1-sqlite.js';
import {signSupportRelay} from '../services/support-relay.js';
import {meetCallback} from './meet-callback.js';
const push=vi.hoisted(()=>vi.fn(async()=>({requestId:'fake'})));
vi.mock('@line-crm/line-sdk',()=>({LineClient:class {pushMessage=push;}}));
let f:SqliteD1;
const payload={session_id:'s',scenario_id:'missing',line_user_id:'U11111111111111111111111111111111',status:'completed',transcripts:[{transcript:'人工の回答'}],completed_at:'2026-10-11T00:00:00Z'};
beforeEach(()=>{f=createTestD1();push.mockReset().mockResolvedValue({requestId:'fake'});f.raw.prepare('INSERT INTO friends(id,line_user_id,metadata) VALUES(?,?,?)').run('f',payload.line_user_id,'{}');});
afterEach(()=>f.raw.close());
async function post(){const body=JSON.stringify(payload),timestamp=String(Math.floor(Date.now()/1000));return meetCallback.request('/api/meet-callback',{method:'POST',body,headers:{'x-nen-timestamp':timestamp,'x-nen-signature':await signSupportRelay('fixture',timestamp,body)}},{DB:f.db,MEET_CALLBACK_SECRET:'fixture',LINE_CHANNEL_ACCESS_TOKEN:'fixture'} as never);}
it('R-MEET01: 結果保存の失敗は未完として残し、同じ受信で補う',async()=>{
 f.raw.exec("CREATE TRIGGER stop_metadata BEFORE UPDATE OF metadata ON friends BEGIN SELECT RAISE(ABORT,'fixture'); END");
 await post();f.raw.exec('DROP TRIGGER stop_metadata');
 expect((await post()).status).toBe(200);
 expect(JSON.parse((f.raw.prepare('SELECT metadata FROM friends').get() as {metadata:string}).metadata)).toMatchObject({meet_hearing:{session_id:'s'}});
 expect(push).toHaveBeenCalledTimes(1);
 expect((await post()).status).toBe(200);expect(push).toHaveBeenCalledTimes(1);
});
it('R-MEET01/B-248: 送信結果が不明なら失敗を見せ、自動で二度送らない',async()=>{
 push.mockRejectedValueOnce(new Error('fixture transport interrupted'));
 expect((await post()).status).toBe(202);expect((await post()).status).toBe(202);
 expect(push).toHaveBeenCalledTimes(1);
 expect(f.raw.prepare('SELECT status FROM outbound_send_requests').get()).toEqual({status:'unknown'});
});
