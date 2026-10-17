import type { MiddlewareHandler } from 'hono';
import { auditEventStatement } from '@line-crm/db';
import type { Env } from '../index.js';

/** Records CSV records correctly even when a quoted cell contains a newline. */
export function csvRecordCount(csv: string): number {
  let quoted = false, start = 0, records = 0;
  for (let i = 0; i <= csv.length; i++) {
    if (csv[i] === '"') {
      if (quoted && csv[i + 1] === '"') i++;
      else quoted = !quoted;
    }
    if ((csv[i] === '\n' && !quoted) || i === csv.length) {
      const row = csv.slice(start, i).replace(/^\uFEFF/, '').trim();
      if (row && !row.startsWith('#')) records++;
      start = i + 1;
    }
  }
  return Math.max(0, records - 1);
}

export function isOutputRequest(path: string, format?: string, method = 'GET'): boolean {
  return format === 'csv' || /\.(csv|zip)$|\/(export|download)(\/|$)|\/form-files\/[^/]+\/content$/.test(path) || (method === 'POST' && path.endsWith('/exports'));
}

// Also applied directly by booking/doc routers, so isolated router use inherits
// the same protection. The outer instance covers rejections before the router.
export const outputAuditMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  let failed = false;
  try { await next(); } catch (error) { failed = true; throw error; }
  finally {
    const csv = (c.res.headers.get('content-type') ?? '').includes('text/csv');
    const metadata = c.get('outputAudit');
    const requested = isOutputRequest(c.req.path, c.req.query('format'), c.req.method);
    if (c.get('staff') && !c.get('outputAuditRecorded') && (csv || requested || metadata)) {
      c.set('outputAuditRecorded', true);
      const status = failed ? 500 : c.res.status;
      // CSV generation is bounded by each route's existing limits. Streams
      // provide a count explicitly and are never buffered here.
      const count = status >= 400 ? 0 : metadata?.count ?? (csv ? csvRecordCount(await c.res.clone().text()) : null);
      const staff = c.get('staff');
      const document = /\/form-files\/[^/]+\/content$/.test(c.req.path);
      const accounts = [...new Set(metadata?.accountIds ?? [])];
      const scope = accounts.length ? accounts : [metadata?.accountId ?? c.req.query('account_id') ?? c.req.query('lineAccountId') ?? staff.assignedLineAccountId ?? null];
      // A shared export gets one record per store, without truncating the list
      // at the audit JSON's safety ceiling. Only identifiers and counts go in.
      const group = crypto.randomUUID();
      await c.env.DB.batch(scope.map(accountId => auditEventStatement(c.env.DB, {
        sourceKind: 'export_request', sourceId: group,
        tenantId: c.get('impersonation')?.tenantId ?? staff.tenantId,
        lineAccountId: accountId,
        category: 'business', action: document ? 'form_document.download' : 'data.export',
        actorPrincipalId: staff.id, actorRole: staff.role,
        targetKind: document ? 'form_document' : 'export', targetId: metadata?.targetId ?? null,
        result: status < 400 ? 'success' : status < 500 ? 'denied' : 'failed',
        after: { count: status >= 400 ? 0 : accounts.length && accountId ? metadata?.accountCounts?.[accountId] ?? null : count,
          totalCount: count, format: document ? 'document' : csv ? 'csv' : 'json',
          route: c.req.routePath, phase: metadata?.phase ?? 'download' },
        riskLevel: 'high', retentionClass: 'security',
      })));
      if (csv || document) c.header('Cache-Control', 'private, no-store');
      if (status < 300 && (csv || requested) && !c.res.headers.has('X-Exported-At')) {
        const actor = staff.id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 100);
        const at = new Date().toISOString();
        c.header('X-Exported-By', actor); c.header('X-Exported-At', at);
        const disposition = c.res.headers.get('Content-Disposition');
        if (disposition) c.header('Content-Disposition', disposition.replace(/filename="([^"]+)"/, (_, name: string) => {
          const dot = name.lastIndexOf('.');
          const suffix = `-by-${actor}-${at.replace(/[^0-9TZ]/g, '')}`;
          return `filename="${dot < 0 ? name + suffix : name.slice(0,dot) + suffix + name.slice(dot)}"`;
        }));
        const named = c.res.headers.get('Content-Disposition');
        if (named) c.header('Content-Disposition', named.replace(/filename\*=UTF-8''([^;]+)/i, (_: string, encoded: string) => {
          let name: string; try { name = decodeURIComponent(encoded); } catch { name = 'download'; }
          const dot = name.lastIndexOf('.'), suffix = `-by-${actor}-${at.replace(/[^0-9TZ]/g, '')}`;
          return `filename*=UTF-8''${encodeURIComponent(dot < 0 ? name + suffix : name.slice(0,dot) + suffix + name.slice(dot))}`;
        }));
        // Keep the bytes unchanged: CSV imports have no comment-row syntax.
      }
    }
  }
};
