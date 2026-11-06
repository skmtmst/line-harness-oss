import { logger } from '@line-crm/shared/server';
import { getAccountSetting,saveVersionedAccountSetting } from '@line-crm/db';
import { defaultRestaurantReservationForm,parseRestaurantReservationForm,type RestaurantReservationForm,type RestaurantReservationFormSettings } from '@line-crm/shared';

export class RestaurantReservationFormError extends Error {
 constructor(public readonly code:'not_found'|'invalid_form'|'invalid_saved_form'|'version_conflict'|'operator_required',message:string){super(message);}
}
export const RESTAURANT_RESERVATION_FORM_RECOVERY_NOTICE='予約フォームの設定が読めないため、最小の項目で受け付けています。直してください';
function settingKey(storeId:string){return `restaurant.reservation_form:${storeId}`;}
async function requireStore(db:D1Database,storeId:string,accountId:string){
 if(!await db.prepare('SELECT 1 FROM rt_stores WHERE id=? AND line_account_id=?').bind(storeId,accountId).first())
  throw new RestaurantReservationFormError('not_found','見つかりません');
}
/** SELECTのみ。未保存の既定値と、壊れた設定を混同しない。 */
export async function readRestaurantReservationForm(db:D1Database,storeId:string,accountId:string):Promise<RestaurantReservationFormSettings>{
 await requireStore(db,storeId,accountId);
 const raw=await getAccountSetting(db,accountId,settingKey(storeId));
 if(raw===null)return {version:0,definition:defaultRestaurantReservationForm()};
 return parseSavedForm(raw);
}
function parseSavedForm(raw:string):RestaurantReservationFormSettings{
 try{
  const saved=JSON.parse(raw) as {version?:unknown;data?:unknown};
  const parsed=parseRestaurantReservationForm(saved?.data);
  if(!Number.isSafeInteger(saved?.version)||Number(saved.version)<1||!parsed.ok)throw new Error('invalid_saved_form');
  return {version:Number(saved.version),definition:parsed.value};
 }catch{throw new RestaurantReservationFormError('invalid_saved_form',RESTAURANT_RESERVATION_FORM_RECOVERY_NOTICE);}
}
/** お客さまの受付だけ最小の項目へ戻す。読んだ設定そのものを確定と同じbatchで照合する。 */
export async function readRestaurantCustomerReservationForm(db:D1Database,storeId:string,accountId:string){
 await requireStore(db,storeId,accountId);
 const key=settingKey(storeId),raw=await getAccountSetting(db,accountId,key);
 let form:RestaurantReservationFormSettings;
 try{form=raw===null?{version:0,definition:defaultRestaurantReservationForm()}:parseSavedForm(raw);}
 catch(error){
  if(!(error instanceof RestaurantReservationFormError)||error.code!=='invalid_saved_form')throw error;
  logger.warn('restaurant_reservation_form_recovery');
  const definition=defaultRestaurantReservationForm();
  definition.fields=definition.fields.map(field=>({...field,enabled:field.required}));
  form={version:-1,definition};
 }
 const guard=db.prepare("SELECT json(CASE WHEN (SELECT value FROM account_settings WHERE line_account_id=? AND key=?) IS ? THEN '{}' ELSE 'RESTAURANT_FORM_CHANGED' END)").bind(accountId,key,raw);
 return {form,guard,isCurrent:async()=>await getAccountSetting(db,accountId,key)===raw};
}
export async function readRestaurantReservationFormHealth(db:D1Database,storeId:string,accountId:string){
 try{await readRestaurantReservationForm(db,storeId,accountId);return {available:true as const};}
 catch(error){
  if(!(error instanceof RestaurantReservationFormError)||error.code!=='invalid_saved_form')throw error;
  return {available:false as const,message:RESTAURANT_RESERVATION_FORM_RECOVERY_NOTICE,repairPath:`/restaurant-test/line-followup?store_id=${encodeURIComponent(storeId)}&repair_form=1`};
 }
}

export async function saveRestaurantReservationForm(db:D1Database,input:{storeId:string;accountId:string;staffId:string;expectedVersion:number;definition:unknown}):Promise<RestaurantReservationFormSettings>{
 if(!input.staffId)throw new RestaurantReservationFormError('operator_required','ログインし直してください');
 const parsed=parseRestaurantReservationForm(input.definition);
 if(!parsed.ok)throw new RestaurantReservationFormError('invalid_form',parsed.error);
 const current=await readRestaurantReservationForm(db,input.storeId,input.accountId);
 if(!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0||current.version!==input.expectedVersion)
  throw new RestaurantReservationFormError('version_conflict','予約フォームが更新されました。読み直してください');
 const saved=await saveVersionedAccountSetting<RestaurantReservationForm>(db,{accountId:input.accountId,key:settingKey(input.storeId),expectedVersion:input.expectedVersion,data:parsed.value});
 if(saved.status!=='saved')throw new RestaurantReservationFormError('version_conflict','予約フォームが更新されました。読み直してください');
 return {version:saved.setting.version,definition:saved.setting.data};
}

async function repairToken(raw:string){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
 return Array.from(new Uint8Array(bytes),value=>value.toString(16).padStart(2,'0')).join('');
}
/** 壊れた設定は通常保存で上書きせず、読んだ破損内容を指定した明示的な修復だけ受ける。 */
export async function readRestaurantReservationFormRepair(db:D1Database,storeId:string,accountId:string){
 await requireStore(db,storeId,accountId);
 const raw=await getAccountSetting(db,accountId,settingKey(storeId));
 if(raw===null)return null;
 try{parseSavedForm(raw);return null;}catch(error){if(!(error instanceof RestaurantReservationFormError))throw error;}
 return {version:-1,definition:defaultRestaurantReservationForm(),repairToken:await repairToken(raw)};
}
export async function repairRestaurantReservationForm(db:D1Database,input:{storeId:string;accountId:string;staffId:string;repairToken:string;definition:unknown}){
 if(!input.staffId)throw new RestaurantReservationFormError('operator_required','ログインし直してください');
 const parsed=parseRestaurantReservationForm(input.definition);
 if(!parsed.ok)throw new RestaurantReservationFormError('invalid_form',parsed.error);
 await requireStore(db,input.storeId,input.accountId);
 const key=settingKey(input.storeId),raw=await getAccountSetting(db,input.accountId,key);
 if(raw===null||await repairToken(raw)!==input.repairToken)throw new RestaurantReservationFormError('version_conflict','予約フォームが更新されました。読み直してください');
 let version=1;
 try{
  const saved=JSON.parse(raw);
  if(Number.isSafeInteger(saved?.version)&&saved.version>0&&saved.version<Number.MAX_SAFE_INTEGER)version=saved.version+1;
 }catch{/* JSONを読み取れない場合も、明示的な修復で受付を元に戻せる。 */}
 try{parseSavedForm(raw);throw new RestaurantReservationFormError('version_conflict','予約フォームが更新されました。読み直してください');}
 catch(error){if(!(error instanceof RestaurantReservationFormError)||error.code!=='invalid_saved_form')throw error;}
 const result=await db.prepare('UPDATE account_settings SET value=?,updated_at=? WHERE line_account_id=? AND key=? AND value=?')
  .bind(JSON.stringify({version,data:parsed.value,repairedBy:input.staffId}),new Date().toISOString(),input.accountId,key,raw).run();
 if(result.meta.changes!==1)throw new RestaurantReservationFormError('version_conflict','予約フォームが更新されました。読み直してください');
 return {version,definition:parsed.value};
}
