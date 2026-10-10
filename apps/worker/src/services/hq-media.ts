import type { HqMediaUploadSession, MessageTemplateMediaDefinition } from '@line-crm/shared';
import type { Env } from '../index.js';
import { createR2PresignedPutUrl } from './r2-presigned-upload.js';
import { copyHqMediaStream, hashHqMedia, HQ_MEDIA_MAX_BYTES } from './hq-media-stream.js';
import { readHqMp4Metadata } from './hq-mp4-metadata.js';
import { requireHqTemplateAuthority, type HqTemplateAuthority } from './hq-templates/contract.js';
import { isRegisteredHqMedia } from './hq-templates/authoring-media.js';
import { HqTemplateError } from './hq-templates/tag.js';
import { ensureFileScanForUpload } from '../routes/file-scan.js';
import { checkKeyGate } from './file-scan.js';

const fail = (code: string, status: 400 | 403 | 404 | 409 | 422 | 500 = 422): never => { throw new HqTemplateError(code, status); };
function scope(authority: HqTemplateAuthority) {
  if (requireHqTemplateAuthority(authority).kind !== 'AUTHORIZED' || !/^[A-Za-z0-9_-]{1,128}$/.test(authority.tenantId)) fail('FORBIDDEN', 403);
  return `hq-templates/${authority.tenantId}/`;
}
interface Session { id: string; r2_key: string; public_key: string | null; filename: string; mime_type: string; expected_size: number; expires_at: string; completed_at: string | null }
function publicOrigin(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('INVALID_PUBLIC_ORIGIN');
  return url.origin;
}

/** Existing nullable account sessions + immutable tenant prefix; never a synthetic store. */
export async function createHqMediaSession(env: Env['Bindings'], db: D1Database, authority: HqTemplateAuthority, input: Record<string, unknown>): Promise<HqMediaUploadSession> {
  const prefix = scope(authority);
  const { filename, mimeType, sizeBytes } = input;
  if (typeof filename !== 'string' || !filename.trim() || filename.length > 200 || /[\\/\u0000-\u001f]/.test(filename)
    || !['audio/mp4', 'video/mp4'].includes(String(mimeType)) || !filename.toLowerCase().endsWith(mimeType === 'audio/mp4' ? '.m4a' : '.mp4')) fail('INVALID_MEDIA');
  if (!Number.isSafeInteger(sizeBytes) || Number(sizeBytes) < 1 || Number(sizeBytes) > HQ_MEDIA_MAX_BYTES) fail('MEDIA_SIZE_LIMIT');
  if (!env.CF_ACCOUNT_ID || !env.MEDIA_R2_ACCESS_KEY_ID || !env.MEDIA_R2_SECRET_ACCESS_KEY || !env.MEDIA_R2_BUCKET_NAME) fail('DIRECT_UPLOAD_UNAVAILABLE', 500);
  const id = crypto.randomUUID(), key = `${prefix}pending/${id}.${mimeType === 'audio/mp4' ? 'm4a' : 'mp4'}`;
  const signed = await createR2PresignedPutUrl({ accountId: env.CF_ACCOUNT_ID!, accessKeyId: env.MEDIA_R2_ACCESS_KEY_ID!, secretAccessKey: env.MEDIA_R2_SECRET_ACCESS_KEY!, bucketName: env.MEDIA_R2_BUCKET_NAME! },
    { key, contentType: String(mimeType), lineAccountId: '', uploadSessionId: id });
  await db.prepare(`INSERT INTO broadcast_media_upload_sessions(id,line_account_id,created_by,r2_key,filename,mime_type,expected_size,expires_at,created_at) VALUES (?,NULL,?,?,?,?,?,?,?)`)
    .bind(id, authority.actorId, key, filename, mimeType, sizeBytes, signed.expiresAt, new Date().toISOString()).run();
  return { id, uploadUrl: signed.url, requiredHeaders: signed.headers, expiresAt: signed.expiresAt };
}
async function session(db: D1Database, authority: HqTemplateAuthority, id: string) {
  const prefix = scope(authority);
  if (!/^[a-f0-9-]{36}$/.test(id)) fail('NOT_FOUND', 404);
  const row = await db.prepare('SELECT * FROM broadcast_media_upload_sessions WHERE id=? AND created_by=? AND line_account_id IS NULL')
    .bind(id, authority.actorId).first<Session>();
  if (!row || !row.r2_key.startsWith(`${prefix}pending/`)) fail('NOT_FOUND', 404);
  return row!;
}
export async function readRegisteredHqMedia(bucket: R2Bucket, tenantId: string, key: unknown): Promise<MessageTemplateMediaDefinition> {
  if (typeof key !== 'string' || !new RegExp(`^hq-templates/${tenantId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/uploads/[a-f0-9-]{36}\\.(m4a|mp4)$`).test(key)) fail('NOT_FOUND', 404);
  const object = await bucket.head(key as string);
  let media: MessageTemplateMediaDefinition;
  try { media = JSON.parse(object?.customMetadata?.hqMedia ?? 'null'); } catch { fail('SOURCE_MEDIA_UNAVAILABLE', 409); }
  if (!media! || media!.r2Key !== key || !isRegisteredHqMedia(object, media!, tenantId) || !['audio', 'video'].includes(media!.kind)) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
  return media!;
}
export async function completeHqMediaSession(env: Env['Bindings'], db: D1Database, authority: HqTemplateAuthority, id: string, etag: unknown, origin: string) {
  const row = await session(db, authority, id), bucket = env.IMAGES, base = publicOrigin(origin);
  if (row.completed_at && row.public_key) return readRegisteredHqMedia(bucket, authority.tenantId, row.public_key);
  if (!Number.isFinite(Date.parse(row.expires_at)) || Date.parse(row.expires_at) <= Date.now()) fail('UPLOAD_EXPIRED', 409);
  const object = await bucket.head(row.r2_key);
  if (!object || object.size !== row.expected_size || object.httpMetadata?.contentType !== row.mime_type || object.etag !== (typeof etag === 'string' ? etag.replace(/^"|"$/g, '') : '')
    || object.customMetadata?.['upload-session-id'] !== id || object.customMetadata?.['line-account-id'] !== '') fail('SOURCE_MEDIA_UNAVAILABLE', 409);
  const kind = row.mime_type === 'audio/mp4' ? 'audio' : 'video';
  let durationMs: number, contentHash: string;
  try {
    ({ durationMs } = await readHqMp4Metadata(bucket, row.r2_key, object!.etag, row.expected_size, kind));
    contentHash = await hashHqMedia(bucket, row.r2_key, object!.etag, row.expected_size);
  } catch { fail('INVALID_MEDIA'); }
  // One immutable key per session. The signed pending key is never made public.
  const key = `hq-templates/${authority.tenantId}/uploads/${id}.${kind === 'audio' ? 'm4a' : 'mp4'}`;
  const media: MessageTemplateMediaDefinition = { id, kind, filename: row.filename, mimeType: row.mime_type, sizeBytes: row.expected_size, width: null, height: null, durationMs: durationMs!, contentHash: contentHash!, r2Key: key, publicUrl: `${base}/images/${key}`, versionId: id, versionNo: 1 };
  const existing = await bucket.head(key);
  if (existing && !isRegisteredHqMedia(existing, media, authority.tenantId)) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
  if (!existing) {
    try { await copyHqMediaStream(bucket, { r2Key: row.r2_key, etag: object!.etag, sizeBytes: media.sizeBytes, contentHash: media.contentHash }, key,
      { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: media.mimeType }, customMetadata: { hqTenant: authority.tenantId, hqMedia: JSON.stringify(media) } }); }
    catch { /* Recover a lost PUT response by checking the exact immutable receipt. */ }
    if (!isRegisteredHqMedia(await bucket.head(key), media, authority.tenantId)) fail('UPLOAD_UNCONFIRMED', 409);
  }
  // Same safety gate as store rich video. Replays must not bypass a failed scan.
  await ensureFileScanForUpload({ db, lineAccountId: null, subjectKind: 'broadcast_asset', subjectId: key, mediaId: null, filename: media.filename, mimeType: media.mimeType, sizeBytes: media.sizeBytes });
  await db.prepare('UPDATE broadcast_media_upload_sessions SET public_key=?,completed_at=? WHERE id=? AND created_by=? AND completed_at IS NULL')
    .bind(key, new Date().toISOString(), id, authority.actorId).run();
  return media;
}
export async function cancelHqMediaSession(bucket: R2Bucket, db: D1Database, authority: HqTemplateAuthority, id: string) {
  const row = await session(db, authority, id);
  if (row.completed_at) fail('MEDIA_IN_USE', 409);
  // Revocation first; an outstanding signed PUT can recreate only an unusable pending key.
  await db.prepare('UPDATE broadcast_media_upload_sessions SET expires_at=? WHERE id=? AND created_by=? AND completed_at IS NULL').bind(new Date(0).toISOString(), id, authority.actorId).run();
  await bucket.delete(row.r2_key);
  return { deleted: true };
}
export async function hqMediaGate(db: D1Database, bucket: Pick<R2Bucket, 'get'>, key: string) {
  const scan = await db.prepare("SELECT status FROM media_file_scans WHERE subject_kind='broadcast_asset' AND subject_id=?").bind(key).first<{ status: string }>();
  if (!scan || !(await checkKeyGate(db, bucket, 'broadcast_asset', key)).allowed) fail('MEDIA_SCAN_PENDING', 409);
}

export interface HqMediaRuntime { bucket: R2Bucket; publicBaseUrl: string; copy?: boolean }
/** Standalone HQ audio is materialized per store only on send/test-send, never during preflight. */
export async function resolveHqAudio(db: D1Database, tenantId: string, accountId: string, audio: Record<string, unknown>, runtime?: HqMediaRuntime) {
  let key = audio.hqMediaKey;
  if (key === undefined && typeof audio.originalContentUrl === 'string') {
    try { const url = new URL(audio.originalContentUrl); if (url.pathname.startsWith('/images/hq-templates/')) key = decodeURIComponent(url.pathname.slice('/images/'.length)); } catch { fail('INVALID_MEDIA'); }
  }
  if (key === undefined) return audio;
  if (!runtime) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
  const bucket = runtime!.bucket, media = await readRegisteredHqMedia(bucket, tenantId, key);
  if (media.kind !== 'audio' || !media.durationMs || !Number.isSafeInteger(media.durationMs) || media.durationMs < 1 || media.sizeBytes > HQ_MEDIA_MAX_BYTES || audio.originalContentUrl !== media.publicUrl) fail('INVALID_MEDIA');
  const store = await db.prepare('SELECT id FROM line_accounts WHERE id=? AND tenant_id=? AND is_active=1 AND archived_at IS NULL').bind(accountId, tenantId).first();
  if (!store) fail('FORBIDDEN', 403);
  await hqMediaGate(db, bucket, media.r2Key);
  const id = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([tenantId, accountId, media.id, media.contentHash])))), b => b.toString(16).padStart(2, '0')).join('');
  const targetKey = `media/${accountId}/hq-audio/${id}.m4a`, url = `${publicOrigin(runtime!.publicBaseUrl)}/images/${targetKey}`;
  if (runtime!.copy) {
    const local = await db.prepare('SELECT line_account_id,r2_key,archived_at FROM media WHERE id=?').bind(id).first<{line_account_id:string;r2_key:string;archived_at:string|null}>();
    if (local && (local.line_account_id !== accountId || local.r2_key !== targetKey || local.archived_at)) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
    const source = await bucket.head(media.r2Key);
    if (!isRegisteredHqMedia(source, media, tenantId)) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
    const matches = (object: R2Object | null) => object?.size === media.sizeBytes && object.httpMetadata?.contentType === media.mimeType && object.customMetadata?.hqTenant === tenantId && object.customMetadata?.contentHash === media.contentHash;
    const existing = await bucket.head(targetKey);
    if (existing && !matches(existing)) fail('SOURCE_MEDIA_UNAVAILABLE', 409);
    if (!existing) {
      try { await copyHqMediaStream(bucket, { r2Key: media.r2Key, etag: source!.etag, sizeBytes: media.sizeBytes, contentHash: media.contentHash }, targetKey,
        { onlyIf: { etagDoesNotMatch: '*' }, httpMetadata: { contentType: media.mimeType }, customMetadata: { hqTenant: tenantId, contentHash: media.contentHash } }); }
      catch { /* Reconcile deterministic copy after a lost response. */ }
      if (!matches(await bucket.head(targetKey))) fail('UPLOAD_UNCONFIRMED', 409);
    }
    const now = new Date().toISOString();
    await db.batch([
      db.prepare(`INSERT OR IGNORE INTO media(id,line_account_id,kind,filename,mime_type,size_bytes,duration_ms,r2_key,public_url,created_at) VALUES (?,?,'audio',?,?,?,?,?,?,?)`).bind(id, accountId, media.filename, media.mimeType, media.sizeBytes, media.durationMs, targetKey, url, now),
      db.prepare(`INSERT OR IGNORE INTO media_versions(id,media_id,version_no,r2_key,mime_type,size_bytes,duration_ms,content_hash,scan_status,scanned_at,created_at,published_at) VALUES (?,?,1,?,?,?,?,?,'verified',?,?,?)`).bind(`hq_audio_${id}`, id, targetKey, media.mimeType, media.sizeBytes, media.durationMs, media.contentHash, now, now, now),
    ]);
  }
  return { originalContentUrl: url, duration: media.durationMs! / 1000 };
}
