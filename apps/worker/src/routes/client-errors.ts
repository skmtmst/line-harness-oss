import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
import { reportHarnessErrorToSlack } from '../services/codex-slack-relay.js';

const MAX_BODY_BYTES = 32 * 1024;

export const clientErrors = new Hono<Env>();

clientErrors.post('/api/client-errors', requireRole('owner', 'admin', 'staff'), async (c) => {
  const rawBody = await c.req.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return c.json({ success: false, error: 'Payload too large' }, 413);
  }
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return c.json({ success: false, error: 'Invalid payload' }, 400);
  }
  if (typeof value.message !== 'string' || value.message.trim().length < 1) {
    return c.json({ success: false, error: 'message is required' }, 400);
  }

  try {
    await reportHarnessErrorToSlack(c.env, {
      source: 'admin',
      message: value.message.slice(0, 2_000),
      path: typeof value.path === 'string' ? value.path.slice(0, 500) : undefined,
      stack: typeof value.stack === 'string' ? value.stack.slice(0, 8_000) : undefined,
      occurredAt: typeof value.occurredAt === 'string' && Number.isFinite(Date.parse(value.occurredAt))
        ? value.occurredAt
        : undefined,
    });
  } catch (error) {
    console.error(JSON.stringify({ event: 'client_error_slack_report_failed', error: String(error) }));
  }
  return c.json({ success: true }, 202);
});
