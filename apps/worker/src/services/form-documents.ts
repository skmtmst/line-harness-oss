import { collectInputs, formFileKind, formFileKinds, type FormInputBlock, type FormLayout } from '@line-crm/shared';
import { getAccountSetting } from '@line-crm/db';
import type { FormFileAnswer } from '@line-crm/shared';

export function uploadedDocumentKind(block: FormInputBlock, mime: string): FormDocumentRow['file_kind'] {
  return formFileKinds(block).includes('identity') ? 'identity' : mime === 'application/pdf' ? 'pdf' : 'image';
}
export const IDENTITY_RETENTION_KEY = 'forms.identityRetentionDays';
export interface FormDocumentRow {
  id: string; line_account_id: string; form_id: string; form_version_id: string | null;
  block_id: string; friend_id: string; submission_id: string | null;
  file_kind: 'image' | 'pdf' | 'identity'; side: 'single' | 'front' | 'back';
  r2_key: string; filename: string; mime_type: string; size_bytes: number; scan_id: string;
  created_at: string; expires_at: string | null; deleted_at: string | null; deletion_reason: string | null;
}
export function documentLimit(block: FormInputBlock): number {
  return formFileKind(block) === 'identity' && block.fileBothSides ? 2 : Math.min(10, Math.max(1, block.fileMaxCount ?? 1));
}
export async function identityRetentionDays(db: D1Database, accountId: string): Promise<number> {
  const raw = await getAccountSetting(db, accountId, IDENTITY_RETENTION_KEY);
  const value = Number(raw ?? 90);
  return Number.isInteger(value) && value >= 1 && value <= 3650 ? value : 90;
}
export function documentExpired(row: FormDocumentRow, now = new Date()): boolean {
  return !!row.deleted_at || !!row.expires_at && Date.parse(row.expires_at) <= now.getTime();
}
export function documentAnswer(row: FormDocumentRow, role?: string, scanStatus = 'clean'): FormFileAnswer {
  if (row.file_kind === 'identity' && role !== 'owner' && role !== 'admin') {
    return { fileId: row.id, state: 'restricted', kind: row.file_kind, side: row.side };
  }
  if (scanStatus === 'quarantined' || scanStatus === 'rejected') return { fileId: row.id, state: scanStatus, kind: row.file_kind, side: row.side };
  if (documentExpired(row)) return { fileId: row.id, state: 'expired', kind: row.file_kind, side: row.side };
  return { fileId: row.id, filename: row.filename, mimeType: row.mime_type, kind: row.file_kind,
    side: row.side, state: scanStatus === 'clean' ? 'ready' : 'pending' };
}
export async function hydrateDocumentAnswers(db: D1Database, data: Record<string, unknown>, role?: string, submissionId?: string): Promise<Record<string, unknown>> {
  const result = { ...data };
  for (const [name, value] of Object.entries(result)) {
    if (!Array.isArray(value) || !value.some(v => v && typeof v === 'object' && 'fileId' in v)) continue;
    result[name] = await Promise.all(value.map(async (v) => {
      if (!v || typeof v !== 'object' || typeof v.fileId !== 'string') return v;
      const row = await db.prepare('SELECT f.*, s.status AS scan_status FROM form_submission_files f LEFT JOIN media_file_scans s ON s.id = f.scan_id WHERE f.id = ? AND f.submission_id = ?').bind(v.fileId, submissionId ?? '').first<FormDocumentRow & { scan_status: string }>();
      return row ? documentAnswer(row, role, row.scan_status ?? 'pending') : { fileId: v.fileId, state: 'expired' };
    }));
  }
  return result;
}
/** Validate server-owned references, never trust kind/side/name sent by the browser. */
export async function validateDocumentAnswers(db: D1Database, layout: FormLayout | null, data: Record<string, unknown>, scope: { accountId: string; formId: string; friendId: string; versionId: string | null; submissionId?: string | null }): Promise<string | null> {
  if (!layout) return null;
  for (const block of collectInputs(layout).filter(b => b.type === 'file')) {
    const value = data[block.name];
    if (!Array.isArray(value)) {
      if (formFileKind(block) === 'identity' || formFileKind(block) === 'pdf') {
        if (value) return `${block.label} の書類を送りなおしてください`;
      }
      continue; // existing image URL answers
    }
    const sides: string[] = [];
    for (const v of value) {
      if (!v || typeof v !== 'object' || typeof v.fileId !== 'string') return '添付の情報が正しくありません';
      const row = await db.prepare('SELECT f.*, s.status AS scan_status FROM form_submission_files f LEFT JOIN media_file_scans s ON s.id = f.scan_id WHERE f.id = ?').bind(v.fileId).first<FormDocumentRow & { scan_status: string }>();
      if (!row || row.line_account_id !== scope.accountId || row.form_id !== scope.formId || row.friend_id !== scope.friendId
        || row.block_id !== block.id || row.form_version_id !== scope.versionId || row.file_kind !== uploadedDocumentKind(block, row.mime_type)
        || (row.mime_type === 'application/pdf' ? !formFileKinds(block).includes('pdf') : !formFileKinds(block).some(kind => kind === 'image' || kind === 'identity'))
        || documentExpired(row)) return `${block.label} の書類を送りなおしてください`;
      if (row.submission_id && row.submission_id !== scope.submissionId) return 'この書類はすでに回答に添付されています';
      if (row.scan_status === 'quarantined' || row.scan_status === 'rejected') return '安全を確認できませんでした。別のファイルを選んでください';
      if (row.scan_status !== 'clean') return '添付を検査しています。終わってから送信してください';
      sides.push(row.side);
      Object.keys(v).forEach(key => { if (key !== 'fileId') delete v[key]; });
    }
    if (value.length > documentLimit(block) || new Set(value.map(v => v.fileId)).size !== value.length) return '添付の枚数を確認してください';
    if (value.length && formFileKind(block) === 'identity' && block.fileBothSides && (sides.length !== 2 || !sides.includes('front') || !sides.includes('back'))) return '本人確認書類の表と裏を送ってください';
  }
  return null;
}
export function documentIds(data: Record<string, unknown>, layout: FormLayout | null): string[] {
  const fileNames = new Set(layout ? collectInputs(layout).filter(b => b.type === 'file').map(b => b.name) : []);
  return Object.entries(data).filter(([name]) => fileNames.has(name)).map(([, value]) => value).flatMap(v => Array.isArray(v) ? v.flatMap(f => f && typeof f === 'object' && typeof f.fileId === 'string' ? [f.fileId] : []) : []);
}
export async function attachDocumentAnswers(db: D1Database, data: Record<string, unknown>, submissionId: string, friendId: string, layout: FormLayout | null): Promise<void> {
  const ids = documentIds(data, layout);
  for (const id of ids) {
    const existing = await db.prepare('SELECT submission_id FROM form_submission_files WHERE id = ? AND friend_id = ?').bind(id, friendId).first<{ submission_id: string | null }>();
    if (existing?.submission_id && existing.submission_id !== submissionId) throw new Error('document_already_submitted');
    const attached = await db.prepare('UPDATE form_submission_files SET submission_id = ? WHERE id = ? AND friend_id = ? AND (submission_id IS NULL OR submission_id = ?)').bind(submissionId, id, friendId, submissionId).run();
    if (attached.meta.changes !== 1) throw new Error('document_attachment_failed');
  }
}
/** A flagged document is never retained for the one-day abandoned-upload period. */
export async function purgeUnsafeFormDocuments(db: D1Database, store: Pick<R2Bucket, 'delete'>, scanId: string): Promise<boolean> {
  const rows = await db.prepare('SELECT * FROM form_submission_files WHERE scan_id = ? AND deleted_at IS NULL').bind(scanId).all<FormDocumentRow>().catch(() => null);
  if (!rows) { console.error('unsafe form document lookup failed'); return false; }
  let complete = true;
  for (const row of rows.results) {
    try {
      await store.delete(row.r2_key);
      await db.prepare("UPDATE form_submission_files SET deleted_at = ?, deletion_reason = 'unsafe' WHERE id = ? AND deleted_at IS NULL").bind(new Date().toISOString(), row.id).run();
    } catch { complete = false; console.error('unsafe form document deletion failed'); }
  }
  return complete;
}
/** Delete R2 first; a failed delete remains due for the next cron. Keep the tombstone. */
export async function purgeExpiredFormDocuments(db: D1Database, store: Pick<R2Bucket, 'delete'>, now = new Date()): Promise<number> {
  const rows = await db.prepare(`SELECT * FROM form_submission_files WHERE deleted_at IS NULL AND expires_at <= ? UNION SELECT * FROM form_submission_files WHERE deleted_at IS NULL AND submission_id IS NULL AND created_at <= ? UNION SELECT f.* FROM form_submission_files f JOIN media_file_scans s ON s.id = f.scan_id WHERE f.deleted_at IS NULL AND s.status = 'quarantined' LIMIT 100`)
    .bind(now.toISOString(), new Date(now.getTime() - 86400000).toISOString()).all<FormDocumentRow>();
  let deleted = 0;
  for (const row of rows.results) {
    try {
      const scan = await db.prepare('SELECT status FROM media_file_scans WHERE id = ?').bind(row.scan_id).first<{ status: string }>();
      await store.delete(row.r2_key);
      await db.prepare('UPDATE form_submission_files SET deleted_at = ?, deletion_reason = ? WHERE id = ? AND deleted_at IS NULL').bind(now.toISOString(), scan?.status === 'quarantined' ? 'unsafe' : row.expires_at && Date.parse(row.expires_at) <= now.getTime() ? 'expired' : 'abandoned', row.id).run();
      deleted++;
    } catch { console.error('form document retention failed'); }
  }
  return deleted;
}
