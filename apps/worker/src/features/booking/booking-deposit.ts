import type {DepositRule} from '@line-crm/shared';
import { yenPercent } from '@line-crm/shared';
import {GapError} from '../../services/gap-common.js';
export const noDeposit:DepositRule={kind:'none',value:null,conditions:{always:true,minPeople:null,weekdays:null,timeBand:null},version:0};
export function validDeposit(b:Record<string,unknown>){
 const c=b.conditions as DepositRule['conditions']|undefined;
 if(!['none','amount','percent'].includes(String(b.kind))||(b.kind==='none'?b.value!==null:!Number.isSafeInteger(b.value)||Number(b.value)<0||Number(b.value)>(b.kind==='percent'?100:10000000))||!c||typeof c.always!=='boolean'||c.minPeople!==null&&(!Number.isInteger(c.minPeople)||c.minPeople<1||c.minPeople>6)||c.weekdays!==null&&(!Array.isArray(c.weekdays)||c.weekdays.some(d=>!Number.isInteger(d)||d<0||d>6))||c.timeBand!==null&&!/^([01]\d|2[0-3]):[0-5]\d-([01]\d|2[0-3]):[0-5]\d$/.test(c.timeBand))throw new GapError('invalid_deposit_rule');
 return {kind:b.kind,value:b.value,conditions:c} as Omit<DepositRule,'version'>;
}
export async function depositRule(db:D1Database,a:string,menu=''):Promise<DepositRule&{inherit:boolean}>{
 const r=await db.prepare('SELECT rule_json,inherit,version FROM booking_deposit_rules WHERE account_id=? AND scope_id=?').bind(a,menu).first<{rule_json:string;inherit:number;version:number}>();
 return {...(r?JSON.parse(r.rule_json):noDeposit),version:r?.version??0,inherit:menu?(!r||!!r.inherit):false};
}
export async function depositEstimate(db:D1Database,a:string,menu:string,price:number,starts:string,people=1,tz='Asia/Tokyo'){
 let r=await depositRule(db,a,menu);if(r.inherit)r=await depositRule(db,a);
 const date=new Date(starts);if(!Number.isFinite(date.getTime()))throw new GapError('invalid_starts_at');
 const weekday=new Date(date.toLocaleString('en-US',{timeZone:tz})).getDay(),time=new Intl.DateTimeFormat('en-GB',{timeZone:tz,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date),c=r.conditions;
 const applicable=r.kind!=='none'&&(c.always||(!c.minPeople||people>=c.minPeople)&&(!c.weekdays||c.weekdays.includes(weekday))&&(!c.timeBand||(time>=c.timeBand.slice(0,5)&&time<c.timeBand.slice(6))));
 return {amount:applicable?(r.kind==='percent'?yenPercent(price,Number(r.value)):Math.min(price,Number(r.value))):0,rule:r,testMode:true,paymentCollectionAvailable:false};
}

/** A stored option must affect the actual request, not just its settings page. */
export async function cancellationCardRequired(db:D1Database,a:string,f:string){
 const option=await db.prepare('SELECT card_required_for FROM booking_cancellation_options WHERE account_id=?').bind(a).first<{card_required_for:string}>();
 if(option?.card_required_for==='no_show_flagged'){
  const {decidePrepayOnly}=await import('@line-crm/db');return (await decidePrepayOnly(db,a,f)).prepayOnly;
 }
 // Custom conditions have no public condition editor in this tranche. Fail closed.
 return true;
}
