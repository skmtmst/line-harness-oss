import { ApiError } from '../transport/errors'
import { fetchApi } from '../transport/request'
import type { ApiResponse,RestaurantFollowupPage,RestaurantFollowupEngineBoard,RestaurantFollowupEngineDraftInput,RestaurantFollowupTrigger,RestaurantReservationFormSettings,RestaurantReservationForm,RestaurantFollowupSetup,RestaurantReservationFormRepair } from '@line-crm/shared'
const base=(storeId:string)=>`/api/restaurant-test/followups/${encodeURIComponent(storeId)}`
const scoped=(path:string,accountId:string)=>`${path}?account_id=${encodeURIComponent(accountId)}`
function unwrap<T>(response:ApiResponse<T>):T{if(!response.success)throw new Error(response.error||'読み込めませんでした');return response.data}
async function read<T>(path:string,accountId:string){return unwrap(await fetchApi<ApiResponse<T>>(scoped(path,accountId)))}
async function write<T>(path:string,accountId:string,body:unknown,method:'PUT'|'POST'='POST'){return unwrap(await fetchApi<ApiResponse<T>>(scoped(path,accountId),{method,body:JSON.stringify(body)}))}
export interface FollowupBoardSnapshot {page:RestaurantFollowupPage;board:RestaurantFollowupEngineBoard;form:RestaurantReservationFormSettings & {repairToken?:string};formError?:string;reviewCount?:number|null}
export interface FollowupTestResult {recipientName:string;recipientKind:'self'|'registered';contentHash:string;versionId:string;sent:number;replayed:boolean}
export const followupBoardApi={
 async read(accountId:string,storeId:string):Promise<FollowupBoardSnapshot>{
  const page=await read<RestaurantFollowupPage>(base(storeId),accountId)
  const [board,form,history]=await Promise.all([read<RestaurantFollowupEngineBoard>(base(storeId)+'/engines',accountId),read<RestaurantReservationFormSettings>(base(storeId)+'/reservation-form',accountId).catch(error=>{
   if(!(error instanceof ApiError)||error.status!==503||error.code!=='invalid_saved_form')throw error
   const repair=(error.data as {repair?:RestaurantReservationFormRepair}|undefined)?.repair
   if(!repair||repair.version!==-1||typeof repair.repairToken!=='string')throw error
   return {...repair,formError:'予約フォームの設定が読めないため、最小の項目で受け付けています。直してください'}
  }),read<{invitations:unknown[]}>(base(storeId)+'/review-history',accountId).catch(()=>null)])
  const reviewCount=Array.isArray(history?.invitations)?history.invitations.length:null
  if('formError' in form){const {formError,...settings}=form;return {page,board,form:settings,reviewCount,formError:String(formError)}}
  return {page,board,form,reviewCount}
 },
 saveForm:(accountId:string,storeId:string,expectedVersion:number,definition:RestaurantReservationForm,repairToken?:string)=>write<RestaurantReservationFormSettings>(base(storeId)+'/reservation-form',accountId,{expectedVersion,definition,...(repairToken?{repairToken}:{})},'PUT'),
 initialize:(accountId:string,storeId:string,rows:Array<{trigger:RestaurantFollowupTrigger;input:RestaurantFollowupEngineDraftInput}>)=>write(base(storeId)+'/engines/initialize',accountId,{rows}),
 saveRow:(accountId:string,storeId:string,trigger:RestaurantFollowupTrigger,input:RestaurantFollowupEngineDraftInput)=>write(base(storeId)+`/engines/${trigger}/draft`,accountId,input),
 test:(accountId:string,storeId:string,trigger:RestaurantFollowupTrigger,expectedTargetVersion:number)=>write<FollowupTestResult>(base(storeId)+`/engines/${trigger}/test-send`,accountId,{expectedTargetVersion}),
 start:(accountId:string,storeId:string,trigger:RestaurantFollowupTrigger,expectedTargetVersion:number,expectedContentHash:string)=>write(base(storeId)+`/engines/${trigger}/start`,accountId,{expectedTargetVersion,expectedContentHash}),
 notUsing:(accountId:string,storeId:string,expectedVersion:number)=>write<RestaurantFollowupSetup>(base(storeId)+'/setup',accountId,{notUsing:true,expectedVersion},'PUT'),
}
