import { bad } from '../../services/event-input-error.js';
import { type Context } from 'hono';
import type { Env } from '../../worker-env.js';
import { verifyCallerLineUserId } from '../../services/liff-auth.js';
import { resolveAccountIdFromLiff } from './input.js';

export async function eventWaitlistCaller(c: Context<Env>) {
  const lineAccountId = await resolveAccountIdFromLiff(c);
  if (!lineAccountId) return bad(c, 'liff_account_resolution_failed', 400, []);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env, lineAccountId);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  return { lineAccountId, callerLineUserId };
}
