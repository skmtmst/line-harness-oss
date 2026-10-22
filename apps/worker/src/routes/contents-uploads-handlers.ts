import { listQueryNumber } from '../lib/list-paging.js';
import { logger } from '@line-crm/shared/server';
import { hasMediaSignature } from './media-signature.js';
import { inputError } from '../lib/input-errors.js';
import { mediaTabCounts } from '../services/tab-counts.js';

import { getMedia, countMedia, getMediaById, getFolderById, getMediaStorageQuota, getMediaVersionByNo, createMediaUploadSession, getMediaUploadSession, failMediaUploadSession, verifyMediaUploadSession, completeNewMediaUpload, createMediaVersionFromUpload, MediaVersionConflictError, MediaVersionIncompatibleError, type MediaMetadata, type MediaKind } from '@line-crm/db';


import type { Env } from '../worker-env.js';

import { auditLog } from '../lib/audit-log.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import { imageDimensions, IMAGE_METADATA_PREFIX_BYTES } from '../features/media/media-metadata/index.js';
import { createR2PresignedPutUrl } from '../services/r2-presigned-upload.js';
import { mediaUploadKey, isFinalMediaKey, finalMediaKey, copyMediaUpload, getPinnedMediaObject } from '../services/media-upload-storage.js';
import { checkMediaGate, getFileScanBySubject, runScanForStoredObject } from '../services/file-scan.js';
import { ensureFileScanForUpload } from './file-scan.js';
import { directUploadConfig, DIRECT_ALLOWED, extensionOf, parseUploadMetadata, normalizedEtag, mediaVersionPreview, uploaderNameMap, serializeMedia, serveMediaFile } from './contents-definition.js';
import type { Context } from 'hono';

export const get__api_media_quota_1 = async (c: Context<Env, "/api/media/quota">) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    return c.json({ success: true, data: await getMediaStorageQuota(c.env.DB, accountId) });
  } catch (err) {
    logger.error("contents.media_quota_get_failed");
    return c.json({ success: false, error: '容量を確認できませんでした' }, 503);
  }
};

export const post__api_media_upload_sessions_2 = async (c: Context<Env, "/api/media/upload-sessions">) => {
    const body = await c.req.json<{
      accountId?: unknown;
      files?: Array<{
        filename?: unknown;
        mimeType?: unknown;
        sizeBytes?: unknown;
        folderId?: unknown;
        targetMediaId?: unknown;
        metadata?: unknown;
      }>;
    }>().catch(() => null);
    const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    if (!accountId || !Array.isArray(body?.files) || body.files.length < 1 || body.files.length > 20) {
      return inputError(c, { success: false, error: 'accountId と1〜20件のfilesが必要です' }, 400, ["accountId","files"]);
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
      metadata: MediaMetadata | null;
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
        return inputError(c, {
          success: false,
          code: 'media_file_invalid',
          error: `${filename || 'ファイル'}の形式、拡張子、容量を確認してください`,
        }, 400, []);
      }
      const metadata = parseUploadMetadata(file?.metadata);
      if (metadata === undefined) {
        return inputError(c, {
          success: false,
          code: 'media_file_invalid',
          error: `${filename}の内容情報が正しくありません`,
        }, 400, []);
      }
      if (targetMediaId && !await getMediaById(c.env.DB, targetMediaId, accountId)) {
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      validated.push({ filename, mimeType, sizeBytes, folderId, targetMediaId, metadata, spec });
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
      const r2Key = finalMediaKey(accountId, extensionOf(file.filename));
      await createMediaUploadSession(c.env.DB, {
        id,
        lineAccountId: accountId,
        targetMediaId: file.targetMediaId,
        folderId: file.folderId,
        filename: file.filename,
        kind: file.spec.kind,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        metadata: file.metadata,
        r2Key,
        expiresAt,
        createdBy: c.get('staff')?.id ?? null,
      });
      const signed = await createR2PresignedPutUrl(config, {
        key: mediaUploadKey(id),
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
  };

export const post__api_media_upload_sessions_id_complete_3 = async (c: Context<Env, "/api/media/upload-sessions/:id/complete">) => {
    const accountIdFromBody = async () => c.req.json<{ accountId?: unknown; etag?: unknown }>()
      .catch(() => null);
    let accountId = '';
    const body = await accountIdFromBody();
    accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    const suppliedEtag = typeof body?.etag === 'string' ? normalizedEtag(body.etag) : '';
    if (!accountId || !suppliedEtag) {
      return inputError(c, { success: false, error: 'accountId と etag が必要です' }, 400, ["etag"]);
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
    if (session.status !== 'pending' && session.status !== 'verified') {
      return c.json({ success: false, code: 'media_upload_not_pending', error: 'このアップロードは確定できません' }, 409);
    }
    if (session.status === 'pending') {
      if (Date.parse(session.expires_at) <= Date.now()) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'expired');
        return c.json({ success: false, code: 'media_upload_expired', error: 'アップロード期限が切れました' }, 409);
      }
      // Old pending sessions used their public key as the PUT target. Copy those too.
      const sourceKey = isFinalMediaKey(session.r2_key) ? mediaUploadKey(session.id) : session.r2_key;
      const object = await c.env.IMAGES.head(sourceKey);
      const objectEtag = object?.etag ? normalizedEtag(object.etag) : '';
      const contentType = object?.httpMetadata?.contentType ?? '';
      const metadata = object?.customMetadata ?? {};
      const metadataAccountId = metadata['line-account-id'] ?? metadata.lineAccountId;
      const metadataSessionId = metadata['upload-session-id'] ?? metadata.uploadSessionId;
      if (!object || Number(object.size) !== Number(session.expected_size)
        || contentType !== session.expected_mime || objectEtag !== suppliedEtag
        || metadataAccountId !== accountId || metadataSessionId !== session.id) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'object_mismatch');
        return c.json({
          success: false,
          code: 'media_upload_mismatch',
          error: 'アップロードしたファイルを確認できませんでした',
        }, 409);
      }
      const headBytes = session.kind === 'image' ? IMAGE_METADATA_PREFIX_BYTES : 16;
      const bodyObject = await c.env.IMAGES.get(sourceKey, {
        range: { offset: 0, length: headBytes }, onlyIf: { etagMatches: object.etag },
      });
      if (!bodyObject || !('body' in bodyObject)) {
        return c.json({ success: false, code: 'media_upload_mismatch', error: 'ファイルが変更されました' }, 409);
      }
      const signatureBytes = new Uint8Array(await bodyObject.arrayBuffer());
      if (!hasMediaSignature(signatureBytes, session.expected_mime)) {
        await failMediaUploadSession(c.env.DB, session.id, accountId, 'signature_mismatch');
        return c.json({
          success: false,
          code: 'media_signature_mismatch',
          error: 'ファイルの実際の形式が申告と一致しません',
        }, 409);
      }
      // 画像は実体の先頭から寸法を測り、申告値ではなく実測値を正本として残す。
      // 測れなかった場合は寸法を null に戻し、版追加は「判定材料不足」で拒否する。
      const measured = session.kind === 'image'
        ? imageDimensions(signatureBytes, session.expected_mime)
        : null;
      const finalKey = finalMediaKey(accountId, extensionOf(session.filename));
      if (!await copyMediaUpload(c.env.IMAGES, sourceKey, finalKey, object.etag, session.expected_size, session.expected_mime)) {
        return c.json({ success: false, code: 'media_upload_mismatch', error: 'ファイルが変更されました' }, 409);
      }
      session = await verifyMediaUploadSession(
        c.env.DB, session.id, accountId, objectEtag,
        session.kind === 'image'
          ? { width: measured?.width ?? null, height: measured?.height ?? null }
          : undefined,
        session.kind === 'image',
        finalKey,
      );
      // Each completion owns its candidate key. A losing request only deletes its own copy.
      if (session?.r2_key !== finalKey) await c.env.IMAGES.delete(finalKey);
      if (!session) throw new Error('verified upload session is unavailable');
      if (session.status === 'completed') {
        return c.json({ success: true, data: { uploadSessionId: session.id, status: 'completed', mediaId: session.result_media_id } });
      }
      if (session.status !== 'verified') return c.json({ success: false, code: 'media_upload_not_pending', error: 'このアップロードは確定できません' }, 409);
    }
    // Pre-deployment verified sessions still refer to a reusable signed key.
    if (!isFinalMediaKey(session.r2_key)) {
      return c.json({ success: false, code: 'media_upload_not_verified', error: 'ファイルをアップロードし直してください' }, 409);
    }
    if (session.target_media_id) {
      // 版の差し替えも検査の対象にする。検査が終わるまで版は出さない。
      // 記録に失敗しても確定自体は返す（門番は出す前にその場で回す）。
      const versionScan = await ensureFileScanForUpload({
        db: c.env.DB,
        lineAccountId: accountId,
        subjectKind: 'upload_session',
        subjectId: session.id,
        mediaId: session.target_media_id,
        filename: session.filename,
        mimeType: session.expected_mime,
        sizeBytes: session.expected_size,
      }).catch((err) => {
        logger.error("contents.media_upload_sessions_id_complete_post_failed");
        return null;
      });
      if (versionScan) {
        await runScanForStoredObject(c.env.DB, c.env.IMAGES, versionScan, session.r2_key, {
          width: session.width, height: session.height,
        }).catch((err) => logger.error("contents.media_upload_sessions_id_complete_post_failed"));
      }
      return c.json({
        success: true,
        data: { uploadSessionId: session.id, status: 'verified', targetMediaId: session.target_media_id },
      });
    }
    const media = await completeNewMediaUpload(c.env.DB, session);
    // 保存の直後に検査の段を入れる。clean になるまで中身は出さない。
    // 記録に失敗しても確定自体は返す（門番は出す前にその場で回す）。
    const newScan = await ensureFileScanForUpload({
      db: c.env.DB,
      lineAccountId: accountId,
      subjectKind: 'upload_session',
      subjectId: session.id,
      mediaId: media.id,
      filename: media.filename,
      mimeType: media.mime_type,
      sizeBytes: media.size_bytes,
    }).catch((err) => {
      logger.error("contents.media_upload_sessions_id_complete_post_failed");
      return null;
    });
    if (newScan) {
      await runScanForStoredObject(c.env.DB, c.env.IMAGES, newScan, session.r2_key, {
        width: media.width, height: media.height,
      }).catch((err) => logger.error("contents.media_upload_sessions_id_complete_post_failed"));
    }
    return c.json({
      success: true,
      data: { uploadSessionId: session.id, status: 'completed', mediaId: media.id },
    }, 201);
  };

export const post__api_media_id_versions_4 = async (c: Context<Env, "/api/media/:id/versions">) => {
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
      return inputError(c, {
        success: false,
        error: 'accountId、確認済みuploadSessionId、previewToken、変更理由が必要です',
      }, 400, ["accountId","uploadSessionId","previewToken","changeReason"]);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const incoming = await getMediaUploadSession(c.env.DB, uploadSessionId, accountId);
    const incomingScan = await getFileScanBySubject(c.env.DB, 'upload_session', uploadSessionId);
    if (!incoming || incoming.target_media_id !== c.req.param('id') || incoming.status !== 'verified'
      || !isFinalMediaKey(incoming.r2_key) || incomingScan?.status !== 'clean') {
      return c.json({ success: false, code: 'media_upload_not_verified', error: '差し替え用ファイルの検査が完了していません' }, 409);
    }
    const preview = await mediaVersionPreview(
      c, c.req.param('id'), uploadSessionId, accountId,
    );
    if (!preview) return c.json({ success: false, error: 'Not found' }, 404);
    const parentGate = await checkMediaGate(c.env.DB, c.env.IMAGES, {
      id: preview.media.id, lineAccountId: accountId, r2Key: preview.media.r2_key,
      filename: preview.media.filename, mimeType: preview.media.mime_type, sizeBytes: preview.media.size_bytes,
      width: preview.media.width, height: preview.media.height,
    });
    if (!parentGate.allowed) return c.json({ success: false, code: parentGate.code, error: parentGate.message }, 409);
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
        data: {
          blockers: preview.blockers,
          currentMetadata: preview.currentMetadata,
          incomingMetadata: preview.incomingMetadata,
        },
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
    if (err instanceof MediaVersionIncompatibleError) {
      return c.json({
        success: false,
        code: 'media_replacement_blocked',
        error: 'このファイルは現在のメディアと互換性がありません',
        data: { blockers: err.blockers },
      }, 409);
    }
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
    throw err;
  }
};

export const post__api_media_id_replacement_preview_5 = async (c: Context<Env, "/api/media/:id/replacement-preview">) => {
    try {
      const body = await c.req.json<{ accountId?: unknown; uploadSessionId?: unknown }>()
        .catch(() => null);
      const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
      const uploadSessionId = typeof body?.uploadSessionId === 'string'
        ? body.uploadSessionId.trim()
        : '';
      if (!accountId || !uploadSessionId) {
        return inputError(c, { success: false, error: 'accountId と uploadSessionId が必要です' }, 400, ["accountId","uploadSessionId"]);
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
          currentMetadata: preview.currentMetadata,
          incomingMetadata: preview.incomingMetadata,
        },
      });
    } catch (err) {
      logger.error("contents.media_id_replacement_preview_post_failed");
      return c.json({ success: false, error: '差し替え内容を確認できませんでした' }, 503);
    }
  };

export const get__api_media_counts_6 = async (c: Context<Env, "/api/media/counts">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  return c.json({ success: true, data: await mediaTabCounts(c.env.DB, accountId) });
};

export const get__api_media_7 = async (c: Context<Env, "/api/media">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const kindRaw = c.req.query('kind');
  const kind = kindRaw && ['image', 'video', 'audio', 'file'].includes(kindRaw)
    ? (kindRaw as MediaKind)
    : undefined;
  const limit = Math.min(100, Math.max(1, listQueryNumber(c.req.query('limit') || undefined, 20, { format: 'integer-prefix' }) || 20));
  const offset = Math.max(0, listQueryNumber(c.req.query('offset') || undefined, 0, { format: 'integer-prefix' }) || 0);
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
    archived: c.req.query('archived') === 'only' || c.req.query('archived') === 'all'
      ? c.req.query('archived') as 'only' | 'all'
      : undefined,
  };
  const [items, total] = await Promise.all([
    getMedia(c.env.DB, { ...filters, sort, limit, offset }),
    countMedia(c.env.DB, filters),
  ]);
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const names = await uploaderNameMap(c.env.DB, items);
  return c.json({
    success: true,
    data: { items: items.map((m) => serializeMedia(m, workerUrl, names)), total, limit, offset },
  });
};

export const get__api_media_id_8 = async (c: Context<Env, "/api/media/:id">) => {
  const accountId = c.req.query('accountId')?.trim();
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const media = await getMediaById(c.env.DB, c.req.param('id'), accountId);
  if (!media) return c.json({ success: false, error: 'Not found' }, 404);
  const folder = media.folder_id ? await getFolderById(c.env.DB, media.folder_id) : null;
  const folderName = folder
    && folder.kind === 'media'
    && (folder.account_id === null || folder.account_id === accountId)
    ? folder.name
    : null;
  const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
  const names = await uploaderNameMap(c.env.DB, [media]);
  return c.json({
    success: true,
    data: { item: serializeMedia(media, workerUrl, names), folderName },
  });
};

export const get__api_media_id_download_9 = async (c: Context<Env, "/api/media/:id/download">) => {
  return await serveMediaFile(c, { auditDownload: true, disposition: 'attachment' });
};

export const get__api_media_id_content_10 = async (c: Context<Env, "/api/media/:id/content">) => {
  return await serveMediaFile(c, { auditDownload: false, disposition: 'inline' });
};

export const get__api_media_id_versions_versionNo_download_11 = async (c: Context<Env, "/api/media/:id/versions/:versionNo/download">) => {
  const id = c.req.param('id');
  const accountId = c.req.query('accountId')?.trim();
  const versionNo = Number(c.req.param('versionNo'));
  if (!id || !Number.isInteger(versionNo) || versionNo < 1) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
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
  const version = await getMediaVersionByNo(c.env.DB, id, accountId, versionNo);
  if (!version) {
    auditLog(c, 'media.download', { kind: 'media', id }, { result: 'denied', lineAccountId: accountId });
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const versionGate = await checkMediaGate(c.env.DB, c.env.IMAGES, {
    id: media.id,
    lineAccountId: media.line_account_id,
    r2Key: version.r2_key,
    filename: media.filename,
    mimeType: version.mime_type,
    sizeBytes: version.size_bytes,
    width: version.width,
    height: version.height,
  });
  if (!versionGate.allowed) {
    auditLog(c, 'media.download', { kind: 'media', id }, { result: 'denied', lineAccountId: accountId });
    return c.json({ success: false, code: versionGate.code, error: versionGate.message }, 409);
  }
  const object = await getPinnedMediaObject(c.env.IMAGES, version.r2_key, versionGate.etag);
  if (!object) return c.json({ success: false, error: 'Not found' }, 404);
  auditLog(c, 'media.download', { kind: 'media', id }, { result: 'success', lineAccountId: accountId });
  // どの版か分かる名前で保存する（例: a.png → a-v1.png）。
  const dot = media.filename.lastIndexOf('.');
  const downloadName = dot > 0
    ? `${media.filename.slice(0, dot)}-v${versionNo}${media.filename.slice(dot)}`
    : `${media.filename}-v${versionNo}`;
  return new Response(object.body, {
    headers: {
      'Content-Type': version.mime_type,
      'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
};
