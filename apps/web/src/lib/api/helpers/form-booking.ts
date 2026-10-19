import { fetchApi } from '../../api'
/** Authentication and LIFF account selection remain the same as the existing customer booking API. */
export function bookFromForm(liffId:string,idToken:string,formAnswer:{formId:string;blockId:string;submissionKey:string}) {
 return fetchApi<{booking_id:string;status:string;payment_required?:boolean}>(`/api/liff/booking/requests?${new URLSearchParams({liffId})}`,{method:'POST',headers:{Authorization:`Bearer ${idToken}`,'Idempotency-Key':`form:${formAnswer.submissionKey}:${formAnswer.blockId}`},body:JSON.stringify({formAnswer})})
}
