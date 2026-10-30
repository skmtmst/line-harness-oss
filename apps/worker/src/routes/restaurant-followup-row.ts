import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';
import { dbFor } from '../services/db-router.js';
import { isRestaurantFollowupTrigger, setRestaurantFollowupRow, readRestaurantFollowupRows, RestaurantFollowupRowError } from '../services/restaurant-followup-rows.js';
import { hasOrganizationSelector, requiredAccount, organizationFor, storeBelongsTo } from './restaurant-test-definition.js';

export async function putRestaurantFollowupRow(c: Context<Env>) {
  if(!hasOrganizationSelector(c))return requiredAccount(c);
  const org=await organizationFor(c),storeId=c.req.param('storeId')??'',trigger=c.req.param('trigger');
  if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'not_found'},404);
  const body=await c.req.json<{expectedRowVersion?:unknown;enabled?:unknown}>().catch(()=>null);
  if(!body||!Number.isSafeInteger(body.expectedRowVersion)||Number(body.expectedRowVersion)<1||typeof body.enabled!=='boolean'||!isRestaurantFollowupTrigger(trigger))
    return inputError(c,{success:false,error:'invalid_followup_row'},400,['expectedRowVersion','enabled','trigger']);
  try {
    const result=await setRestaurantFollowupRow(dbFor(c.env,storeId),storeId,trigger,Number(body.expectedRowVersion),body.enabled);
    return result?c.json({success:true,data:{...result,sendingStatus:'stopped'}}):c.json({success:false,error:'version_conflict'},409);
  } catch(error) {
    if(error instanceof RestaurantFollowupRowError)return c.json({success:false,code:'line_account_required',error:'LINE公式アカウントを接続してから、もう一度お試しください'},409);
    throw error;
  }
}

export const get__api_restaurant_test_followups_storeId_15 = async (c: Context<Env, "/api/restaurant-test/followups/:storeId">) => {
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c),storeId=c.req.param('storeId');
 if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'not_found'},404);
 const db=dbFor(c.env,storeId);
 const template=await db.prepare('SELECT * FROM rt_store_followup_templates WHERE store_id=?').bind(storeId).first();
 const rows=await readRestaurantFollowupRows(db,storeId);
 const bindings=(await db.prepare('SELECT * FROM rt_store_followup_step_bindings WHERE store_id=? ORDER BY trigger,step_id').bind(storeId).all()).results;
 const jobs=(await db.prepare(`SELECT j.* FROM scenario_source_jobs j LEFT JOIN rt_reservation_events e ON e.id=j.source_event_id WHERE e.store_id=? OR (j.source_kind='restaurant_anniversary' AND j.source_id=?) ORDER BY j.scheduled_at DESC LIMIT 100`).bind(storeId,storeId).all()).results;
 return c.json({success:true,data:{template,bindings,rows,jobs,editor:'common_scenario'}});
};

