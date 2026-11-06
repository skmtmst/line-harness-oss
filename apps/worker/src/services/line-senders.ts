import type { AuthenticatedStaff } from '../middleware/auth/principal/auth.js';
import { GapError } from './gap-common.js';
export interface SenderSnapshot {name:string;iconUrl?:string}
export interface SenderRow {id:string;account_id:string;name:string;icon_media_id:string|null;icon_url:string|null;visibility:'all'|'owner_only';owner_staff_id:string|null;status:string;version:number;request_json:string}
export function validSenderName(input:unknown):input is string {
 return typeof input==='string' && Array.from(input.trim()).length>0 && Array.from(input.trim()).length<=20
  && !/line|ライン/i.test(input.normalize('NFKC')) && /[\p{L}\p{N}]/u.test(input);
}
export async function senderIcon(db:D1Database,account:string,id:unknown):Promise<{id:string;url:string}|null> {
 if(id==null) return null;
 if(typeof id!=='string') throw new GapError('invalid_icon');
 const m=await db.prepare('SELECT id,public_url,mime_type,size_bytes,width,height FROM media WHERE id=? AND line_account_id=? AND archived_at IS NULL').bind(id,account)
  .first<{id:string;public_url:string;mime_type:string;size_bytes:number;width:number;height:number}>();
 if(!m||!['image/png','image/jpeg'].includes(m.mime_type)||m.size_bytes>1024*1024||!m.width||m.width!==m.height) throw new GapError('invalid_icon');
 try {const u=new URL(m.public_url);if(u.protocol!=='https:'||u.username||u.password) throw 0;} catch {throw new GapError('invalid_icon');}
 return {id:m.id,url:m.public_url};
}
export async function resolveLineSender(db:D1Database,account:string,staff:AuthenticatedStaff,id:string):Promise<SenderSnapshot|null> {
 const row=await db.prepare('SELECT * FROM line_senders WHERE id=? AND account_id=? AND status=\'active\'').bind(id,account).first<SenderRow>();
 if(!row) throw new GapError('sender_not_found',404);
 if(row.visibility==='owner_only' && row.owner_staff_id!==staff.id && !['owner','admin'].includes(staff.role)) throw new GapError('sender_forbidden',403);
 if(row.icon_url && (!row.icon_media_id || !await db.prepare('SELECT id FROM media WHERE id=? AND line_account_id=? AND archived_at IS NULL').bind(row.icon_media_id,account).first())) return null;
 return {name:row.name,...(row.icon_url?{iconUrl:row.icon_url}:{})};
}
export function senderResponse(r:SenderRow) {return {id:r.id,name:r.name,iconMediaId:r.icon_media_id,iconUrl:r.icon_url,visibility:r.visibility,ownerStaffId:r.owner_staff_id,status:r.status,version:r.version};}
