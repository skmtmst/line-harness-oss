import {beforeEach,afterEach,test,expect,vi} from 'vitest';
import {formRouting} from './form-routing.js';
import {loadRoutingLayout,validateLayoutRouting,resolveRouting,issueRoutingToken,verifyRoutingToken} from '../features/forms/form-routing.js';
import {gapFixture,gapApp,gapCall,gapOwner} from '../test-utils/gap1.js';
import type {SqliteD1} from '../test-utils/d1-sqlite.js';
import {normalizeLayout,type FormLayout} from '@line-crm/shared';

let d:SqliteD1;
const target={menuId:'menu',staffId:'bs'};
const layout=()=>normalizeLayout({sections:[{id:'s1',name:'相談',blocks:[{id:'q',kind:'input',type:'radio',name:'subject',label:'内容',choices:[{id:'job',label:'転職'}]},{id:'book',kind:'input',type:'booking',name:'book',label:'予約',booking:{menuId:'menu',routing:{enabled:true,rules:[{conditions:[{questionId:'q',op:'is',value:'転職'}],target}],fallback:{menuId:'menu'}}}}]}]})!;
beforeEach(()=>{d=gapFixture();const l=JSON.stringify(layout());d.raw.prepare("INSERT INTO forms(id,name,fields,layout) VALUES('form','相談','[]',?)").run(l);d.raw.exec("INSERT INTO form_accounts(form_id,line_account_id) VALUES('form','a')");vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({sub:'Uf'}))));});
afterEach(()=>{d.raw.close();vi.unstubAllGlobals();});
test('B6-01 B6-02 B6-03 B6-13: fallback必須・自由記述不可・51行拒否',async()=>{
 await expect(validateLayoutRouting(d.db,'a',layout())).resolves.toBeUndefined();
 const l=layout(),blocks=l.sections[0].blocks as any[],r=blocks[1].booking.routing;delete r.fallback;await expect(validateLayoutRouting(d.db,'a',l)).rejects.toThrow('routing_invalid');r.fallback=target;
 blocks[0].type='text';await expect(validateLayoutRouting(d.db,'a',l)).rejects.toThrow('routing_question_invalid');blocks[0].type='radio';r.rules=Array.from({length:51},()=>r.rules[0]);await expect(validateLayoutRouting(d.db,'a',l)).rejects.toThrow('routing_invalid');
});
test('B6-04 B6-05 B6-08 B6-14: 上から当て、停止した先はfallback、閲覧のみの試しは保存しない',async()=>{
 const l=layout();expect(await resolveRouting(d.db,'a',l,{subject:'転職'})).toMatchObject({matchedIndex:0,target});expect(await resolveRouting(d.db,'a',l,{subject:'その他'})).toMatchObject({matchedIndex:-1});
 const old=d.raw.prepare("SELECT layout FROM forms WHERE id='form'").get();const a=gapApp(d,[formRouting],{...gapOwner,readOnly:true});const r=await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{subject:'転職'}});expect(r.status).toBe(200);expect(d.raw.prepare("SELECT layout FROM forms WHERE id='form'").get()).toEqual(old);
 d.raw.exec("UPDATE staff SET is_active=0 WHERE id='bs';INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('bs2','menu',1)");expect(await resolveRouting(d.db,'a',l,{subject:'転職'})).toMatchObject({matchedIndex:-1,fellBack:true});
});
test('B6-10: 署名・本人・店・期限・指定担当を守り改ざんを拒否',async()=>{
 // 不変版をDBに作ってから署名。存在しない版を署名しても予約で拒否する。
 const {publishFormVersion}=await import('@line-crm/db');const pub=await publishFormVersion(d.db,'form',1);expect(pub.kind).toBe('published');
 const version=(d.raw.prepare("SELECT current_published_version_id id FROM forms WHERE id='form'").get() as any).id;
 const token=await issueRoutingToken(d.db,{account:'a',friend:'f',formId:'form',versionId:version,blockId:'book',target,matchedIndex:0,exp:Date.now()+60000});
 await expect(verifyRoutingToken(d.db,'a','f',token,'menu','bs')).resolves.toMatchObject({matchedIndex:0});
 for(const [a,f,t,m,s] of [['a','f2',token,'menu','bs'],['b','f',token,'menu','bs'],['a','f',token+'x','menu','bs'],['a','f',token,'other','bs'],['a','f',token,'menu','bs2']])await expect(verifyRoutingToken(d.db,a,f,t,m,s)).rejects.toThrow('routing_token_invalid');
});
test('B6-06: 公開の版を読んで下書きの変更を混ぜない',async()=>{
 const {publishFormVersion}=await import('@line-crm/db');await publishFormVersion(d.db,'form',1);const l=layout();(l.sections[0].blocks[1] as any).booking.routing.rules=[];d.raw.prepare("UPDATE forms SET layout=? WHERE id='form'").run(JSON.stringify(l));
 expect((await resolveRouting(d.db,'a',(await loadRoutingLayout(d.db,'form','a',true)).layout,{subject:'転職'})).matchedIndex).toBe(0);
 expect((await resolveRouting(d.db,'a',(await loadRoutingLayout(d.db,'form','a',false)).layout,{subject:'転職'})).matchedIndex).toBe(-1);
});
test('保存前の振り分けを試せて、フォームは変更されない',async()=>{
 const before=d.raw.prepare("SELECT layout,content_revision FROM forms WHERE id='form'").get();
 const draft=layout();(draft.sections[0].blocks[1] as any).booking.routing.rules=[];
 const a=gapApp(d,[formRouting],{...gapOwner,readOnly:true});
 const r=await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{subject:'転職'},layout:draft});
 expect(r.status).toBe(200);expect((await r.json() as any).data.matchedIndex).toBe(-1);
 expect(d.raw.prepare("SELECT layout,content_revision FROM forms WHERE id='form'").get()).toEqual(before);
});
test('保存前の試行も別の店のフォームと不正な内容を拒む',async()=>{
 const a=gapApp(d,[formRouting],gapOwner);
 expect((await gapCall(a,'/api/forms/form/routing/preview?account_id=b','POST',{answers:{},layout:layout()})).status).toBe(404);
 expect((await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{},layout:{sections:'invalid'}})).status).toBe(400);
});
test('50行は受け付け、別店舗や停止中の行き先は拒む',async()=>{
 const l=layout(),routing=(l.sections[0].blocks[1] as any).booking.routing;
 routing.rules=Array.from({length:50},()=>structuredClone(routing.rules[0]));
 await expect(validateLayoutRouting(d.db,'a',l)).resolves.toBeUndefined();
 routing.rules[49].target={menuId:'another-account-menu'};
 await expect(validateLayoutRouting(d.db,'a',l)).rejects.toThrow('routing_target_invalid:49');
 routing.rules[49].target=target;
 d.raw.exec("UPDATE menus SET is_active=0 WHERE id='menu'");
 await expect(validateLayoutRouting(d.db,'a',l)).rejects.toThrow('routing_target_invalid:0');
});
test('フォームと予約メニューの閲覧権限で同じ店の担当の組だけを読める',async()=>{
 d.raw.exec("INSERT INTO booking_routing_staff_groups(id,line_account_id,name,staff_ids_json) VALUES('g1','a','相談','[]'),('g2','b','他店','[]'); INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price,is_active) VALUES('closed','a','停止',30,0,0); INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('bs','closed',1),('bs2','menu',0)");
 const viewer={...gapOwner,role:'staff' as const,readOnly:true,permissionKeys:[],viewPermissionKeys:['/form-submissions','/booking/menus']};
 const a=gapApp(d,[formRouting],viewer);
 const r=await gapCall(a,'/api/forms/form/routing/groups?account_id=a','GET');
 expect(r.status).toBe(200);expect((await r.json() as any).data).toEqual({groups:[{id:'g1',name:'相談'}],menus:[{id:'menu',name:'相談',durationMinutes:60}],staff:[{menuId:'menu',id:'bs',name:'担当'}]});
 expect((await gapCall(a,'/api/forms/form/routing/groups?account_id=b','GET')).status).toBe(404);
 const denied=gapApp(d,[formRouting],{...viewer,viewPermissionKeys:['/form-submissions']});
 expect((await gapCall(denied,'/api/forms/form/routing/groups?account_id=a','GET')).status).toBe(403);
});
test('3つの回答をすべて満たすときだけ行き先が当たる',async()=>{
 const draft=layout();const blocks=draft.sections[0].blocks as any[];
 blocks.splice(1,0,{id:'area',kind:'input',type:'radio',name:'area',label:'地域',choices:[{id:'tokyo',label:'東京'}]},{id:'rating',kind:'input',type:'rating',name:'rating',label:'評価'});
 blocks[3].booking.routing.rules[0].conditions.push({questionId:'area',op:'is',value:'東京'},{questionId:'rating',op:'between',value:[3,5]});
 await expect(validateLayoutRouting(d.db,'a',draft)).resolves.toBeUndefined();
 const a=gapApp(d,[formRouting],{...gapOwner,readOnly:true});
 const preview=async(answers:Record<string,unknown>)=>{const r=await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers,layout:draft});expect(r.status).toBe(200);return (await r.json() as any).data.matchedIndex;};
 expect(await preview({subject:'転職',area:'東京',rating:4})).toBe(0);
 expect(await preview({subject:'転職',area:'大阪',rating:4})).toBe(-1);
 expect(await preview({subject:'転職',area:'東京',rating:2})).toBe(-1);
});


test('両方入れる店でもフォームの所属と担当の店を分ける',async()=>{
 d.raw.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret,tenant_id) VALUES('c','ch3','同じ会社の別店','x','x','t'); INSERT INTO staff(id,line_account_id,name,display_name) VALUES('cs','c','別店担当','別店担当'); INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('cm','c','別店メニュー',30,0); INSERT INTO staff_menus(staff_id,menu_id,is_offered) VALUES('cs','cm',1),('cs','menu',1); INSERT INTO booking_routing_staff_groups(id,line_account_id,name,staff_ids_json) VALUES('cg','c','別店組','[]')");
 const a=gapApp(d,[formRouting],gapOwner);
 expect((await gapCall(a,'/api/forms/form/routing/groups?account_id=c')).status).toBe(404);
 const r=await gapCall(a,'/api/forms/form/routing/groups?account_id=a');expect(r.status).toBe(200);
 expect((await r.json() as any).data).toEqual({groups:[],menus:[{id:'menu',name:'相談',durationMinutes:60}],staff:[{menuId:'menu',id:'bs',name:'担当'}]});
});
test('試行は不正な条件を400で拒み、有効な配列を受け付ける',async()=>{
 const a=gapApp(d,[formRouting],gapOwner),draft=layout(),condition=(draft.sections[0].blocks[1] as any).booking.routing.rules[0].conditions[0];
 condition.op='in';condition.value='転職';
 expect((await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{subject:'転職'},layout:draft})).status).toBe(400);
 condition.value=['転職'];(draft.sections[0].blocks[1] as any).booking.routing.rules[0].target={menuId:7};
 expect((await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{subject:'転職'},layout:draft})).status).toBe(400);
 (draft.sections[0].blocks[1] as any).booking.routing.rules[0].target=target;expect((await gapCall(a,'/api/forms/form/routing/preview?account_id=a','POST',{answers:{subject:'転職'},layout:draft})).status).toBe(200);
});
