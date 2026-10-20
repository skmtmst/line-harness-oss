
/**
 * 代理ログイン（★37-5）。
 *
 * 運営マスターが契約先（統括）の画面に入るとき、通常の認証で得た本人の
 * 身元はそのままに、「どの統括として見ているか」だけを差し替える。
 *
 * - 既定は閲覧のみ。readOnly を立てて、既存の authMiddleware の
 *   「閲覧のみは更新不可」の判定にそのまま乗せる
 * - 書き込みは理由を入れて切り替えたときだけ readOnly を外す
 * - 運営コンソール自身の API（/api/ops/*）と認証（/api/auth/*）には
 *   差し替えを掛けない。「代理ログインを終える」が閲覧モードでも押せるように
 *
 * 記録（監査・契約先側の履歴）はルート側で行う。ここは身元の差し替えだけ。
 */

export interface ImpersonationContext {
  id: string;
  tenantId: string;
  mode: 'read' | 'write';
  piiRevealed: boolean;
  startedAt: string;
}
