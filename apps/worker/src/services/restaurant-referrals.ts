import type { RestaurantReferralCandidate } from '@line-crm/shared';
import { customerAvailability, type CustomerStore } from './restaurant-customer-booking.js';
import { isAccountFeatureEnabled, activeTenantLineAccountSql } from '@line-crm/db';

export function distanceKm(a:{latitude:number;longitude:number},b:{latitude:number;longitude:number}):number {
 const rad=(v:number)=>v*Math.PI/180;
 const x=Math.sin(rad(b.latitude-a.latitude)/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(rad(b.longitude-a.longitude)/2)**2;
 return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(Math.max(0,1-x)));
}
/** 参加を許可し、確認済み座標と予約入口を持つ同じ組織の店だけを返す。 */
export async function referralCandidates(db:D1Database,source:CustomerStore,date:string,count:number,startsAt?:string):Promise<RestaurantReferralCandidate[]> {
 const origin=await db.prepare('SELECT latitude,longitude FROM rt_stores WHERE id=?').bind(source.id).first<{latitude:number|null;longitude:number|null}>();
 if(origin?.latitude==null || origin.longitude==null)return [];
 const targets=await db.prepare(`SELECT DISTINCT s.id,s.name,s.timezone,s.line_account_id,COALESCE(a.tenant_id,'') tenant_id,s.latitude,s.longitude,a.liff_id,l.token,MIN(m.max_distance,n.max_distance) max_distance
 FROM rt_store_group_members m JOIN rt_store_groups g ON g.id=m.group_id JOIN rt_store_group_members n ON n.group_id=g.id
 JOIN rt_stores s ON s.id=n.store_id JOIN line_accounts a ON a.id=s.line_account_id JOIN rt_reservation_links l ON l.store_id=s.id
 WHERE m.store_id=? AND m.referral_enabled=1 AND n.referral_enabled=1 AND s.id<>? AND s.organization_id=g.organization_id
 AND g.organization_id=(SELECT organization_id FROM rt_stores WHERE id=?) AND s.status='active' AND a.is_active=1 AND a.archived_at IS NULL
 AND ${activeTenantLineAccountSql('a.id')} AND s.latitude IS NOT NULL AND s.longitude IS NOT NULL AND a.liff_id IS NOT NULL`).bind(source.id,source.id,source.id).all<CustomerStore & {latitude:number;longitude:number;liff_id:string;token:string;max_distance:number}>();
 const out:RestaurantReferralCandidate[]=[];
 for(const target of targets.results){
  if(!target.liff_id.trim() || !await isAccountFeatureEnabled(db,target.line_account_id,'restaurant_test'))continue;
  const distance=distanceKm({latitude:origin.latitude,longitude:origin.longitude},target);
  if(distance>target.max_distance)continue;
  const available=await customerAvailability(db,target,date,count);
  const slot=available?.data.slots.find(s=>s.available && (!startsAt || s.startsAt===startsAt));
  if(!slot || out.some(r=>r.storeId===target.id))continue;
  out.push({storeId:target.id,storeName:target.name,distanceKm:distance,startsAt:slot.startsAt,endsAt:slot.endsAt,bookingUrl:`https://liff.line.me/${encodeURIComponent(target.liff_id)}?${new URLSearchParams({page:'restaurant',token:target.token,date,startsAt:slot.startsAt,guestCount:String(count)})}`});
 }
 return out.sort((a,b)=>a.distanceKm-b.distanceKm || a.storeId.localeCompare(b.storeId));
}
