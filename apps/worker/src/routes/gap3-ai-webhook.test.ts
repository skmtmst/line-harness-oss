import {createHmac} from 'node:crypto';
import {Hono} from 'hono';
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import type { Env } from '../worker-env.js';
import {gapFixture} from '../test-utils/gap1.js';
const mocks=vi.hoisted(()=>({keyword:vi.fn(async()=>({matched:false,replyTokenConsumed:false})),reply:vi.fn(),push:vi.fn(),event:vi.fn(async()=>undefined)}));
vi.mock('@line-crm/line-sdk',async original=>({...await original<typeof import('@line-crm/line-sdk')>(),LineClient:vi.fn(function(){return {replyMessage:mocks.reply,pushMessage:mocks.push};})}));
vi.mock('../features/auto-replies/auto-reply.js',()=>({matchAndReply:mocks.keyword}));
vi.mock('../services/activity-mileage.js',()=>({awardActivityMileage:vi.fn(async()=>undefined)}));
vi.mock('../services/event-bus.js',()=>({fireEvent:mocks.event,logOutgoingMessage:vi.fn(async()=>undefined)}));
import {webhook} from './webhook.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{
 d=gapFixture();d.raw.exec("UPDATE line_accounts SET channel_secret='other-secret' WHERE id='b'");mocks.keyword.mockResolvedValue({matched:false,replyTokenConsumed:false});vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));
 d.raw.exec(`INSERT INTO ai_settings(account_id,mode,updated_by) VALUES('a','auto_qa','o'); INSERT INTO qa_entries(id,account_id,questions_json,answer_messages_json,status,created_by,updated_at,idempotency_key) VALUES('qa','a','["駐車場"]','[{"type":"text","text":"裏に2台"}]','published','o','now','qa')`);
});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();expect(mocks.reply).not.toHaveBeenCalled();expect(mocks.push).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
async function incoming(id:string,kind='text',text='駐車場'){
 const app=new Hono<Env>();app.route('/',webhook);const waits:Promise<unknown>[]=[];
 const body=JSON.stringify({destination:'channel',events:[{type:'message',timestamp:Date.now(),webhookEventId:id,deliveryContext:{isRedelivery:false},source:{type:'user',userId:'Uf'},replyToken:'fake-reply',message:{type:kind,id:'msg-'+id,...(kind==='text'?{text}:{packageId:'1',stickerId:'2'})}}]});
 const response=await app.request('/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Line-Signature':createHmac('sha256','secret').update(body).digest('base64')},body},{DB:d.db,LINE_CHANNEL_SECRET:'secret',LINE_CHANNEL_ACCESS_TOKEN:'test-token'} as Env['Bindings'],{waitUntil:(p:Promise<unknown>)=>{waits.push(p);},passThroughOnException:()=>{},props:{}} as ExecutionContext);
 expect(response.status).toBe(200);await Promise.all(waits);expect(d.raw.prepare('SELECT status,last_error FROM line_webhook_events WHERE webhook_event_id=?').get(id)).toMatchObject({status:'succeeded',last_error:null});
}
test('AI-09/17/32: 本物の受信経路はキーワードの後に模擬・最初の会話でも記録・再送で増えず未読を保つ',async()=>{
 await incoming('one');expect(d.raw.prepare('SELECT action,answer_snapshot_json FROM ai_answer_logs').get()).toEqual({action:'answered',answer_snapshot_json:'[{"type":"text","text":"裏に2台"}]'});
 expect(d.raw.prepare('SELECT status FROM chats WHERE friend_id=\'f\'').get()).toMatchObject({status:'unread'});
 await incoming('one');expect(d.raw.prepare('SELECT count(*) n FROM ai_answer_logs').get()).toEqual({n:1});
 mocks.keyword.mockResolvedValue({matched:true,replyTokenConsumed:true});await incoming('keyword');expect(d.raw.prepare('SELECT count(*) n FROM ai_answer_logs').get()).toEqual({n:1});
});
test('AI-13/14/33: 画像だけは人へ・人希望の後の別受信も自動で答えない',async()=>{
 await incoming('media','sticker');expect(d.raw.prepare('SELECT handoff_reason FROM ai_answer_logs').get()).toEqual({handoff_reason:'media'});
 await incoming('human','text','人と話したい');await incoming('after');expect(d.raw.prepare("SELECT action,handoff_reason FROM ai_answer_logs ORDER BY rowid DESC LIMIT 1").get()).toEqual({action:'handed_off',handoff_reason:'customer_requested'});
 expect(d.raw.prepare("SELECT count(*) n FROM ai_answer_logs WHERE action='answered'").get()).toEqual({n:0});
});
