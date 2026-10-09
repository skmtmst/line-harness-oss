import { Hono, type Context } from 'hono';
import { setAccountSetting } from '@line-crm/db';
import { formFileKind, formFileKinds, type FormInputBlock } from '@line-crm/shared';
import type { Env } from '../index.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { requireRole } from '../middleware/role-guard.js';
import { builtinFileScan, getFileScanConfig, resolveExternalScanner, markFileScanClean, markFileScanQuarantined, markFileScanPendingRetry } from '../services/file-scan.js';
import { ensureFileScanForUpload } from './file-scan.js';
import { imageDimensions } from '../services/media-metadata.js';
import { documentAnswer, documentExpired, identityRetentionDays, IDENTITY_RETENTION_KEY, type FormDocumentRow } from '../services/form-documents.js';

const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
export async function uploadFormDocument(c: Context<Env>, block: FormInputBlock, scope: { accountId: string; formId: string; friendId: string; versionId: string | null }) {
  const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
  const kind = formFileKind(block);
  const kinds = formFileKinds(block);
  const extension = TYPES[mime];
  if (!extension || (mime === 'application/pdf' ? !kinds.includes('pdf') : !kinds.some(k => k === 'image' || k === 'identity'))) return c.json({ success: false, error: 'この質問で受け取れる形式を選んでください' }, 400);
  const side = c.req.query('side') ?? (kind === 'identity' && block.fileBothSides ? 'front' : 'single');
  if (kind === 'identity' && block.fileBothSides ? !['front', 'back'].includes(side) : side !== 'single') return c.json({ success: false, error: '表か裏を選んでください' }, 400);
  if (Number(c.req.header('Content-Length') ?? 0) > 10485760) return c.json({ success: false, error: '1ファイル10MBまでです' }, 400);
  // Stream with a hard ceiling even if Content-Length is absent or forged.
  const reader = c.req.raw.body?.getReader();
  if (!reader) return c.json({ success: false, error: 'ファイルが空です' }, 400);
  const parts: Uint8Array[] = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read(); if (done) break;
    size += value.byteLength;
    if (size > 10485760) { await reader.cancel(); return c.json({ success: false, error: '1ファイル10MBまでです' }, 400); }
    parts.push(value);
  }
  if (!size) return c.json({ success: false, error: 'ファイルが空です' }, 400);
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  let filename = `添付.${extension}`;
  try { filename = (c.req.query('filename') ?? filename).replace(/[\r\n\x00-\x1f/\\]/g, '_').slice(0, 200) || filename; } catch { /* use safe default */ }
  const id = crypto.randomUUID(); const key = `private/form-documents/${scope.accountId}/${id}.${extension}`;
  const scan = await ensureFileScanForUpload({ db: c.env.DB, lineAccountId: scope.accountId, subjectKind: 'form_file', subjectId: key, filename, mimeType: mime, sizeBytes: size });
  const dims = imageDimensions(bytes, mime);
  const verdict = builtinFileScan(bytes, { filename, mimeType: mime, sizeBytes: size, width: dims?.width, height: dims?.height, tail: bytes.subarray(Math.max(0, size - 65536)) });
  if (verdict.verdict !== 'clean') {
    await markFileScanQuarantined(c.env.DB, scan.id, verdict.reasonCode, verdict.detail);
    return c.json({ success: false, code: 'file_scan_blocked', error: '安全を確認できませんでした。別のファイルを選んでください' }, 422);
  }
  const now = new Date().toISOString();
  const expires = kind === 'identity' ? new Date(Date.now() + await identityRetentionDays(c.env.DB, scope.accountId) * 86400000).toISOString() : null;
  await c.env.IMAGES.put(key, bytes, { httpMetadata: { contentType: mime } });
  try {
    await c.env.DB.prepare(`INSERT INTO form_submission_files (id,line_account_id,form_id,form_version_id,block_id,friend_id,file_kind,side,r2_key,filename,mime_type,size_bytes,scan_id,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, scope.accountId, scope.formId, scope.versionId, block.id, scope.friendId, kind, side, key, filename, mime, size, scan.id, now, expires).run();
  } catch (err) { await c.env.IMAGES.delete(key); throw err; }
  let status = 'clean';
  const config = await getFileScanConfig(c.env.DB, scope.accountId);
  const external = resolveExternalScanner(c.env as unknown as Record<string, string | undefined>, config);
  if (external) {
    try {
      if (await external.scan(bytes, { filename, mimeType: mime, sizeBytes: size }) !== 'clean') {
        await markFileScanQuarantined(c.env.DB, scan.id, 'external_flagged', '外部の検査で問題が見つかりました'); status = 'quarantined';
      }
    } catch { await markFileScanPendingRetry(c.env.DB, scan.id, scan.attempts); status = 'pending'; }
  }
  if (status === 'clean') await markFileScanClean(c.env.DB, scan.id);
  if (status === 'quarantined') return c.json({ success: false, code: 'file_scan_blocked', error: '安全を確認できませんでした。別のファイルを選んでください' }, 422);
  const row = await c.env.DB.prepare('SELECT * FROM form_submission_files WHERE id = ?').bind(id).first<FormDocumentRow>();
  if (!row) throw new Error('document_record_missing');
  return c.json({ success: true, data: { file: documentAnswer(row, 'owner', status), scanStatus: status } }, 201);
}
export const formDocuments = new Hono<Env>();
formDocuments.get('/api/form-files/:id/content', requireRole('owner', 'admin', 'staff'), async c => {
  const row = await c.env.DB.prepare('SELECT f.*, s.status AS scan_status FROM form_submission_files f LEFT JOIN media_file_scans s ON s.id = f.scan_id WHERE f.id = ?').bind(c.req.param('id')).first<FormDocumentRow & { scan_status: string }>();
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!row || !scope.ids.includes(row.line_account_id)) return c.json({ success: false, error: '書類が見つかりません' }, 404);
  if (row.file_kind === 'identity' && !['owner', 'admin'].includes(c.get('staff')?.role ?? '')) return c.json({ success: false, error: '見る権限がありません' }, 403);
  if (documentExpired(row)) return c.json({ success: false, error: '期限で消しました' }, 410);
  if (row.scan_status !== 'clean') return c.json({ success: false, error: '検査が終わるまで開けません' }, 409);
  const object = await c.env.IMAGES.get(row.r2_key);
  if (!object) return c.json({ success: false, error: '書類が見つかりません' }, 404);
  return new Response(object.body, { headers: { 'Content-Type': row.mime_type, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(row.filename)}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
});
formDocuments.get('/api/forms/document-settings/:accountId', requireRole('owner', 'admin'), async c => {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.ids.includes(c.req.param('accountId'))) return c.json({ success: false }, 404);
  return c.json({ success: true, data: { identityRetentionDays: await identityRetentionDays(c.env.DB, c.req.param('accountId')) } });
});
formDocuments.put('/api/forms/document-settings/:accountId', requireRole('owner', 'admin'), async c => {
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.ids.includes(c.req.param('accountId'))) return c.json({ success: false }, 404);
  const body = await c.req.json<{ identityRetentionDays?: number }>();
  const days = body.identityRetentionDays;
  if (!Number.isInteger(days) || days! < 1 || days! > 3650) return c.json({ success: false, error: '保存日数は1〜3650日で入力してください' }, 400);
  await setAccountSetting(c.env.DB, c.req.param('accountId'), IDENTITY_RETENTION_KEY, String(days));
  return c.json({ success: true, data: { identityRetentionDays: days } });
});
