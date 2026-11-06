import {GapError} from '../../services/gap-common.js';
import {menuAudience} from './booking-audience.js';
export interface BookingAddon {id:string;name:string;duration_minutes:number;base_price:number;version:number}
export async function bookingAddons(db:D1Database,a:string,menuId:string,ids:unknown,friend:string|null):Promise<BookingAddon[]>{
 if(ids===undefined)return [];
 if(!Array.isArray(ids)||ids.length>3||ids.some(x=>typeof x!=='string')||new Set(ids).size!==ids.length)throw new GapError('invalid_addons');
 const m=await db.prepare('SELECT addon_menu_ids_json,addon_only FROM menus WHERE id=? AND line_account_id=? AND is_active=1 AND deleted_at IS NULL').bind(menuId,a).first<{addon_menu_ids_json:string;addon_only:number}>();
 if(!m||m.addon_only)throw new GapError('addon_only_menu');
 const allowed=JSON.parse(m.addon_menu_ids_json) as string[];if(ids.some(id=>!allowed.includes(id)))throw new GapError('addon_not_allowed');
 const rows=(await db.prepare(`SELECT id,name,duration_minutes,base_price,version FROM menus WHERE line_account_id=? AND is_active=1 AND deleted_at IS NULL AND price_mode='fixed' AND id IN(SELECT value FROM json_each(?))`).bind(a,JSON.stringify(ids)).all<BookingAddon>()).results;
 if(rows.length!==ids.length)throw new GapError('addon_unavailable');
 for(const row of rows)if(!(await menuAudience(db,a,row.id,friend)).visible)throw new GapError('addon_unavailable');
 if(rows.reduce((n,r)=>n+r.duration_minutes,0)>480)throw new GapError('addons_too_long');
 return rows;
}
export async function readAddonSettings(db:D1Database,a:string,b:Record<string,unknown>){
 const sets:string[]=[],values:unknown[]=[];
 if(b.recurring!==undefined){const r=b.recurring as {enabled:boolean;freqs:string[];maxCount:number};if(!r||typeof r.enabled!=='boolean'||!Array.isArray(r.freqs)||!r.freqs.length||r.freqs.some(x=>!['weekly','biweekly','monthly_nth'].includes(x))||!Number.isInteger(r.maxCount)||r.maxCount<2||r.maxCount>12)throw new GapError('invalid_recurring');sets.push('customer_recurring_enabled = ?','recurring_freqs_json = ?','recurring_max_count = ?');values.push(r.enabled?1:0,JSON.stringify(r.freqs),r.maxCount);}

 if(b.maxPartySize!==undefined){if(!Number.isInteger(b.maxPartySize)||(Number(b.maxPartySize)<1||Number(b.maxPartySize)>6))throw new GapError('invalid_max_party_size');sets.push('max_party_size = ?');values.push(b.maxPartySize);}
 if(b.addonOnly!==undefined){if(typeof b.addonOnly!=='boolean')throw new GapError('invalid_addon_only');sets.push('addon_only = ?');values.push(b.addonOnly?1:0);}
 if(b.addonMenuIds!==undefined){if(!Array.isArray(b.addonMenuIds)||b.addonMenuIds.length>100||b.addonMenuIds.some(x=>typeof x!=='string')||new Set(b.addonMenuIds).size!==b.addonMenuIds.length)throw new GapError('invalid_addon_menus');
 const ids=b.addonMenuIds as string[];const rows=(await db.prepare("SELECT id FROM menus WHERE line_account_id=? AND deleted_at IS NULL AND price_mode='fixed' AND id IN(SELECT value FROM json_each(?))").bind(a,JSON.stringify(ids)).all()).results;if(rows.length!==ids.length)throw new GapError('invalid_addon_menus');sets.push('addon_menu_ids_json = ?');values.push(JSON.stringify(ids));}
 return {sets,values};
}
