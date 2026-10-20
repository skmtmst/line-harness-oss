import type { MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';
import { dangerousOperationPurpose } from './sensitive-operation-purpose.js';
export { dangerousOperationPurpose } from './sensitive-operation-purpose.js';
import { sensitiveStepUpSatisfied, stepUpRequiredResponse } from '../lib/step-up.js';

export const sensitiveOperationMiddleware: MiddlewareHandler<Env> = async (c, next) => {
  let purpose = dangerousOperationPurpose(c.req.method, c.req.path, c.req.query('format'));
  // Scheduling can happen through create/update as well as a named send route.
  if (!purpose && ['POST','PUT','PATCH'].includes(c.req.method) && /^\/api\/(?:hq\/)?broadcasts(?:\/[^/]+)?$/.test(c.req.path)) {
    const body: unknown = await c.req.raw.clone().json().catch(() => null);
    if (body && typeof body === 'object' && 'scheduledAt' in body && body.scheduledAt
      && (!('saveAsDraft' in body) || body.saveAsDraft !== true)) purpose = 'broadcast.send';
  }
  if (!purpose || !c.get('staff')) return next();
  if (c.get('staff').readOnly || (c.get('impersonation') && purpose !== 'ops.impersonation')) return c.json({ success: false, error: 'この操作は本人の編集権限が必要です' }, 403);
  if (!await sensitiveStepUpSatisfied(c, purpose)) return stepUpRequiredResponse(c, 'この操作の前に、もう一度本人確認してください');
  return next();
};
