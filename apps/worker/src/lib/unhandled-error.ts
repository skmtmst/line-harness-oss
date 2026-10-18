import type { ErrorHandler } from 'hono';
import type { Env } from '../index.js';
import { reportHarnessErrorToSlack } from '../services/codex-slack-relay.js';

/** One server-generated incident ID connects the response, safe log and notification. */
export const unhandledWorkerError: ErrorHandler<Env> = (_error, c) => {
  const incidentId = crypto.randomUUID();
  const method = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(c.req.method) ? c.req.method : 'OTHER';
  const route = `${method} ${c.req.routePath || '(unmatched)'}`;
  console.error(JSON.stringify({ code: 'unhandled_worker_error', route, incidentId }));
  const reportPromise = reportHarnessErrorToSlack(c.env, {
    source: 'worker', message: 'unhandled_worker_error', path: route, incidentId,
  }).catch(() => {
    console.error(JSON.stringify({ code: 'unhandled_worker_error_slack_report_failed', incidentId }));
  });
  try { c.executionCtx.waitUntil(reportPromise); } catch { void reportPromise; }
  return c.json({ success: false, error: 'Internal Server Error', incidentId }, 500);
};
