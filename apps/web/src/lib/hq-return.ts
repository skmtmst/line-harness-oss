/**
 * 店の画面から統括へ戻れるか。上の帯の切り替え（「統括に戻る」）と、
 * ★V8 左下の自分のメニュー（「統括に戻る」）が同じ判定を使う。
 *
 * 統括へ戻る口はオーナーと管理者に出す（管理者も統括を開ける。2026-10-07 オーナー）。
 * すでに統括の画面（/hq、V8 では統括の殻の画面も）にいるときは出さない。
 *
 * @param hqShell いまの画面が統括の殻か（V8 では `/accounts/new` も統括）。
 */
export function canReturnToHqFrom(staffRole: string | null | undefined, pathname: string, hqShell: boolean): boolean {
  return (staffRole === 'owner' || staffRole === 'admin') && !pathname.startsWith('/hq') && !hqShell
}
