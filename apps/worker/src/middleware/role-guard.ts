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

/**
 * 取り消せない操作に、明示的な確認を要求する。
 *
 * 一斉配信の本送信のように「押したら友だち全員に届き、取り消せない」操作は、
 * 権限があるだけでは足りない。画面の確認ダイアログは押し間違いを減らすが、
 * URL を直接叩けば素通りするので、サーバー側でも意思表示を求める。
 *
 * 呼び出し側は `X-Confirm-Irreversible: <合言葉>` を送る。合言葉は操作ごとに
 * 決め打ちで、たまたま付いていた、では通らないようにする。
 */
export function requireIrreversibleConfirmation(token: string): MiddlewareHandler<Env> {
  return async (c, next) => {
    if (c.req.header('x-confirm-irreversible') !== token) {
      return c.json(
        {
          success: false,
          error: 'この操作は取り消せません。画面の確認手順を経てから実行してください。',
          code: 'CONFIRMATION_REQUIRED',
        },
        428,
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
