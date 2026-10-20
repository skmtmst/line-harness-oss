import { fetchApi } from '../../api'
export type NotificationPurpose='booking_reminders'|'marketing'
export interface LiffNotificationPreferences {items:Array<{purpose:NotificationPurpose;label:string;state:'granted'|'unknown'|'revoked';enabled:boolean|null;recorded:boolean;version:number;updatedAt:string|null}>;purposeSpecificEnforcement:false;deliveryEnforcement:'any_non_granted_suppresses_automatic'}
/** LINEの本人トークンを明示する。管理者の認証情報では変更できない。 */
export const liffNotificationPreferencesApi={
 get:(lineAccountId:string,idToken:string)=>fetchApi<{success:true;data:LiffNotificationPreferences}>(`/api/liff/notification-preferences?${new URLSearchParams({lineAccountId})}`,{headers:{Authorization:`Bearer ${idToken}`}}),
 update:(lineAccountId:string,idToken:string,purpose:NotificationPurpose,enabled:boolean,expectedVersion:number)=>fetchApi<{success:true;data:LiffNotificationPreferences}>(`/api/liff/notification-preferences/${encodeURIComponent(purpose)}?${new URLSearchParams({lineAccountId})}`,{method:'PUT',headers:{Authorization:`Bearer ${idToken}`},body:JSON.stringify({enabled,expectedVersion})}),
}
