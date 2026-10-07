import { Hono } from 'hono';
import type { Env } from '../index.js';
import { jstNow } from '@line-crm/db';
import { requirePermission, requireRole } from '../middleware/role-guard.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { createR2PresignedPutUrl } from '../services/r2-presigned-upload.js';
import { storeBroadcastMedia } from '../services/broadcast-media-storage.js';
import { validateBroadcastMediaUpload } from './broadcast-message-assets.js';
import { ensureFileScanForUpload } from './file-scan.js';

const broadcastMediaDirect = new Hono<Env>();
interface Session { id:string; line_account_id:string|null; created_by:string; r2_key:string; public_key:string|null; filename:string; mime_type:string; expected_size:number; expires_at:string; completed_at:string|null }
broadcastMediaDirect.post('/api/broadcast-message-assets/upload-sessions',requireRole('owner','admin','staff'),requirePermission('/broadcasts'),async c => {
  const body = await c.req.json<{lineAccountId?:string|null;filename?:string;mimeType?:string;sizeBytes?:number}>();
  const accountId = body.lineAccountId ?? null;
  if (!await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[accountId])) return c.json({success:false,error:'このLINEアカウントを操作する権限がありません'},403);
  const mime = body.mimeType ?? '';
  const max = mime === 'video/mp4' ? 200*1024*1024 : 10*1024*1024;
  const extension = mime === 'video/mp4' ? 'mp4' : mime === 'image/jpeg' ? 'jpg' : 'png';
  if (!['video/mp4','image/png','image/jpeg'].includes(mime) || !body.filename || !Number.isSafeInteger(body.sizeBytes) || Number(body.sizeBytes) < 1 || Number(body.sizeBytes)>max) return c.json({success:false,error:'動画はMP4・200MB、画像はJPEG/PNG・10MBまでです'},400);
  if (!c.env.CF_ACCOUNT_ID || !c.env.MEDIA_R2_ACCESS_KEY_ID || !c.env.MEDIA_R2_SECRET_ACCESS_KEY || !c.env.MEDIA_R2_BUCKET_NAME) return c.json({success:false,error:'直接アップロードが未設定です。管理者に確認してください'},503);
  const id = crypto.randomUUID();
  const key = `broadcast-upload/${id}.${extension}`;
  const signed = await createR2PresignedPutUrl({accountId:c.env.CF_ACCOUNT_ID,accessKeyId:c.env.MEDIA_R2_ACCESS_KEY_ID,secretAccessKey:c.env.MEDIA_R2_SECRET_ACCESS_KEY,bucketName:c.env.MEDIA_R2_BUCKET_NAME},{key,contentType:mime,lineAccountId:accountId??'',uploadSessionId:id});
  await c.env.DB.prepare(`INSERT INTO broadcast_media_upload_sessions (id,line_account_id,created_by,r2_key,filename,mime_type,expected_size,expires_at,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).bind(id,accountId,c.get('staff').id,key,body.filename,mime,body.sizeBytes,signed.expiresAt,jstNow()).run();
  return c.json({success:true,data:{id,uploadUrl:signed.url,requiredHeaders:signed.headers,expiresAt:signed.expiresAt}},201);
});
broadcastMediaDirect.post('/api/broadcast-message-assets/upload-sessions/:id/complete',requireRole('owner','admin','staff'),requirePermission('/broadcasts'),async c => {
  const session = await c.env.DB.prepare('SELECT * FROM broadcast_media_upload_sessions WHERE id = ? AND created_by = ?').bind(c.req.param('id'),c.get('staff').id).first<Session>();
  if (!session || !await canAccessAllLineAccounts(c.env.DB,c.get('staff'),[session.line_account_id])) return c.notFound();
  const origin = c.env.WORKER_URL || new URL(c.req.url).origin;
  if (session.completed_at && session.public_key) return c.json({success:true,data:{key:session.public_key,url:`${origin}/images/${session.public_key}`,mimeType:session.mime_type,size:session.expected_size}});
  if (Date.parse(session.expires_at)<=Date.now()) return c.json({success:false,error:'アップロード期限が切れました。やり直してください'},409);
  const body = await c.req.json<{etag?:string}>();
  const object = await c.env.IMAGES.head(session.r2_key);
  if (!object || object.size !== session.expected_size || object.httpMetadata?.contentType !== session.mime_type || object.etag !== body.etag?.replace(/^"|"$/g,'') || object.customMetadata?.['upload-session-id'] !== session.id || object.customMetadata?.['line-account-id'] !== (session.line_account_id ?? '')) return c.json({success:false,error:'アップロードしたファイルを確認できませんでした'},409);
  const prefix = await c.env.IMAGES.get(session.r2_key,{range:{offset:0,length:16}});
  const validation = validateBroadcastMediaUpload(prefix ? new Uint8Array(await prefix.arrayBuffer()) : new Uint8Array(),session.mime_type,session.filename);
  if (!validation.ok) return c.json({success:false,error:validation.error},422);
  const source = await c.env.IMAGES.get(session.r2_key,{onlyIf:{etagMatches:object.etag}});
  if (!source || !('body' in source)) return c.json({success:false,error:'ファイルが変更されました。やり直してください'},409);
  // 署名URLで上書きできる一時キーから、公開する変更不能のキーへ移す。
  const stored = await storeBroadcastMedia({bucket:c.env.IMAGES,body:source.body,contentLength:session.expected_size,mimeType:validation.mimeType,originalFilename:session.filename,publicBaseUrl:origin});
  await ensureFileScanForUpload({db:c.env.DB,lineAccountId:session.line_account_id,subjectKind:'broadcast_asset',subjectId:stored.key,mediaId:null,filename:session.filename,mimeType:session.mime_type,sizeBytes:session.expected_size});
  const completion = await c.env.DB.prepare('UPDATE broadcast_media_upload_sessions SET public_key = ?, completed_at = ? WHERE id = ? AND completed_at IS NULL').bind(stored.key,jstNow(),session.id).run();
  if (Number(completion.meta.changes) !== 1) {
    const winner = await c.env.DB.prepare('SELECT * FROM broadcast_media_upload_sessions WHERE id = ?').bind(session.id).first<Session>();
    if (winner?.public_key) {
      await c.env.IMAGES.delete(stored.key);
      return c.json({success:true,data:{key:winner.public_key,url:`${origin}/images/${winner.public_key}`,mimeType:session.mime_type,size:session.expected_size}});
    }
    return c.json({success:false,error:'完了を確認できませんでした。もう一度確認してください'},409);
  }
  return c.json({success:true,data:stored},201);
});
export { broadcastMediaDirect };
