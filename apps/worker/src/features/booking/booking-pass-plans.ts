import {GapError} from '../../services/gap-common.js';
import {EntitlementError} from './entitlement-error.js';
export type PassPlanWrite={kind:'ticket'|'monthly';name:string;price:number;count:number|null;monthlyLimit:number|null;validDays:number;menuIds:string[];allowWithoutPass:boolean;eventIds?:string[]| null};
export function passPlanInput(b:Record<string,unknown>):PassPlanWrite{
 if(!['ticket','monthly'].includes(String(b.kind))||typeof b.name!=='string'||!b.name.trim()||b.name.length>100||!Number.isSafeInteger(b.price)||Number(b.price)<0||Number(b.price)>100000000||!Number.isInteger(b.validDays)||Number(b.validDays)<1||Number(b.validDays)>3650||!Array.isArray(b.menuIds)||b.menuIds.length>100||b.menuIds.some(x=>typeof x!=='string')||new Set(b.menuIds).size!==b.menuIds.length||typeof b.allowWithoutPass!=='boolean'||(b.kind==='ticket'?(!Number.isInteger(b.count)||Number(b.count)<1||b.monthlyLimit!=null):(b.monthlyLimit!==null&&(!Number.isInteger(b.monthlyLimit)||Number(b.monthlyLimit)<1)||b.count!=null)))throw new GapError('invalid_pass_plan');
 const eventIds=eventScopeInput(b.eventIds);
 return {eventIds,kind:b.kind as PassPlanWrite['kind'],name:b.name.trim(),price:Number(b.price),count:b.kind==='ticket'?Number(b.count):null,monthlyLimit:b.kind==='monthly'&&b.monthlyLimit!==null?Number(b.monthlyLimit):null,validDays:Number(b.validDays),menuIds:b.menuIds as string[],allowWithoutPass:b.allowWithoutPass};
}
export function passPlanView(r:Record<string,unknown>){return {id:String(r.id),kind:r.kind,name:r.name,price:r.price,count:r.count,monthlyLimit:r.monthly_limit,eventIds:r.event_target_scope_json==null?null:JSON.parse(String(r.event_target_scope_json)),validDays:r.valid_days,menuIds:JSON.parse(String(r.target_scope_json)),allowWithoutPass:!!r.allow_without_pass,status:r.status,version:r.version};}
export async function expandPlanGrant(db:D1Database,a:string,b:Record<string,unknown>){
 if(b.planId===undefined)return b;
 if(typeof b.planId!=='string')throw new EntitlementError('invalid_plan',400);
 const r=await db.prepare("SELECT * FROM booking_pass_plans WHERE id=? AND line_account_id=? AND status='on_sale'").bind(b.planId,a).first<Record<string,unknown>>();if(!r)throw new EntitlementError('plan_unavailable',409);
 const validFrom=typeof b.validFrom==='string'?b.validFrom:new Date().toISOString();
 if(!Number.isFinite(Date.parse(validFrom)))throw new EntitlementError('invalid_input',400);
 return {...b,kind:r.kind,name:r.name,remaining:r.kind==='ticket'?r.count:undefined,monthlyLimit:r.kind==='monthly'?r.monthly_limit:undefined,menuId:null,validFrom,expiresAt:new Date(Date.parse(validFrom)+Number(r.valid_days)*86400000).toISOString()};
}
export async function passUnusable(db:D1Database,e:{id:string;menu_id:string|null;kind:string;remaining:number|null;monthRemaining:number|null;valid_from:string;expires_at:string},a:string,menu:string|undefined,at:string){
 const extra=await db.prepare('SELECT e.billing_status,e.grace_until,p.target_scope_json FROM booking_entitlements e LEFT JOIN booking_pass_plans p ON p.id=e.plan_id AND p.line_account_id=e.line_account_id WHERE e.id=? AND e.line_account_id=?').bind(e.id,a).first<{billing_status:string;grace_until:string|null;target_scope_json:string|null}>();
 if(extra?.billing_status==='stopped'||extra?.billing_status==='grace'&&extra.grace_until&&Date.parse(extra.grace_until)<=Date.now())return 'billing_stopped';
 if(Date.parse(at)<Date.parse(e.valid_from)||Date.parse(at)>=Date.parse(e.expires_at))return 'expired';
 if(menu&&(e.menu_id&&e.menu_id!==menu||extra?.target_scope_json&&JSON.parse(extra.target_scope_json).length&&!JSON.parse(extra.target_scope_json).includes(menu)))return 'menu_out_of_scope';
 if(e.kind==='ticket'?Number(e.remaining)<=0:e.monthRemaining!==null&&e.monthRemaining<=0)return 'month_used_up';return null;
}
export async function assertPassRequirement(db:D1Database,a:string,menu:string,entitlement:unknown){
 const required=await db.prepare("SELECT id FROM booking_pass_plans WHERE line_account_id=? AND status!='draft' AND allow_without_pass=0 AND (json_array_length(target_scope_json)=0 OR EXISTS(SELECT 1 FROM json_each(target_scope_json) WHERE value=?)) LIMIT 1").bind(a,menu).first();
 if(required&&!entitlement)throw new EntitlementError('pass_required',400);
}

export function eventScopeInput(value:unknown):string[]|null|undefined {
 if(value===undefined||value===null)return value;
 if(!Array.isArray(value)||value.length>100||value.some(x=>typeof x!=='string')||new Set(value).size!==value.length)throw new GapError('invalid_event_scope');
 return value as string[];
}
