import type { MiddlewareHandler } from 'hono';
import type { Env } from '../index.js';
import type { StaffRole } from './auth.js';

/**
 * 役割による門番。
 *
 * 更新の可否と閲覧の可否は別の軸で見る:
 *   - 更新（GET 以外）は authMiddleware が readOnly で一律に止める
 *   - ここでは「その役割に許された操作か」だけを見る
 *
 * GET を役割で絞りたい場合もここを使う。読み取り専用の人まで止めたい GET は
 * denyReadOnly と併用する（鍵情報の一覧など）。
 */
export function requireRole(...allowed: StaffRole[]): MiddlewareHandler<Env> {
  return async (c, next) => {
    const staff = c.get('staff');
    if (!staff || !allowed.includes(staff.role)) {
      return c.json(
        { success: false, error: `この操作には${roleLabel(allowed[0])}権限が必要です` },
        403,
      );
    }
    return next();
  };
}

/**
 * 読み取り専用の人を、GET であっても止める。
 *
 * 通常、閲覧は役割だけで判断する。ただし鍵情報（APIキーなど）は
 * 「見えること自体が権限」なので、閲覧のみの人には役割にかかわらず
 * 見せない。requireRole と重ねて使う。
 */
export function denyReadOnly(): MiddlewareHandler<Env> {
  return async (c, next) => {
    const staff = c.get('staff');
    if (!staff || staff.readOnly) {
      return c.json(
        { success: false, error: '閲覧のみの権限では、この情報は表示できません' },
        403,
      );
    }
    return next();
  };
}

function roleLabel(role: StaffRole | undefined): string {
  switch (role) {
    case 'owner':
      return 'オーナー';
    case 'admin':
      return '管理者';
    case 'staff':
      return 'スタッフ';
    default:
      return '相応の';
  }
}
