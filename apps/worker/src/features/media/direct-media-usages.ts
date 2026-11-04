import { getMediaUsageMatchTokens } from '@line-crm/db';

export type DirectMediaUsage = { refKind: 'auto_reply' | 'visit_stamp_card' | 'visit_stamp_photo' | 'banner_image' | 'other_image_setting' | 'company_logo' | 'line_sender_icon' | 'google_post' | 'google_profile_photo' | 'friend_field'; refId: string; name: string; href: string | null };

/** 台帳の種別を増やさず、対象アカウントの現在の使用先を直接確かめる。 */
export async function findDirectMediaUsages(db: D1Database, media: { id: string; r2_key: string }, accountId: string): Promise<DirectMediaUsage[]> {
  const tokens = JSON.stringify([...new Set([media.r2_key, ...await getMediaUsageMatchTokens(db, media.id)])].filter(Boolean));
  const replies = await db.prepare(`SELECT ar.id, COALESCE(NULLIF(ar.name,''), ar.keyword) AS name FROM auto_replies ar
    WHERE (ar.line_account_id IS NULL OR ar.line_account_id = ?) AND ar.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(ar.response_content, token.value) > 0 OR instr(COALESCE(ar.actions_json,''), token.value) > 0)
      OR EXISTS (SELECT 1 FROM auto_reply_versions v WHERE v.auto_reply_id = ar.id AND (v.line_account_id IS NULL OR v.line_account_id = ar.line_account_id)
        AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(v.definition_snapshot, token.value) > 0)))
    ORDER BY ar.id`).bind(accountId, tokens, tokens).all<{id:string;name:string}>();
  const stamps = await db.prepare(`SELECT c.id, c.name FROM visit_stamp_card_accounts ca
    JOIN visit_stamp_cards c ON c.id=ca.card_id WHERE ca.line_account_id = ?
      AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(c.settings_json, token.value) > 0)
    ORDER BY c.id`).bind(accountId, tokens).all<{id:string;name:string}>();
  // These references were absent from the usage ledger and from SOURCES. Check
  // all owners: an inconsistent cross-account reference must still block deletion.
  // Only aggregate labels leave this function, so other accounts' details stay private.
  const extra = await db.prepare(`SELECT
    (SELECT COUNT(*) FROM tenants WHERE logo_media_id = ?) AS logos,
    (SELECT COUNT(*) FROM line_senders WHERE icon_media_id = ?) AS senders,
    (SELECT COUNT(*) FROM rt_google_posts p WHERE p.instagram_media_id = ?
      OR EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(p.media_json, token.value) > 0)
      OR EXISTS (SELECT 1 FROM json_tree(p.media_json) value WHERE value.type = 'text' AND value.value = ?)) AS posts,
    (SELECT COUNT(*) FROM rt_google_changes c WHERE c.kind = 'photo' AND (
      EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(c.after_json, token.value) > 0)
      OR EXISTS (SELECT 1 FROM json_tree(CASE WHEN json_valid(c.after_json) THEN c.after_json ELSE 'null' END) item WHERE item.key = 'mediaId' AND item.value = ?))) AS profile_photos,
    (SELECT COUNT(*) FROM friend_field_values WHERE media_id = ?) AS fields,
    (SELECT COUNT(*) FROM visit_stamp_paper_requests p WHERE EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(p.photo_url, token.value) > 0)) AS stamp_photos,
    ((SELECT COUNT(*) FROM banner_images WHERE media_id = ?) + (SELECT COUNT(*) FROM banner_image_deliveries WHERE media_id = ?)) AS banners,
    (SELECT COUNT(*) FROM auto_replies ar WHERE ar.line_account_id IS NOT NULL AND ar.line_account_id <> ? AND ar.deleted_at IS NULL AND (
      EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(ar.response_content, token.value) > 0 OR instr(COALESCE(ar.actions_json,''), token.value) > 0)
      OR EXISTS (SELECT 1 FROM auto_reply_versions v WHERE v.auto_reply_id=ar.id AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(v.definition_snapshot,token.value)>0)))) AS other_replies,
    (SELECT COUNT(*) FROM visit_stamp_cards c WHERE EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(c.settings_json,token.value)>0)
      AND NOT EXISTS (SELECT 1 FROM visit_stamp_card_accounts ca WHERE ca.card_id=c.id AND ca.line_account_id=?)) AS other_stamps`)

    .bind(media.id, media.id, media.id, tokens, media.id, tokens, media.id, media.id, tokens, media.id, media.id, accountId, tokens, tokens, tokens, accountId)
    .first<{logos:number;senders:number;posts:number;profile_photos:number;fields:number;stamp_photos:number;banners:number;other_replies:number;other_stamps:number}>();
  const settings = await db.prepare(`SELECT kind, COUNT(*) AS count FROM (
    SELECT 'マイレージ特典' AS kind, image_url AS url FROM mileage_rewards UNION ALL
    SELECT 'EC通知' AS kind, image_url FROM ec_notification_settings UNION ALL
    SELECT 'EC通知（店舗）' AS kind, image_url FROM ec_notification_account_settings UNION ALL
    SELECT 'キャンペーン通知' AS kind, image_url FROM nen_campaign_settings UNION ALL
    SELECT 'アカウントの共有画像' AS kind, og_default_image_url FROM line_accounts UNION ALL
    SELECT 'アカウントの画像' AS kind, icon_url FROM line_accounts UNION ALL
    SELECT 'LINEプロフィール画像' AS kind, line_picture_url FROM line_accounts UNION ALL
    SELECT 'リンクの共有画像' AS kind, og_image_url FROM tracked_links UNION ALL
    SELECT '予約メニュー画像' AS kind, image_url FROM menus UNION ALL
    SELECT '予約スタッフ画像' AS kind, profile_image_url FROM staff
    UNION ALL SELECT '統括テンプレートの版' AS kind, definition_json FROM hq_template_versions
    UNION ALL SELECT '初期セット' AS kind, definition_json FROM style_starter_sets
    UNION ALL SELECT '初期セットの保存内容' AS kind, json_array(source_snapshot,pending_update) FROM style_starter_items
    UNION ALL SELECT '初期セットの配布記録' AS kind, source_snapshot FROM style_starter_catalog_resources
    UNION ALL SELECT 'Google投稿（旧）' AS kind, media_url FROM rt_gbp_posts
    UNION ALL SELECT '共通情報' AS kind, json_array(value,fallback_value) FROM common_vars
    UNION ALL SELECT '共通情報の変更予約' AS kind, value FROM common_var_schedules
    UNION ALL SELECT '共通情報の版' AS kind, value FROM common_var_versions
    UNION ALL SELECT '予約したチャット送信' AS kind, content FROM scheduled_chat_sends WHERE status IN ('scheduled','sending','failed')
    UNION ALL SELECT '顧客通知の下書き' AS kind, draft_config_json FROM customer_notification_definitions
    UNION ALL SELECT '顧客通知の公開版' AS kind, json_array(config_json,line_template_json) FROM customer_notification_versions
    UNION ALL SELECT '配信素材の公開版' AS kind, payload_json FROM broadcast_asset_versions
    UNION ALL SELECT '配信素材の公開記録' AS kind, payload_json FROM broadcast_asset_publish_keys
    UNION ALL SELECT '配信の比較案' AS kind, messages_json FROM broadcast_variants
    UNION ALL SELECT 'シナリオの公開版' AS kind, json_array(steps_snapshot,actions_snapshot) FROM scenario_versions
    UNION ALL SELECT 'イベントの公開版' AS kind, snapshot_json FROM event_versions
    UNION ALL SELECT 'イベント予約の保存内容' AS kind, event_snapshot_json FROM event_bookings
  ) source WHERE EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(source.url, token.value) > 0)
    GROUP BY kind ORDER BY kind`).bind(tokens).all<{kind:string;count:number}>();
  const additional: DirectMediaUsage[] = [];
  for (const [refKind, label, count] of [
    ['company_logo', '会社ロゴ', extra?.logos ?? 0],
    ['line_sender_icon', '担当者アイコン', extra?.senders ?? 0],
    ['google_post', 'Google・Instagram 投稿', extra?.posts ?? 0],
    ['google_profile_photo', 'Google 店舗写真', extra?.profile_photos ?? 0],
    ['friend_field', '友だち情報', extra?.fields ?? 0],
    ['visit_stamp_photo', '来店スタンプの申請写真', extra?.stamp_photos ?? 0],
    ['banner_image', 'バナー画像', extra?.banners ?? 0],
    ['other_image_setting', '他アカウントの自動応答', extra?.other_replies ?? 0],
    ['other_image_setting', '他アカウントの来店スタンプ', extra?.other_stamps ?? 0],
  ] as const) {
    if (count > 0) additional.push({ refKind, refId: `${refKind}:${label}:${count}`, name: `${label}（${count}件）`, href: null });
  }
  for (const row of settings.results) additional.push({ refKind:'other_image_setting', refId:`other_image_setting:${row.kind}:${row.count}`, name:`${row.kind}（${row.count}件）`, href:null });
  return [
    ...replies.results.map(row => ({ refKind:'auto_reply' as const, refId:row.id, name:row.name, href:`/auto-replies/edit?id=${encodeURIComponent(row.id)}` })),
    ...stamps.results.map(row => ({ refKind:'visit_stamp_card' as const, refId:row.id, name:row.name, href:'/visit-stamps' })),
    ...additional,
  ];
}

/** 送信済み履歴は削除を止めず、匿名の件数だけを確認画面へ返す。 */
export async function countSentMediaMessages(db: D1Database, media: { id: string; r2_key: string }): Promise<number> {
  const tokens = JSON.stringify([...new Set([media.r2_key, ...await getMediaUsageMatchTokens(db, media.id)])].filter(Boolean));
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM messages_log message
    WHERE message.direction = 'outgoing' AND message.unsent_at IS NULL
      AND EXISTS (SELECT 1 FROM json_each(?) token WHERE instr(message.content, token.value) > 0)`)
    .bind(tokens).first<{ count: number }>();
  return row?.count ?? 0;
}
