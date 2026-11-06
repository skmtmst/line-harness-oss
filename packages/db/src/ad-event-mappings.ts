import type { AdEventMapping,SaveAdEventMappingRequest } from '@line-crm/shared';
import { dbTableExists,jstNow } from './utils.js';
import { getActiveAdPlatforms,readPublicAdPlatformConfig,enqueueAdConversionOutbox } from './ad-platforms.js';
import { selectAdClickForPlatform } from './entry-routes.js';

export function automaticAdEventName(type:string,provider:'meta'|'google'):string|null {
  const family = /^(purchase|purchase_first|ec_order_confirmed)$/.test(type) ? 'purchase'
    : /^(subscribe|subscription|subscribe_teiki)$/.test(type) ? 'subscribe'
    : /^(booking|reservation_confirmed)$/.test(type) ? 'schedule' : null;
  if(!family) return null;
  return provider==='google' ? family : ({purchase:'Purchase',subscribe:'Subscribe',schedule:'Schedule'})[family];
}
export async function adMappingPointExists(db:D1Database,id:string,accountId:string) {
  return Boolean(await db.prepare(`SELECT cp.id FROM conversion_points cp JOIN line_accounts la ON la.id = ?
    WHERE cp.id = ? AND (cp.line_account_id = la.id OR cp.line_account_id IS NULL)
    AND COALESCE(cp.tenant_id,'default') = COALESCE(la.tenant_id,'default')`).bind(accountId,id).first());
}
export async function listAdEventMappings(db:D1Database,accountId:string):Promise<AdEventMapping[]> {
  const rows=await db.prepare(`SELECT cp.id,cp.name,cp.event_type,m.provider,m.mode,m.event_name,m.google_action_id,m.version
    FROM conversion_points cp JOIN line_accounts la ON la.id = ?
    LEFT JOIN ad_event_mappings m ON m.conversion_point_id = cp.id AND m.line_account_id = la.id
    WHERE (cp.line_account_id = la.id OR cp.line_account_id IS NULL)
    AND COALESCE(cp.tenant_id,'default') = COALESCE(la.tenant_id,'default') ORDER BY cp.created_at,cp.id`)
    .bind(accountId).all<{id:string;name:string;event_type:string;provider:'meta'|'google'|null;mode:AdEventMapping['mode']|null;event_name:string|null;google_action_id:string|null;version:number|null}>();
  const points=new Map<string,typeof rows.results>();for(const row of rows.results){const list=points.get(row.id)??[];list.push(row);points.set(row.id,list)}
  return [...points.values()].flatMap(rows=>(['google','meta'] as const).map(provider=>{
    const point=rows[0]!;const saved=rows.find(row=>row.provider===provider);const auto=automaticAdEventName(point.event_type,provider);
    const mode=saved?.mode??'auto';return {pointId:point.id,pointName:point.name,eventType:point.event_type,provider,mode,
      eventName:mode==='off'?null:mode==='manual'?saved?.event_name??null:auto,automaticEventName:auto,
      googleActionId:saved?.google_action_id??null,version:saved?.version??0};
  }));
}
export async function saveAdEventMapping(db:D1Database,pointId:string,input:SaveAdEventMappingRequest) {
  const name=input.mode==='manual'?input.eventName??null:null;
  const result=input.expectedVersion===0
    ? await db.prepare(`INSERT OR IGNORE INTO ad_event_mappings(conversion_point_id,line_account_id,provider,mode,event_name,google_action_id,updated_at)
        SELECT ?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM conversion_points cp JOIN line_accounts la ON la.id = ? WHERE cp.id = ?
          AND (cp.line_account_id IS NULL OR cp.line_account_id = la.id) AND COALESCE(cp.tenant_id,'default') = COALESCE(la.tenant_id,'default'))`)
        .bind(pointId,input.account_id,input.provider,input.mode,name,input.googleActionId??null,jstNow(),input.account_id,pointId).run()
    : await db.prepare(`UPDATE ad_event_mappings SET mode = ?,event_name = ?,google_action_id = ?,version = version + 1,updated_at = ?
        WHERE conversion_point_id = ? AND line_account_id = ? AND provider = ? AND version = ? AND EXISTS (
          SELECT 1 FROM conversion_points cp JOIN line_accounts la ON la.id = ? WHERE cp.id = ?
          AND (cp.line_account_id IS NULL OR cp.line_account_id = la.id) AND COALESCE(cp.tenant_id,'default') = COALESCE(la.tenant_id,'default'))`)
        .bind(input.mode,name,input.googleActionId??null,jstNow(),pointId,input.account_id,input.provider,input.expectedVersion,input.account_id,pointId).run();
  return Boolean(result.meta.changes);
}

type Snapshot = {eventName:string|null;googleActionId:string|null;currency:string;eventValue:number|null;clickSnapshot:NonNullable<Parameters<typeof enqueueAdConversionOutbox>[1]['clickSnapshot']>};
export async function mappedAdSnapshot(db:D1Database,eventId:string,platformId:string) {
  const row=await db.prepare('SELECT snapshot_json FROM ad_event_mapping_dispatches WHERE conversion_event_id = ? AND ad_platform_id = ?').bind(eventId,platformId).first<{snapshot_json:string}>();
  return row ? JSON.parse(row.snapshot_json) as Snapshot : null;
}
/** 初回の対応とクリックを保存してから既存送信台帳へ積む。再送も同じ名前・所属。 */
export async function queueMappedAdConversion(db:D1Database,eventId:string) {
  if(!await dbTableExists(db,'ad_conversion_event_accounts')) return;
  const event=await db.prepare(`SELECT ce.*,a.line_account_id,a.platform_ids_json FROM conversion_events ce JOIN ad_conversion_event_accounts a ON a.conversion_event_id = ce.id WHERE ce.id = ?`)
    .bind(eventId).first<{conversion_point_id:string;friend_id:string;value_snapshot:number|null;event_type_snapshot:string|null;line_account_id:string;platform_ids_json:string}>();
  if(!event) return;
  const mappings=await listAdEventMappings(db,event.line_account_id);
  const platforms=await getActiveAdPlatforms(db,event.line_account_id);
  for(const platform of platforms.filter(p=>(JSON.parse(event.platform_ids_json) as string[]).includes(p.id))) {
    if(platform.name!=='meta'&&platform.name!=='google') continue;
    let snapshot=await mappedAdSnapshot(db,eventId,platform.id);
    if(!snapshot) {
      const mapping=mappings.find(m=>m.pointId===event.conversion_point_id&&m.provider===platform.name);
      if(!mapping) continue;
      const config=readPublicAdPlatformConfig(platform);if(!config) continue;
      const days=config.click_id_validity_days;
      let clickSnapshot:Snapshot['clickSnapshot']={reason:'validity_not_configured'};
      if(Number.isSafeInteger(days)&&Number(days)>0) {
        const click=await selectAdClickForPlatform(db,{friendId:event.friend_id,lineAccountId:event.line_account_id,platformName:platform.name,validityDays:Number(days)});
        clickSnapshot={...click,reason:click.status,...(click.status==='eligible'?{context:{ipAddress:click.ipAddress,userAgent:click.userAgent}}:{})};
      }
      snapshot={eventName:mapping.mode==='auto'?automaticAdEventName(event.event_type_snapshot??mapping.eventType,platform.name):mapping.eventName,
        googleActionId:platform.name==='google'?(mapping.googleActionId??(typeof config.conversion_action_id==='string'?config.conversion_action_id:null)):null,
        currency:typeof config.currency==='string'?config.currency:'JPY',eventValue:event.value_snapshot,clickSnapshot};
      await db.prepare(`INSERT OR IGNORE INTO ad_event_mapping_dispatches(conversion_event_id,ad_platform_id,line_account_id,snapshot_json,created_at) VALUES(?,?,?,?,?)`)
        .bind(eventId,platform.id,event.line_account_id,JSON.stringify(snapshot),jstNow()).run();
      snapshot=(await mappedAdSnapshot(db,eventId,platform.id))!;
    }
    if(snapshot.eventName) await enqueueAdConversionOutbox(db,{platformId:platform.id,friendId:event.friend_id,lineAccountId:event.line_account_id,
      eventName:snapshot.eventName,eventValue:snapshot.eventValue,currency:snapshot.currency,idempotencyKey:`conversion:${eventId}`,providerEventId:`conversion:${eventId}:${platform.id}`,clickSnapshot:snapshot.clickSnapshot});
    await db.prepare('UPDATE ad_event_mapping_dispatches SET completed = 1 WHERE conversion_event_id = ? AND ad_platform_id = ?').bind(eventId,platform.id).run();
  }
}
/** 成果記録直後に止まったものだけ回収。過去分は移行で帳簿を作らない。 */
export async function recoverMappedAdConversions(db:D1Database,limit=100) {
  if(!await dbTableExists(db,'ad_conversion_event_accounts')) return;
  const rows=await db.prepare(`SELECT DISTINCT a.conversion_event_id FROM ad_conversion_event_accounts a
    JOIN ad_platforms p ON p.line_account_id = a.line_account_id AND p.is_active = 1 AND p.verified_at IS NOT NULL AND p.name IN ('meta','google') AND p.id IN (SELECT value FROM json_each(a.platform_ids_json))
    LEFT JOIN ad_event_mapping_dispatches d ON d.conversion_event_id = a.conversion_event_id AND d.ad_platform_id = p.id
    WHERE d.completed IS NULL OR d.completed = 0 LIMIT ?`).bind(limit).all<{conversion_event_id:string}>();
  for(const row of rows.results) await queueMappedAdConversion(db,row.conversion_event_id);
}
/** ECの成果地点がある場合は固定Purchaseの重複送信を止める（offも尊重）。 */
export async function hasMappedEcConversionSource(db:D1Database,accountId:string) {
  if(!await dbTableExists(db,'ad_event_mappings')) return false;
  return Boolean(await db.prepare(`SELECT cp.id FROM conversion_points cp JOIN line_accounts la ON la.id = ?
    WHERE cp.event_type = 'ec_order_confirmed' AND (cp.line_account_id = la.id OR cp.line_account_id IS NULL)
    AND COALESCE(cp.tenant_id,'default') = COALESCE(la.tenant_id,'default') LIMIT 1`).bind(accountId).first());
}
