import type { Context } from 'hono';
import type { Env } from '../index.js';
import { restaurantTestEnabled } from '../lib/environment-features.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { dbFor } from './db-router.js';

/**
 * 統括（テナント）が指定の機能パックを持っているか。
 *
 * `tenants.feature_packs` はこれまで運営コンソールの表示専用ラベルだったが、
 * 統括単位で飲食店機能を実効的にオン/オフするため、ここで読む側を作る。
 */
export async function tenantHasFeaturePack(
  db: D1Database,
  tenantId: string,
  pack: string,
): Promise<boolean> {
  const row = await db
    .prepare('SELECT feature_packs FROM tenants WHERE id = ?')
    .bind(tenantId)
    .first<{ feature_packs: string }>();
  if (!row) return false;
  try {
    const packs = JSON.parse(row.feature_packs) as unknown;
    return Array.isArray(packs) && packs.includes(pack);
  } catch {
    return false;
  }
}

/**
 * 飲食店機能（restaurant-test）が、この統括に対して実際に有効か。
 *
 * 環境のキルスイッチ（`RESTAURANT_TEST_ENABLED`、本番は常にfalse）が
 * 最上位で、そのうえで統括に `restaurant` パックが付いている場合だけ有効。
 * どちらか片方だけでは有効にならない。
 */
export async function restaurantEffectivelyEnabledForTenant(
  c: Context<Env>,
  tenantId?: string,
): Promise<boolean> {
  if (!restaurantTestEnabled(c.env)) return false;
  const id = tenantId ?? c.get('staff')?.tenantId ?? DEFAULT_TENANT_ID;
  return tenantHasFeaturePack(dbFor(c.env), id, 'restaurant');
}
