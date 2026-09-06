import { jstNow } from './utils.js';
import type { Media, MediaKind } from './media.js';

const DEFAULT_MEDIA_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

export type MediaQuotaState = 'normal' | 'notice' | 'warning' | 'full';

export interface MediaStorageQuota {
  usageBytes: number;
  reservedBytes: number;
  limitBytes: number;
  remainingBytes: number;
  usageRate: number;
  state: MediaQuotaState;
}

export interface MediaUploadSession {
  id: string;
  line_account_id: string;
  target_media_id: string | null;
  result_media_id: string | null;
  folder_id: string | null;
  filename: string;
  kind: MediaKind;
  expected_mime: string;
  expected_size: number;
  r2_key: string;
  status: 'pending' | 'verified' | 'completed' | 'failed' | 'expired';
  failure_code: string | null;
  etag: string | null;
  expires_at: string;
  created_by: string | null;
  created_at: string;
  completed_at: string | null;
}

export interface MediaVersion {
  id: string;
  media_id: string;
  version_no: number;
  r2_key: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  page_count: number | null;
  codec: string | null;
  content_hash: string | null;
  etag: string | null;
  scan_status: string;
  scan_result: string | null;
  scanned_at: string | null;
  change_reason: string | null;
  uploaded_by: string | null;
  created_at: string;
  published_at: string | null;
}

export class MediaVersionConflictError extends Error {
  constructor(readonly currentVersionNo: number) {
    super('media version conflict');
  }
}

function quotaState(usageRate: number): MediaQuotaState {
  if (usageRate >= 1) return 'full';
  if (usageRate >= 0.9) return 'warning';
  if (usageRate >= 0.8) return 'notice';
  return 'normal';
}

export async function getMediaStorageQuota(
  db: D1Database,
  lineAccountId: string,
): Promise<MediaStorageQuota> {
  await db.prepare(
    `INSERT OR IGNORE INTO media_storage_quotas
       (line_account_id, limit_bytes, updated_at) VALUES (?, ?, ?)`,
  ).bind(lineAccountId, DEFAULT_MEDIA_QUOTA_BYTES, jstNow()).run();
  const row = await db.prepare(
    `SELECT q.limit_bytes,
            COALESCE((SELECT SUM(m.size_bytes) FROM media m
              WHERE m.line_account_id = q.line_account_id), 0)
            + COALESCE((SELECT SUM(v.size_bytes)
                FROM media_versions v JOIN media m ON m.id = v.media_id
               WHERE m.line_account_id = q.line_account_id AND v.r2_key <> m.r2_key), 0)
              AS usage_bytes,
            COALESCE((SELECT SUM(s.expected_size) FROM media_upload_sessions s
              WHERE s.line_account_id = q.line_account_id
                AND s.status IN ('pending','verified') AND datetime(s.expires_at) > datetime(?)), 0)
              AS reserved_bytes
       FROM media_storage_quotas q WHERE q.line_account_id = ?`,
  ).bind(jstNow(), lineAccountId).first<{
    limit_bytes: number;
    usage_bytes: number;
    reserved_bytes: number;
  }>();
  if (!row) throw new Error('media quota is unavailable');
  const usageBytes = Number(row.usage_bytes);
  const reservedBytes = Number(row.reserved_bytes);
  const limitBytes = Number(row.limit_bytes);
  const usedAndReserved = usageBytes + reservedBytes;
  const usageRate = limitBytes > 0 ? usedAndReserved / limitBytes : 1;
  return {
    usageBytes,
    reservedBytes,
    limitBytes,
    remainingBytes: Math.max(0, limitBytes - usedAndReserved),
    usageRate,
    state: quotaState(usageRate),
  };
}

export async function createMediaUploadSession(
  db: D1Database,
  input: {
    id: string;
    lineAccountId: string;
    targetMediaId?: string | null;
    folderId?: string | null;
    filename: string;
    kind: MediaKind;
    mimeType: string;
    sizeBytes: number;
    r2Key: string;
    expiresAt: string;
    createdBy?: string | null;
  },
): Promise<MediaUploadSession> {
  await db.prepare(
    `INSERT INTO media_upload_sessions
       (id, line_account_id, target_media_id, folder_id, filename, kind, expected_mime,
        expected_size, r2_key, status, expires_at, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
  ).bind(
    input.id, input.lineAccountId, input.targetMediaId ?? null, input.folderId ?? null,
    input.filename, input.kind, input.mimeType, input.sizeBytes, input.r2Key,
    input.expiresAt, input.createdBy ?? null, jstNow(),
  ).run();
  return (await getMediaUploadSession(db, input.id, input.lineAccountId))!;
}

export async function getMediaUploadSession(
  db: D1Database,
  id: string,
  lineAccountId: string,
): Promise<MediaUploadSession | null> {
  return db.prepare(
    `SELECT * FROM media_upload_sessions WHERE id = ? AND line_account_id = ?`,
  ).bind(id, lineAccountId).first<MediaUploadSession>();
}

export async function failMediaUploadSession(
  db: D1Database,
  id: string,
  lineAccountId: string,
  failureCode: string,
): Promise<void> {
  await db.prepare(
    `UPDATE media_upload_sessions SET status = 'failed', failure_code = ?, completed_at = ?
      WHERE id = ? AND line_account_id = ? AND status IN ('pending','verified')`,
  ).bind(failureCode, jstNow(), id, lineAccountId).run();
}

export async function verifyMediaUploadSession(
  db: D1Database,
  id: string,
  lineAccountId: string,
  etag: string,
): Promise<MediaUploadSession | null> {
  await db.prepare(
    `UPDATE media_upload_sessions SET status = 'verified', etag = ?, completed_at = ?
      WHERE id = ? AND line_account_id = ? AND status = 'pending'`,
  ).bind(etag, jstNow(), id, lineAccountId).run();
  return getMediaUploadSession(db, id, lineAccountId);
}

export async function completeNewMediaUpload(
  db: D1Database,
  session: MediaUploadSession,
): Promise<Media> {
  if (session.target_media_id) throw new Error('target media session cannot create a media asset');
  const mediaId = crypto.randomUUID();
  const versionId = crypto.randomUUID();
  const now = jstNow();
  await db.batch([
    db.prepare(
      `INSERT INTO media
         (id, line_account_id, folder_id, kind, filename, mime_type, size_bytes,
          width, height, duration_ms, r2_key, public_url, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, NULL, ?, ?)`,
    ).bind(
      mediaId, session.line_account_id, session.folder_id, session.kind, session.filename,
      session.expected_mime, session.expected_size, session.r2_key, session.created_by, now,
    ),
    db.prepare(
      `INSERT INTO media_versions
         (id, media_id, version_no, r2_key, mime_type, size_bytes, etag, scan_status,
          scanned_at, uploaded_by, created_at, published_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)`,
    ).bind(
      versionId, mediaId, session.r2_key, session.expected_mime, session.expected_size,
      session.etag, now, session.created_by, now, now,
    ),
    db.prepare(
      `UPDATE media_upload_sessions
          SET status = 'completed', result_media_id = ?, completed_at = ?
        WHERE id = ? AND line_account_id = ? AND status = 'verified'`,
    ).bind(mediaId, now, session.id, session.line_account_id),
  ]);
  const media = await db.prepare(
    `SELECT * FROM media WHERE id = ? AND line_account_id = ?`,
  ).bind(mediaId, session.line_account_id).first<Media>();
  if (!media) throw new Error('completed media is unavailable');
  return media;
}

export async function getCurrentMediaVersionNo(
  db: D1Database,
  mediaId: string,
  lineAccountId: string,
): Promise<number | null> {
  const row = await db.prepare(
    `SELECT MAX(v.version_no) AS version_no
       FROM media_versions v JOIN media m ON m.id = v.media_id
      WHERE v.media_id = ? AND m.line_account_id = ?`,
  ).bind(mediaId, lineAccountId).first<{ version_no: number | null }>();
  return row?.version_no == null ? null : Number(row.version_no);
}

export async function createMediaVersionFromUpload(
  db: D1Database,
  input: {
    mediaId: string;
    lineAccountId: string;
    uploadSessionId: string;
    expectedVersionNo: number;
    changeReason: string;
    uploadedBy?: string | null;
  },
): Promise<MediaVersion> {
  const currentVersionNo = await getCurrentMediaVersionNo(db, input.mediaId, input.lineAccountId);
  if (currentVersionNo === null) throw new Error('media_not_found');
  if (currentVersionNo !== input.expectedVersionNo) {
    throw new MediaVersionConflictError(currentVersionNo);
  }
  const session = await getMediaUploadSession(db, input.uploadSessionId, input.lineAccountId);
  if (!session || session.target_media_id !== input.mediaId || session.status !== 'verified') {
    throw new Error('media_upload_session_not_verified');
  }
  const id = crypto.randomUUID();
  const nextVersionNo = currentVersionNo + 1;
  const now = jstNow();
  try {
    await db.batch([
      db.prepare(
        `INSERT INTO media_versions
           (id, media_id, version_no, r2_key, mime_type, size_bytes, etag, scan_status,
            scanned_at, change_reason, uploaded_by, created_at, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?, ?)`,
      ).bind(
        id, input.mediaId, nextVersionNo, session.r2_key, session.expected_mime,
        session.expected_size, session.etag, now, input.changeReason,
        input.uploadedBy ?? session.created_by, now, now,
      ),
      db.prepare(
        `UPDATE media SET filename = ?, mime_type = ?, size_bytes = ?, r2_key = ?, uploaded_by = ?
          WHERE id = ? AND line_account_id = ?`,
      ).bind(
        session.filename, session.expected_mime, session.expected_size, session.r2_key,
        input.uploadedBy ?? session.created_by, input.mediaId, input.lineAccountId,
      ),
      db.prepare(
        `UPDATE media_upload_sessions
            SET status = 'completed', result_media_id = ?, completed_at = ?
          WHERE id = ? AND line_account_id = ? AND status = 'verified'`,
      ).bind(input.mediaId, now, session.id, input.lineAccountId),
    ]);
  } catch (error) {
    const latestVersionNo = await getCurrentMediaVersionNo(db, input.mediaId, input.lineAccountId);
    if (latestVersionNo !== null && latestVersionNo !== currentVersionNo) {
      throw new MediaVersionConflictError(latestVersionNo);
    }
    throw error;
  }
  const version = await db.prepare(
    `SELECT * FROM media_versions WHERE id = ? AND media_id = ?`,
  ).bind(id, input.mediaId).first<MediaVersion>();
  if (!version) throw new Error('created media version is unavailable');
  return version;
}
