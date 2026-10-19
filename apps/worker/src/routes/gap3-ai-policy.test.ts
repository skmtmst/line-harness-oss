import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import {accountAiFeatures} from './account-ai-features.js';
import {aiDrafts} from './ai-drafts.js';
import {hqBanners} from './hq-banners.js';
import {AI_DISCLOSURE_VERSION,accountAiSetting,g2OpenAiAvailable} from '../services/account-ai-features.js';
import {processBannerGeneration} from '../services/banner-jobs.js';
import {sha256Hex} from '../middleware/auth.js';
import {createLineAccount} from '@line-crm/db';
import {initializeAccountStyle} from '../services/style-setup.js';
let d:ReturnType<typeof gapFixture>;
beforeEach(()=>{d=gapFixture();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('external_forbidden');}));});
afterEach(()=>{expect(fetch).not.toHaveBeenCalled();d.raw.close();vi.unstubAllGlobals();});
const path='/api/ai-features/banner?account_id=a';
const body={enabled:true,expectedVersion:0,consent:true,disclosureVersion:AI_DISCLOSURE_VERSION};
async function put(b:unknown=body,staff=gapOwner,im=false){return gapApp(d,[accountAiFeatures],staff,im).request(path,{method:'PUT',headers:{Authorization:'Bearer lh_session:session','Content-Type':'application/json'},body:JSON.stringify(b)});}
async function session(){d.raw.prepare('INSERT INTO admin_sessions(token_hash,staff_id,expires_at,step_up_at) VALUES(?,?,?,?)').run(await sha256Hex('session'),'o',new Date(Date.now()+3600000).toISOString(),new Date().toISOString());}
test('新しいアカウントと初期セットはAIをオンにしない',async()=>{
 const fresh=await createLineAccount(d.db,{channelId:'fresh',name:'新店',channelAccessToken:'fake',channelSecret:'fake',tenantId:'t'},'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
 for(const a of ['a',fresh.id]){
  const result=await gapCall(gapApp(d,[aiDrafts]),'/api/ai-settings?account_id='+a);expect((await result.json() as any).data.mode).toBe('off');
  await initializeAccountStyle(d.db,a,'t','o');
  expect((await (await gapCall(gapApp(d,[aiDrafts]),'/api/ai-settings?account_id='+a)).json() as any).data.mode).toBe('off');
  for(const f of ['banner','google_review'] as const)expect(await accountAiSetting(d.db,a,f)).toMatchObject({enabled:false,version:0,consentBy:null});
 }
});
test('明示同意・本人再確認・版・権限。誰がいつ同意したかを原子的に残す',async()=>{
 expect((await put()).status).toBe(401);await session();
 expect((await put({...body,consent:false})).status).toBe(400);
 for(const [s,im] of [[{...gapOwner,readOnly:true},false],[{...gapOwner,role:'staff' as const},false],[gapOwner,true]] as const)expect((await put(body,s,im)).status).toBe(403);
 const response=await put();expect(response.status).toBe(200);expect((await response.json() as any).data).toMatchObject({enabled:true,version:1,consentBy:'o',disclosureVersion:AI_DISCLOSURE_VERSION,consentAt:expect.any(String)});
 expect((await put()).status).toBe(409);expect((await accountAiSetting(d.db,'b','banner')).enabled).toBe(false);expect((await accountAiSetting(d.db,'a','google_review')).enabled).toBe(false);
 const audit=d.raw.prepare("SELECT detail_json FROM operation_audit WHERE target_kind='account_ai_feature'").get() as any;expect(JSON.parse(audit.detail_json).consent).toMatchObject({by:'o',at:expect.any(String),disclosureVersion:AI_DISCLOSURE_VERSION});
 expect((await put({enabled:false,expectedVersion:1})).status).toBe(200);expect(await accountAiSetting(d.db,'a','banner')).toMatchObject({enabled:false,consentBy:'o',version:2});
 d.raw.exec("CREATE TRIGGER fail_consent BEFORE INSERT ON operation_audit BEGIN SELECT RAISE(ABORT,'audit failure');END");
 expect((await put({...body,expectedVersion:2})).status).toBe(503);expect((await accountAiSetting(d.db,'a','banner')).enabled).toBe(false);
});
test('バナー受付とキューの両方で既定off・後の停止を守る',async()=>{
 const a=gapApp(d,[hqBanners]);
 const r=await gapCall(a,'/api/hq/banners/projects/project/generations?account_id=a','POST',{});expect(r.status,await r.clone().text()).toBe(409);expect((await r.json() as any).code).toBe('ai_disabled');
 d.raw.exec(`INSERT INTO banner_projects(id,tenant_id,name) VALUES('project','t','見本');INSERT INTO banner_generations(id,tenant_id,project_id,status,mode,preset_key,aspect_ratio,api_size,quality,text_lines,person_option,custom_prompt,free_prompt,final_prompt,engine,requested_count,units_per_image,ai_account_id) VALUES('g','t','project','queued','banner','line_rich_message','1:1','1024x1024','medium','[]','without','','','prompt','openai',1,1,'a')`);
 await expect(processBannerGeneration({DB:d.db} as any,'g','t')).rejects.toMatchObject({code:'ai_disabled'});
 expect(d.raw.prepare('SELECT count(*) n FROM banner_images').get()).toEqual({n:0});
});
test('G2は既定も本番もOpenAIを呼ばず、設定がonでも拒否する',async()=>{
 d.raw.exec("INSERT INTO chats(id,friend_id,created_at,updated_at) VALUES('chat','f','now','now');INSERT INTO ai_settings(account_id,mode,updated_by) VALUES('a','draft_only','o')");
 for(const bindings of [{},{G2_OPENAI_ENABLED:'true'},{G2_OPENAI_ENABLED:'true',DEPLOY_ENV:'production'},{G2_OPENAI_ENABLED:'true',DEPLOY_ENV:'unknown'}])for(const kind of ['summary','draft']){
  const r=await gapCall(gapApp(d,[aiDrafts],gapOwner,false,{OPENAI_API_KEY:'fake',...bindings}),`/api/chats/chat/ai/${kind}`,'POST',{});expect(r.status).toBe(409);expect((await r.json() as any).error).toBe('g2_ai_unavailable');
 }
 expect(g2OpenAiAvailable({G2_OPENAI_ENABLED:'true',DEPLOY_ENV:'staging'})).toBe(true);
 expect(d.raw.prepare('SELECT count(*) n FROM ai_usage_counters').get()).toEqual({n:0});
});
