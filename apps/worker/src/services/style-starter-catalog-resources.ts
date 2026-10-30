export const catalogResourceKind = (kind:string) => kind==='coupon'?'template':kind==='tag_folder'?'folder':kind;
const tables: Record<string, { table: string; account: string; children?: [string, string][] }> = {
  tag: { table: 'tags', account: 'line_account_id' },
  folder: { table: 'folders', account: 'account_id' },
  template: { table: 'templates', account: 'line_account_id', children: [['template_versions', 'template_id']] },
  media: { table: 'media', account: 'line_account_id', children: [['media_versions', 'media_id']] },
  auto_reply: { table: 'auto_replies', account: 'line_account_id', children: [['auto_reply_versions', 'auto_reply_id']] },
  scenario: { table: 'scenarios', account: 'line_account_id', children: [['scenario_steps', 'scenario_id']] },
  form: { table: 'forms', account: '', children: [['form_accounts', 'form_id']] },
  rich_menu: { table: 'rich_menu_groups', account: 'account_id', children: [['rich_menu_pages', 'group_id']] },
};
/** 比較は内容・利用状態だけ。件数、時刻、配備中の印、将来追加される列は含めない。 */
const contentColumns:Record<string,string> = {
  tags: 'id,name,color,description,group_id,folder_id,is_starred,display_order,manual_assignment_allowed,reapply_policy,linked_enabled,status,mileage_reward,referral_mileage_reward,mileage_multiplier_bps,mileage_multiplier_priority',
  folders: 'id,kind,name,parent_id,color,display_order',
  templates: 'id,name,category,folder_id,display_order,message_type,message_content,carousel_actions_json,carousel_tap_limit_mode,carousel_tap_limit_text,question_json,question_status,message_bubbles_json,draft_message_type,draft_message_content,draft_carousel_actions_json,draft_carousel_tap_limit_mode,draft_carousel_tap_limit_text,draft_question_json,draft_question_status,draft_message_bubbles_json,published_version,deleted_at',
  template_versions: 'id,template_id,version_number,message_type,message_content,carousel_actions_json,carousel_tap_limit_mode,carousel_tap_limit_text,question_json,question_status,message_bubbles_json',
  media: 'id,folder_id,kind,filename,mime_type,size_bytes,width,height,duration_ms,r2_key,public_url',
  media_versions: 'id,media_id,version_no,r2_key,mime_type,size_bytes,width,height,duration_ms,page_count,codec,content_hash,etag',
  auto_replies: 'id,name,keyword,match_type,response_type,response_content,template_id,is_active,actions_json,response_weekdays_json,response_holiday_rule,once_per_friend,keywords_json,respond_to_all,keyword_match_mode,active_from,active_until,cooldown_minutes,skip_when_operator_active,folder_id,display_order,priority,message_kinds_json,friend_conditions_json,lifecycle_status,current_draft_version_id,current_published_version_id,deleted_at',
  auto_reply_versions: 'id,auto_reply_id,version_number,definition_snapshot,status',
  scenarios: 'id,name,description,trigger_type,trigger_tag_id,is_active,delivery_mode,folder_id,display_order,allow_concurrent,audience_condition_json,on_complete_mode,on_complete_scenario_id,current_published_version_id',
  scenario_steps: 'id,scenario_id,step_order,delay_minutes,message_type,message_content,message_bubbles_json,offset_days,offset_minutes,delivery_time,template_id,on_reach_tag_id,condition_type,condition_value,next_step_on_false,after_send,target_condition_json,question_json,is_draft',
  forms: 'id,name,description,fields,layout,on_submit_tag_id,on_submit_scenario_id,save_to_metadata,is_active,on_submit_message_type,on_submit_message_content,on_submit_webhook_url,on_submit_webhook_headers,on_submit_webhook_fail_message,og_title,og_description,og_image_url,status,archived_at,current_published_version_id,folder_id',
  form_accounts: 'form_id,line_account_id',
  rich_menu_groups: 'id,name,chat_bar_text,size,default_page_id,is_default_for_all,status,targeting_condition,targeting_priority,targeting_enabled,folder_id,display_order,default_open',
  rich_menu_pages: 'id,group_id,order_index,name,image_r2_key,image_content_type',
  rich_menu_areas: 'id,page_id,bounds_x,bounds_y,bounds_width,bounds_height,action_type,action_data,intent,label,tag_ids,score_change,template_id,form_id,tracked_link_id',
  broadcast_message_assets: 'id,kind,name,payload_json,folder_id,published_version,draft_payload_json',
  common_action_bindings: 'id,common_action_id,common_action_version_id,consumer_type,consumer_id,consumer_path',
  common_actions: 'id,name,description,status,current_draft_version_id,current_published_version_id,archived_at',
  common_action_versions: 'id,common_action_id,version_number,status,action_config',
};
const columns=(table:string)=>contentColumns[table];
/** 名前だけで同じと見なさず、子行・公開状態も含めて店の編集を検出する。 */
export async function catalogResourceSnapshot(db: D1Database, account: string, kind: string, id: string): Promise<string | null> {
  kind=catalogResourceKind(kind);
  const spec = tables[kind];
  if (!spec) return null;
  const root = await db.prepare(spec.account
    ? `SELECT ${columns(spec.table)} FROM ${spec.table} WHERE id=? AND ${spec.account}=?`
    : `SELECT ${columns('forms')} FROM forms WHERE id=? AND EXISTS(SELECT 1 FROM form_accounts WHERE form_id=forms.id AND line_account_id=?)`)
    .bind(id, account).first<Record<string, unknown>>();
  if (!root && kind === 'template') {
    const asset = await db.prepare(`SELECT ${columns('broadcast_message_assets')} FROM broadcast_message_assets WHERE id=? AND line_account_id=?`).bind(id, account).first();
    return asset ? JSON.stringify({ root: asset }) : null;
  }
  if (!root) return null;
  const children: Record<string, unknown> = {};
  if (kind === 'tag') {
    children.bindings = (await db.prepare(`SELECT ${columns('common_action_bindings')} FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=? ORDER BY id`).bind(account, id).all()).results;
    children.actions = (await db.prepare(`SELECT ${columns('common_actions')} FROM common_actions WHERE line_account_id=? AND id IN(SELECT common_action_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?) ORDER BY id`).bind(account, account, id).all()).results;
    children.versions = (await db.prepare(`SELECT ${columns('common_action_versions')} FROM common_action_versions WHERE id IN(SELECT common_action_version_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?) ORDER BY id`).bind(account, id).all()).results;
  }
  for (const [table, owner] of spec.children ?? []) children[table] = (await db.prepare(`SELECT ${columns(table)} FROM ${table} WHERE ${owner}=? ORDER BY 1,2`).bind(id).all()).results;
  if (kind === 'rich_menu') children.areas = (await db.prepare(`SELECT ${columns('rich_menu_areas')} FROM rich_menu_areas WHERE page_id IN(SELECT id FROM rich_menu_pages WHERE group_id=?) ORDER BY id`).bind(id).all()).results;
  return JSON.stringify({ root, children });
}

/** 実体と同じ batch で比較用の記録を作り、作成直後の店の編集を取り込まない。 */
export async function catalogResourceCommit(db:D1Database,tenant:string,account:string,resolutions:readonly {itemKind:string;targetId?:string}[]) {
  const statements: import('./hq-templates/contract.js').HqTemplateStatement[]=[];
  const rowJson=async(table:string,alias:string)=>{
    return `json_object(${contentColumns[table].split(',').flatMap(column=>[`'${column}'`,`${alias}."${column}"`]).join(',')})`;
  };
  const seen=new Set<string>();
  for(const resolution of resolutions) {
    const kind=catalogResourceKind(resolution.itemKind),id=resolution.targetId,spec=tables[kind];
    if(!id||!spec||seen.has(`${kind}:${id}`))continue;
    seen.add(`${kind}:${id}`);
    const root=`(SELECT ${await rowJson(spec.table,'r')} FROM ${spec.table} r WHERE r.id=? AND ${spec.account?`r.${spec.account}=?`:'EXISTS(SELECT 1 FROM form_accounts WHERE form_id=r.id AND line_account_id=?)'})`;
    const bindings:Array<string|number|null>=[tenant,account,kind,id,id,account];
    const children:string[]=[];
    const child=async(key:string,table:string,where:string,args:unknown[])=>{
      children.push(`'${key}',json((SELECT json_group_array(json(value)) FROM (SELECT ${await rowJson(table,'c')} value FROM ${table} c WHERE ${where} ORDER BY ${contentColumns[table].split(',').slice(0,2).map(column=>`c."${column}"`).join(',')})))`);
      bindings.push(...args as (string|number|null)[]);
    };
    if(kind==='tag') {
      await child('bindings','common_action_bindings',"c.line_account_id=? AND c.consumer_type='tag' AND c.consumer_id=?",[account,id]);
      await child('actions','common_actions',"c.line_account_id=? AND c.id IN(SELECT common_action_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?)",[account,account,id]);
      await child('versions','common_action_versions',"c.id IN(SELECT common_action_version_id FROM common_action_bindings WHERE line_account_id=? AND consumer_type='tag' AND consumer_id=?)",[account,id]);
    }
    for(const [table,owner] of spec.children??[])await child(table,table,`c.${owner}=?`,[id]);
    if(kind==='rich_menu')await child('areas','rich_menu_areas','c.page_id IN(SELECT id FROM rich_menu_pages WHERE group_id=?)',[id]);
    let snapshot=`json_object('root',json(${root}),'children',json_object(${children.join(',')}))`;
    if(kind==='template') {
      const asset=`(SELECT ${await rowJson('broadcast_message_assets','a')} FROM broadcast_message_assets a WHERE a.id=? AND a.line_account_id=?)`;
      snapshot=`CASE WHEN ${root} IS NOT NULL THEN ${snapshot} ELSE json_object('root',json(${asset})) END`;
      // CASE の最初の存在判定にも同じ所有範囲を束縛する。
      bindings.splice(4,0,id,account);bindings.push(id,account);
    }
    bindings.push(new Date().toISOString());
    statements.push({sql:`INSERT INTO style_starter_catalog_resources(tenant_id,line_account_id,resource_kind,target_id,source_snapshot,updated_at) VALUES (?,?,?,?,${snapshot},?) ON CONFLICT(line_account_id,resource_kind,target_id) DO UPDATE SET source_snapshot=excluded.source_snapshot,updated_at=excluded.updated_at`,bindings});
  }
  return statements;
}
