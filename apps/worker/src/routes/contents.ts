import { Hono, type Context } from 'hono';
import {
  getMedia,
  countMedia,
  getMediaById,
  getFolderById,
  updateMedia,
  deleteMedia,
  getMediaUsages,
  getMediaDeleteImpact,
  getMediaReplacementPlan,
  applyMediaReplacementPlan,
  getMediaStorageQuota,
  createMediaUploadSession,
  getMediaUploadSession,
  failMediaUploadSession,
  verifyMediaUploadSession,
  completeNewMediaUpload,
  createMediaVersionFromUpload,
  getCurrentMediaVersionNo,
  MediaVersionConflictError,
  jstNow,
  getCommonVars,
  countCommonVars,
  COMMON_VARS_LIST_LIMIT,
  getCommonVarUsageSummaries,
  getCommonVarById,
  getCommonVarByIdIncludingArchived,
  createCommonVar,
  updateCommonVar,
  CommonVarFolderError,
  CommonVarKeyConflictError,
  deleteCommonVar,
  getCommonVarUsageImpact,
  getCommonVarVersions,
  getCommonVarReplacementCandidates,
  getCommonVarReplacementPlan,
  applyCommonVarReplacementPlan,
  CommonVarVersionConflictError,
  getCommonVarSchedules,
  createCommonVarSchedule,
  deleteCommonVarSchedule,
  validateFieldKey,
  COMMON_VAR_TYPES,
  type Media,
  type MediaKind,
  type CommonVar,
  type CommonVarSchedule,
  type CommonVarType,
  type CommonVarUsageImpact,
  type CommonVarUsageItem,
  type CommonVarReplacementPlan,
} from '@line-crm/db';
import type { CommonVarDeleteImpact, CommonVarUsageKind } from '@line-crm/shared';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { scanSingleMediaUsage } from '../services/media-usage-scan.js';
import { createR2PresignedPutUrl } from '../services/r2-presigned-upload.js';
import type { MediaReplacementImpact } from '@line-crm/shared';

/**
 * メディアライブラリと共通情報。
 *
 * どちらも「1か所に置いて使い回す」ための機能で、画面も同じ /contents の
 * タブなので1つのルータにまとめている。
 */
const contents = new Hono<Env>();
const REPLACEMENT_BODY_MAX_BYTES = 16 * 1024;

class RequestBodyError extends Error {
  constructor(readonly status: 400 | 413, message: string) {
    super(message);
  }
}

async function readBoundedJson(request: Request): Promise<Record<string, unknown>> {
  const declared = Number.parseInt(request.headers.get('Content-Length') ?? '', 10);
  if (Number.isFinite(declared) && declared > REPLACEMENT_BODY_MAX_BYTES) {
    throw new RequestBodyError(413, '送信内容が大きすぎます');
  }
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > REPLACEMENT_BODY_MAX_BYTES) {
      await reader.cancel();
      throw new RequestBodyError(413, '送信内容が大きすぎます');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('object required');
    return parsed as Record<string, unknown>;
  } catch {
    throw new RequestBodyError(400, '送信内容を読み取れませんでした');
  }
}

async function replacementRevision(
  sourceId: string,
  replacementId: string,
  usages: Array<{ ref_kind: string; ref_id: string; scanned_at: string }>,
): Promise<string> {
  const raw = [sourceId, replacementId, ...usages.map((usage) =>
    `${usage.ref_kind}:${usage.ref_id}`).sort()].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function replacementImpact(
  c: Context<Env>,
  sourceId: string,
  replacementId: string,
  accountId: string,
): Promise<{
  plan: NonNullable<Awaited<ReturnType<typeof getMediaReplacementPlan>>>;
  impact: MediaReplacementImpact;
} | null> {
  const checkedAt = jstNow();
  const source = await getMediaById(c.env.DB, sourceId, accountId);
  const replacement = await getMediaById(c.env.DB, replacementId, accountId);
  if (!source || !replacement) return null;
  await scanSingleMediaUsage(c.env.DB, checkedAt, { id: source.id, r2_key: source.r2_key });
  const plan = await getMediaReplacementPlan(c.env.DB, {
    sourceId, replacementId, lineAccountId: accountId, checkedAt,
  });
  if (!plan) return null;
  return {
    plan,
    impact: { ...plan.impact, revision: await replacementRevision(sourceId, replacementId, plan.usages) },
  };
}

// ── メディア ────────────────────────────────────────────────

/**
 * 受け付ける形式。MIMEと拡張子の両方を見る。
 *
 * MIMEだけだと、送る側が名乗った値をそのまま信じることになる。
 * 拡張子だけだと、中身が違うものを .png と名付けるだけで通る。
 * 両方が揃っているものだけ通す。
 */
const ALLOWED: Record<string, { kind: MediaKind; ext: string[]; maxBytes: number }> = {
  'image/png': { kind: 'image', ext: ['png'], maxBytes: 10 * 1024 * 1024 },
  'image/jpeg': { kind: 'image', ext: ['jpg', 'jpeg'], maxBytes: 10 * 1024 * 1024 },
  'image/gif': { kind: 'image', ext: ['gif'], maxBytes: 10 * 1024 * 1024 },
  'image/webp': { kind: 'image', ext: ['webp'], maxBytes: 10 * 1024 * 1024 },
  'video/mp4': { kind: 'video', ext: ['mp4'], maxBytes: 90 * 1024 * 1024 },
  'audio/mpeg': { kind: 'audio', ext: ['mp3'], maxBytes: 30 * 1024 * 1024 },
  'audio/mp4': { kind: 'audio', ext: ['m4a'], maxBytes: 30 * 1024 * 1024 },
  'application/pdf': { kind: 'file', ext: ['pdf'], maxBytes: 20 * 1024 * 1024 },
};

const DIRECT_ALLOWED: Record<string, { kind: MediaKind; ext: string[]; maxBytes: number }> = {
  ...ALLOWED,
  'video/mp4': { kind: 'video', ext: ['mp4'], maxBytes: 200 * 1024 * 1024 },
  'audio/mpeg': { kind: 'audio', ext: ['mp3'], maxBytes: 200 * 1024 * 1024 },
  'audio/mp4': { kind: 'audio', ext: ['m4a'], maxBytes: 200 * 1024 * 1024 },
};

/**
 * 動画の上限を 90MB にしている理由。
 *
 * 要件定義書は 200MB としているが、Cloudflare Workers が1リクエストで
 * 受け取れる本文には上限があり（プランによって 100MB 前後）、
 * 200MB は届く前に切られる。「アップロードできます」と書いておいて
 * 大きいファイルだけ黙って失敗する方が困るので、確実に通る値にした。
 *
 * それ以上を扱うなら、R2 へ直接上げる仕組み（署名付きURL）が要る。
 */

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : '';
}

/** ブラウザの申告ではなく、実際の先頭バイトが選んだ形式と一致するかを見る。 */
function hasMediaSignature(bytes: Uint8Array, mimeType: string): boolean {
  const ascii = (start: number, length: number) =>
    String.fromCharCode(...bytes.slice(start, start + length));
  switch (mimeType) {
    case 'image/png':
      return bytes.length >= 8
        && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
          .every((value, index) => bytes[index] === value);
    case 'image/jpeg':
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/gif':
      return ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP';
    case 'video/mp4':
    case 'audio/mp4':
      return bytes.length >= 12 && ascii(4, 4) === 'ftyp';
    case 'audio/mpeg':
      return ascii(0, 3) === 'ID3'
        || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
    case 'application/pdf':
      return ascii(0, 5) === '%PDF-';
    default:
      return false;
  }
}

function serializeMedia(row: Media, workerUrl: string) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    kind: row.kind,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    durationMs: row.duration_ms,
    url: row.public_url ?? `${workerUrl}/images/${row.r2_key}`,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    usageCount: row.usage_count === undefined ? undefined : Number(row.usage_count),
  };
}

function directUploadConfig(env: Env['Bindings']) {
  const accountId = env.CF_ACCOUNT_ID?.trim();
  const accessKeyId = env.MEDIA_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.MEDIA_R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = env.MEDIA_R2_BUCKET_NAME?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) return null;
  return { accountId, accessKeyId, secretAccessKey, bucketName };
}

function normalizedEtag(value: string): string {
  return value.trim().replace(/^"|"$/g, '');
}

async function mediaVersionPreview(
  c: Context<Env>,
  mediaId: string,
  uploadSessionId: string,
  accountId: string,
) {
  const [media, session, currentVersionNo] = await Promise.all([
    getMediaById(c.env.DB, mediaId, accountId),
    getMediaUploadSession(c.env.DB, uploadSessionId, accountId),
    getCurrentMediaVersionNo(c.env.DB, mediaId, accountId),
  ]);
  if (!media || !session || currentVersionNo === null || session.target_media_id !== mediaId) {
    return null;
  }
  const blockers = session.status === 'verified'
    ? (session.kind === media.kind ? [] : ['different_kind'])
    : ['upload_not_verified'];
  const raw = [
    media.id, media.r2_key, String(currentVersionNo), session.id, session.r2_key,
    session.etag ?? '', session.kind, session.expected_mime, String(session.expected_size),
    ...blockers,
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const previewToken = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return {
    media,
    session,
    currentVersionNo,
    previewToken,
    blockers,
    canReplace: blockers.length === 0,
  };
}

// 容量は現行ファイルだけでなく旧版と期限内アップロード予約も含める。
contents.get('/api/media/quota', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    return c.json({ success: true, data: await getMediaStorageQuota(c.env.DB, accountId) });
  } catch (err) {
    console.error('GET /api/media/quota error:', err);
    return c.json({ success: false, error: '容量を確認できませんでした' }, 503);
  }
});

contents.post(
  '/api/media/upload-sessions',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const body = await c.req.json<{
        accountId?: unknown;
        files?: Array<{
          filename?: unknown;
          mimeType?: unknown;
          sizeBytes?: unknown;
          folderId?: unknown;
          targetMediaId?: unknown;
        }>;
      }>().catch(() => null);
      const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
      if (!accountId || !Array.isArray(body?.files) || body.files.length < 1 || body.files.length > 20) {
        return c.json({ success: false, error: 'accountId と1〜20件のfilesが必要です' }, 400);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      const config = directUploadConfig(c.env);
      if (!config) {
        return c.json({
          success: false,
          code: 'media_direct_upload_unavailable',
          error: '直接アップロードの設定が完了していません',
        }, 503);
      }
      const validated: Array<{
        filename: string;
        mimeType: string;
        sizeBytes: number;
        folderId: string | null;
        targetMediaId: string | null;
        spec: { kind: MediaKind; ext: string[]; maxBytes: number };
      }> = [];
      for (const file of body.files) {
        const filename = typeof file?.filename === 'string' ? file.filename.trim() : '';
        const mimeType = typeof file?.mimeType === 'string' ? file.mimeType.trim().toLowerCase() : '';
        const sizeBytes = Number(file?.sizeBytes);
        const folderId = typeof file?.folderId === 'string' && file.folderId.trim()
          ? file.folderId.trim()
          : null;
        const targetMediaId = typeof file?.targetMediaId === 'string' && file.targetMediaId.trim()
          ? file.targetMediaId.trim()
          : null;
        const spec = DIRECT_ALLOWED[mimeType];
        const ext = extensionOf(filename);
        if (!filename || filename.length > 255 || /[\u0000-\u001f]/.test(filename)
          || !spec || !spec.ext.includes(ext)
          || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > spec.maxBytes) {
          return c.json({
            success: false,
            code: 'media_file_invalid',
            error: `${filename || 'ファイル'}の形式、拡張子、容量を確認してください`,
          }, 400);
        }
        if (targetMediaId && !await getMediaById(c.env.DB, targetMediaId, accountId)) {
          return c.json({ success: false, error: 'Not found' }, 404);
        }
        validated.push({ filename, mimeType, sizeBytes, folderId, targetMediaId, spec });
      }
      const quota = await getMediaStorageQuota(c.env.DB, accountId);
      const requestedBytes = validated.reduce((total, file) => total + file.sizeBytes, 0);
      if (requestedBytes > quota.remainingBytes) {
        return c.json({
          success: false,
          code: 'media_quota_exceeded',
          error: '保存容量が不足しています',
          data: quota,
        }, 409);
      }
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const sessions = [];
      for (const file of validated) {
        const id = crypto.randomUUID();
        const r2Key = `media/${accountId}/${crypto.randomUUID()}.${extensionOf(file.filename)}`;
        await createMediaUploadSession(c.env.DB, {
          id,
          lineAccountId: accountId,
          targetMediaId: file.targetMediaId,
          folderId: file.folderId,
          filename: file.filename,
          kind: file.spec.kind,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes,
          r2Key,
          expiresAt,
          createdBy: c.get('staff')?.id ?? null,
        });
        const signed = await createR2PresignedPutUrl(config, {
          key: r2Key,
          contentType: file.mimeType,
          lineAccountId: accountId,
          uploadSessionId: id,
          expiresInSeconds: 900,
          now,
        });
        sessions.push({
          id,
          filename: file.filename,
          sizeBytes: file.sizeBytes,
          targetMediaId: file.targetMediaId,
          method: 'PUT',
          uploadUrl: signed.url,
          requiredHeaders: signed.headers,
          expiresAt: signed.expiresAt,
        });
      }
      return c.json({ success: true, data: { sessions } }, 201);
    } catch (err) {
      console.error('POST /api/media/upload-sessions error:', err);
      return c.json({ success: false, error: 'アップロードを準備できませんでした' }, 500);
    }
  },
);

contents.post(
  '/api/media/upload-sessions/:id/complete',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    const accountIdFromBody = async () => c.req.json<{ accountId?: unknown; etag?: unknown }>()
      .catch(() => null);
    let accountId = '';
    try {
      const body = await accountIdFromBody();
      accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
      const suppliedEtag = typeof body?.etag === 'string' ? normalizedEtag(body.etag) : '';
      if (!accountId || !suppliedEtag) {
        return c.json({ success: false, error: 'accountId と etag が必要です' }, 400);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      let session = await getMediaUploadSession(c.env.DB, c.req.param('id'), accountId);
      if (!session) return c.json({ success: false, error: 'Not found' }, 404);
      if (session.status === 'completed') {
        return c.json({
          success: true,
          data: { uploadSessionId: session.id, status: 'completed', mediaId: session.result_media_id },
        });
      }
      if (session.status === 'verified') {
        return c.json({
          success: true,
          data: { uploadSessionId: session.id, status: 'verified', targetMediaId: session.target_media_id },
        });
      }
      if (session.status !== 'pending') {
        return c.json({ success: false, code: 'media_upload_not_pending', error: 'このアップロードは確定できません' }, 409);
      }
      if (Date.parse(session.expires_at) <= Date.now()) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'expired');
        return c.json({ success: false, code: 'media_upload_expired', error: 'アップロード期限が切れました' }, 409);
      }
      const object = await c.env.IMAGES.head(session.r2_key);
      const objectEtag = object?.etag ? normalizedEtag(object.etag) : '';
      const contentType = object?.httpMetadata?.contentType ?? '';
      const metadata = object?.customMetadata ?? {};
      const metadataAccountId = metadata['line-account-id'] ?? metadata.lineAccountId;
      const metadataSessionId = metadata['upload-session-id'] ?? metadata.uploadSessionId;
      if (!object || Number(object.size) !== Number(session.expected_size)
        || contentType !== session.expected_mime || objectEtag !== suppliedEtag
        || metadataAccountId !== accountId || metadataSessionId !== session.id) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'object_mismatch');
        await c.env.IMAGES.delete(session.r2_key);
        return c.json({
          success: false,
          code: 'media_upload_mismatch',
          error: 'アップロードしたファイルを確認できませんでした',
        }, 409);
      }
      const bodyObject = await c.env.IMAGES.get(session.r2_key, { range: { offset: 0, length: 16 } });
      const signatureBytes = bodyObject
        ? new Uint8Array(await bodyObject.arrayBuffer())
        : new Uint8Array();
      if (!hasMediaSignature(signatureBytes, session.expected_mime)) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'signature_mismatch');
        await c.env.IMAGES.delete(session.r2_key);
        return c.json({
          success: false,
          code: 'media_signature_mismatch',
          error: 'ファイルの実際の形式が申告と一致しません',
        }, 409);
      }
      session = await verifyMediaUploadSession(c.env.DB, session.id, accountId, objectEtag);
      if (!session) throw new Error('verified upload session is unavailable');
      if (session.target_media_id) {
        return c.json({
          success: true,
          data: { uploadSessionId: session.id, status: 'verified', targetMediaId: session.target_media_id },
        });
      }
      const media = await completeNewMediaUpload(c.env.DB, session);
      return c.json({
        success: true,
        data: { uploadSessionId: session.id, status: 'completed', mediaId: media.id },
      }, 201);
    } catch (err) {
      console.error('POST /api/media/upload-sessions/:id/complete error:', err);
      return c.json({ success: false, error: 'アップロードを確定できませんでした' }, 500);
    }
  },
);

contents.post('/api/media/:id/versions', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const body = await c.req.json<{
      accountId?: unknown;
      uploadSessionId?: unknown;
      previewToken?: unknown;
      changeReason?: unknown;
    }>().catch(() => null);
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    const uploadSessionId = typeof body?.uploadSessionId === 'string'
      ? body.uploadSessionId.trim()
      : '';
    const previewToken = typeof body?.previewToken === 'string' ? body.previewToken.trim() : '';
    const changeReason = typeof body?.changeReason === 'string' ? body.changeReason.trim() : '';
    if (!accountId || !uploadSessionId || !previewToken
      || !changeReason || changeReason.length > 500) {
      return c.json({
        success: false,
        error: 'accountId、確認済みuploadSessionId、previewToken、変更理由が必要です',
      }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const preview = await mediaVersionPreview(
      c, c.req.param('id'), uploadSessionId, accountId,
    );
    if (!preview) return c.json({ success: false, error: 'Not found' }, 404);
    if (preview.previewToken !== previewToken) {
      return c.json({
        success: false,
        code: 'media_replacement_changed',
        error: 'ファイルまたは現在版が変わりました。差し替え内容を確認し直してください。',
        data: {
          previewToken: preview.previewToken,
          currentVersionNo: preview.currentVersionNo,
          blockers: preview.blockers,
          canReplace: preview.canReplace,
        },
      }, 409);
    }
    if (!preview.canReplace) {
      return c.json({
        success: false,
        code: 'media_replacement_blocked',
        error: 'このファイルは現在のメディアと互換性がありません',
        data: { blockers: preview.blockers },
      }, 409);
    }
    const version = await createMediaVersionFromUpload(c.env.DB, {
      mediaId: c.req.param('id'),
      lineAccountId: accountId,
      uploadSessionId,
      expectedVersionNo: preview.currentVersionNo,
      changeReason,
      uploadedBy: c.get('staff')?.id ?? null,
    });
    return c.json({
      success: true,
      data: {
        id: version.id,
        mediaId: version.media_id,
        versionNo: version.version_no,
        mimeType: version.mime_type,
        sizeBytes: version.size_bytes,
        changeReason: version.change_reason,
        createdAt: version.created_at,
      },
    }, 201);
  } catch (err) {
    if (err instanceof MediaVersionConflictError) {
      return c.json({
        success: false,
        code: 'media_version_conflict',
        error: '新しい版が追加されています。最新状態を読み直してください。',
        currentVersionNo: err.currentVersionNo,
      }, 409);
    }
    if (err instanceof Error && err.message === 'media_not_found') {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (err instanceof Error && err.message === 'media_upload_session_not_verified') {
      return c.json({
        success: false,
        code: 'media_upload_not_verified',
        error: '差し替え用ファイルの確認が完了していません',
      }, 409);
    }
    console.error('POST /api/media/:id/versions error:', err);
    return c.json({ success: false, error: '新しい版を追加できませんでした' }, 500);
  }
});

contents.post(
  '/api/media/:id/replacement-preview',
  requireRole('owner', 'admin', 'staff'),
  async (c) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; uploadSessionId?: unknown }>()
        .catch(() => null);
      const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
      const uploadSessionId = typeof body?.uploadSessionId === 'string'
        ? body.uploadSessionId.trim()
        : '';
      if (!accountId || !uploadSessionId) {
        return c.json({ success: false, error: 'accountId と uploadSessionId が必要です' }, 400);
      }
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      const preview = await mediaVersionPreview(c, c.req.param('id'), uploadSessionId, accountId);
      if (!preview) return c.json({ success: false, error: 'Not found' }, 404);
      return c.json({
        success: true,
        data: {
          mediaId: preview.media.id,
          uploadSessionId: preview.session.id,
          currentVersionNo: preview.currentVersionNo,
          previewToken: preview.previewToken,
          blockers: preview.blockers,
          canReplace: preview.canReplace,
        },
      });
    } catch (err) {
      console.error('POST /api/media/:id/replacement-preview error:', err);
      return c.json({ success: false, error: '差し替え内容を確認できませんでした' }, 503);
    }
  },
);

contents.get('/api/media', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const kindRaw = c.req.query('kind');
    const kind = kindRaw && ['image', 'video', 'audio', 'file'].includes(kindRaw)
      ? (kindRaw as MediaKind)
      : undefined;
    const limit = Math.min(100, Math.max(1, Number.parseInt(c.req.query('limit') || '20', 10) || 20));
    const offset = Math.max(0, Number.parseInt(c.req.query('offset') || '0', 10) || 0);
    const sortRaw = c.req.query('sort');
    const sort = sortRaw && ['newest', 'oldest', 'name', 'size', 'usage'].includes(sortRaw)
      ? sortRaw as 'newest' | 'oldest' | 'name' | 'size' | 'usage'
      : 'newest';
    const filters = {
      lineAccountId: accountId,
      kind,
      folderId: c.req.query('folderId') || undefined,
      excludeId: c.req.query('excludeId') || undefined,
      query: c.req.query('query')?.trim() || undefined,
      unusedOnly: c.req.query('unusedOnly') === '1',
      nearLimitOnly: c.req.query('nearLimitOnly') === '1',
    };
    const [items, total] = await Promise.all([
      getMedia(c.env.DB, { ...filters, sort, limit, offset }),
      countMedia(c.env.DB, filters),
    ]);
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({
      success: true,
      data: { items: items.map((m) => serializeMedia(m, workerUrl)), total, limit, offset },
    });
  } catch (err) {
    console.error('GET /api/media error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 登録メディアのダウンロード。
 *
 * 一覧が返す `url` は認証なしの保存URL（GET /images/* はLINE配信など
 * 公開系も使うため公開のまま）なので、管理画面のダウンロード操作は
 * こちらを通す。担当者の役割とLINEアカウントの可視範囲を確認し、
 * 成功・拒否のどちらもURLや秘密値なしで監査へ残す。
 */
contents.get('/api/media/:id/download', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      auditLog(c, 'media.download', { kind: 'media', id }, { result: 'denied', lineAccountId: accountId });
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const media = await getMediaById(c.env.DB, id, accountId);
    if (!media) {
      auditLog(c, 'media.download', { kind: 'media', id }, { result: 'denied', lineAccountId: accountId });
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const object = await c.env.IMAGES.get(media.r2_key);
    if (!object) return c.json({ success: false, error: 'Not found' }, 404);
    auditLog(c, 'media.download', { kind: 'media', id }, { result: 'success', lineAccountId: accountId });
    return new Response(object.body, {
      headers: {
        'Content-Type': media.mime_type,
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(media.filename)}`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    console.error('GET /api/media/:id/download error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.patch('/api/media/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ filename?: string; folderId?: string | null }>();
    // 名前は空・長すぎ・制御文字を受け付けない（直接アップロードの申告時と同じ決まり）。
    const filename = body.filename === undefined ? undefined : String(body.filename).trim();
    if (filename !== undefined) {
      if (!filename) return c.json({ success: false, error: 'ファイル名を入力してください' }, 400);
      if (filename.length > 255) {
        return c.json({ success: false, error: 'ファイル名は255文字までで入力してください' }, 400);
      }
      if (/[\u0000-\u001f]/.test(filename)) {
        return c.json({ success: false, error: 'ファイル名に使えない文字が含まれています' }, 400);
      }
    }
    // 存在しない・別種のフォルダを指すと、一覧の絞り込みから消える。
    let folderId: string | null | undefined;
    if ('folderId' in body) {
      folderId = body.folderId ? String(body.folderId) : null;
      if (folderId) {
        const folder = await getFolderById(c.env.DB, folderId);
        if (!folder || folder.kind !== 'media') {
          return c.json({ success: false, error: '指定のフォルダが見つかりません。フォルダを選び直してください' }, 400);
        }
      }
    }
    const media = await updateMedia(c.env.DB, id, accountId, {
      ...(filename !== undefined ? { filename } : {}),
      ...(folderId !== undefined ? { folderId } : {}),
    });
    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    return c.json({ success: true, data: serializeMedia(media!, workerUrl) });
  } catch (err) {
    console.error('PATCH /api/media/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 削除前に、現在記録されている使用先を名前と導線付きで確認する。
contents.get('/api/media/:id/delete-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const checkedAt = jstNow();
    await scanSingleMediaUsage(c.env.DB, checkedAt, {
      id: existing.id,
      r2_key: existing.r2_key,
    });
    const impact = await getMediaDeleteImpact(c.env.DB, c.req.param('id'), accountId, checkedAt);
    if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: impact });
  } catch (err) {
    console.error('GET /api/media/:id/delete-impact error:', err);
    return c.json(
      { success: false, error: '削除したときの影響を確認できませんでした' },
      503,
    );
  }
});

// 差し替える前に、現在の使用先を7種類すべて読み直す。内部IDは返さない。
contents.get('/api/media/:id/replacement-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    const replacementId = c.req.query('replacementId')?.trim();
    if (!accountId || !replacementId) {
      return c.json({ success: false, error: 'accountId と replacementId が必要です' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const current = await replacementImpact(c, c.req.param('id'), replacementId, accountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { ...current.impact, previewToken: current.impact.revision },
    });
  } catch (err) {
    console.error('GET /api/media/:id/replacement-impact error:', err);
    return c.json({ success: false, error: '差し替えたときの影響を確認できませんでした' }, 503);
  }
});

// 画面で読んだ影響は信用せず、同じ7種類を実行直前にも読み直す。
contents.post('/api/media/:id/replace-usages', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const body = await readBoundedJson(c.req.raw);
    const replacementId = typeof body.replacementMediaId === 'string'
      ? body.replacementMediaId.trim()
      : '';
    const expectedRevision = typeof body.previewToken === 'string'
      ? body.previewToken.trim()
      : (typeof body.expectedRevision === 'string' ? body.expectedRevision.trim() : '');
    if (!replacementId || !expectedRevision) {
      return c.json({ success: false, error: '差し替え先と、確認した版が必要です' }, 400);
    }

    const current = await replacementImpact(c, c.req.param('id'), replacementId, accountId);
    if (!current) return c.json({ success: false, error: 'Not found' }, 404);
    if (current.impact.revision !== expectedRevision) {
      return c.json({
        success: false,
        code: 'media_replacement_changed',
        error: '使用先が変わりました。最新の影響を読み直してから、もう一度お試しください。',
        data: current.impact,
      }, 409);
    }
    if (!current.impact.canReplace || !current.plan) {
      return c.json({
        success: false,
        code: 'media_replacement_blocked',
        error: '一括で差し替えられない使用先があります。表示された使用先を個別に確認してください。',
        data: current.impact,
      }, 409);
    }

    const replacedUsageCount = await applyMediaReplacementPlan(c.env.DB, current.plan, accountId);
    let remainingUsageCount: number | null = null;
    let verification: 'verified' | 'partial' | 'unavailable' = 'unavailable';
    const verifiedAt = jstNow();
    try {
      await Promise.all([
        scanSingleMediaUsage(c.env.DB, verifiedAt, {
          id: current.plan.source.id,
          r2_key: current.plan.source.r2_key,
        }),
        scanSingleMediaUsage(c.env.DB, verifiedAt, {
          id: current.plan.replacement.id,
          r2_key: current.plan.replacement.r2_key,
        }),
      ]);
      remainingUsageCount = (await getMediaUsages(c.env.DB, current.plan.source.id)).length;
      verification = remainingUsageCount === 0
        && replacedUsageCount === current.impact.replaceableCount
        ? 'verified'
        : 'partial';
    } catch (verifyError) {
      // 差し替え自体はD1のbatchで確定済み。ここで500を返すと、利用者が
      // 再実行して二重操作するため「確認できなかった」と成功レスポンスに残す。
      console.error('media replacement verification failed:', verifyError);
    }
    return c.json({
      success: true,
      data: {
        sourceId: current.plan.source.id,
        replacementId: current.plan.replacement.id,
        replacedUsageCount,
        remainingUsageCount,
        verification,
        checkedAt: verifiedAt,
      },
    });
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('POST /api/media/:id/replace-usages error:', err);
    return c.json({ success: false, error: '使用先を差し替えられませんでした' }, 503);
  }
});

// 使われていれば最新の影響を返して止める。画面で前に読んだ結果は信用しない。
contents.delete('/api/media/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getMediaById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const checkedAt = jstNow();
    await scanSingleMediaUsage(c.env.DB, checkedAt, {
      id: existing.id,
      r2_key: existing.r2_key,
    });
    const impact = await getMediaDeleteImpact(c.env.DB, id, accountId, checkedAt);
    if (!impact) return c.json({ success: false, error: 'Not found' }, 404);
    if (!impact.canDelete) {
      return c.json(
        {
          success: false,
          error: `このファイルは ${impact.usageCount} か所で使われています。先に使用先から外してください。`,
          code: 'media_delete_blocked',
          data: impact,
        },
        409,
      );
    }

    // R2 の実体を先に消すと、DBの削除に失敗したときに「行はあるが実体が無い」
    // 状態になる。行を消してから実体を消す。逆なら孤児のファイルが残るだけで、
    // 画面には出てこない。
    await deleteMedia(c.env.DB, id, accountId);
    const removal = c.env.IMAGES.delete(existing.r2_key).catch((err) =>
      console.error('R2 delete failed:', err),
    );
    // c.executionCtx は使えない場面で参照そのものが例外を投げるので、
    // 参照ごと守る。使えなければ待つ。実体の削除はどちらでも構わない
    // （行はもう消えているので、画面には出てこない）。
    try {
      c.executionCtx.waitUntil(removal);
    } catch {
      await removal;
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/media/:id error:', err);
    return c.json({ success: false, error: '削除したときの影響を確認できませんでした' }, 503);
  }
});

// ── 共通情報 ────────────────────────────────────────────────

function serializeVar(row: CommonVar) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    folderId: row.folder_id,
    name: row.name,
    varKey: row.var_key,
    type: row.type,
    value: row.value,
    memo: row.memo ?? '',
    version: Number(row.version ?? 1),
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextSchedule: row.next_effective_from
      ? { effectiveFrom: row.next_effective_from, value: row.next_value ?? '' }
      : null,
    pendingScheduleCount: Number(row.pending_schedule_count ?? 0),
    usageCount: Number(row.usage_count ?? 0),
    usageByKind: row.usage_by_kind ?? null,
  };
}

function serializeSchedule(row: CommonVarSchedule) {
  return {
    id: row.id,
    varId: row.var_id,
    effectiveFrom: row.effective_from,
    value: row.value,
    appliedAt: row.applied_at,
  };
}

const COMMON_VAR_USAGE_KIND_LABELS: Record<CommonVarUsageKind, string> = {
  template: 'テンプレート',
  broadcast: '一斉配信',
  scenario: 'シナリオ配信',
  reminder: 'リマインダ',
  auto_reply: '自動応答',
  form: '回答フォーム',
  automation: 'オートメーション',
  friend_add: '友だち追加時の配信',
  common_action: '共通アクション',
};

function emptyCommonVarUsageImpact(): CommonVarUsageImpact {
  return {
    total: 0,
    blockingTotal: 0,
    historicalTotal: 0,
    unscopedFormTotal: 0,
    byKind: Object.fromEntries(
      Object.keys(COMMON_VAR_USAGE_KIND_LABELS).map((kind) => [kind, 0]),
    ) as Record<CommonVarUsageKind, number>,
    items: [],
  };
}

function collectReadableStrings(value: unknown, token: string, out: string[]): void {
  if (typeof value === 'string') {
    if (value.includes(token)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectReadableStrings(item, token, out);
    return;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectReadableStrings(item, token, out);
    }
  }
}

/** JSON設定の内部構造を出さず、差し込みを含む人向けの文だけを短く返す。 */
function readableCommonVarUsage(content: string, token: string): string {
  let text = content;
  try {
    const strings: string[] = [];
    collectReadableStrings(JSON.parse(content) as unknown, token, strings);
    // 共通情報を増減する操作は varKey を内部JSONに持つ。人向けの文が
    // 無いときはJSONを見せず、下の共通文へ倒す。
    text = strings.join(' ／ ');
  } catch {
    // 通常の本文はJSONではない。
  }
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return 'この設定の中で使われています';
  return compact.length > 180 ? `${compact.slice(0, 179)}…` : compact;
}

function commonVarUsageHref(item: CommonVarUsageItem): string {
  const id = encodeURIComponent(item.source_parent_id ?? item.source_id);
  switch (item.kind) {
    case 'template': return `/templates/edit?id=${id}`;
    case 'broadcast': return `/broadcasts/detail?id=${id}`;
    case 'scenario': return `/scenarios/detail?id=${id}`;
    case 'reminder': return `/reminders/edit?id=${id}`;
    case 'auto_reply': return `/auto-replies/edit?id=${id}`;
    case 'form': return `/form-submissions/edit?id=${id}`;
    case 'automation': return '/automations';
    case 'friend_add': return '/friend-add-settings';
    case 'common_action': return `/common-actions/versions?id=${id}`;
    // 新しい種別が増えても画面のLinkを壊さない。一覧へ戻す。
    default: return '/contents/vars';
  }
}

function commonVarUsageStatus(item: CommonVarUsageItem): string {
  if (item.is_historical === 1) return '送信済み・変わりません';
  if (item.source_status === 'scheduled') return '配信予約中';
  if (item.source_status === 'sending') return '配信中';
  if (item.source_status === 'draft') return '下書き';
  if (item.source_status === 'stopped') return '停止中';
  return '使われています';
}

function serializeCommonVarDeleteImpact(
  variable: CommonVar,
  impact: CommonVarUsageImpact,
): CommonVarDeleteImpact {
  const token = `{{var.${variable.var_key}}}`;
  const canDelete = impact.blockingTotal === 0;
  return {
    variable: { id: variable.id, name: variable.name, varKey: variable.var_key },
    total: impact.total,
    blockingTotal: impact.blockingTotal,
    historicalTotal: impact.historicalTotal,
    unscopedFormTotal: impact.unscopedFormTotal,
    canDelete,
    byKind: impact.byKind,
    items: impact.items.map((item) => ({
      kind: item.kind,
      kindLabel: COMMON_VAR_USAGE_KIND_LABELS[item.kind],
      name: item.source_name,
      status: commonVarUsageStatus(item),
      href: commonVarUsageHref(item),
      blocksDeletion: item.is_historical !== 1,
      currentPreview: readableCommonVarUsage(item.source_content, token)
        .replaceAll(token, variable.value),
    })),
    unavailableReferences: impact.unscopedFormTotal > 0
      ? [{
          kind: 'form',
          kindLabel: COMMON_VAR_USAGE_KIND_LABELS.form,
          count: impact.unscopedFormTotal,
          reason: '所属するLINEアカウントを確認できないため、名前と内容は表示しません',
        }]
      : [],
    checkedAt: jstNow(),
    recommendedAction: canDelete ? 'delete' : 'review_references',
  };
}

const LINE_TEXT_USAGE_KINDS = new Set<CommonVarUsageKind>([
  'template', 'broadcast', 'scenario', 'reminder', 'auto_reply', 'form',
]);
const LINE_TEXT_CHARACTER_LIMIT = 5_000;

/** 値を保存する前に、表示文の差分と検査結果だけを安全な形で返す。 */
function serializeCommonVarChangeImpact(
  variable: CommonVar,
  impact: CommonVarUsageImpact,
  nextValue: string,
) {
  const base = serializeCommonVarDeleteImpact(variable, impact);
  const token = `{{var.${variable.var_key}}}`;
  const items = impact.items.map((item, index) => {
    const safeSource = readableCommonVarUsage(item.source_content, token);
    const previewAvailable = safeSource.includes(token);
    // base.items は impact.items と同じ順で作る。同じ位置の要素を使う前提を
    // 型で守れないので、無いときは安全な文へ倒す（非null断言を使わない）。
    const currentPreview = previewAvailable
      ? safeSource.replaceAll(token, variable.value)
      : (base.items.at(index)?.currentPreview ?? safeSource);
    const changesOnSave = item.is_historical !== 1;
    const nextPreview = !changesOnSave
      ? currentPreview
      : previewAvailable
        ? safeSource.replaceAll(token, nextValue)
        : null;
    const characterLimit = LINE_TEXT_USAGE_KINDS.has(item.kind)
      ? LINE_TEXT_CHARACTER_LIMIT
      : null;
    const nextCharacterCount = nextPreview === null ? null : [...nextPreview].length;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (changesOnSave && nextValue.length === 0) errors.push('変更後の値が空になります');
    if (characterLimit !== null && nextCharacterCount !== null
      && nextCharacterCount > characterLimit) {
      errors.push(`変更後の文が${characterLimit.toLocaleString('ja-JP')}文字を超えます`);
    }
    if (changesOnSave && !previewAvailable) {
      warnings.push('変更後の文は使用先を開いて確認してください');
    }
    return {
      ...base.items[index],
      changesOnSave,
      previewAvailable,
      currentPreview,
      nextPreview,
      currentCharacterCount: [...currentPreview].length,
      nextCharacterCount,
      characterLimit,
      exceedsCharacterLimit: characterLimit !== null && nextCharacterCount !== null
        ? nextCharacterCount > characterLimit
        : false,
      errors,
      warnings,
    };
  });
  return {
    ...base,
    variable: {
      ...base.variable,
      currentValue: variable.value,
      nextValue,
    },
    items,
    errorTotal: items.reduce((sum, item) => sum + item.errors.length, 0),
    warningTotal: items.reduce((sum, item) => sum + item.warnings.length, 0),
    canSave: items.every((item) => item.errors.length === 0),
    recommendedAction: items.some((item) => item.errors.length > 0)
      ? 'fix_errors'
      : impact.blockingTotal > 0
        ? 'confirm_changes'
        : 'save',
  };
}

async function commonVarUsageRevision(
  variable: CommonVar,
  impact: CommonVarUsageImpact,
): Promise<string> {
  const raw = [
    `${variable.id}:${variable.version}`,
    ...impact.items.map((item) => [
      item.kind, item.source_id, item.source_parent_id ?? '', item.source_status ?? '', item.source_content,
    ].join(':')).sort(),
    `unscoped:${impact.unscopedFormTotal}`,
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function commonVarReplacementRevision(plan: CommonVarReplacementPlan): Promise<string> {
  const raw = [
    `${plan.source.id}:${plan.source.version}:${plan.replacement.id}:${plan.replacement.version}`,
    ...plan.targets.map((target) =>
      `${target.table}:${target.id}:${target.fingerprint}`).sort(),
    `blocked:${plan.blockedTotal}`,
  ].join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function serializeCommonVarReplacementPlan(plan: CommonVarReplacementPlan, revision: string) {
  const byKind = Object.fromEntries(Object.keys(COMMON_VAR_USAGE_KIND_LABELS).map((kind) => [
    kind,
    plan.targets.filter((target) => target.kind === kind).length,
  ]));
  return {
    source: { id: plan.source.id, name: plan.source.name, type: plan.source.type, version: plan.source.version },
    replacement: {
      id: plan.replacement.id,
      name: plan.replacement.name,
      type: plan.replacement.type,
      version: plan.replacement.version,
    },
    usageTotal: plan.usageTotal,
    replaceableTotal: plan.replaceableTotal,
    blockedTotal: plan.blockedTotal,
    historicalTotal: plan.historicalTotal,
    unscopedFormTotal: plan.unscopedFormTotal,
    byKind,
    canReplace: plan.blockedTotal === 0,
    revision,
    checkedAt: jstNow(),
  };
}

contents.get('/api/common-vars', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const rawLimit = Number(c.req.query('limit'));
    const limit = Number.isFinite(rawLimit)
      ? Math.max(1, Math.min(Math.floor(rawLimit), COMMON_VARS_LIST_LIMIT))
      : COMMON_VARS_LIST_LIMIT;
    const folderId = c.req.query('folderId') || undefined;
    const [items, total] = await Promise.all([
      getCommonVars(c.env.DB, { lineAccountId: accountId, folderId, limit }),
      countCommonVars(c.env.DB, { lineAccountId: accountId, folderId }),
    ]);
    const usageSummaries = await getCommonVarUsageSummaries(
      c.env.DB,
      items.map((item) => item.var_key),
      accountId,
    );
    for (const item of items) {
      const summary = usageSummaries.get(item.var_key);
      item.usage_count = summary?.total ?? 0;
      item.usage_by_kind = summary?.byKind ?? Object.fromEntries(
        Object.keys(COMMON_VAR_USAGE_KIND_LABELS).map((kind) => [kind, 0]),
      ) as CommonVar['usage_by_kind'];
    }
    return c.json({
      success: true,
      data: items.map(serializeVar),
      meta: { total, limited: total > items.length, limit },
    });
  } catch (err) {
    console.error('GET /api/common-vars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.get('/api/common-vars/:id', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const variable = await getCommonVarByIdIncludingArchived(c.env.DB, c.req.param('id'), accountId);
    if (!variable) return c.json({ success: false, error: 'Not found' }, 404);
    const [impact, versions] = await Promise.all([
      variable.archived_at
        ? Promise.resolve(emptyCommonVarUsageImpact())
        : getCommonVarUsageImpact(c.env.DB, variable.var_key, accountId),
      getCommonVarVersions(c.env.DB, variable.id, accountId, 20),
    ]);
    const serializedImpact = serializeCommonVarDeleteImpact(variable, impact);
    variable.usage_count = impact.total;
    variable.usage_by_kind = impact.byKind;
    return c.json({
      success: true,
      data: {
        ...serializeVar(variable),
        usages: serializedImpact.items.slice(0, 15),
        usagePage: {
          total: impact.total,
          shown: Math.min(serializedImpact.items.length, 15),
          hasMore: impact.total > 15,
          unavailableCount: impact.unscopedFormTotal,
        },
        history: versions.map((version) => ({
          id: version.id,
          version: Number(version.version_no),
          name: version.name,
          value: version.value,
          memo: version.memo,
          changeReason: version.change_reason,
          actorId: version.actor_id,
          actorName: version.actor_name,
          createdAt: version.created_at,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/common-vars/:id error:', err);
    return c.json({ success: false, error: '共通情報の詳細を確認できませんでした' }, 503);
  }
});

contents.post('/api/common-vars', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>();
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: '名前を入力してください' }, 400);

    // 差し込み名の決まりは友だち情報欄と同じ。片方だけ緩めると、
    // 「情報欄では使えないのに共通情報では使える名前」ができて混乱する。
    const keyCheck = validateFieldKey(body.varKey);
    if (!keyCheck.ok) return c.json({ success: false, error: keyCheck.error }, 422);

    // 不正な種別は黙って標準にしない。誤った種別での登録に気づけなくなる。
    const typeRaw = body.type === undefined ? 'text' : String(body.type);
    if (!(COMMON_VAR_TYPES as readonly string[]).includes(typeRaw)) {
      return c.json({ success: false, error: '種別が正しくありません。選び直してください' }, 400);
    }
    const type = typeRaw as CommonVarType;

    // 編集画面の入力欄と同じ上限を口でも守る。超えた値は送信時に落ち、
    // 原因がこの操作と結びつかなくなる。
    const value = body.value == null ? '' : String(body.value);
    const memo = body.memo == null ? '' : String(body.memo);
    if (name.length > 200) {
      return c.json({ success: false, error: '名前は200文字までで入力してください' }, 400);
    }
    if (value.length > 200) {
      return c.json({ success: false, error: '差し込まれる文字は200文字までで入力してください' }, 400);
    }
    if (memo.length > 1000) {
      return c.json({ success: false, error: 'メモは1000文字までで入力してください' }, 400);
    }

    const created = await createCommonVar(c.env.DB, {
      lineAccountId: accountId,
      name,
      varKey: String(body.varKey),
      type,
      value,
      memo,
      actorId: c.get('staff').id,
      folderId: body.folderId ? String(body.folderId) : null,
    });
    return c.json({ success: true, data: serializeVar(created) }, 201);
  } catch (err) {
    if (err instanceof CommonVarFolderError) {
      return c.json({ success: false, error: '指定のフォルダが見つかりません。フォルダを選び直してください' }, 400);
    }
    if (err instanceof CommonVarKeyConflictError) {
      return c.json({ success: false, error: 'その差し込み名は既に使われています' }, 409);
    }
    console.error('POST /api/common-vars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.patch('/api/common-vars/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, id, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    const body = await c.req.json<Record<string, unknown>>();
    const expectedVersion = body.expectedVersion === undefined
      ? undefined
      : Number(body.expectedVersion);
    if (expectedVersion !== undefined && (!Number.isInteger(expectedVersion) || expectedVersion < 1)) {
      return c.json({ success: false, error: 'expectedVersion must be a positive integer' }, 400);
    }
    // 差し込み名は変えられない。変えるとテンプレートの差し込みが黙って空になる。
    if (body.varKey !== undefined && body.varKey !== existing.var_key) {
      return c.json(
        {
          success: false,
          error:
            '差し込み名は後から変えられません。テンプレートの差し込みが空になるためです。新しく作ってください。',
        },
        422,
      );
    }
    // 空の名前は作れない(登録時と同じ)。版番号なしの上書きは許すが、
    // その旨は契約テストに明記する(同時編集の衝突検出は版番号つきのみ)。
    const patchName = body.name === undefined ? undefined : String(body.name).trim();
    if (patchName !== undefined && !patchName) {
      return c.json({ success: false, error: '名前を入力してください' }, 400);
    }
    if (patchName !== undefined && patchName.length > 200) {
      return c.json({ success: false, error: '名前は200文字までで入力してください' }, 400);
    }
    const patchValue = body.value === undefined ? undefined : String(body.value);
    if (patchValue !== undefined && patchValue.length > 200) {
      return c.json({ success: false, error: '差し込まれる文字は200文字までで入力してください' }, 400);
    }
    const patchMemo = body.memo === undefined ? undefined : String(body.memo);
    if (patchMemo !== undefined && patchMemo.length > 1000) {
      return c.json({ success: false, error: 'メモは1000文字までで入力してください' }, 400);
    }
    const updated = await updateCommonVar(c.env.DB, id, accountId, {
      name: patchName,
      value: patchValue,
      memo: patchMemo,
      expectedVersion,
      actorId: c.get('staff').id,
      changeReason: typeof body.changeReason === 'string' ? body.changeReason : undefined,
      ...(('folderId' in body) ? { folderId: body.folderId ? String(body.folderId) : null } : {}),
    });
    return c.json({ success: true, data: serializeVar(updated!) });
  } catch (err) {
    if (err instanceof CommonVarFolderError) {
      return c.json({ success: false, error: '指定のフォルダが見つかりません。フォルダを選び直してください' }, 400);
    }
    if (err instanceof CommonVarVersionConflictError) {
      return c.json({
        success: false,
        error: '別の担当者が先に更新しました。最新内容を読み直してください。',
        code: 'common_var_version_conflict',
        currentVersion: err.currentVersion,
      }, 409);
    }
    console.error('PATCH /api/common-vars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.get('/api/common-vars/:id/delete-impact', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    return c.json({ success: true, data: serializeCommonVarDeleteImpact(existing, impact) });
  } catch (err) {
    console.error('GET /api/common-vars/:id/delete-impact error:', err);
    return c.json(
      { success: false, error: '使用先を確認できないため削除できません' },
      503,
    );
  }
});

contents.post('/api/common-vars/:id/impact-preview', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await readBoundedJson(c.req.raw);
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (typeof body.nextValue !== 'string') {
      return c.json({ success: false, error: '変更後の値を入力してください' }, 400);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    if (body.expectedVersion !== undefined) {
      const expectedVersion = Number(body.expectedVersion);
      if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
        return c.json({ success: false, error: 'expectedVersion must be a positive integer' }, 400);
      }
      if (expectedVersion !== existing.version) {
        return c.json({
          success: false,
          error: '別の担当者が先に更新しました。最新内容を読み直してください。',
          code: 'common_var_version_conflict',
          currentVersion: existing.version,
        }, 409);
      }
    }
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    const serialized = serializeCommonVarChangeImpact(existing, impact, body.nextValue);
    return c.json({
      success: true,
      data: {
        ...serialized,
        version: existing.version,
        usageByKind: impact.byKind,
        scheduledUsageCount: impact.items.filter((item) => item.source_status === 'scheduled').length,
        publishedUsageCount: impact.items.filter((item) =>
          item.source_status === 'active' || item.source_status === 'sending').length,
        usageRevision: await commonVarUsageRevision(existing, impact),
      },
    });
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('POST /api/common-vars/:id/impact-preview error:', err);
    return c.json(
      { success: false, error: '影響する場所を確認できませんでした' },
      503,
    );
  }
});

contents.post('/api/common-vars/:id/replace', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await readBoundedJson(c.req.raw);
    const accountId = typeof body.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId) return c.json({ success: false, error: 'accountId is required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const source = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!source) return c.json({ success: false, error: 'Not found' }, 404);
    const replacementId = typeof body.replacementId === 'string' ? body.replacementId.trim() : '';
    if (!replacementId) {
      const candidates = await getCommonVarReplacementCandidates(c.env.DB, source);
      return c.json({
        success: true,
        data: {
          source: { id: source.id, name: source.name, type: source.type, version: source.version },
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            name: candidate.name,
            varKey: candidate.var_key,
            type: candidate.type,
            value: candidate.value,
            version: candidate.version,
          })),
        },
      });
    }
    const replacement = await getCommonVarById(c.env.DB, replacementId, accountId);
    if (!replacement) return c.json({ success: false, error: 'Not found' }, 404);
    if (source.id === replacement.id || source.type !== replacement.type) {
      return c.json({ success: false, error: '同じ種類の別の共通情報を選んでください' }, 422);
    }
    const plan = await getCommonVarReplacementPlan(c.env.DB, source, replacement);
    const revision = await commonVarReplacementRevision(plan);
    const preview = serializeCommonVarReplacementPlan(plan, revision);
    if (body.apply !== true) return c.json({ success: true, data: preview });

    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return c.json({ success: false, error: 'expectedVersion is required' }, 400);
    }
    if (expectedVersion !== source.version) {
      return c.json({
        success: false,
        error: '別の担当者が先に更新しました。最新内容を読み直してください。',
        code: 'common_var_version_conflict',
        currentVersion: source.version,
      }, 409);
    }
    if (typeof body.expectedRevision !== 'string' || body.expectedRevision !== revision) {
      return c.json({
        success: false,
        error: '使用先が変わりました。影響をもう一度確認してください。',
        code: 'common_var_usage_changed',
        data: preview,
      }, 409);
    }
    if (!preview.canReplace) {
      return c.json({
        success: false,
        error: '差し替えられない使用先があります。先に個別に確認してください。',
        code: 'common_var_replacement_blocked',
        data: preview,
      }, 409);
    }
    const result = await applyCommonVarReplacementPlan(c.env.DB, plan, c.get('staff').id);
    let remainingUsageCount: number | null = null;
    try {
      const remaining = await getCommonVarUsageImpact(c.env.DB, source.var_key, accountId);
      remainingUsageCount = remaining.blockingTotal;
    } catch {
      // 差し替え自体は完了している。再走査不能を0件と偽らずnullで返す。
    }
    return c.json({
      success: true,
      data: {
        ...result,
        sourceId: source.id,
        replacementId: replacement.id,
        remainingUsageCount,
        verification: remainingUsageCount === null
          ? 'unavailable'
          : remainingUsageCount === 0 ? 'verified' : 'partial',
        completedAt: jstNow(),
      },
    });
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    if (err instanceof CommonVarVersionConflictError) {
      return c.json({
        success: false,
        error: '別の担当者が先に更新しました。最新内容を読み直してください。',
        code: 'common_var_version_conflict',
        currentVersion: err.currentVersion,
      }, 409);
    }
    console.error('POST /api/common-vars/:id/replace error:', err);
    return c.json({ success: false, error: '差し替えの影響を確認できませんでした' }, 503);
  }
});

contents.delete('/api/common-vars/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const impact = await getCommonVarUsageImpact(c.env.DB, existing.var_key, accountId);
    const deleteImpact = serializeCommonVarDeleteImpact(existing, impact);
    if (!deleteImpact.canDelete) {
      return c.json(
        {
          success: false,
          error: `${impact.blockingTotal}件で使用中のため削除できません`,
          code: 'common_var_delete_blocked',
          data: deleteImpact,
        },
        409,
      );
    }
    await deleteCommonVar(c.env.DB, existing.id, accountId, c.get('staff').id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/common-vars/:id error:', err);
    return c.json(
      { success: false, error: '使用先を確認できないため削除できません' },
      503,
    );
  }
});

contents.get('/api/common-vars/:id/schedules', async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const items = await getCommonVarSchedules(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: items.map(serializeSchedule) });
  } catch (err) {
    console.error('GET /api/common-vars/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

contents.post('/api/common-vars/:id/schedules', requireRole('owner', 'admin'), async (c) => {
  try {
    const varId = c.req.param('id');
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const existing = await getCommonVarById(c.env.DB, varId, accountId);
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);

    // 同じ画面の impact-preview・replace と同じ16KB制限にする。
    const body = await readBoundedJson(c.req.raw);
    const effectiveFrom = typeof body.effectiveFrom === 'string' ? body.effectiveFrom : '';
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(effectiveFrom)
      || !isValidScheduleDateTime(effectiveFrom)) {
      return c.json(
        { success: false, error: '切り替える日時は 2026-09-01T10:00 の形で指定してください' },
        400,
      );
    }
    // 過ぎた日時は受け付けない。入れた瞬間に次のCronで当たり、
    // 「予約したつもりが今すぐ変わった」になる。
    const jstNowIso = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 16);
    if (effectiveFrom < jstNowIso) {
      return c.json({ success: false, error: '過去の日時は指定できません' }, 400);
    }

    const created = await createCommonVarSchedule(c.env.DB, {
      varId,
      effectiveFrom,
      value: typeof body.value === 'string' ? body.value : '',
    });
    return c.json({ success: true, data: serializeSchedule(created) }, 201);
  } catch (err) {
    if (err instanceof RequestBodyError) {
      return c.json({ success: false, error: err.message }, err.status);
    }
    console.error('POST /api/common-vars/:id/schedules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * 切替日時の実在検査。正規表現だけでは月13・99日が通る。
 * JSTの壁時計として組み立て直し、月日時刻の範囲を確かめる。
 */
export function isValidScheduleDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59) return false;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day >= 1 && day <= lastDay;
}

contents.delete(
  '/api/common-vars/:id/schedules/:scheduleId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = c.req.query('accountId')?.trim();
      if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
      if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      const existing = await getCommonVarById(c.env.DB, c.req.param('id'), accountId);
      if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
      await deleteCommonVarSchedule(c.env.DB, c.req.param('scheduleId'), existing.id);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('DELETE /api/common-vars/:id/schedules/:scheduleId error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

export { contents };
