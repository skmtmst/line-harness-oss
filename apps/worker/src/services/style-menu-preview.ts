import { initialMenuDestination, type AccountStyle } from '@line-crm/shared';
import type { StarterItem } from './style-starter-definition.js';
/** 店が選んだ既存メニューの画像・操作を、そのまま表示する。 */
export async function savedStyleMenuPreview(db:D1Database,account:string,style:AccountStyle,item:StarterItem) {
 const page=await db.prepare(`SELECT p.id,p.image_r2_key,g.size FROM style_starter_items i JOIN rich_menu_groups g ON g.id=i.target_id AND g.account_id=i.line_account_id JOIN rich_menu_pages p ON p.id=g.default_page_id WHERE i.line_account_id=? AND i.item_key=? AND i.kind='rich_menu' ORDER BY i.style=? DESC,i.applied_at DESC LIMIT 1`).bind(account,item.key,style).first<{id:string;image_r2_key:string|null;size:string}>();
 if(!page)return null;
 const rows=(await db.prepare(`SELECT label,action_type,action_data,intent,form_id,bounds_x x,bounds_y y,bounds_width width,bounds_height height FROM rich_menu_areas WHERE page_id=? ORDER BY bounds_y,bounds_x`).bind(page.id).all<{label:string;action_type:string;action_data:string;intent:string;form_id:string|null;x:number;y:number;width:number;height:number}>()).results;
 const buttons=await Promise.all(rows.map(async row=>{
  const definition=item.buttons?.find(button=>button.label===row.label);
  let data:Record<string,unknown>={};try{const parsed=JSON.parse(row.action_data);if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))data=parsed;}catch{data=row.action_type==='uri'?{uri:row.action_data}:{text:row.action_data}}
  const actionData=row.action_type==='uri'?String(data.uri??''):row.action_type==='message'?String(data.text??''):Object.keys(data).length?JSON.stringify(data):'';
  let ready=!!actionData.trim();
  if(row.form_id)ready=!!await db.prepare(`SELECT 1 FROM forms f JOIN form_accounts a ON a.form_id=f.id WHERE f.id=? AND a.line_account_id=? AND f.status='active' AND f.is_active=1 AND f.current_published_version_id IS NOT NULL`).bind(row.form_id,account).first();
  return {label:row.label,feature:definition?.feature??'contact',target:definition?.target,actionType:row.action_type,actionData,intent:row.intent,formId:row.form_id,bounds:{x:row.x,y:row.y,width:row.width,height:row.height},ready,reason:row.form_id?'ページの内容を確認して公開してください':'最初のメニューの設定を確認してください',destination:definition?.target?initialMenuDestination(style,definition.target):'保存済みのボタンの操作'};
 }));
 return {key:item.key,targetId:(await db.prepare('SELECT group_id FROM rich_menu_pages WHERE id=?').bind(page.id).first<{group_id:string}>())?.group_id,imageR2Key:page.image_r2_key,imageHeight:page.size==='small'?843:1686,buttons};
}
