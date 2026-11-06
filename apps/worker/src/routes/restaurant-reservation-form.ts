import { auditLog } from '../lib/audit-log.js';
import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';
import { dbFor } from '../services/db-router.js';
import { hasOrganizationSelector,requiredAccount,organizationFor,storeBelongsTo } from './restaurant-test-definition.js';
import { readRestaurantReservationForm,saveRestaurantReservationForm,RestaurantReservationFormError,readRestaurantReservationFormRepair,repairRestaurantReservationForm } from '../services/restaurant-reservation-form.js';

async function scope(c:Context<Env>){
 if(!hasOrganizationSelector(c))return {response:requiredAccount(c)};
 const org=await organizationFor(c),storeId=c.req.param('storeId')??'';
 if(!org||!await storeBelongsTo(c,org.id,storeId))return {response:c.json({success:false,error:'見つかりません'},404)};
 const db=dbFor(c.env,storeId);
 const store=await db.prepare('SELECT line_account_id FROM rt_stores WHERE id=? AND organization_id=?').bind(storeId,org.id).first<{line_account_id:string|null}>();
 if(!store?.line_account_id)return {response:c.json({success:false,error:'この店のLINE公式アカウントを確認してください'},409)};
 return {db,storeId,accountId:store.line_account_id};
}
function failure(c:Context<Env>,error:unknown){
 if(!(error instanceof RestaurantReservationFormError))throw error;
 if(error.code==='invalid_form')return inputError(c,{success:false,code:error.code,error:error.message},422,['definition']);
 const status=error.code==='not_found'?404:error.code==='operator_required'?401:error.code==='invalid_saved_form'?503:409;
 return c.json({success:false,code:error.code,error:error.message},status);
}
export async function getRestaurantReservationForm(c:Context<Env>){
 const access=await scope(c);if(access.response)return access.response;
 try{return c.json({success:true,data:await readRestaurantReservationForm(access.db!,access.storeId!,access.accountId!)});}catch(error){
  if(error instanceof RestaurantReservationFormError&&error.code==='invalid_saved_form')return c.json({success:false,code:error.code,error:error.message,data:{repair:await readRestaurantReservationFormRepair(access.db!,access.storeId!,access.accountId!)}},503);
  return failure(c,error);
 }
}
export async function putRestaurantReservationForm(c:Context<Env>){
 const access=await scope(c);if(access.response)return access.response;
 const staff=c.get('staff');
 if(!staff?.id)return c.json({success:false,error:'ログインし直してください'},401);
 if(staff.role!=='owner'&&staff.role!=='admin'||staff.readOnly)return c.json({success:false,error:'オーナーか管理者が決めます'},403);
 const body=await c.req.json<{expectedVersion?:unknown;definition?:unknown;repairToken?:unknown}>().catch(()=>null);
 if(!body||!Number.isSafeInteger(body.expectedVersion)||Number(body.expectedVersion)<-1)return inputError(c,{success:false,error:'予約フォームを読み直してください'},400,['expectedVersion']);
 if(body.expectedVersion===-1){
  if(typeof body.repairToken!=='string')return inputError(c,{success:false,error:'修復する予約フォームを読み直してください'},400,['repairToken']);
  try{
   const repaired=await repairRestaurantReservationForm(access.db!,{storeId:access.storeId!,accountId:access.accountId!,staffId:staff.id,repairToken:body.repairToken,definition:body.definition});
   auditLog(c,'restaurant.reservation_form.repair',{id:access.storeId!,kind:'rt_store'},{lineAccountId:access.accountId!});
   return c.json({success:true,data:repaired});
  }catch(error){return failure(c,error);}
 }
 try{return c.json({success:true,data:await saveRestaurantReservationForm(access.db!,{storeId:access.storeId!,accountId:access.accountId!,staffId:staff.id,expectedVersion:Number(body.expectedVersion),definition:body.definition})});}catch(error){return failure(c,error);}
}
