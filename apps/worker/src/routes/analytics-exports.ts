import { Hono, type Context } from 'hono';
import {
  ANALYTICS_EXPORT_MAX_BYTES,
  ANALYTICS_EXPORT_TTL_MS,
  buildCrossCsv,
  buildFunnelCsv,
  buildReactionsCsv,
  buildSavedCsv,
  buildUrlClicksCsv,
  completeAnalyticsExport,
  createAnalyticsExportJob,
  failAnalyticsExport,
  getAnalyticsCrossRun,
  getAnalyticsExportCsv,
  getAnalyticsExportJob,
  getAnalyticsReactionsOverview,
  getAnalyticsUrlClicksOverview,
  getLatestFunnelRun,
  getLineAccountById,
  getSavedAnalytics,
  markAnalyticsExportExpired,
  markAnalyticsExportRunning,
  parseAnalyticsExportParams,
  parseAnalyticsExportTarget,
  analyticsCsvText,
  type AnalyticsCsvRow,
  type AnalyticsExportJobMeta,
  type AnalyticsExportParams,
  type AnalyticsExportTarget,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { getVisibleLineAccountScope } from '../services/account-access.js';
import { auditLog } from '../lib/audit-log.js';
import { readAnalyticsOverviewRange } from './analytics.js';

export const analyticsExports = new Hono<Env>();

function exportJobJson(job: AnalyticsExportJobMeta) {
  return {
    id: job.id,
    target: job.target,
    params: JSON.parse(job.params_json) as AnalyticsExportParams,
    status: job.status,
    rowCount: job.row_count == null ? null : Number(job.row_count),
    byteSize: job.byte_size == null ? null : Number(job.byte_size),
    createdBy: job.created_by,
    createdByName: job.created_by_name,
    createdAt: job.created_at,
    startedAt: job.started_at,
    finishedAt: job.finished_at,
    expiresAt: job.expires_at,
    failureReason: job.failure_reason,
    downloadUrl: job.status === 'completed' ? `/api/analytics/exports/${job.id}/download` : null,
  };
}

async function resolveExportAccount(
  c: Context<Env>,
  accountId: string | undefined,
): Promise<{ ok: true; accountId: string } | { ok: false; response: Response }> {
  const trimmed = accountId?.trim();
  if (!trimmed) {
    return { ok: false, response: c.json({ success: false, error: 'LINE公式アカウントを選んでください' }, 400) };
  }
  const scope = await getVisibleLineAccountScope(c.env.DB, c.get('staff'));
  if (!scope.allowedAccountIds.includes(trimmed)) {
    return { ok: false, response: c.json({ success: false, error: 'Not found' }, 404) };
  }
  return { ok: true, accountId: trimmed };
}

function exportFileName(target: AnalyticsExportTarget, id: string): string {
  return `analytics-${target}-${id}.csv`;
}

/**
 * キューに積まれた1件を書き出す。画面のCSVと同じ集計関数を読み、
 * 同じ列定義（analytics-exports.ts の builder）で組み立てる。
 * route 試験から直接呼べるよう export しておく。
 */
export async function runAnalyticsExportJob(db: D1Database, jobId: string): Promise<void> {
  const header = await db.prepare(`
    SELECT id, line_account_id, target, params_json FROM analytics_export_jobs WHERE id = ?
  `).bind(jobId).first<{
    id: string; line_account_id: string; target: string; params_json: string;
  }>();
  if (!header || header.target == null) return;
  const target = parseAnalyticsExportTarget(header.target);
  if (!target) {
    await failAnalyticsExport(db, jobId, '書き出し対象が正しくありません', new Date().toISOString());
    return;
  }
  const params = parseAnalyticsExportParams(JSON.parse(header.params_json));
  const finishedAt = () => new Date().toISOString();
  try {
    await markAnalyticsExportRunning(db, jobId, finishedAt());
    const rows = await buildExportRows(db, header.line_account_id, target, params);
    const csvText = analyticsCsvText(rows);
    const byteSize = new TextEncoder().encode(csvText).length;
    if (byteSize > ANALYTICS_EXPORT_MAX_BYTES) {
      await failAnalyticsExport(
        db, jobId, '出力が大きすぎます。期間を短くして分けて書き出してください', finishedAt(),
      );
      return;
    }
    await completeAnalyticsExport(db, jobId, {
      rowCount: Math.max(0, rows.length - 1),
      csvText,
      byteSize,
      finishedAt: finishedAt(),
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'analytics_export_failed', jobId, error: String(error) }));
    const message = error instanceof Error && error.message === 'analytics_export_not_ready'
      ? '集計がまだ終わっていません。集計が終わってから書き出してください'
      : error instanceof Error && error.message === 'analytics_export_not_found'
        ? '書き出す集計が見つかりません'
        : '書き出しの途中で失敗しました';
    await failAnalyticsExport(db, jobId, message, finishedAt());
  }
}

async function buildExportRows(
  db: D1Database,
  lineAccountId: string,
  target: AnalyticsExportTarget,
  params: AnalyticsExportParams,
): Promise<AnalyticsCsvRow[]> {
  if (target === 'cross') {
    if (!params.resultId) throw new Error('analytics_export_not_found');
    const run = await getAnalyticsCrossRun(db, lineAccountId, params.resultId);
    if (!run) throw new Error('analytics_export_not_found');
    if (!run.result) throw new Error('analytics_export_not_ready');
    const query = JSON.parse(
      (await db.prepare(`SELECT query_json FROM analytics_cross_runs WHERE id = ? AND line_account_id = ?`)
        .bind(params.resultId, lineAccountId).first<{ query_json: string }>())?.query_json ?? '{}',
    ) as { rowAxis?: { kind?: string }; columnAxis?: { kind?: string; fieldId?: string } };
    let fieldName = '友だち情報';
    if (query.columnAxis?.kind === 'field_choice' && query.columnAxis.fieldId) {
      const field = await db.prepare(`SELECT name FROM friend_fields WHERE id = ?`)
        .bind(query.columnAxis.fieldId).first<{ name: string }>();
      if (field?.name) fieldName = field.name;
    }
    return buildCrossCsv(run.result, query.rowAxis?.kind ?? 'tag', fieldName);
  }
  if (target === 'funnel') {
    if (!params.funnelId) throw new Error('analytics_export_not_found');
    const run = await getLatestFunnelRun(db, lineAccountId, params.funnelId);
    if (!run) throw new Error('analytics_export_not_found');
    return buildFunnelCsv(run, params.groupKey);
  }
  if (target === 'saved') {
    const items = await getSavedAnalytics(db, lineAccountId);
    return buildSavedCsv(items, params.query);
  }
  const account = await getLineAccountById(db, lineAccountId);
  if (!account) throw new Error('analytics_export_not_found');
  const range = readAnalyticsOverviewRange(
    (key) => (key === 'from' ? params.from : key === 'to' ? params.to : undefined),
    account.timezone || 'Asia/Tokyo',
  );
  if (!range.ok) throw new Error(`analytics_export_bad_range: ${range.error}`);
  const context = { lineAccountId, ...range.value };
  if (target === 'reactions') {
    const overview = await getAnalyticsReactionsOverview(db, context);
    return buildReactionsCsv(overview.data);
  }
  const clicks = await getAnalyticsUrlClicksOverview(db, context);
  return buildUrlClicksCsv(clicks.data.links, params.query);
}

analyticsExports.post(
  '/api/analytics/exports',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<Record<string, unknown>>().catch(() => null);
      const account = await resolveExportAccount(c, body?.accountId as string | undefined);
      if (!account.ok) return account.response;
      const target = parseAnalyticsExportTarget(body?.target);
      if (!target) {
        return c.json({ success: false, error: '書き出す内容を選んでください' }, 400);
      }
      const params = parseAnalyticsExportParams(body?.params);
      if (target === 'cross' && !params.resultId) {
        return c.json({ success: false, error: 'クロス分析の結果を選んでください' }, 422);
      }
      if (target === 'funnel' && !params.funnelId) {
        return c.json({ success: false, error: 'ファネルを選んでください' }, 422);
      }
      if ((target === 'cross' || target === 'funnel') && (params.from || params.to)) {
        return c.json({ success: false, error: '期間の指定はこの書き出しには使えません' }, 400);
      }
      // 存在しない集計の待ち行列を作らない。IDの打ち間違いはここで落とす。
      if (target === 'cross') {
        const run = await getAnalyticsCrossRun(c.env.DB, account.accountId, params.resultId as string);
        if (!run) return c.json({ success: false, error: '書き出す集計が見つかりません' }, 404);
      }
      if (target === 'funnel') {
        const run = await getLatestFunnelRun(c.env.DB, account.accountId, params.funnelId as string);
        if (!run) return c.json({ success: false, error: '書き出す集計が見つかりません' }, 404);
      }
      if ((target === 'reactions' || target === 'url-clicks') && (params.from || params.to)) {
        const selected = await getLineAccountById(c.env.DB, account.accountId);
        const range = readAnalyticsOverviewRange(
          (key) => (key === 'from' ? params.from : key === 'to' ? params.to : undefined),
          selected?.timezone || 'Asia/Tokyo',
        );
        if (!range.ok) return c.json({ success: false, error: range.error }, 400);
      }
      const staff = c.get('staff');
      const now = new Date();
      const job = await createAnalyticsExportJob(c.env.DB, {
        id: crypto.randomUUID(),
        lineAccountId: account.accountId,
        target,
        params,
        createdBy: staff.id,
        createdByName: staff.name,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + ANALYTICS_EXPORT_TTL_MS).toISOString(),
      });
      const task = runAnalyticsExportJob(c.env.DB, job.id);
      try {
        c.executionCtx.waitUntil(task);
      } catch {
        await task;
      }
      auditLog(c, 'analytics.export', { kind: 'analytics_export', id: job.id });
      const fresh = await getAnalyticsExportJob(c.env.DB, job.id, account.accountId);
      return c.json({ success: true, data: exportJobJson(fresh ?? job) }, 202);
    } catch (error) {
      console.error(JSON.stringify({ event: 'analytics_export_create_failed', error: String(error) }));
      return c.json({ success: false, error: '書き出しを始められませんでした' }, 500);
    }
  },
);

analyticsExports.get(
  '/api/analytics/exports/:id',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const account = await resolveExportAccount(c, c.req.query('accountId'));
      if (!account.ok) return account.response;
      const job = await getAnalyticsExportJob(c.env.DB, c.req.param('id'), account.accountId);
      if (!job) return c.json({ success: false, error: 'Not found' }, 404);
      if (job.status === 'completed' && job.expires_at <= new Date().toISOString()) {
        await markAnalyticsExportExpired(c.env.DB, job.id);
        const fresh = await getAnalyticsExportJob(c.env.DB, job.id, account.accountId);
        return c.json({ success: true, data: exportJobJson(fresh ?? { ...job, status: 'expired' }) });
      }
      return c.json({ success: true, data: exportJobJson(job) });
    } catch (error) {
      console.error(JSON.stringify({ event: 'analytics_export_status_failed', error: String(error) }));
      return c.json({ success: false, error: '書き出しの状態を確認できませんでした' }, 500);
    }
  },
);

analyticsExports.get(
  '/api/analytics/exports/:id/download',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const account = await resolveExportAccount(c, c.req.query('accountId'));
      if (!account.ok) return account.response;
      const job = await getAnalyticsExportJob(c.env.DB, c.req.param('id'), account.accountId);
      if (!job) {
        auditLog(c, 'analytics.export', { kind: 'analytics_export', id: c.req.param('id') });
        return c.json({ success: false, error: 'Not found' }, 404);
      }
      if (job.status === 'completed' && job.expires_at <= new Date().toISOString()) {
        await markAnalyticsExportExpired(c.env.DB, job.id);
      }
      // download 経路だけが csv_text を読む。detail は触らない。
      const fresh = await getAnalyticsExportCsv(c.env.DB, job.id, account.accountId);
      const status = fresh?.status ?? job.status;
      if (status === 'expired') {
        return c.json({ success: false, error: 'ダウンロード期限が切れています。もう一度書き出してください' }, 410);
      }
      if (status === 'failed' || status === 'queued' || status === 'running' || !fresh?.csv_text) {
        return c.json({ success: false, error: 'この書き出しはまだダウンロードできません' }, 409);
      }
      auditLog(c, 'analytics.export', { kind: 'analytics_export', id: job.id });
      return new Response(`﻿${fresh.csv_text}`, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="${exportFileName(job.target, job.id)}"`,
          'cache-control': 'private, no-store',
        },
      });
    } catch (error) {
      console.error(JSON.stringify({ event: 'analytics_export_download_failed', error: String(error) }));
      return c.json({ success: false, error: 'ダウンロードできませんでした' }, 500);
    }
  },
);
