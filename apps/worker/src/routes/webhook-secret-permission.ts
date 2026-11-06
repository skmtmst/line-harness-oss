import type { MiddlewareHandler } from 'hono';
import type { Env } from '../worker-env.js';

/** 通常編集を任された管理者にも、既存の合言葉の差し替えは許可しない。 */
export const requireWebhookSecretOwner: MiddlewareHandler<Env> = async (c, next) => {
  const body: unknown = await c.req.raw.clone().json().catch(() => null);
  if (body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, 'secret')
      && c.get('staff')?.role !== 'owner') {
    return c.json({ success: false, error: '合言葉の変更はオーナーだけができます' }, 403);
  }
  return next();
};
