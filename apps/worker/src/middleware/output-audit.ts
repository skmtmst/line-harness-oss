import { exportedResponseHeaders } from '../services/output-response.js';
import { isOutputRequest } from './output-request.js';
export { isOutputRequest } from './output-request.js';
import type { MiddlewareHandler } from 'hono';
import { auditEventStatement } from '@line-crm/db';
import type { Env } from '../worker-env.js';

/** 引用符内の改行を行の区切りと誤認せず、CSV の記録数を数える。 */
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

// 単独の予約・書類 route にも同じ保護を適用する。外側は route より前の拒否も含める。
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
      // 各 route の CSV 上限は保つ。stream は明示された件数を使い、ここで全体をメモリへ貯めない。
      const count = status >= 400 ? 0 : metadata?.count ?? (csv ? csvRecordCount(await c.res.clone().text()) : null);
      const staff = c.get('staff');
      const document = /\/form-files\/[^/]+\/content$/.test(c.req.path);
      const accounts = [...new Set(metadata?.accountIds ?? [])];
      const scope = accounts.length ? accounts : [metadata?.accountId ?? c.req.query('account_id') ?? c.req.query('lineAccountId') ?? staff.assignedLineAccountId ?? null];
      // 共有出力は店舗ごとに1件記録し、監査 JSON の安全上限で店舗一覧を欠落させない。識別子と件数だけを残す。
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
        const headers = exportedResponseHeaders(staff.id, c.res.headers.get('Content-Disposition'));
        for (const [name, value] of Object.entries(headers)) c.header(name, value);
        // Keep the bytes unchanged: CSV imports have no comment-row syntax.
      }
    }
  }
};
