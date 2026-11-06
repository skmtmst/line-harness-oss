import type { RestaurantInventoryRules, RestaurantInventoryRulesInput, RestaurantChannelCloseTask, RestaurantInventoryRuleState } from '@line-crm/shared';
type RuleRow = {store_id:string;threshold:number;stop_line:number;stop_same_day:number;notify:number;version:number};
/** 呼出し側で店舗の時間帯に変換した日付境界を渡す。既存記録の読取りのみ。 */
export async function getRestaurantInventoryRuleState(db:D1Database,storeId:string,from:string,to:string):Promise<RestaurantInventoryRuleState> {
 const stoppedWhere=`store_id=? AND datetime(starts_at)>=datetime(?) AND datetime(starts_at)<datetime(?) AND (auto_line_original IS NOT NULL OR auto_same_day_original IS NOT NULL)`;
 const historyWhere=`store_id=? AND datetime(starts_at)>=datetime(?) AND datetime(starts_at)<datetime(?)`;
 const rows=await db.prepare(`SELECT id AS slotId,starts_at AS startsAt,auto_line_original AS lineOriginal,auto_same_day_original AS sameDayOriginal,
 total_capacity-occupied_seats-unassigned_guests AS remainingSeats,(SELECT threshold FROM rt_inventory_rules WHERE store_id=?) AS threshold
 FROM rt_inventory_occupancy WHERE ${stoppedWhere} ORDER BY starts_at,id LIMIT 100`).bind(storeId,storeId,from,to).all<RestaurantInventoryRuleState['stopped'][number]>();
 const history=await db.prepare(`SELECT id,starts_at AS startsAt,before_line AS beforeLine,after_line AS afterLine,before_same_day AS beforeSameDay,after_same_day AS afterSameDay,
 CASE WHEN cause LIKE 'rt_reservations:%' THEN 'reservation' WHEN cause LIKE 'rt_tables:%' THEN 'tables' WHEN cause='rules_saved' THEN 'rules' ELSE 'inventory' END AS cause,
 strftime('%Y-%m-%dT%H:%M:%fZ',created_at) AS createdAt FROM rt_inventory_rule_log WHERE ${historyWhere} ORDER BY id DESC LIMIT 100`).bind(storeId,from,to).all<RestaurantInventoryRuleState['history'][number]>();
 const stoppedTotal=await db.prepare(`SELECT COUNT(*) AS n FROM rt_inventory_slots WHERE ${stoppedWhere}`).bind(storeId,from,to).first<{n:number}>();
 const historyTotal=await db.prepare(`SELECT COUNT(*) AS n FROM rt_inventory_rule_log WHERE ${historyWhere}`).bind(storeId,from,to).first<{n:number}>();
 return {stopped:rows.results,stoppedTotal:stoppedTotal!.n,history:history.results,historyTotal:historyTotal!.n};
}
export async function getRestaurantInventoryRules(db:D1Database,storeId:string):Promise<RestaurantInventoryRules> {
 const r=await db.prepare('SELECT * FROM rt_inventory_rules WHERE store_id=?').bind(storeId).first<RuleRow>();
 return {storeId,threshold:r?.threshold??2,stopLine:r?!!r.stop_line:false,stopSameDay:r?!!r.stop_same_day:false,notify:r?!!r.notify:true,version:r?.version??0};
}
export function validateRestaurantInventoryRules(b:unknown):b is RestaurantInventoryRulesInput {
 if(!b||typeof b!=='object')return false;const r=b as RestaurantInventoryRulesInput;
 return typeof r.storeId==='string'&&!!r.storeId&&Number.isSafeInteger(r.threshold)&&r.threshold>=0&&r.threshold<=10000
 &&[r.stopLine,r.stopSameDay,r.notify].every(v=>typeof v==='boolean')&&Number.isSafeInteger(r.expectedVersion)&&r.expectedVersion>=0;
}
export async function saveRestaurantInventoryRules(db:D1Database,b:RestaurantInventoryRulesInput):Promise<boolean> {
 const result=await db.prepare(`INSERT INTO rt_inventory_rules(store_id,threshold,stop_line,stop_same_day,notify,version)
 SELECT ?,?,?,?,?,1 WHERE ?=0 OR EXISTS(SELECT 1 FROM rt_inventory_rules WHERE store_id=?)
 ON CONFLICT(store_id) DO UPDATE SET threshold=excluded.threshold,stop_line=excluded.stop_line,
 stop_same_day=excluded.stop_same_day,notify=excluded.notify,version=version+1,updated_at=datetime('now') WHERE version=?`)
 .bind(b.storeId,b.threshold,Number(b.stopLine),Number(b.stopSameDay),Number(b.notify),b.expectedVersion,b.storeId,b.expectedVersion).run();
 return result.meta.changes>0;
}
export async function listRestaurantCloseTasks(db:D1Database,storeId:string,filters:{source?:string;channel?:string}={}):Promise<RestaurantChannelCloseTask[]> {
 const acknowledgements=await db.prepare(`SELECT a.key,a.value FROM account_settings a JOIN rt_stores s ON s.line_account_id=a.line_account_id
 WHERE s.id=? AND a.key LIKE 'restaurant_close_opened:%'`).bind(storeId).all<{key:string;value:string}>();
 const opened=new Map(acknowledgements.results.map(r=>[r.key.slice('restaurant_close_opened:'.length),r.value]));
 const rows=await db.prepare(`SELECT t.*,i.starts_at FROM rt_channel_close_tasks t JOIN rt_inventory_slots i ON i.id=t.slot_id
 WHERE t.store_id=? AND (? IS NULL OR t.trigger_source=? OR EXISTS(SELECT 1 FROM json_each(t.trigger_sources_json) origin WHERE json_extract(origin.value,'$.source')=?)) AND (? IS NULL OR t.channel=?) ORDER BY i.starts_at,t.channel LIMIT 500`).bind(storeId,filters.source??null,filters.source??null,filters.source??null,filters.channel??null,filters.channel??null).all<{trigger_source:string|null;trigger_reservation_id:string|null;trigger_sources_json:string;id:string;store_id:string;slot_id:string;starts_at:string;channel:string;status:RestaurantChannelCloseTask['status'];reason:RestaurantChannelCloseTask['reason'];remaining_seats:number;recipient_ids_json:string;generation:number;created_at:string;updated_at:string}>();
 const direct=await db.prepare(`SELECT t.*,t.trigger_source AS source FROM rt_reservation_close_tasks t
 WHERE t.store_id=? AND (? IS NULL OR t.trigger_source=?) AND (? IS NULL OR t.channel=?) ORDER BY t.starts_at,t.channel LIMIT 500`).bind(storeId,filters.source??null,filters.source??null,filters.channel??null,filters.channel??null).all<{id:string;store_id:string;starts_at:string;channel:string;status:RestaurantChannelCloseTask['status'];reservation_id:string;source:string;generation:number;created_at:string;updated_at:string}>();
 const closures=(await db.prepare('SELECT * FROM rt_closure_close_tasks WHERE store_id=? AND ? IS NULL AND (? IS NULL OR channel=?) ORDER BY starts_at,channel LIMIT 500').bind(storeId,filters.source??null,filters.channel??null,filters.channel??null).all<{id:string;store_id:string;closure_id:string;closure_version:number;channel:string;status:RestaurantChannelCloseTask['status'];kind:NonNullable<RestaurantChannelCloseTask['closureKind']>;start_date:string;end_date:string;all_day:number;start_time:string|null;end_time:string|null;table_ids_json:string;starts_at:string;ends_at:string;generation:number;created_at:string;updated_at:string}>()).results;
 const closureTasks:RestaurantChannelCloseTask[]=closures.map(r=>({id:r.id,storeId:r.store_id,slotId:null,closureId:r.closure_id,closureVersion:r.closure_version,closureKind:r.kind,channel:r.channel,status:r.status,reason:'closure',startDate:r.start_date,endDate:r.end_date,allDay:!!r.all_day,startTime:r.start_time,endTime:r.end_time,tableIds:JSON.parse(r.table_ids_json),startsAt:r.starts_at,endsAt:r.ends_at,remainingSeats:null,recipientIds:[],createdAt:r.created_at,updatedAt:r.updated_at}));
 const existing=rows.results.map(r=>({id:r.id,storeId:r.store_id,slotId:r.slot_id,triggerReservationId:r.trigger_reservation_id,triggerSources:JSON.parse(r.trigger_sources_json),startsAt:r.starts_at,channel:r.channel,status:r.status,reason:r.reason,remainingSeats:r.remaining_seats,recipientIds:JSON.parse(r.recipient_ids_json),createdAt:r.created_at,updatedAt:r.updated_at}));
 const metadata=new Map([...rows.results,...direct.results,...closures].map(r=>[r.id,{generation:r.generation,source:'source' in r?r.source:'trigger_source' in r?r.trigger_source:null}]));
 return [...closureTasks,...existing,...direct.results.map(r=>({id:r.id,storeId:r.store_id,slotId:null,reservationId:r.reservation_id,startsAt:r.starts_at,channel:r.channel,status:r.status,reason:'limited' as const,remainingSeats:null,recipientIds:[],createdAt:r.created_at,updatedAt:r.updated_at}))]
 .map(task=>({...task,...metadata.get(task.id),opened:task.status==='reopen'&&opened.get(task.id)===String(metadata.get(task.id)?.generation)}))
 .sort((a,b)=>a.startsAt.localeCompare(b.startsAt)||a.channel.localeCompare(b.channel));
}
