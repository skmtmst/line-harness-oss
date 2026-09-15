import type { Context, MiddlewareHandler } from 'hono';
import { getPlatformAdminByStaffId } from '@line-crm/db';
import type { Env } from '../index.js';
import { DEFAULT_TENANT_ID } from '../lib/tenant.js';
import { dbFor } from '../services/db-router.js';

/**
 * 運営マスター（★V6 37）の門番。
 *
 * 判定は platform_admins に登録され、かつ有効であること。役割（owner/admin）や
 * 所属する統括とは別の軸で見る。
 *
 * 移行期間の互換: platform_admins に 1 人も登録されていない間だけ、従来の
 * 「既定の統括のオーナー」を運営マスターとみなす。3 名を登録して動作を確認したら、
 * この互換は外す（要件 §6-2「新しい判定を足す → 登録 → 確認 → 旧判定を外す」）。
 */

export async function isPlatformAdmin(c: Context<Env>): Promise<boolean> {
  const staff = c.get('staff');
  if (!staff) return false;
  if (staff.id === 'env-owner') return false;
  const db = dbFor(c.env);
  const admin = await getPlatformAdminByStaffId(db, staff.id);
  if (admin) return true;
  return legacyDefaultTenantOwner(c);
}

/** 互換判定。platform_admins が空のときだけ真になりうる。 */
export async function legacyDefaultTenantOwner(c: Context<Env>): Promise<boolean> {
  const staff = c.get('staff');
  if (!staff) return false;
  if (staff.role !== 'owner' || staff.readOnly) return false;
  if ((staff.tenantId ?? DEFAULT_TENANT_ID) !== DEFAULT_TENANT_ID) return false;
  const row = await dbFor(c.env)
    .prepare('SELECT COUNT(*) AS count FROM platform_admins WHERE is_active = 1')
    .first<{ count: number }>();
  return (row?.count ?? 0) === 0;
}

export function platformForbidden(c: Context<Env>) {
  return c.json({ success: false, error: '運営コンソールを使う権限がありません' }, 403);
}

/** GET も含めて運営マスターだけを通す。 */
export function requirePlatformAdmin(): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (!(await isPlatformAdmin(c))) return platformForbidden(c);
    return next();
  };
}

/** 書き込み系。読み取り専用の権限は役割にかかわらず止める。 */
export function requirePlatformAdminWrite(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const staff = c.get('staff');
    if (!staff || staff.readOnly) {
      return c.json({ success: false, error: '閲覧のみの権限では、この操作はできません' }, 403);
    }
    if (!(await isPlatformAdmin(c))) return platformForbidden(c);
    return next();
  };
}
