import { MediaImpactMatcher } from './media-impact-matcher.js';

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2,'0')).join('');
}

export interface PurgeMediaKey { key:string; mediaId:string; ownerAccount:string; includeLive:boolean }

/** Scan source rows once per bounded group of keys; only key hashes are kept. */
export async function captureMediaPurgeImpacts(db: D1Database, ownerTenant: string, items: PurgeMediaKey[], now: string): Promise<Array<{mediaId:string;keyHash:string}>> {
  if (!items.length) return [];
  const matcher = new MediaImpactMatcher(items);
  const hashes = await Promise.all(items.map(item => sha256(item.key)));
  const accountSources = [
    `SELECT 'event' kind,id reference_id,account_id,json_array(image_url,og_image_url) content FROM event_accounts`,
    `SELECT 'event' kind,event_id reference_id,line_account_id account_id,snapshot_json content FROM event_versions`,
    `SELECT 'event' kind,v.event_id reference_id,accounts.value account_id,v.snapshot_json content FROM event_versions v JOIN events e ON e.id=v.event_id,json_each(CASE WHEN json_valid(e.account_ids) THEN e.account_ids ELSE '[]' END) accounts`,
    `SELECT 'event_booking' kind,id reference_id,line_account_id account_id,event_snapshot_json content FROM event_bookings`,
    `SELECT 'template' kind,id reference_id,line_account_id account_id,json_array(message_content,message_bubbles_json,draft_message_content,draft_message_bubbles_json) content FROM templates`,
    `SELECT 'template' kind,t.id reference_id,t.line_account_id account_id,json_array(v.message_content,v.message_bubbles_json) content FROM template_versions v JOIN templates t ON t.id=v.template_id`,
    `SELECT 'asset' kind,id reference_id,line_account_id account_id,json_array(payload_json,draft_payload_json) content FROM broadcast_message_assets`,
    `SELECT 'asset' kind,a.id reference_id,a.line_account_id account_id,v.payload_json content FROM broadcast_asset_versions v JOIN broadcast_message_assets a ON a.id=v.asset_id`,
    `SELECT 'asset' kind,a.id reference_id,a.line_account_id account_id,v.payload_json content FROM broadcast_asset_publish_keys v JOIN broadcast_message_assets a ON a.id=v.asset_id`,
    `SELECT 'broadcast' kind,id reference_id,line_account_id account_id,json_array(message_content,message_bubbles_json,draft_payload_json) content FROM broadcasts`,
    `SELECT 'broadcast' kind,b.id reference_id,accounts.value account_id,json_array(b.message_content,b.message_bubbles_json,b.draft_payload_json) content FROM broadcasts b,json_each(CASE WHEN json_valid(b.account_ids) THEN b.account_ids ELSE '[]' END) accounts`,
    `SELECT 'broadcast' kind,b.id reference_id,b.line_account_id account_id,v.messages_json content FROM broadcast_variants v JOIN broadcasts b ON b.id=v.broadcast_id`,
    `SELECT 'broadcast' kind,b.id reference_id,accounts.value account_id,v.messages_json content FROM broadcast_variants v JOIN broadcasts b ON b.id=v.broadcast_id,json_each(CASE WHEN json_valid(b.account_ids) THEN b.account_ids ELSE '[]' END) accounts`,
    `SELECT 'auto_reply' kind,id reference_id,line_account_id account_id,json_array(response_content,actions_json) content FROM auto_replies WHERE deleted_at IS NULL`,
    `SELECT 'auto_reply' kind,r.id reference_id,r.line_account_id account_id,v.definition_snapshot content FROM auto_reply_versions v JOIN auto_replies r ON r.id=v.auto_reply_id WHERE r.deleted_at IS NULL`,
    `SELECT 'scenario' kind,s.id reference_id,s.line_account_id account_id,json_array(p.message_content,p.message_bubbles_json) content FROM scenario_steps p JOIN scenarios s ON s.id=p.scenario_id`,
    `SELECT 'scenario' kind,s.id reference_id,s.line_account_id account_id,json_array(v.steps_snapshot,v.actions_snapshot) content FROM scenario_versions v JOIN scenarios s ON s.id=v.scenario_id`,
    `SELECT 'form' kind,f.id reference_id,a.line_account_id account_id,json_array(f.fields,f.layout,f.on_submit_message_content,f.og_image_url) content FROM forms f JOIN form_accounts a ON a.form_id=f.id`,
    `SELECT 'form' kind,f.id reference_id,a.line_account_id account_id,json_array(v.fields,v.layout,v.on_submit_message_content,v.og_image_url) content FROM form_versions v JOIN forms f ON f.id=v.form_id JOIN form_accounts a ON a.form_id=f.id`,
    `SELECT 'rich_menu' kind,g.id reference_id,g.account_id,json_array(p.image_r2_key) content FROM rich_menu_pages p JOIN rich_menu_groups g ON g.id=p.group_id`,
    `SELECT 'column' kind,id reference_id,line_account_id account_id,image_url content FROM nen_columns`,
    `SELECT 'tracked_link' kind,id reference_id,line_account_id account_id,og_image_url content FROM tracked_links`,
    `SELECT 'webinar' kind,id reference_id,account_id,video_prefix content FROM webinars`,
    `SELECT 'booking_menu' kind,id reference_id,line_account_id account_id,json_array(image_url,photo_media_id) content FROM menus WHERE deleted_at IS NULL`,
    `SELECT 'booking_staff' kind,id reference_id,line_account_id account_id,json_array(profile_image_url,photo_media_id) content FROM staff WHERE deleted_at IS NULL`,
    `SELECT 'booking_settings' kind,id reference_id,line_account_id account_id,json_array(store_photo_media_id,store_photo_interior_media_id,store_photo_waiting_media_id) content FROM booking_settings`,
    `SELECT 'restaurant_menu' kind,m.id reference_id,s.line_account_id account_id,m.image_media_id content FROM rt_menu_items m JOIN rt_stores s ON s.id=m.store_id`,
    `SELECT 'google_post' kind,p.id reference_id,s.line_account_id account_id,json_array(p.media_json,p.instagram_media_id) content FROM rt_google_posts p JOIN rt_stores s ON s.id=p.store_id`,
    `SELECT 'google_post' kind,p.id reference_id,s.line_account_id account_id,p.media_url content FROM rt_gbp_posts p JOIN rt_stores s ON s.id=p.store_id`,
    `SELECT 'google_change' kind,c.id reference_id,s.line_account_id account_id,c.after_json content FROM rt_google_changes c JOIN rt_stores s ON s.id=c.store_id WHERE c.kind='photo'`,
    `SELECT 'sender' kind,id reference_id,account_id,json_array(icon_media_id,icon_url) content FROM line_senders`,
    `SELECT 'account_profile' kind,id reference_id,id account_id,json_array(og_default_image_url,icon_url,line_picture_url) content FROM line_accounts`,
    `SELECT 'banner_delivery' kind,id reference_id,line_account_id account_id,media_id content FROM banner_image_deliveries`,
    `SELECT 'hq_template_distribution' kind,r.template_id reference_id,r.target_account_id account_id,v.definition_json content FROM hq_template_distribution_results r JOIN hq_template_versions v ON v.id=r.template_version_id AND v.tenant_id=r.tenant_id WHERE r.status='succeeded'`,
    `SELECT 'friend_field' kind,f.friend_id || ':' || f.field_id reference_id,p.line_account_id account_id,json_array(f.media_id,f.value,f.value_text,f.value_json) content FROM friend_field_values f JOIN friends p ON p.id=f.friend_id`,
    `SELECT 'visit_stamp_photo' kind,id reference_id,line_account_id account_id,photo_url content FROM visit_stamp_paper_requests`,
    `SELECT 'visit_stamp_card' kind,c.id reference_id,a.line_account_id account_id,c.settings_json content FROM visit_stamp_cards c JOIN visit_stamp_card_accounts a ON a.card_id=c.id`,
    `SELECT 'mileage_reward' kind,id reference_id,line_account_id account_id,image_url content FROM mileage_rewards`,
    `SELECT 'ec_notification' kind,event_type reference_id,line_account_id account_id,image_url content FROM ec_notification_account_settings`,
    `SELECT 'ec_notification_fallback' kind,s.event_type reference_id,a.id account_id,s.image_url content FROM ec_notification_settings s JOIN line_accounts a
      WHERE NOT EXISTS (SELECT 1 FROM ec_notification_account_settings own WHERE own.line_account_id=a.id AND own.event_type=s.event_type)`,
    `SELECT 'customer_notification' kind,id reference_id,line_account_id account_id,draft_config_json content FROM customer_notification_definitions`,
    `SELECT 'customer_notification' kind,d.id reference_id,d.line_account_id account_id,json_array(v.config_json,v.line_template_json) content FROM customer_notification_versions v JOIN customer_notification_definitions d ON d.id=v.definition_id`,
    `SELECT 'common_var' kind,id reference_id,line_account_id account_id,json_array(value,fallback_value) content FROM common_vars`,
    `SELECT 'common_var' kind,v.id reference_id,v.line_account_id account_id,s.value content FROM common_var_schedules s JOIN common_vars v ON v.id=s.var_id`,
    `SELECT 'common_var' kind,v.id reference_id,v.line_account_id account_id,s.value content FROM common_var_versions s JOIN common_vars v ON v.id=s.common_var_id`,
    `SELECT 'scheduled_chat' kind,id reference_id,line_account_id account_id,content FROM scheduled_chat_sends WHERE status IN ('scheduled','sending')`,
    `SELECT 'starter_item' kind,item_key reference_id,line_account_id account_id,json_array(source_snapshot,pending_update) content FROM style_starter_items`,
    `SELECT 'starter_resource' kind,target_id reference_id,line_account_id account_id,source_snapshot content FROM style_starter_catalog_resources`,
  ];
  const sourceSql = (group: string[], includeGlobal: boolean) => `WITH target AS (SELECT ? AS owner_tenant),
    event_accounts AS (
      SELECT e.id,e.image_url,e.og_image_url,e.line_account_id AS account_id FROM events e
      UNION SELECT e.id,e.image_url,e.og_image_url,accounts.value AS account_id
        FROM events e,json_each(CASE WHEN json_valid(e.account_ids) THEN e.account_ids ELSE '[]' END) accounts
    ), account_sources AS (${group.join(' UNION ALL ')}), global_sources AS (
      SELECT 'ec_notification_settings' AS kind,event_type AS reference_id,image_url AS content FROM ec_notification_settings
      UNION ALL SELECT 'nen_campaign_settings',campaign_key,image_url FROM nen_campaign_settings
      UNION ALL SELECT 'style_starter_set',id,definition_json FROM style_starter_sets WHERE tenant_id IS NULL
      UNION ALL SELECT 'unscoped_' || kind,reference_id,content FROM account_sources WHERE account_id IS NULL
    ), sources AS (
      SELECT a.tenant_id,a.id AS account_id,r.kind,CAST(r.reference_id AS TEXT) AS reference_id,r.content FROM account_sources r
        JOIN line_accounts a ON a.id=r.account_id, target t
       WHERE a.tenant_id IS NOT NULL AND a.tenant_id<>t.owner_tenant AND r.content IS NOT NULL
      UNION ALL SELECT s.tenant_id,NULL,'style_starter_set',s.id,s.definition_json FROM style_starter_sets s,target t WHERE ${includeGlobal ? '1' : '0'} AND s.tenant_id IS NOT NULL AND s.tenant_id<>t.owner_tenant
      UNION ALL SELECT v.tenant_id,NULL,'hq_template_version',v.id,v.definition_json FROM hq_template_versions v,target t WHERE ${includeGlobal ? '1' : '0'} AND v.tenant_id<>t.owner_tenant
      UNION ALL SELECT b.tenant_id,NULL,'banner_image',b.id,b.media_id FROM banner_images b,target t WHERE ${includeGlobal ? '1' : '0'} AND b.tenant_id<>t.owner_tenant AND b.deleted_at IS NULL
      UNION ALL SELECT n.id,NULL,'company_logo',n.id,n.logo_media_id FROM tenants n,target t WHERE ${includeGlobal ? '1' : '0'} AND n.id<>t.owner_tenant AND n.logo_media_id IS NOT NULL
    ), global_scope AS (SELECT NULL AS tenant_id,NULL AS account_id,g.kind,CAST(g.reference_id AS TEXT) AS reference_id,g.content FROM global_sources g WHERE g.content IS NOT NULL ${includeGlobal ? '' : "AND g.kind LIKE 'unscoped_%'"}), combined AS (SELECT * FROM sources UNION ALL SELECT * FROM global_scope)
    SELECT tenant_id,account_id,kind,reference_id,json_group_array(content) AS contents FROM combined
      WHERE reference_id IS NOT NULL GROUP BY tenant_id,account_id,kind,reference_id`;
  type Row={tenant_id:string|null;account_id:string|null;kind:string;reference_id:string;contents:string};
  type Aggregate={index:number;tenantId:string|null;accountId:string|null;kind:string;count:number};
  const aggregates = new Map<string,Aggregate>();
  const seen = new Set<string>();
  for (let offset=0; offset<accountSources.length; offset+=5) {
    const page = await db.prepare(sourceSql(accountSources.slice(offset,offset+5), offset===0)).bind(ownerTenant).all<Row>();
    for (const row of page.results) {
      for (const index of matcher.match(row.contents)) {
        const reference=JSON.stringify([index,row.tenant_id,row.account_id,row.kind,row.reference_id]);
        if (seen.has(reference)) continue;
        seen.add(reference);
        const key=JSON.stringify([index,row.tenant_id,row.account_id,row.kind]);
        const previous=aggregates.get(key);
        if (previous) previous.count++;
        else aggregates.set(key,{index,tenantId:row.tenant_id,accountId:row.account_id,kind:row.kind,count:1});
      }
    }
  }
  const writes = await Promise.all([...aggregates.values()].map(async row => {
    const item=items[row.index], keyHash=hashes[row.index];
    const id = await sha256(JSON.stringify([keyHash,row.tenantId,row.accountId,row.kind]));
    return db.prepare(`INSERT OR IGNORE INTO media_purge_impact_pending
      (id,media_id,owner_line_account_id,key_sha256,target_tenant_id,target_line_account_id,target_kind,usage_count,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,item.mediaId,item.ownerAccount,keyHash,row.tenantId,row.accountId,row.kind,row.count,now);
  }));
  for (let i=0; i<writes.length; i+=50) await db.batch(writes.slice(i,i+50));
  return items.map((item,index)=>({mediaId:item.mediaId,keyHash:hashes[index]}));
}

/** Publish the saved impact only after the R2 delete succeeds; retry is idempotent. */
export async function finishMediaPurgeImpacts(db: D1Database, impacts: Array<{mediaId:string;keyHash:string}>, now: string): Promise<void> {
  if (!impacts.length) return;
  const unique=[...new Map(impacts.map(item=>[JSON.stringify(item),item])).values()];
  const pairs=JSON.stringify(unique);
  const pending = await db.prepare(`SELECT p.id,p.target_tenant_id AS tenant_id,p.target_line_account_id AS account_id,
      p.target_kind AS kind,p.usage_count FROM json_each(?) i JOIN media_purge_impact_pending p
      ON p.media_id=json_extract(i.value,'$.mediaId') AND p.key_sha256=json_extract(i.value,'$.keyHash')`)
    .bind(pairs).all<{id:string;account_id:string|null;tenant_id:string|null;kind:string;usage_count:number}>();
  const groups = pending.results.map(row => {
    const id = row.id;
    if (row.tenant_id === null) return [db.prepare(`INSERT OR IGNORE INTO notifications
      (id,event_type,title,body,channel,status,category,line_account_id,metadata,created_at)
      VALUES (?,'global_media_removed','共通設定の画像が削除されました','共通設定の画像を確認してください。','dashboard','sent','error',NULL,?,?)`)
      .bind(id,JSON.stringify({kind:row.kind,usageCount:row.usage_count,reasonCode:'CROSS_TENANT_MEDIA_REMOVED'}),now)];
    const audit = db.prepare(`INSERT OR IGNORE INTO audit_events
      (id,source_kind,source_id,tenant_id,line_account_id,category,action,target_kind,result,reason,after_json,created_at)
      VALUES (?,'media_purge_impact',?,?,?,'business','media_removed_cross_tenant',?,'success','CROSS_TENANT_MEDIA_REMOVED',?,?)`)
      .bind(id,id,row.tenant_id,row.account_id,row.kind,JSON.stringify({usageCount:row.usage_count}),now);
    if (row.account_id === null) return [audit];
    return [audit,db.prepare(`INSERT OR IGNORE INTO notifications
      (id,event_type,title,body,channel,status,category,line_account_id,metadata,created_at)
      VALUES (?,'cross_tenant_media_removed','使用中の画像が削除されました',?,'dashboard','sent','error',?,?,?)`)
      .bind(id,`元の統括の保存期限により画像が削除されました。画像が使われていた設定が${row.usage_count}件あります。`,row.account_id,
        JSON.stringify({kind:row.kind,usageCount:row.usage_count,reasonCode:'CROSS_TENANT_MEDIA_REMOVED'}),now)];
  });
  const writes = groups.flat();
  for (let i=0; i<writes.length; i+=50) await db.batch(writes.slice(i,i+50));
  await db.prepare(`DELETE FROM media_purge_impact_pending WHERE (media_id,key_sha256) IN
    (SELECT json_extract(value,'$.mediaId'),json_extract(value,'$.keyHash') FROM json_each(?))`).bind(pairs).run();
}
