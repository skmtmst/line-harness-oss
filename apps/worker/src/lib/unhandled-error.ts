import type { Context, ErrorHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { createInvocationContext, currentInvocation, logger, runWithInvocation } from '@line-crm/shared/server';
import type { Env } from '../worker-env.js';
import { reportHarnessErrorToSlack } from '../services/codex-slack-relay.js';

/** 既存の案内と復旧用データを保ったまま、予期しない失敗を共通処理へ渡す。 */
export class UnexpectedRouteError extends HTTPException {
  constructor(c: Context, body: Record<string, unknown>) {
    super(500, { res: c.json(body, 500) });
  }
}

/**
 * 障害の識別番号を共通の依頼番号へ接続する。入力や例外の自由文は記録しない。
 */
export const unhandledWorkerError: ErrorHandler<Env> = (error, c) => {
  const context = currentInvocation() ?? createInvocationContext('http');
  return runWithInvocation(context, async () => {
    const incidentId = context.requestId;
    const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(c.req.method) ? c.req.method : 'OTHER';
    const route = `${method} ${c.req.routePath || '(unmatched)'}`;
    logger.error('unhandled_worker_error');
    const report = reportHarnessErrorToSlack(c.env, {
      source: 'worker', message: 'unhandled_worker_error', path: route, incidentId,
    }).catch(() => { logger.error("worker.report_error_to_slack_failed"); });
    try { c.executionCtx.waitUntil(report); } catch { void report; }
    if (error instanceof UnexpectedRouteError) {
      const response = error.getResponse();
      const body = await response.json<Record<string, unknown>>();
      return new Response(JSON.stringify({ ...body, incidentId }), { status: 500, headers: response.headers });
    }
    return c.json({ success: false, error: 'Internal Server Error', incidentId }, 500);
  });
};
