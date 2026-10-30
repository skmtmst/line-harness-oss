import { hasDatabaseTable } from './schema-presence.js';
import { restaurantFollowupEnabledRowsSql } from './restaurant-followup-enabled.js';
import type { RestaurantFollowupSetup } from '@line-crm/shared';

/** 未保存を「使わない」と推測しない。保存後に別の入口から有効化されても解除する。 */
export async function readRestaurantFollowupSetup(db:D1Database,storeId:string):Promise<RestaurantFollowupSetup>{
  const row=await db.prepare(`SELECT not_using,decided_at,version FROM rt_store_followup_preferences WHERE store_id=?`)
    .bind(storeId).first<{not_using:number;decided_at:string|null;version:number}>();
  return row?{notUsing:row.not_using===1,decidedAt:row.decided_at,version:row.version}:{notUsing:false,decidedAt:null,version:0};
}

/** 最新の版と全送り方オフを、同じ書き込みの条件で確認する。 */
export async function saveRestaurantFollowupNotUsing(db:D1Database,storeId:string,expectedVersion:number,staffId:string){
  const result=await db.prepare(`INSERT INTO rt_store_followup_preferences(store_id,not_using,decided_at,decided_by,version)
    SELECT ?,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'),?,1
    WHERE EXISTS(SELECT 1 FROM rt_stores WHERE id=?)
      AND COALESCE((SELECT version FROM rt_store_followup_preferences WHERE store_id=?),0)=?
      AND NOT EXISTS(SELECT 1 FROM (${restaurantFollowupEnabledRowsSql}) WHERE store_id=?)
    ON CONFLICT(store_id) DO UPDATE SET not_using=1,decided_at=excluded.decided_at,decided_by=excluded.decided_by,version=rt_store_followup_preferences.version+1`)
    .bind(storeId,staffId,storeId,storeId,expectedVersion,storeId).run();
  return result.meta.changes===1?readRestaurantFollowupSetup(db,storeId):null;
}

/** ダッシュボード用。行の補完や送信履歴を読まず、移行の未適用時は追加情報を返さない。 */
export async function readRestaurantFollowupSetupProgress(db:D1Database,storeId:string){
  if(!await hasDatabaseTable(db,'rt_store_followup_preferences'))return null;
  const setup=await readRestaurantFollowupSetup(db,storeId);
  const enabled=await db.prepare(`SELECT 1 FROM (${restaurantFollowupEnabledRowsSql}) WHERE store_id=? LIMIT 1`).bind(storeId).first();
  return {...setup,anyEnabled:!!enabled};
}
