import type { RestaurantCloseNotificationSettings } from '@line-crm/shared';
import { StampError } from './visit-stamps.js';
export async function readCloseNotificationSettings(db:D1Database,storeId:string):Promise<RestaurantCloseNotificationSettings> {
 const r=await db.prepare('SELECT * FROM rt_close_notification_settings WHERE store_id=?').bind(storeId).first<{notify_reopen:number;recipient_mode:RestaurantCloseNotificationSettings['recipientMode'];membership_ids_json:string;version:number}>();
 return {storeId,notifyReopen:r?!!r.notify_reopen:true,recipientMode:r?.recipient_mode??'responsible',membershipIds:r?JSON.parse(r.membership_ids_json):[],version:r?.version??0};
}
export async function saveCloseNotificationSettings(db:D1Database,storeId:string,b:Omit<RestaurantCloseNotificationSettings,'storeId'|'version'> & {expectedVersion:number}) {
 if(!b||typeof b.notifyReopen!=='boolean'||!['responsible','manager','selected'].includes(b.recipientMode)||!Array.isArray(b.membershipIds)||b.membershipIds.length>100||new Set(b.membershipIds).size!==b.membershipIds.length
 ||b.membershipIds.some(id=>typeof id!=='string'||!id)||!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||(b.recipientMode==='selected'&&!b.membershipIds.length))throw new StampError('知らせる相手と版を確認してください');
 for(const id of b.membershipIds)if(!await db.prepare(`SELECT m.id FROM rt_memberships m JOIN rt_stores s ON s.organization_id=m.organization_id
 WHERE s.id=? AND m.id=? AND m.status='active' AND (m.store_id IS NULL OR m.store_id=s.id)`).bind(storeId,id).first())throw new StampError('選んだスタッフはこの店の担当ではありません',403);
 const r=await db.prepare(`INSERT INTO rt_close_notification_settings(store_id,notify_reopen,recipient_mode,membership_ids_json) SELECT ?,?,?,? WHERE ?=0 OR EXISTS(SELECT 1 FROM rt_close_notification_settings WHERE store_id=?)
 ON CONFLICT(store_id) DO UPDATE SET notify_reopen=excluded.notify_reopen,recipient_mode=excluded.recipient_mode,membership_ids_json=excluded.membership_ids_json,version=version+1 WHERE version=?`)
 .bind(storeId,Number(b.notifyReopen),b.recipientMode,JSON.stringify(b.membershipIds),b.expectedVersion,storeId,b.expectedVersion).run();
 if(!r.meta.changes)throw new StampError('知らせの設定が更新されました。読み直してください',409);
 return readCloseNotificationSettings(db,storeId);
}
