import {GapError} from '../../services/gap-common.js';
import { formatYen, yenPercent } from '@line-crm/shared';
export interface CancellationPolicy {enabled:boolean;tiers:Array<{beforeHours:number;percent:number}>;noShowPercent:number;version:number}
export const defaultCancellationPolicy:CancellationPolicy={enabled:false,tiers:[{beforeHours:24,percent:0},{beforeHours:0,percent:50}],noShowPercent:100,version:0};
export function validCancellationPolicy(b:unknown):b is CancellationPolicy {
 if(!b||typeof b!=='object')return false;const p=b as CancellationPolicy;
 return typeof p.enabled==='boolean'&&Array.isArray(p.tiers)&&p.tiers.length>=2&&p.tiers.length<=4&&p.tiers.every((t,i)=>Number.isInteger(t.beforeHours)&&t.beforeHours>=0&&t.beforeHours<=336&&Number.isInteger(t.percent)&&t.percent>=0&&t.percent<=100&&(i===0?t.beforeHours>=1&&t.percent===0:t.beforeHours<p.tiers[i-1].beforeHours&&t.percent>=p.tiers[i-1].percent))
 &&p.tiers.at(-1)?.beforeHours===0&&Number.isInteger(p.noShowPercent)&&p.noShowPercent>=p.tiers.at(-1)!.percent&&p.noShowPercent<=100;
}
export async function cancellationPolicy(db:D1Database,account:string):Promise<CancellationPolicy> {
 const r=await db.prepare('SELECT * FROM booking_cancellation_policies WHERE line_account_id=?').bind(account).first<{enabled:number;tiers_json:string;no_show_percent:number;version:number}>();
 return r?{enabled:!!r.enabled,tiers:JSON.parse(r.tiers_json),noShowPercent:r.no_show_percent,version:r.version}:structuredClone(defaultCancellationPolicy);
}
export function cancellationQuote(policy:CancellationPolicy,startsAt:string,price:number,now=new Date(),ticket=false) {
 const enabled=policy.enabled&&!ticket,remaining=(Date.parse(startsAt)-now.getTime())/3600000;
 const sorted=[...policy.tiers].sort((a,b)=>b.beforeHours-a.beforeHours),tier=sorted.find(t=>remaining>=t.beforeHours)??sorted.at(-1)!;
 const free=sorted.find(t=>t.percent===0),freeUntil=enabled&&free?new Date(Date.parse(startsAt)-free.beforeHours*3600000).toISOString():null;
 const feeNow=enabled?yenPercent(price,tier.percent):0,feeNoShow=enabled?yenPercent(price,policy.noShowPercent):0;
 const text=!enabled?'キャンセル料は掛かりません':`${freeUntil} まで無料／${sorted.filter(t=>t.percent>0).map(t=>`${t.beforeHours===0?'それ以降':`開始${t.beforeHours}時間前まで`} 料金の ${t.percent}%（${formatYen(yenPercent(price,t.percent))}）`).join('／')}／連絡なしの欠席 ${policy.noShowPercent}%（${formatYen(feeNoShow)}）`;
 return {freeUntil,feeNow,feeNoShow,text,policyAcceptedRequired:enabled};
}
export async function requireCancellationTestConnection(db:D1Database,account:string) {
 const r=await db.prepare('SELECT test_mode,disconnected_at FROM booking_payment_connections WHERE line_account_id=?').bind(account).first<{test_mode:number;disconnected_at:string|null}>();
 if(!r||r.disconnected_at)throw new GapError('payment_not_connected',409);
 if(r.test_mode!==1)throw new GapError('live_mode_not_approved',409);
}
/** 模擬専用。外への通信はなく、Setupの完了は署名付きのWebhookでのみ確定する。 */
export function cancellationSetupUrl(id:string){return `https://checkout.stripe.com/test/setup/${id}`;}
export async function bookingCancellationQuote(db:D1Database,id:string,account:string,now=new Date()) {
 const b=await db.prepare(`SELECT b.*,EXISTS(SELECT 1 FROM booking_entitlement_uses u WHERE u.booking_id=b.id) ticket FROM bookings b WHERE b.id=? AND b.line_account_id=?`).bind(id,account).first<{policy_snapshot_json:string|null;starts_at:string;price_at_booking:number;ticket:number}>();
 if(!b)throw new GapError('not_found',404);
 return cancellationQuote(b.policy_snapshot_json?JSON.parse(b.policy_snapshot_json):defaultCancellationPolicy,b.starts_at,b.price_at_booking,now,!!b.ticket);
}
