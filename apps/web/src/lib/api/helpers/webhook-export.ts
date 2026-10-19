import { downloadApiFile } from '../../api'

export function exportWebhookInteractions(input:{lineAccountId:string;periodDays?:number;direction?:'incoming'|'outgoing';status?:'succeeded'|'failed';search?:string}) {
  const params=new URLSearchParams()
  for(const [key,value] of Object.entries(input))if(value!==undefined)params.set(key,String(value))
  return downloadApiFile(`/api/webhooks/interactions/export.csv?${params}`,'webhook-interactions.csv')
}
