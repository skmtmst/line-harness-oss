import { fetchApi } from '../../api'

export interface HqBroadcastViewConditions {
  from?:string;to?:string;q?:string;status?:'draft'|'pending_approval'|'scheduled'|'sending'|'sent'|'failed'|'stopped'|'cancelled';folderId?:string;sort?:'newest'|'oldest';limit?:number
}
export interface HqBroadcastSavedView {
  id:string;name:string;scope:'private'|'hq';staffId:string;conditions:HqBroadcastViewConditions;revision:number;createdAt:string;updatedAt:string;canEdit:boolean
}
const base='/api/hq/broadcasts/saved-views'
type Input={name:string;scope?:'private'|'hq';conditions:HqBroadcastViewConditions}
export const hqBroadcastViewsApi={
  list:()=>fetchApi<{success:boolean;data:HqBroadcastSavedView[]}>(base,{method:'GET'}),
  create:(input:Input)=>fetchApi<{success:boolean;data:HqBroadcastSavedView}>(base,{method:'POST',body:JSON.stringify(input)}),
  update:(id:string,input:Input&{expectedRevision:number})=>fetchApi<{success:boolean;data:HqBroadcastSavedView}>(`${base}/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify(input)}),
  archive:(id:string,expectedRevision:number)=>fetchApi<{success:boolean;data:{id:string;archived:true}}>(`${base}/${encodeURIComponent(id)}`,{method:'DELETE',body:JSON.stringify({expectedRevision})}),
}
