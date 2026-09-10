import { Hono } from 'hono';
import type { Env } from '../index.js';
import { relayAiLoopReport, type AiLoopReport } from '../services/ai-loop-slack-report.js';
import { verifySupportRelay } from '../services/support-relay.js';

const MAX_BODY_BYTES = 8 * 1024;
const ALLOWED_KEYS = new Set([
  'version', 'eventId', 'taskId', 'repository', 'title', 'commander', 'executor',
  'model', 'status', 'summary', 'taskUrl', 'prUrl', 'occurredAt', 'revision',
]);
const GITHUB_URL = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/(?:issues|pull)\/\d+$/;

export const aiLoopSlackReports = new Hono<Env>();

function parseReport(body: string): AiLoopReport | null {
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(body) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (Object.keys(value).some((key) => !ALLOWED_KEYS.has(key))) return null;
  if (
    value.version !== 1 ||
    typeof value.eventId !== 'string' || value.eventId.length < 3 || value.eventId.length > 255 ||
    typeof value.taskId !== 'string' || !/^[A-Za-z0-9._:-]{1,120}$/.test(value.taskId) ||
    typeof value.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository) ||
    typeof value.title !== 'string' || value.title.length < 1 || value.title.length > 120 ||
    (value.commander !== 'codex' && value.commander !== 'claude') ||
    (value.executor !== 'meta' && value.executor !== 'codex') ||
    typeof value.model !== 'string' || value.model.length < 1 || value.model.length > 80 ||
    !['started', 'completed', 'failed', 'approval'].includes(String(value.status)) ||
    typeof value.summary !== 'string' || value.summary.length < 1 || value.summary.length > 500 ||
    typeof value.taskUrl !== 'string' || !GITHUB_URL.test(value.taskUrl) ||
    typeof value.occurredAt !== 'string' || !Number.isFinite(Date.parse(value.occurredAt)) ||
    !Number.isSafeInteger(value.revision) || Number(value.revision) < 0
  ) return null;
  if (value.prUrl != null && (typeof value.prUrl !== 'string' || !GITHUB_URL.test(value.prUrl))) return null;
  return value as AiLoopReport;
}

aiLoopSlackReports.post('/api/integrations/ai-loop/reports', async (c) => {
  const secret = c.env.CODEX_SLACK_RELAY_SECRET_MASATO ?? c.env.CODEX_SLACK_RELAY_SECRET;
  if (!secret || !c.env.SLACK_BOT_TOKEN || !c.env.SLACK_AI_LOOP_CHANNEL_ID) {
    return c.json({ success: false, error: 'AI loop Slack report not configured' }, 503);
  }
  const body = await c.req.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  const verified = await verifySupportRelay(
    secret,
    c.req.header('x-nen-timestamp'),
    c.req.header('x-nen-signature'),
    body,
  );
  if (!verified) return c.json({ success: false, error: 'Invalid signature' }, 401);
  const report = parseReport(body);
  if (!report) return c.json({ success: false, error: 'Invalid report payload' }, 400);

  try {
    const result = await relayAiLoopReport(c.env, report);
    return c.json({ success: true, ...result });
  } catch (error) {
    console.error(JSON.stringify({ event: 'ai_loop_slack_report_failed', eventId: report.eventId, error: String(error) }));
    return c.json({ success: false, error: 'Slack report failed' }, 502);
  }
});
