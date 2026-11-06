import { logger } from '@line-crm/shared/server';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { defaultRestaurantReservationForm } from '@line-crm/shared';
import { createTestD1,type SqliteD1 } from '../test-utils/d1-sqlite.js';
import { readRestaurantReservationForm,saveRestaurantReservationForm,readRestaurantCustomerReservationForm,readRestaurantReservationFormHealth,readRestaurantReservationFormRepair,repairRestaurantReservationForm } from './restaurant-reservation-form.js';
let fixture:SqliteD1;
beforeEach(()=>{
 fixture=createTestD1({foreignKeys:true});fixture.raw.exec(`
 INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','ca','A','t','s'),('b','cb','B','t','s');
 INSERT INTO rt_organizations(id,account_id,name) VALUES('org','a','組織');
 INSERT INTO rt_stores(id,organization_id,name,code,line_account_id) VALUES('store-a','org','店A','A','a'),('store-a2','org','店A2','A2',NULL),('store-b','org','店B','B','b');`);
});
afterEach(()=>fixture.raw.close());
const save=(definition:unknown=defaultRestaurantReservationForm(),expectedVersion=0)=>saveRestaurantReservationForm(fixture.db,{storeId:'store-a',accountId:'a',staffId:'owner',expectedVersion,definition});
it('未保存の設定は同じ既定値を返し、読むだけでは設定の行を作らない',async()=>{
 const before=fixture.raw.prepare('SELECT count(*) n FROM account_settings').get();
 expect(await readRestaurantReservationForm(fixture.db,'store-a','a')).toEqual({version:0,definition:defaultRestaurantReservationForm()});
 expect(fixture.raw.prepare('SELECT count(*) n FROM account_settings').get()).toEqual(before);
});
it('店を分け、未接続や別アカウントの店には書かない',async()=>{
 const definition={...defaultRestaurantReservationForm(),title:'夜のお席のご予約'};
 expect(await save(definition)).toMatchObject({version:1,definition:{title:definition.title}});
 await expect(readRestaurantReservationForm(fixture.db,'store-a2','a')).rejects.toMatchObject({code:'not_found'});
 expect(await readRestaurantReservationForm(fixture.db,'store-b','b')).toMatchObject({version:0});
 await expect(saveRestaurantReservationForm(fixture.db,{storeId:'store-b',accountId:'a',staffId:'owner',expectedVersion:0,definition})).rejects.toMatchObject({code:'not_found'});
 expect(fixture.raw.prepare("SELECT count(*) n FROM account_settings WHERE key='restaurant.reservation_form:store-b'").get()).toEqual({n:0});
});
it('同じ版から並行して保存しても1つだけ通り、古い内容を上書きしない',async()=>{
 const results=await Promise.allSettled([save({...defaultRestaurantReservationForm(),title:'A'}),save({...defaultRestaurantReservationForm(),title:'B'})]);
 expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
 expect(results.filter(result=>result.status==='rejected')).toHaveLength(1);
 expect(await readRestaurantReservationForm(fixture.db,'store-a','a')).toMatchObject({version:1});
 await expect(save()).rejects.toMatchObject({code:'version_conflict'});
});
for(const id of ['name','dateTime','guestCount'])it(`${id}は必須を外したり削除したりできず保存も行わない`,async()=>{
 const definition=defaultRestaurantReservationForm();
 await expect(save({...definition,fields:definition.fields.map(field=>field.id===id?{...field,required:false}:field)})).rejects.toMatchObject({code:'invalid_form'});
 await expect(save({...definition,fields:definition.fields.filter(field=>field.id!==id)})).rejects.toMatchObject({code:'invalid_form'});
 expect((await readRestaurantReservationForm(fixture.db,'store-a','a')).version).toBe(0);
});
it('壊れた保存済み設定を未保存の見本として表示したり上書きしたりしない',async()=>{
 await save();fixture.raw.exec("UPDATE account_settings SET value='{broken' WHERE key='restaurant.reservation_form:store-a'");
 await expect(readRestaurantReservationForm(fixture.db,'store-a','a')).rejects.toMatchObject({code:'invalid_saved_form'});
 await expect(save(defaultRestaurantReservationForm(),1)).rejects.toMatchObject({code:'invalid_saved_form'});
 expect(fixture.raw.prepare("SELECT value FROM account_settings WHERE key='restaurant.reservation_form:store-a'").get()).toEqual({value:'{broken'});
});

for(const broken of ['{broken',JSON.stringify({version:5,data:{title:'private-title',fields:[]}})])it('壊れた設定は顧客だけ必須3項目へ戻し、読取後の修復と確定を競合させない',async()=>{
 await save();fixture.raw.prepare("UPDATE account_settings SET value=? WHERE key='restaurant.reservation_form:store-a'").run(broken);
 const warn=vi.spyOn(logger,'warn').mockImplementation(()=>{});
 try{
  const snapshot=await readRestaurantCustomerReservationForm(fixture.db,'store-a','a');
  expect(snapshot.form.version).toBe(-1);
  expect(snapshot.form.definition.fields.filter(field=>field.enabled).map(field=>field.id)).toEqual(['name','dateTime','guestCount']);
  expect(await snapshot.isCurrent()).toBe(true);await expect(snapshot.guard.first()).resolves.toBeTruthy();
  expect(await readRestaurantReservationFormHealth(fixture.db,'store-a','a')).toMatchObject({available:false,repairPath:'/restaurant-test/line-followup?store_id=store-a&repair_form=1'});
  await expect(readRestaurantReservationForm(fixture.db,'store-a','a')).rejects.toMatchObject({code:'invalid_saved_form'});
  fixture.raw.prepare("UPDATE account_settings SET value=? WHERE key='restaurant.reservation_form:store-a'").run(JSON.stringify({version:2,data:defaultRestaurantReservationForm()}));
  expect(await snapshot.isCurrent()).toBe(false);await expect(snapshot.guard.first()).rejects.toThrow();
  expect(warn).toHaveBeenCalledWith('restaurant_reservation_form_recovery');expect(JSON.stringify(warn.mock.calls)).not.toContain('private-title');
 }finally{warn.mockRestore();}
});

it('破損の修復は読んだ内容と操作者を確認し、同時に直された設定を上書きしない',async()=>{
 await save();fixture.raw.exec("UPDATE account_settings SET value='{broken' WHERE key='restaurant.reservation_form:store-a'");
 const repair=(await readRestaurantReservationFormRepair(fixture.db,'store-a','a'))!;
 const input={storeId:'store-a',accountId:'a',staffId:'owner',repairToken:repair.repairToken,definition:repair.definition};
 await expect(repairRestaurantReservationForm(fixture.db,{...input,staffId:''})).rejects.toMatchObject({code:'operator_required'});
 await expect(repairRestaurantReservationForm(fixture.db,{...input,repairToken:'stale'})).rejects.toMatchObject({code:'version_conflict'});
 expect(await repairRestaurantReservationForm(fixture.db,input)).toMatchObject({version:1});
 await expect(repairRestaurantReservationForm(fixture.db,input)).rejects.toMatchObject({code:'version_conflict'});
 expect(await readRestaurantReservationFormHealth(fixture.db,'store-a','a')).toEqual({available:true});
 expect(JSON.parse((fixture.raw.prepare("SELECT value FROM account_settings WHERE key='restaurant.reservation_form:store-a'").get() as {value:string}).value).repairedBy).toBe('owner');
});
