import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createTestD1 } from '../test-utils/d1-sqlite.js';
import { saveTemplate } from './hq-templates/distribution.js';
import { saveCatalogStarter, listStarterCatalog } from './style-starter-catalog-save.js';
import { applyCatalogStarter } from './style-starter-catalog-apply.js';
import { initializeAccountStyle, saveProfile } from './style-setup.js';
import { catalogResourceSnapshot } from './style-starter-catalog-resources.js';
import type { HqTemplateAuthority } from './hq-templates/contract.js';
import type { StarterCatalogSelection } from '@line-crm/shared';
vi.mock('./account-access.js', () => ({ canAccessAllLineAccounts: async()=>true }));
let sql: ReturnType<typeof createTestD1>;
const authority: HqTemplateAuthority = {tenantId:'t',actorId:'owner',role:'owner',readOnly:false,accountScoped:false};
const bucket = {head:async()=>null,get:async()=>null,put:async()=>null,delete:async()=>{}} as unknown as R2Bucket;
const tag = (name='分類') => ({schemaVersion:1,folders:[],tag:{name,color:'#3B82F6',description:null,folderId:null}});
const message = (name='ご案内', text='カタログに保存した本文') => ({schemaVersion:1,template:{id:'hq-authored-message',name,category:'general',messageType:'text',messageContent:text,carouselActionsJson:null,carouselTapLimitMode:'none',carouselTapLimitText:null,questionJson:null,questionStatus:'draft'},media:[]});
async function catalog(type:'tag'|'template', definition:unknown) {
  const saved = await saveTemplate(sql.db,authority,{type,name:'見本',definition,requestId:crypto.randomUUID()});
  return { kind:type,templateId:saved.template.id,versionId:saved.template.current_version_id! } satisfies StarterCatalogSelection;
}
async function set(selections:StarterCatalogSelection[], autoInsert=true, expectedVersion=0) {
  return saveCatalogStarter(sql.db,'t','owner','standard',{expectedVersion,confirmed:true,autoInsert,definition:{mode:'catalog',items:[],selections}});
}
beforeEach(()=>{
  sql=createTestD1({foreignKeys:true,now:()=>new Date()});
  sql.raw.exec(`INSERT INTO tenants(id,name) VALUES('t','本部'),('other','別の本部');
    INSERT INTO line_accounts(id,tenant_id,channel_id,name,channel_access_token,channel_secret) VALUES('a','t','ca','店舗','fixture','fixture'),('b','other','cb','別店舗','fixture','fixture');
    INSERT INTO staff_members(id,name,role,api_key,tenant_id) VALUES('owner','統括','owner','owner-key','t'),('admin','店の担当者','admin','admin-key','t');
    UPDATE staff_members SET account_scope='accounts' WHERE id='admin';`);
});
afterEach(()=>{sql.raw.close();vi.restoreAllMocks()});
test('空の組を明示保存でき、標準文面で埋めず、未選択では投入しない',async()=>{
  await set([]);
  await initializeAccountStyle(sql.db,'a','t','owner');
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM templates').get()).toEqual({n:0});
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM rich_menu_groups').get()).toEqual({n:0});
  await saveProfile(sql.db,'a','t','owner',{expectedVersion:1,style:'standard'});
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM templates').get()).toEqual({n:0});
});
test('保存したカタログの版を固定し、新しい版へ勝手に差し替えない',async()=>{
  const choice=await catalog('tag',tag('最初の版'));
  await set([choice]);
  await saveTemplate(sql.db,authority,{name:'新しい版',definition:tag('次の版'),expectedRevision:1},choice.templateId);
  const saved=sql.raw.prepare('SELECT definition_json FROM style_starter_sets WHERE archived_at IS NULL').get() as {definition_json:string};
  expect(JSON.parse(saved.definition_json).selections).toEqual([choice]);
  await initializeAccountStyle(sql.db,'a','t','owner','standard');
  expect(sql.raw.prepare("SELECT name FROM tags WHERE line_account_id='a'").all()).toEqual([{name:'最初の版'}]);
});
test('店限定の担当者のスタイル選択でも、統括の承認済みの組だけを入れ、二回目は複製しない',async()=>{
  await set([await catalog('tag',tag())]);
  const saved=await initializeAccountStyle(sql.db,'a','t','admin','standard');
  expect(saved.catalogApplication?.items[0].state).toBe('succeeded');
  await applyCatalogStarter(sql.db,'t','a','admin','standard');
  expect(sql.raw.prepare("SELECT COUNT(*) n FROM tags WHERE line_account_id='a'").get()).toEqual({n:1});
  expect(sql.raw.prepare("SELECT initiated_by,approved_by,state FROM style_starter_catalog_items").get()).toEqual({initiated_by:'admin',approved_by:'owner',state:'succeeded'});
});
test('別統括の版・種類違い・未対応の種類を保存できない',async()=>{
  const choice=await catalog('tag',tag());
  sql.raw.prepare("UPDATE hq_templates SET tenant_id='other' WHERE id=?").run(choice.templateId);
  await expect(saveCatalogStarter(sql.db,'t','owner','standard',{expectedVersion:0,confirmed:true,definition:{mode:'catalog',items:[],selections:[choice]}})).rejects.toMatchObject({code:'catalog_version_unavailable'});
  sql.raw.prepare("UPDATE hq_templates SET tenant_id='t' WHERE id=?").run(choice.templateId);
  await expect(set([{...choice,kind:'form'}])).rejects.toMatchObject({code:'catalog_version_unavailable'});
  await expect(set([{...choice,kind:'visit_stamp'}])).rejects.toMatchObject({code:'invalid_starter_set'});
});
test('店限定・閲覧のみの承認では保存できず、承認者の権限が失われたら自動実行しない',async()=>{
  const choice=await catalog('tag',tag());
  await expect(saveCatalogStarter(sql.db,'t','admin','standard',{expectedVersion:0,confirmed:true,definition:{mode:'catalog',items:[],selections:[choice]}})).rejects.toMatchObject({code:'forbidden'});
  await set([choice]);
  sql.raw.exec("UPDATE staff_members SET access_level='read_only' WHERE id='owner'");
  await expect(initializeAccountStyle(sql.db,'a','t','admin','standard')).rejects.toMatchObject({code:'catalog_approval_unavailable'});
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM tags').get()).toEqual({n:0});
});
test('違う店の境界と自動投入オフを守る',async()=>{
  await set([await catalog('tag',tag())],false);
  await initializeAccountStyle(sql.db,'a','t','admin','standard');
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM tags').get()).toEqual({n:0});
  await set([await catalog('tag',tag('別'))],true,1);
  await initializeAccountStyle(sql.db,'b','other','owner','standard');
  await expect(applyCatalogStarter(sql.db,'t','b','owner','standard')).rejects.toMatchObject({code:'catalog_approval_unavailable'});
});
test('店が持つ同名タグを上書きせず、確認待ちにする',async()=>{
  await set([await catalog('tag',tag())]);
  sql.raw.exec("INSERT INTO tags(id,line_account_id,name,color) VALUES('local','a','分類','#ef4444')");
  const result=await initializeAccountStyle(sql.db,'a','t','admin','standard');
  expect(result.catalogApplication?.items[0]).toMatchObject({state:'blocked',reason:'catalog_local_changes'});
  expect(sql.raw.prepare("SELECT id,color FROM tags WHERE line_account_id='a'").all()).toEqual([{id:'local',color:'#ef4444'}]);
});
test('テンプレートを未公開の下書きで作り、カタログの本文と版を保つ',async()=>{
  await set([await catalog('template',message())]);
  const result=await initializeAccountStyle(sql.db,'a','t','admin','standard',{bucket,publicBaseUrl:'https://worker.test'});
  expect(result.catalogApplication?.items[0]).toMatchObject({state:'succeeded'});
  expect(sql.raw.prepare("SELECT published_version,draft_revision,draft_message_content FROM templates WHERE line_account_id='a'").get()).toEqual({published_version:0,draft_revision:1,draft_message_content:'カタログに保存した本文'});
  expect(sql.raw.prepare('SELECT COUNT(*) n FROM template_versions').get()).toEqual({n:0});
});
test('一度入った物を店で編集しても、再保存・再試行で上書きしない',async()=>{
  const choice=await catalog('tag',tag());await set([choice]);
  await initializeAccountStyle(sql.db,'a','t','admin','standard');
  const before=await catalogResourceSnapshot(sql.db,'a','tag',String((sql.raw.prepare("SELECT id FROM tags WHERE line_account_id='a'").get() as {id:string}).id));
  sql.raw.exec("UPDATE tags SET name='店で直した',version=version+1 WHERE line_account_id='a'");
  await saveProfile(sql.db,'a','t','admin',{expectedVersion:1,style:'standard'});
  expect(sql.raw.prepare("SELECT name FROM tags WHERE line_account_id='a'").all()).toEqual([{name:'店で直した'}]);
  expect(before).not.toBe(await catalogResourceSnapshot(sql.db,'a','tag',String((sql.raw.prepare("SELECT id FROM tags WHERE line_account_id='a'").get() as {id:string}).id)));
});
test('候補は同じ統括の現在の版と選択済みの版だけで、本文を返さない',async()=>{
  const choice=await catalog('template',message()); await set([choice]);
  const options=await listStarterCatalog(sql.db,'t');
  expect(options).toHaveLength(1);expect(options[0]).toMatchObject({kind:'template',versionId:choice.versionId,version:1});
  expect(options[0]).not.toHaveProperty('definition_json');
  expect(await listStarterCatalog(sql.db,'other')).toEqual([]);
});
