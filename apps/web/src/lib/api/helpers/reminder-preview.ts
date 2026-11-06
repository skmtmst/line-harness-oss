import { fetchApi } from '../../api'

export function previewReminderMessage(id:string,input:{friendId:string;stableStepId:string;expectedDraftVersionId:string;expectedDraftUpdatedAt:string;deliveredAt?:string}) {
  return fetchApi<{success:boolean;data:{dryRun:true;sent:0;persistsSchedule:false;draftVersionId:string;draftUpdatedAt:string;friendId:string;friendName:string|null;stableStepId:string;deliveredAt:string;messageType:string;messageContent:string;message:unknown}}>(`/api/reminders/${encodeURIComponent(id)}/message-preview`,{method:'POST',body:JSON.stringify(input)})
}
