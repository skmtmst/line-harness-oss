import { Hono } from 'hono';
import {
  COMMON_VAR_EXPORT_MAX_BYTES,
  COMMON_VAR_EXPORT_PAGE_SIZE,
  COMMON_VAR_EXPORT_TTL_MS,
  completeCommonVarExport,
  countCommonVars,
  createCommonVarExportJob,
  failCommonVarExport,
  getCommonVarExportCsv,
  getCommonVarExportJob,
  getCommonVarUsageSummaries,
  getFolderById,
  listCommonVarExportJobs,
  listCommonVarsForExport,
  markCommonVarExportExpired,
  markCommonVarExportRunning,
  parseCommonVarExportFilter,
  protectCsvCell,
  updateCommonVarExportProgress,
  type CommonVarExportJobMeta,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { auditLog } from '../lib/audit-log.js';
import { canAccessAllLineAccounts } from '../services/account-access.js';

/**
 * 共通情報の監査付き非同期CSV出力（N-192）。
 *
 * 以前は画面に読み込めた最大200件を端末でCSV化していただけで、
 * 出力依頼・監査記録・期限つきダウンロードが無かった。ここでは
 * 依頼ごとに台帳行を作り、バックグラウンドで全件をページングして
 * 書き出す。成果物は出力時点の写しとして台帳行に保管し、
 * 7日間だけダウンロードできる。
 */

export const commonVarExports = new Hono<Env>();

/** 依頼1回あたりの台帳一覧の返し数。画面の「最近の書き出し」が読む。 */
const EXPORT_JOBS_LIST_LIMIT = 20;

/*
 * 画面の旧CSVと同じ7列。運用者に見せる差し込みキーは内部キー
 * （{{var.xxx}}）ではなく {名前} の形にそろえる。
 */
const CSV_HEADER = '共通情報,差し込みキー,中身,使われている場所,更新,次の変更日時,次の中身';

function exportJobJson(job: CommonVarExportJobMeta, nowIso = new Date().toISOString()) {
  const filter = parseCommonVarExportFilter(job.filter_json);
  const effectiveStatus = job.status === 'completed' && job.expires_at <= nowIso ? 'expired' : job.status;
  return {
    id: job.id,
    lineAccountId: job.line_account_id,
    folderId: filter.folderId ?? null,
    ungrouped: filter.ungrouped === true,
    status: effectiveStatus,
    totalCount: job.total_count,
    processedCount: job.processed_count,
    rowCount: job.row_count,
    byteSize: job.byte_size,
    createdBy: job.created_by,
    createdByName: job.created_by_name,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    expiresAt: job.expires_at,
    failureReason: job.failure_reason,
    downloadUrl: effectiveStatus === 'completed'
      ? `/api/common-vars/exports/${job.id}/download`
      : null,
  };
}

/**
 * キューに積まれた1件を書き出す。ページごとに使用先をまとめて数え、
 * processed_count を進める。成果物は csv_text へ、件数と容量も台帳へ残す。
 * route 試験から直接呼べるよう export しておく。
 */
export async function runCommonVarExportJob(db: D1Database, jobId: string): Promise<void> {
  const job = await getCommonVarExportJob(db, jobId);
  if (!job || job.status !== 'queued') return;
  const filter = parseCommonVarExportFilter(job.filter_json);
  const finishedAt = () => new Date().toISOString();
  try {
    const total = await countCommonVars(db, {
      lineAccountId: filter.accountId,
      folderId: filter.folderId,
      ungrouped: filter.ungrouped,
    });
    await markCommonVarExportRunning(db, jobId, finishedAt(), total);

    const encoder = new TextEncoder();
    const lines: string[] = [CSV_HEADER];
    let byteSize = encoder.encode(CSV_HEADER).length + 2;
    let processed = 0;
    let truncated = false;

    for (;;) {
      const page = await listCommonVarsForExport(db, {
        lineAccountId: filter.accountId,
        folderId: filter.folderId,
        ungrouped: filter.ungrouped,
        limit: COMMON_VAR_EXPORT_PAGE_SIZE,
        offset: processed,
      });
      if (page.length === 0) break;
      const usage = await getCommonVarUsageSummaries(
        db,
        page.map((item) => item.var_key),
        filter.accountId,
      );
      for (const item of page) {
        const line = [
          item.name,
          `{${item.name}}`,
          item.value,
          String(usage.get(item.var_key)?.total ?? 0),
          item.updated_at,
          item.next_effective_from ?? '',
          item.next_value ?? '',
        ].map((cell) => protectCsvCell(cell)).join(',');
        byteSize += encoder.encode(line).length + 2;
        if (byteSize > COMMON_VAR_EXPORT_MAX_BYTES) {
          truncated = true;
          break;
        }
        lines.push(line);
        processed += 1;
      }
      await updateCommonVarExportProgress(db, jobId, processed);
      if (truncated || page.length < COMMON_VAR_EXPORT_PAGE_SIZE) break;
    }

    if (truncated) {
      await failCommonVarExport(
        db, jobId, '出力が大きすぎます。フォルダで絞り込んで分けて書き出してください', finishedAt(),
      );
      return;
    }
    await completeCommonVarExport(db, jobId, {
      rowCount: processed,
      csvText: `${lines.join('\r\n')}\r\n`,
      byteSize,
      finishedAt: finishedAt(),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'common_var_export_failed', jobId, error: String(error) }));
    await failCommonVarExport(db, jobId, '書き出しの途中で失敗しました', finishedAt());
  }
}

async function accessibleExportJob(
  db: D1Database,
  staff: Parameters<typeof canAccessAllLineAccounts>[1],
  id: string,
): Promise<CommonVarExportJobMeta | null> {
  const job = await getCommonVarExportJob(db, id);
  if (!job) return null;
  return (await canAccessAllLineAccounts(db, staff, [job.line_account_id])) ? job : null;
}

commonVarExports.get('/api/common-vars/exports', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const accountId = c.req.query('accountId')?.trim();
    if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    const jobs = await listCommonVarExportJobs(c.env.DB, accountId, EXPORT_JOBS_LIST_LIMIT);
    return c.json({ success: true, data: jobs.map((job) => exportJobJson(job)) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'common_var_exports_list_failed', error: String(error) }));
    return c.json({ success: false, error: '書き出しの履歴を読み込めませんでした' }, 500);
  }
});

commonVarExports.post('/api/common-vars/exports', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ accountId?: string; folderId?: string | null; ungrouped?: boolean }>();
    const accountId = body.accountId?.trim();
    const folderId = typeof body.folderId === 'string' && body.folderId ? body.folderId : undefined;
    const ungrouped = body.ungrouped === true;
    if (!accountId) {
      return c.json({ success: false, error: '対象アカウントを選んでください' }, 400);
    }
    if (folderId && ungrouped) {
      return c.json({ success: false, error: 'フォルダと未分類は同時に選べません' }, 400);
    }
    if (!await canAccessAllLineAccounts(c.env.DB, c.get('staff'), [accountId])) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }
    if (folderId) {
      const folder = await getFolderById(c.env.DB, folderId);
      if (!folder || folder.kind !== 'common_var'
        || (folder.account_id !== null && folder.account_id !== accountId)) {
        return c.json({ success: false, error: '指定のフォルダが見つかりません。フォルダを選び直してください' }, 400);
      }
    }
    const staff = c.get('staff');
    const now = new Date();
    const job = await createCommonVarExportJob(c.env.DB, {
      id: crypto.randomUUID(),
      lineAccountId: accountId,
      filter: { accountId, folderId, ungrouped: ungrouped || undefined },
      createdBy: staff.id,
      createdByName: staff.name,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + COMMON_VAR_EXPORT_TTL_MS).toISOString(),
    });
    const task = runCommonVarExportJob(c.env.DB, job.id);
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      // 単体試験など ExecutionContext が無い環境では、その場で終わらせる。
      await task;
    }
    const fresh = await getCommonVarExportJob(c.env.DB, job.id);
    return c.json({ success: true, data: exportJobJson(fresh ?? job) }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'common_var_export_create_failed', error: String(error) }));
    return c.json({ success: false, error: '書き出しを作れませんでした' }, 500);
  }
});

commonVarExports.get('/api/common-vars/exports/:id', requireRole('owner', 'admin', 'staff'), async (c) => {
  try {
    const job = await accessibleExportJob(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!job) return c.json({ success: false, error: 'Not found' }, 404);
    if (job.status === 'completed' && job.expires_at <= new Date().toISOString()) {
      await markCommonVarExportExpired(c.env.DB, job.id);
      const fresh = await getCommonVarExportJob(c.env.DB, job.id);
      return c.json({ success: true, data: exportJobJson(fresh ?? { ...job, status: 'expired' }) });
    }
    return c.json({ success: true, data: exportJobJson(job) });
  } catch (error) {
    console.error(JSON.stringify({ event: 'common_var_export_status_failed', error: String(error) }));
    return c.json({ success: false, error: '書き出しの状態を確認できませんでした' }, 500);
  }
});

commonVarExports.get('/api/common-vars/exports/:id/download', requireRole('owner', 'admin'), async (c) => {
  const job = await accessibleExportJob(c.env.DB, c.get('staff'), c.req.param('id'));
  if (!job) {
    auditLog(c, 'common_var_export.download', { kind: 'common_var_export', id: c.req.param('id') }, { result: 'denied' });
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  const detail = { result: 'denied' as const, lineAccountId: job.line_account_id };
  if (job.status === 'completed' && job.expires_at <= new Date().toISOString()) {
    await markCommonVarExportExpired(c.env.DB, job.id);
  }
  // download 経路だけが csv_text（最大4MiB）を読む。detail/list は触らない。
  const fresh = await getCommonVarExportCsv(c.env.DB, job.id);
  const status = fresh?.status ?? job.status;
  if (status === 'expired') {
    auditLog(c, 'common_var_export.download', { kind: 'common_var_export', id: job.id }, detail);
    return c.json({ success: false, error: 'ダウンロード期限が切れています。もう一度書き出してください' }, 410);
  }
  if (status === 'failed' || status === 'queued' || status === 'running' || !fresh?.csv_text) {
    auditLog(c, 'common_var_export.download', { kind: 'common_var_export', id: job.id }, detail);
    return c.json({ success: false, error: 'この書き出しはまだダウンロードできません' }, 409);
  }
  auditLog(c, 'common_var_export.download', { kind: 'common_var_export', id: job.id },
    { result: 'success', lineAccountId: job.line_account_id });
  return new Response(`\uFEFF${fresh.csv_text}`, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="common-vars-${job.id}.csv"`,
      'cache-control': 'private, no-store',
    },
  });
});

commonVarExports.post('/api/common-vars/exports/:id/regenerate', requireRole('owner', 'admin'), async (c) => {
  try {
    const job = await accessibleExportJob(c.env.DB, c.get('staff'), c.req.param('id'));
    if (!job) return c.json({ success: false, error: 'Not found' }, 404);
    const filter = parseCommonVarExportFilter(job.filter_json);
    const staff = c.get('staff');
    const now = new Date();
    const next = await createCommonVarExportJob(c.env.DB, {
      id: crypto.randomUUID(),
      lineAccountId: job.line_account_id,
      filter,
      createdBy: staff.id,
      createdByName: staff.name,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + COMMON_VAR_EXPORT_TTL_MS).toISOString(),
    });
    const task = runCommonVarExportJob(c.env.DB, next.id);
    try {
      c.executionCtx.waitUntil(task);
    } catch {
      await task;
    }
    const fresh = await getCommonVarExportJob(c.env.DB, next.id);
    return c.json({ success: true, data: exportJobJson(fresh ?? next) }, 201);
  } catch (error) {
    console.error(JSON.stringify({ event: 'common_var_export_regenerate_failed', error: String(error) }));
    return c.json({ success: false, error: 'もう一度書き出せませんでした' }, 500);
  }
});
