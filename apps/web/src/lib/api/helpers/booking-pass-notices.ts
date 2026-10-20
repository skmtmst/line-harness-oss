import {fetchApi} from '../../api';
import type {ApiResponse} from '@line-crm/shared';
export interface PassNoticeSettings {remainingOne:boolean;expiry14Days:boolean;version:number;testMode:true;deliveryAvailable:false}
export interface PassNotice {id:string;entitlementId:string;planId:string;kind:'remaining_one'|'expiry_14_days';purpose:'transaction';messages:Array<{type:'text';text:string}>;scheduledAt:string;status:'scheduled'|'simulated'|'skipped_disabled'|'skipped_unavailable'|'skipped_opted_out'|'skipped_late';processedAt:string|null;testMode:number}
const path=(url:string,a:string)=>`${url}?account_id=${encodeURIComponent(a)}`;
export const bookingPassNoticesApi={
 settings:(a:string,planId:string)=>fetchApi<ApiResponse<PassNoticeSettings>>(path(`/api/booking/admin/pass-plans/${encodeURIComponent(planId)}/notice-settings`,a)),
 save:(a:string,planId:string,b:{remainingOne:boolean;expiry14Days:boolean;expectedVersion:number})=>fetchApi<ApiResponse<PassNoticeSettings>>(path(`/api/booking/admin/pass-plans/${encodeURIComponent(planId)}/notice-settings`,a),{method:'PUT',body:JSON.stringify({...b,testMode:true})}),
 list:(a:string,filters:{planId?:string;offset?:number;limit?:10|20|50}={})=>{
  const q=new URLSearchParams({account_id:a});for(const [k,v]of Object.entries(filters))if(v!==undefined)q.set(k,String(v));
  return fetchApi<ApiResponse<{items:PassNotice[];total:number;sent:false;testMode:true}>>('/api/booking/admin/pass-notices?'+q);
 },
 simulate:(a:string)=>fetchApi<ApiResponse<{processed:number;sent:false;testMode:true}>>(path('/api/booking/admin/pass-notices/simulate',a),{method:'POST',body:JSON.stringify({testMode:true})}),
};
