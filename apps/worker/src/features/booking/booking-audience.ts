import {GapError} from '../../services/gap-common.js';
export interface AudienceRow {audience_mode:string;audience_tag_ids_json:string}
export async function menuAudience(db:D1Database,account:string,menuId:string,friendId:string|null) {
 const m=await db.prepare('SELECT audience_mode,audience_tag_ids_json FROM menus WHERE id=? AND line_account_id=? AND is_active=1 AND deleted_at IS NULL').bind(menuId,account).first<AudienceRow>();
 if(!m)return {visible:false,reason:'menu_not_available'};
 if(m.audience_mode==='all')return {visible:true,reason:null};
 const ids=JSON.parse(m.audience_tag_ids_json) as string[];
 if(!ids.length)return {visible:false,reason:'audience_tags_missing'};
 const tags=(await db.prepare(`SELECT t.id FROM tags t JOIN json_each(?) j ON j.value=t.id WHERE t.line_account_id=? AND t.status='active'`).bind(JSON.stringify(ids),account).all<{id:string}>()).results;
 if(tags.length!==ids.length)return {visible:false,reason:'audience_tags_missing'};
 const match=friendId?await db.prepare(`SELECT 1 FROM friend_tags ft JOIN json_each(?) j ON j.value=ft.tag_id WHERE ft.friend_id=? LIMIT 1`).bind(JSON.stringify(ids),friendId).first():null;
 const visible=m.audience_mode==='include_tags'?!!match:!match;
 return {visible,reason:visible?null:(m.audience_mode==='include_tags'?'required_tag_missing':'excluded_tag_present')};
}
export async function readAudienceWrite(db:D1Database,account:string,b:Record<string,unknown>) {
 if(b.audienceMode===undefined&&b.audienceTagIds===undefined)return null;
 if(!['all','include_tags','exclude_tags'].includes(String(b.audienceMode))||!Array.isArray(b.audienceTagIds)||b.audienceTagIds.length>100||b.audienceTagIds.some(x=>typeof x!=='string')||new Set(b.audienceTagIds).size!==b.audienceTagIds.length)throw new GapError('invalid_audience');
 if(b.audienceMode!=='all'&&!b.audienceTagIds.length)throw new GapError('audience_tags_required');
 const ids=b.audienceTagIds as string[];
 const found=(await db.prepare("SELECT id FROM tags WHERE line_account_id=? AND status='active' AND id IN(SELECT value FROM json_each(?))").bind(account,JSON.stringify(ids)).all()).results;
 if(found.length!==ids.length)throw new GapError('invalid_audience_tags');
 return {mode:b.audienceMode as string,ids};
}
