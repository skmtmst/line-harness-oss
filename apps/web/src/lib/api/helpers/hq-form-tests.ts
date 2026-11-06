import { responseApiError, extractApiErrorCode } from '../transport/errors'
import { readApiError } from '@line-crm/shared'
import { fetchApi } from '../../api'
import type { FormLayout } from '@line-crm/shared'

export interface HqFormTest {
  templateId:string;templateVersionId:string;dryRun:true;sent:0;persistsAnswers:false
  form:{name:string;description:string|null;fields:unknown[];layout:FormLayout}
  answerValidation:{valid:boolean;error:string|null}|null
}
export interface HqFormTestToken {
  id:string;token:string;expiresAt:string;templateId:string;templateVersionId:string;revision:number;testUrl:string;dryRun:true;sent:0;persistsAnswers:false
}
export const hqFormTestsApi={
  issue:(id:string,expectedRevision:number)=>fetchApi<{success:boolean;data:HqFormTestToken}>(`/api/hq/templates/${encodeURIComponent(id)}/test-token`,{method:'POST',body:JSON.stringify({expectedRevision})}),
  revoke:(id:string,tokenId:string)=>fetchApi<{success:boolean;data:{id:string;revoked:true}}>(`/api/hq/templates/${encodeURIComponent(id)}/test-tokens/${encodeURIComponent(tokenId)}`,{method:'DELETE'}),
}
/** Public preview uses only the capability, never the administrator's credentials. */
export async function readHqFormTest(apiOrigin:string,id:string,token:string,answers?:Record<string,unknown>):Promise<HqFormTest> {
  const response=await fetch(new URL(`/api/liff/hq-form-tests/${encodeURIComponent(id)}${answers===undefined?'':'/submit'}`,apiOrigin),{
    method:answers===undefined?'GET':'POST',credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',
    headers:{Authorization:`Bearer ${token}`,...(answers===undefined?{}:{'Content-Type':'application/json'})},
    ...(answers===undefined?{}:{body:JSON.stringify({answers})}),
  })
  const raw = await response.text()
  if (!response.ok) {
    const failure = responseApiError(response, raw, extractApiErrorCode(raw))
    if (/^API error: /.test(failure.message)) failure.message = '試しのURLと有効期限を確認してください'
    throw failure
  }
  const result=JSON.parse(raw) as {success:boolean;data:HqFormTest;error?:string}
  if(!result.success)throw new Error(readApiError(result).message??'試しのURLと有効期限を確認してください')
  return result.data
}
