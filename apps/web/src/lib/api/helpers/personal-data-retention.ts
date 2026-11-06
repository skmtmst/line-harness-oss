import { fetchApi } from '../../api';
export type PersonalDataRetentionPolicy = { enabled:boolean; hold:boolean; responseDays:number; blockedFriendDays:number };
export type PersonalDataRetentionSetting = { version:number; policy:PersonalDataRetentionPolicy };
export const personalDataRetentionApi = {
  get: (accountId:string) => fetchApi<{success:true;data:PersonalDataRetentionSetting}>(`/api/account-settings/personal-data-retention?accountId=${encodeURIComponent(accountId)}`),
  save: (accountId:string,expectedVersion:number,policy:PersonalDataRetentionPolicy,stepUpToken:string) =>
    fetchApi<{success:true;data:PersonalDataRetentionSetting}>('/api/account-settings/personal-data-retention',{method:'PUT',headers:{'X-Step-Up-Token':stepUpToken},body:JSON.stringify({accountId,expectedVersion,policy})}),
};
