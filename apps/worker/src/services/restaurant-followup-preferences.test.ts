import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readRestaurantFollowupRows,setRestaurantFollowupRow } from './restaurant-followup-rows.js';
import { hasDatabaseTable } from './schema-presence.js';
import { readRestaurantFollowupSetupProgress,saveRestaurantFollowupNotUsing } from './restaurant-followup-preferences.js';
let t:SqliteD1;
beforeEach(()=>{t=createTestD1({foreignKeys:true});t.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','c','店','t','s');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store','org','店舗','S','a');`);});
afterEach(()=>t.raw.close());
it('初期設定の集計は未保存を推測せず、行も送信履歴も作らない',async()=>{
 t.raw.exec('DELETE FROM rt_store_followup_rows');
 const before=t.raw.prepare('SELECT total_changes() n').get();
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toEqual({notUsing:false,decidedAt:null,version:0,anyEnabled:false});
 expect(t.raw.prepare('SELECT total_changes() n').get()).toEqual(before);
 await saveRestaurantFollowupNotUsing(t.db,'store',0,'owner');
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toMatchObject({notUsing:true,version:1,anyEnabled:false});
});
it('未適用の環境では追加情報を返さず既存の判定へ任せる',async()=>{
 t.raw.exec('DROP TABLE rt_store_followup_preferences');
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toBeNull();
});
it('管理対象のオンを数え、別の店や旧の送り手の残りを数えない',async()=>{
 t.raw.exec(`INSERT INTO automation_definitions(id,line_account_id,name) VALUES('target','a','お礼');
 INSERT INTO rt_store_followup_targets(store_id,trigger,engine,automation_id,enabled) VALUES('store','post_visit','automation','target',1);`);
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toMatchObject({anyEnabled:true});
 expect(await readRestaurantFollowupSetupProgress(t.db,'missing')).toMatchObject({anyEnabled:false,notUsing:false});
 t.raw.exec("UPDATE rt_store_followup_targets SET enabled=0");
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toMatchObject({anyEnabled:false});
});

it('切替後の旧bindingが残っても集計・表示・使わない保存の判定は同じになる',async()=>{
 const before=(await readRestaurantFollowupRows(t.db,'store')).find(row=>row.trigger==='post_visit')!;
 await setRestaurantFollowupRow(t.db,'store','post_visit',before.version,true);
 t.raw.exec(`INSERT INTO automation_definitions(id,line_account_id,name) VALUES('target','a','お礼');
 INSERT INTO rt_store_followup_targets(store_id,trigger,engine,automation_id,enabled) VALUES('store','post_visit','automation','target',0);`);
 expect(await readRestaurantFollowupSetupProgress(t.db,'store')).toMatchObject({anyEnabled:false});
 expect((await readRestaurantFollowupRows(t.db,'store')).find(row=>row.trigger==='post_visit')).toMatchObject({enabled:false});
 expect(await saveRestaurantFollowupNotUsing(t.db,'store',0,'owner')).toMatchObject({notUsing:true});
});
it('表がある確認は共有し、無い確認だけ短期で更新する',async()=>{
 const spy=vi.spyOn(t.db,'prepare');
 await hasDatabaseTable(t.db,'rt_store_followup_targets');await hasDatabaseTable(t.db,'rt_store_followup_targets');
 expect(spy.mock.calls.filter(([sql])=>sql.includes('sqlite_master'))).toHaveLength(1);
 t.raw.exec('DROP TABLE rt_store_followup_preferences');
 vi.spyOn(Date,'now').mockReturnValue(10000);
 expect(await hasDatabaseTable(t.db,'rt_store_followup_preferences')).toBe(false);
 expect(await hasDatabaseTable(t.db,'rt_store_followup_preferences')).toBe(false);
 const count=spy.mock.calls.filter(([sql])=>sql.includes('sqlite_master')).length;
 vi.spyOn(Date,'now').mockReturnValue(15001);await hasDatabaseTable(t.db,'rt_store_followup_preferences');
 expect(spy.mock.calls.filter(([sql])=>sql.includes('sqlite_master'))).toHaveLength(count+1);vi.restoreAllMocks();
});
