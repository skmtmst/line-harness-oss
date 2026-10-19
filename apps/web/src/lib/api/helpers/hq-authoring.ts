import { fetchApi } from '../../api'
import type { HqRichMenuDefinition } from '@line-crm/shared'

export type HqRichMenuDraft = HqRichMenuDefinition
export interface HqRichMenuPreview {
  name: string
  summary: {accountCount:number;sameNameAccountCount:number;overwriteCount:number;createCount:number;missingReferences:number;missingTags:number}
  stores: Array<{accountId:string;accountName:string;sameNameMenus:Array<{id:string;name:string;status:string;can_overwrite:number}>;canOverwrite:boolean;missingReferences:Array<{kind:string;sourceId:string;name:string|null}>}>
  references: Array<{kind:string;sourceId:string;name:string|null;availableAccountCount:number;totalAccountCount:number;accounts:Array<{accountId:string;accountName:string;status:string;targetId:string|null}>}>
  images: Array<{pageId:string;sizeBytes:number|null;sizeKb:number|null;available:boolean}>
  requiresPreflight: true
}
export async function previewHqRichMenu(input: {name:string;accountIds:string[];definition?:HqRichMenuDraft}): Promise<HqRichMenuPreview> {
  const result=await fetchApi<{success:boolean;data:HqRichMenuPreview}>('/api/hq/templates/rich-menu-preview',{method:'POST',body:JSON.stringify(input)})
  if(!result.success)throw new Error('配る前の確認ができませんでした。')
  return result.data
}
/** The upload receipt already returns the server-verified number of bytes. */
export function hqImageSizeKb(receipt: {sizeBytes:number}): number {
  return receipt.sizeBytes/1024
}
export async function saveHqRichMenu(input: {name:string;definition:HqRichMenuDraft;description?:string;folderId?:string|null} & ({id?:undefined;requestId:string;expectedRevision?:undefined}|{id:string;expectedRevision:number;requestId?:string})) {
  const {id,...body}=input
  const result=await fetchApi<{success:boolean;data:{template:{id:string;revision:number};definition:HqRichMenuDraft}}>(`/api/hq/templates${id?`/${encodeURIComponent(id)}`:''}`,{method:id?'PATCH':'POST',body:JSON.stringify({type:'rich_menu',...body})})
  if(!result.success)throw new Error('リッチメニューを保存できませんでした。')
  return result.data
}

export async function testHqForm(id:string,input:{expectedRevision?:number;answers?:Record<string,unknown>}={}) {
  const result=await fetchApi<{success:boolean;data:{dryRun:true;sent:0;persistsAnswers:false;templateId:string;templateVersionId:string;revision:number;form:{name:string;description:string|null;fields:unknown[];layout:import('@line-crm/shared').FormLayout};answerValidation:{valid:boolean;error:string|null}|null;testUrl:null;testUrlUnavailableReason:string}}>(`/api/hq/templates/${encodeURIComponent(id)}/test-send`,{method:'POST',body:JSON.stringify(input)})
  if(!result.success)throw new Error('フォームを試せませんでした。')
  return result.data
}
