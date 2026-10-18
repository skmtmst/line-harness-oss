import type { ErrorHandler } from 'hono';
import { createInvocationContext, currentInvocation, logger, runWithInvocation } from '@line-crm/shared/server';
import type { Env } from '../worker-env.js';
import { reportHarnessErrorToSlack } from '../services/codex-slack-relay.js';

/** S01の事故番号を共通の依頼番号へ接続する。入力や例外の自由文は記録しない。 */
export const unhandledWorkerError: ErrorHandler<Env> = (_error, c) => {
  const context = currentInvocation() ?? createInvocationContext('http');
  return runWithInvocation(context, () => {
    const incidentId = context.requestId;
    const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(c.req.method) ? c.req.method : 'OTHER';
    const route = `${method} ${c.req.routePath || '(unmatched)'}`;
    logger.error('unhandled_worker_error');
    const report = reportHarnessErrorToSlack(c.env, {
      source: 'worker', message: 'unhandled_worker_error', path: route, incidentId,
    }).catch(() => { logger.error('unhandled_worker_error_slack_report_failed'); });
    try { c.executionCtx.waitUntil(report); } catch { void report; }
    return c.json({ success: false, error: 'Internal Server Error', incidentId }, 500);
  });
};
