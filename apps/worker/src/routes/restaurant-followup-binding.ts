import type { Context } from 'hono';
import type { Env } from '../worker-env.js';
import { inputError } from '../lib/input-errors.js';
import { dbFor } from '../services/db-router.js';
import { validRestaurantFollowupTiming } from '../services/restaurant-followup-timing.js';
import { isRestaurantFollowupTrigger } from '../services/restaurant-followup-rows.js';
import { hasOrganizationSelector, requiredAccount, organizationFor, storeBelongsTo } from './restaurant-test-definition.js';

export const updateRestaurantFollowupBinding=async(c:Context<Env>)=>{
 if(!hasOrganizationSelector(c))return requiredAccount(c);
 const org=await organizationFor(c),storeId=c.req.param('storeId')??'';
 if(!org||!await storeBelongsTo(c,org.id,storeId))return c.json({success:false,error:'not_found'},404);
 const b=await c.req.json<{expectedVersion?:number;trigger?:string;offsetMinutes?:number;enabled?:boolean;anniversaryDaysBefore?:number;anniversaryTime?:string}>().catch(()=>null);
 if(!b||!Number.isSafeInteger(b.expectedVersion)||Number(b.expectedVersion)<1||!isRestaurantFollowupTrigger(b.trigger)||typeof b.enabled!=='boolean')return inputError(c,{success:false,error:'invalid_binding'},400,['expectedVersion','trigger','enabled']);
 if(b.anniversaryDaysBefore!==undefined) {
  if(b.trigger!=='anniversary_before'||!Number.isSafeInteger(b.anniversaryDaysBefore)||b.anniversaryDaysBefore<1||b.anniversaryDaysBefore>365)return inputError(c,{success:false,error:'invalid_anniversary_days'},400,['anniversaryDaysBefore']);
  if(b.offsetMinutes!==undefined&&b.offsetMinutes!==-b.anniversaryDaysBefore*1440)return inputError(c,{success:false,error:'invalid_anniversary_days'},400,['offsetMinutes']);
  b.offsetMinutes=-b.anniversaryDaysBefore*1440;
 }
 if(typeof b.offsetMinutes!=='number'||!validRestaurantFollowupTiming(b.trigger,b.offsetMinutes,b.anniversaryTime))return inputError(c,{success:false,error:'invalid_timing'},400,['offsetMinutes','anniversaryTime']);
 const changed=await dbFor(c.env,storeId).prepare(`INSERT INTO rt_store_followup_step_bindings(store_id,trigger,step_id,offset_minutes,enabled,anniversary_time)
  SELECT ?,?,?,?,?,COALESCE(?,'10:00') WHERE EXISTS(SELECT 1 FROM rt_store_followup_templates t JOIN scenario_steps step ON step.scenario_id=t.scenario_id
   WHERE t.store_id=? AND t.template_version=? AND step.id=?)
  AND (?='POST' OR EXISTS(SELECT 1 FROM rt_store_followup_step_bindings WHERE store_id=? AND trigger=? AND step_id=?))
  ON CONFLICT(store_id,trigger,step_id) DO UPDATE SET offset_minutes=excluded.offset_minutes,enabled=excluded.enabled,anniversary_time=COALESCE(?,anniversary_time),version=version+1`)
  .bind(storeId,b.trigger,c.req.param('stepId'),b.offsetMinutes,b.enabled?1:0,b.anniversaryTime??null,storeId,b.expectedVersion,c.req.param('stepId'),c.req.method,storeId,b.trigger,c.req.param('stepId'),b.anniversaryTime??null).run();
 return changed.meta.changes?c.json({success:true,data:{stopped:true}}):c.json({success:false,error:'version_conflict'},409);
};
