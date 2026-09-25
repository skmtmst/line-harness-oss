import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { recordAuditEvent } from '@line-crm/db';
import { canAccessAllLineAccounts } from '../services/account-access.js';
import {
  FILE_SCAN_REASON_LABELS,
  claimDueFileScans,
  createFileScan,
  getFileScanBySubject,
  getFileScanConfig,
  getLatestMediaScan,
  markFileScanClean,
  markFileScanPendingRetry,
  markFileScanQuarantined,
  resolveExternalScanner,
  runScanForStoredObject,
  ScanRetryableError,
  type FileScanRow,
  type FileScanStatus,
  type FileScanSubjectKind,
} from '../services/file-scan.js';

/*
 * 危険なファイルの検査の管理口。
 * 一覧・消す・誤りなので戻す（理由を記録）は owner / admin だけ。
 * 自分の上げたファイルの状態確認と、止まっている時の表示は staff も見られる。
 */

export const fileScan = new Hono<Env>();

function reasonLabel(code: string | null): string | null {
  if (!code) return null;
  return FILE_SCAN_REASON_LABELS[code] ?? '確認が必要です';
}

function serializeScan(row: FileScanRow) {
  return {
    id: row.id,
    lineAccountId: row.line_account_id,
    subjectKind: row.subject_kind,
    subjectId: row.subject_id,
    mediaId: row.media_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    status: row.status,
    reasonCode: row.reason_code,
    // 中身は画面に出さない。理由コードの言葉だけ出す。
    reasonLabel: reasonLabel(row.reason_code),
    attempts: row.attempts,
    nextRetryAt: row.next_retry_at,
    scannedAt: row.scanned_at,
    quarantinedAt: row.quarantined_at,
    releasedAt: row.released_at,
    releaseReason: row.release_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findR2Key(
  db: D1Database,
  scan: FileScanRow,
): Promise<{ key: string; width: number | null; height: number | null } | null> {
  if (scan.subject_kind === 'upload_session' || scan.subject_kind === 'media_version') {
    const session = await db.prepare(
      `SELECT r2_key, width, height FROM media_upload_sessions WHERE id = ?`,
    ).bind(scan.subject_id).first<{ r2_key: string; width: number | null; height: number | null }>();
    if (session) return { key: session.r2_key, width: session.width, height: session.height };
  }
  if (scan.subject_kind === 'media' || scan.media_id) {
    const media = await db.prepare(
      `SELECT r2_key, width, height FROM media WHERE id = ?`,
    ).bind(scan.media_id ?? scan.subject_id)
      .first<{ r2_key: string; width: number | null; height: number | null }>();
    if (media) return { key: media.r2_key, width: media.width, height: media.height };
  }
  if (scan.subject_kind === 'photo') {
    const photo = await db.prepare(
      `SELECT r2_key, image_width, image_height FROM nen_photo_submissions WHERE id = ?`,
    ).bind(scan.subject_id)
      .first<{ r2_key: string; image_width: number | null; image_height: number | null }>();
    if (photo) return { key: photo.r2_key, width: photo.image_width, height: photo.image_height };
  }
  if (
    scan.subject_kind === 'form_file'
    || scan.subject_kind === 'broadcast_asset'
    || scan.subject_kind === 'generic_image'
  ) {
    // R2 キーを subject_id に入れている。寸法はその場で測る。
    return { key: scan.subject_id, width: null, height: null };
  }
  return null;
}

/** 期限切れの pending を拾って内蔵＋外部の検査を回す。失敗は pending のまま。 */
export async function processDueFileScans(
  env: Env['Bindings'],
  limit = 20,
): Promise<{ processed: number; stillPending: number }> {
  const now = new Date().toISOString();
  const due = await claimDueFileScans(env.DB, now, limit);
  let stillPending = 0;
  for (const scan of due) {
    try {
      const target = await findR2Key(env.DB, scan);
      if (!target) {
        await markFileScanPendingRetry(env.DB, scan.id, scan.attempts);
        stillPending += 1;
        continue;
      }
      const config = await getFileScanConfig(env.DB, scan.line_account_id);
      const external = resolveExternalScanner(
        env as unknown as Record<string, string | undefined>, config,
      );
      if (external) {
        // 外の検査は設定があれば使う。鍵は設定の secret_ref が指す環境値から。
        const head = await env.IMAGES.get(target.key, { range: { offset: 0, length: 256 * 1024 } });
        const bytes = head ? new Uint8Array(await head.arrayBuffer()) : new Uint8Array();
        try {
          const verdict = await external.scan(bytes, {
            filename: scan.filename, mimeType: scan.mime_type, sizeBytes: scan.size_bytes,
          });
          if (verdict === 'clean') {
            await markFileScanClean(env.DB, scan.id);
          } else {
            await markFileScanQuarantined(env.DB, scan.id, 'external_flagged', '外部の検査で問題が見つかりました');
          }
          continue;
        } catch (err) {
          if (err instanceof ScanRetryableError) {
            await markFileScanPendingRetry(env.DB, scan.id, scan.attempts);
            stillPending += 1;
            continue;
          }
          throw err;
        }
      }
      const next = await runScanForStoredObject(env.DB, env.IMAGES, scan, target.key, {
        width: target.width, height: target.height,
      }, {
        maxBytes: config?.max_bytes_override ?? null,
        maxPixels: config?.max_pixels_override ?? null,
      });
      if (next.status === 'pending') stillPending += 1;
    } catch (err) {
      console.error('processDueFileScans error:', scan.id, err);
      await markFileScanPendingRetry(env.DB, scan.id, scan.attempts);
      stillPending += 1;
    }
  }
  return { processed: due.length, stillPending };
}

fileScan.get('/api/file-scans', requireRole('owner', 'admin'), async (c) => {
  const accountId = (c.req.query('accountId') ?? '').trim();
  const status = (c.req.query('status') ?? '').trim() as FileScanStatus | '';
  const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 20) || 20, 1), 100);
  const offset = Math.max(Number(c.req.query('offset') ?? 0) || 0, 0);
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const allowed: FileScanStatus[] = ['pending', 'clean', 'rejected', 'quarantined'];
  const where = status && (allowed as string[]).includes(status)
    ? `line_account_id = ? AND status = ?`
    : `line_account_id = ?`;
  const binds = status && (allowed as string[]).includes(status) ? [accountId, status] : [accountId];
  const rows = await c.env.DB.prepare(
    `SELECT * FROM media_file_scans WHERE ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
  ).bind(...binds, limit, offset).all<FileScanRow>();
  const total = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM media_file_scans WHERE ${where}`,
  ).bind(...binds).first<{ n: number }>();
  const items = rows.results ?? [];
  // 上げた人の表示はその場で集める。media は登録者、写真は投稿者、その他は「—」。
  const mediaIds = [...new Set(items.filter((row) => row.media_id).map((row) => row.media_id as string))];
  const photoIds = [...new Set(items.filter((row) => row.subject_kind === 'photo').map((row) => row.subject_id))];
  const uploaders = new Map<string, string>();
  if (mediaIds.length > 0) {
    const placeholders = mediaIds.map(() => '?').join(',');
    const mediaRows = await c.env.DB.prepare(
      `SELECT id, uploaded_by FROM media WHERE id IN (${placeholders})`,
    ).bind(...mediaIds).all<{ id: string; uploaded_by: string | null }>();
    for (const mediaRow of mediaRows.results ?? []) {
      if (mediaRow.uploaded_by) uploaders.set(`media:${mediaRow.id}`, mediaRow.uploaded_by);
    }
  }
  if (photoIds.length > 0) {
    const placeholders = photoIds.map(() => '?').join(',');
    const photoRows = await c.env.DB.prepare(
      `SELECT ps.id, f.display_name AS friend_name
         FROM nen_photo_submissions ps LEFT JOIN friends f ON f.id = ps.friend_id
        WHERE ps.id IN (${placeholders})`,
    ).bind(...photoIds).all<{ id: string; friend_name: string | null }>();
    for (const photoRow of photoRows.results ?? []) {
      uploaders.set(`photo:${photoRow.id}`, photoRow.friend_name ?? 'お客さん');
    }
  }
  return c.json({
    success: true,
    data: {
      items: items.map((row) => {
        const uploader = row.subject_kind === 'photo'
          ? uploaders.get(`photo:${row.subject_id}`)
          : row.media_id ? uploaders.get(`media:${row.media_id}`) : undefined;
        return { ...serializeScan(row), uploaderLabel: uploader ?? '—' };
      }),
      total: Number(total?.n ?? 0), limit, offset,
    },
  });
});

fileScan.get('/api/file-scans/by-subject', requireRole('owner', 'admin', 'staff'), async (c) => {
  const kind = (c.req.query('kind') ?? '').trim();
  const id = (c.req.query('id') ?? '').trim();
  const accountId = (c.req.query('accountId') ?? '').trim();
  if (!kind || !id || !accountId) {
    return c.json({ success: false, error: 'kind と id と accountId が必要です' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scan = await getFileScanBySubject(
    c.env.DB, kind as 'media' | 'media_version' | 'upload_session' | 'photo', id,
  );
  if (!scan || scan.line_account_id !== accountId) {
    return c.json({ success: true, data: { scan: null } });
  }
  return c.json({ success: true, data: { scan: serializeScan(scan) } });
});

fileScan.get('/api/file-scans/for-media', requireRole('owner', 'admin', 'staff'), async (c) => {
  const mediaId = (c.req.query('mediaId') ?? '').trim();
  const accountId = (c.req.query('accountId') ?? '').trim();
  if (!mediaId || !accountId) {
    return c.json({ success: false, error: 'mediaId と accountId が必要です' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scan = await getLatestMediaScan(c.env.DB, mediaId);
  if (!scan || scan.line_account_id !== accountId) {
    return c.json({ success: true, data: { scan: null } });
  }
  return c.json({ success: true, data: { scan: serializeScan(scan) } });
});

/** 止まっている時の表示（B-3）。staff も見られる。赤は使わない。 */
fileScan.get('/api/file-scans/health', requireRole('owner', 'admin', 'staff'), async (c) => {
  const accountId = (c.req.query('accountId') ?? '').trim();
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS pending_count, MIN(created_at) AS oldest_pending_at
       FROM media_file_scans WHERE line_account_id = ? AND status = 'pending'`,
  ).bind(accountId).first<{ pending_count: number; oldest_pending_at: string | null }>();
  const pendingCount = Number(row?.pending_count ?? 0);
  const oldest = row?.oldest_pending_at ? Date.parse(row.oldest_pending_at) : NaN;
  // 30分以上 pending のまま残っていれば「止まっている」と見せる。
  const stopped = pendingCount > 0 && !Number.isNaN(oldest) && Date.now() - oldest > 30 * 60_000;
  return c.json({
    success: true,
    data: { stopped, pendingCount, oldestPendingAt: row?.oldest_pending_at ?? null },
  });
});

fileScan.post('/api/file-scans/:id/retry', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: unknown }>().catch(() => null);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scan = await c.env.DB.prepare(`SELECT * FROM media_file_scans WHERE id = ?`)
    .bind(c.req.param('id')).first<FileScanRow>();
  if (!scan || scan.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  // 二重実行は行の状態で抑える。pending の再試行は時刻だけ前倒しする。
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE media_file_scans SET status = 'pending', next_retry_at = ?, updated_at = ? WHERE id = ?`,
  ).bind(now, now, scan.id).run();
  await recordAuditEvent(c.env.DB, {
    lineAccountId: accountId,
    category: 'business',
    actorPrincipalId: c.get('staff')?.id ?? 'unknown',
    actorRole: c.get('staff')?.role ?? 'unknown',
    action: 'file_scan.retry',
    targetKind: 'file_scan',
    targetId: scan.id,
    result: 'success',
  }).catch(() => {});
  return c.json({ success: true, data: { id: scan.id, status: 'pending' } });
});

/** 誤りなので戻す。理由の記録は必須。quarantined だけ戻せる。 */
fileScan.post('/api/file-scans/:id/release', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{ accountId?: unknown; reason?: unknown }>().catch(() => null);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
  if (!accountId || !reason) {
    return c.json({ success: false, error: 'accountId と理由が必要です' }, 400);
  }
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scan = await c.env.DB.prepare(`SELECT * FROM media_file_scans WHERE id = ?`)
    .bind(c.req.param('id')).first<FileScanRow>();
  if (!scan || scan.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (scan.status !== 'quarantined') {
    return c.json({ success: false, code: 'file_scan_not_quarantined', error: 'しまったファイルだけ戻せます' }, 409);
  }
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `UPDATE media_file_scans
        SET status = 'clean', released_at = ?, release_reason = ?,
            released_by = ?, next_retry_at = NULL, updated_at = ?
      WHERE id = ? AND status = 'quarantined'`,
  ).bind(now, reason.slice(0, 500), c.get('staff')?.id ?? null, now, scan.id).run();
  await recordAuditEvent(c.env.DB, {
    lineAccountId: accountId,
    category: 'business',
    actorPrincipalId: c.get('staff')?.id ?? 'unknown',
    actorRole: c.get('staff')?.role ?? 'unknown',
    action: 'file_scan.release',
    targetKind: 'file_scan',
    targetId: scan.id,
    result: 'success',
  }).catch(() => {});
  return c.json({ success: true, data: { id: scan.id, status: 'clean' } });
});

/** しまった・使えないファイルの消去。記録は監査に残し、中身は出さない。 */
fileScan.delete('/api/file-scans/:id', requireRole('owner', 'admin'), async (c) => {
  const accountId = (c.req.query('accountId') ?? '').trim();
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const scan = await c.env.DB.prepare(`SELECT * FROM media_file_scans WHERE id = ?`)
    .bind(c.req.param('id')).first<FileScanRow>();
  if (!scan || scan.line_account_id !== accountId) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  if (scan.status !== 'quarantined' && scan.status !== 'rejected') {
    return c.json({ success: false, code: 'file_scan_not_disposable', error: 'しまった・使えないファイルだけ消せます' }, 409);
  }
  const target = await findR2Key(c.env.DB, scan);
  if (target) await c.env.IMAGES.delete(target.key).catch(() => {});
  if (scan.media_id) {
    await c.env.DB.prepare(
      `UPDATE media SET archived_at = ?, archived_by = ?, archive_reason = ?
        WHERE id = ? AND line_account_id = ?`,
    ).bind(new Date().toISOString(), c.get('staff')?.id ?? null, '検査でしまったため', scan.media_id, accountId).run();
  }
  await c.env.DB.prepare(`DELETE FROM media_file_scans WHERE id = ?`).bind(scan.id).run();
  await recordAuditEvent(c.env.DB, {
    lineAccountId: accountId,
    category: 'business',
    actorPrincipalId: c.get('staff')?.id ?? 'unknown',
    actorRole: c.get('staff')?.role ?? 'unknown',
    action: 'file_scan.delete',
    targetKind: 'file_scan',
    targetId: scan.id,
    result: 'success',
  }).catch(() => {});
  return c.json({ success: true, data: { id: scan.id } });
});

fileScan.get('/api/file-scans/config', requireRole('owner', 'admin'), async (c) => {
  const accountId = (c.req.query('accountId') ?? '').trim();
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const config = await getFileScanConfig(c.env.DB, accountId);
  return c.json({
    success: true,
    data: {
      config: config ? {
        externalProvider: config.external_provider,
        externalEndpointUrl: config.external_endpoint_url,
        // 鍵そのものは返さない。名前だけ。
        externalSecretRef: config.external_secret_ref,
        externalTimeoutMs: config.external_timeout_ms,
        maxBytesOverride: config.max_bytes_override,
        maxPixelsOverride: config.max_pixels_override,
        updatedAt: config.updated_at,
      } : null,
    },
  });
});

fileScan.put('/api/file-scans/config', requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json<{
    accountId?: unknown;
    externalProvider?: unknown;
    externalEndpointUrl?: unknown;
    externalSecretRef?: unknown;
    externalTimeoutMs?: unknown;
    maxBytesOverride?: unknown;
    maxPixelsOverride?: unknown;
  }>().catch(() => null);
  const accountId = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
  if (!accountId) return c.json({ success: false, error: 'accountId が必要です' }, 400);
  if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const text = (v: unknown, max: number): string | null => {
    if (v == null || v === '') return null;
    return typeof v === 'string' ? v.trim().slice(0, max) || null : null;
  };
  const provider = text(body?.externalProvider, 80);
  const endpoint = text(body?.externalEndpointUrl, 500);
  const secretRef = text(body?.externalSecretRef, 120);
  if (endpoint && !/^https:\/\//.test(endpoint)) {
    return c.json({ success: false, error: '外の検査の宛先は https にしてください' }, 400);
  }
  if ((provider || endpoint || secretRef) && !(provider && endpoint)) {
    return c.json({ success: false, error: '外の検査を使う時は提供元と宛先の両方が必要です' }, 400);
  }
  const timeoutMs = Number(body?.externalTimeoutMs);
  const numOrNull = (v: unknown): number | null => {
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isSafeInteger(n) && n > 0 ? n : null;
  };
  const now = new Date().toISOString();
  await c.env.DB.prepare(
    `INSERT INTO file_scan_configs
      (line_account_id, external_provider, external_endpoint_url, external_secret_ref,
       external_timeout_ms, max_bytes_override, max_pixels_override, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (line_account_id) DO UPDATE SET
       external_provider = excluded.external_provider,
       external_endpoint_url = excluded.external_endpoint_url,
       external_secret_ref = excluded.external_secret_ref,
       external_timeout_ms = excluded.external_timeout_ms,
       max_bytes_override = excluded.max_bytes_override,
       max_pixels_override = excluded.max_pixels_override,
       updated_by = excluded.updated_by,
       updated_at = excluded.updated_at`,
  ).bind(
    accountId, provider, endpoint, secretRef,
    Number.isSafeInteger(timeoutMs) && timeoutMs > 0 ? timeoutMs : 10000,
    numOrNull(body?.maxBytesOverride), numOrNull(body?.maxPixelsOverride),
    c.get('staff')?.id ?? null, now,
  ).run();
  return c.json({ success: true, data: { lineAccountId: accountId } });
});

export async function ensureFileScanForUpload(args: {
  db: D1Database;
  lineAccountId: string | null;
  subjectKind: FileScanSubjectKind;
  subjectId: string;
  mediaId?: string | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<FileScanRow> {
  const existing = await getFileScanBySubject(args.db, args.subjectKind, args.subjectId);
  if (existing) return existing;
  return createFileScan(args.db, {
    lineAccountId: args.lineAccountId,
    subjectKind: args.subjectKind,
    subjectId: args.subjectId,
    mediaId: args.mediaId ?? null,
    filename: args.filename,
    mimeType: args.mimeType,
    sizeBytes: args.sizeBytes,
  });
}
