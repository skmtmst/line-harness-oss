import type { Context } from 'hono';
import type { Env } from '../worker-env.js';

export const ACCOUNT_KEYS = ['account_id', 'accountId', 'line_account_id', 'lineAccountId'] as const;

export async function bodyAccountIds(c: Context<Env>): Promise<string[]> {
  if (!c.req.header('content-type')?.toLowerCase().includes('application/json')) return [];
  try {
    const body = await c.req.raw.clone().json() as Record<string, unknown>;
    for (const key of ACCOUNT_KEYS) {
      const value = body[key];
      if (typeof value === 'string' && value.trim()) return [value.trim()];
    }
    for (const key of ['accountIds', 'lineAccountIds'] as const) {
      const values = body[key];
      if (Array.isArray(values)) {
        return [...new Set(values.filter(
          (value): value is string => typeof value === 'string' && Boolean(value.trim()),
        ).map((value) => value.trim()))];
      }
    }
  } catch {
    // 入力契約のエラーは route handler に任せる。
  }
  return [];
}
