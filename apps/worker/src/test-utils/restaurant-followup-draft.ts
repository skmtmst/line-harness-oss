import type { RestaurantFollowupTrigger } from '@line-crm/shared';
import { saveRestaurantFollowupEngineDraft,saveRestaurantFollowupStoreDrafts,type FollowupDraftInput } from '../services/restaurant-followup-engine-draft.js';
import { readRestaurantFollowupRows } from '../services/restaurant-followup-rows.js';

/** 未移行なら7行を渡す。試験でも製品と同じ初回の境界を通る。 */
export async function saveFollowupDraftFixture(db:D1Database,storeId:string,trigger:RestaurantFollowupTrigger,input:FollowupDraftInput,staffId:string){
 if(await db.prepare('SELECT 1 FROM rt_store_followup_targets WHERE store_id=? LIMIT 1').bind(storeId).first())return saveRestaurantFollowupEngineDraft(db,storeId,trigger,input,staffId);
 const rows=await readRestaurantFollowupRows(db,storeId);
 return saveRestaurantFollowupStoreDrafts(db,storeId,rows.map(row=>({trigger:row.trigger,input:row.trigger===trigger?input:{...input,expectedRowVersion:row.version,enabled:false}})),staffId);
}
