/**
 * 管理画面の見た目テーマの「環境の既定」。
 *
 * app/layout.tsx（`<html data-theme>` の初期値）と lib/use-admin-theme.ts
 * （React の初期状態）が同じ値を使うためにここへ置く。片方だけ v8 にすると、
 * HTML は V8 なのに React は最初に v7 の旧画面を選び、描き直しでちらつく。
 *
 * `process.env.NEXT_PUBLIC_ADMIN_THEME` は書き出し時に文字へ置き換わるので、
 * サーバの描画とブラウザの最初の描画で必ず同じ値になる（hydration を壊さない）。
 * 試験で環境を差し替えられるよう、定数ではなく関数で読む。
 */
export function adminThemeDefault(): 'v7' | 'v8' {
  return process.env.NEXT_PUBLIC_ADMIN_THEME === 'v8' ? 'v8' : 'v7'
}

/**
 * 既定が v8 の環境（検証環境）は V8 だけにする（2026-10-07 オーナー）。
 * そのブラウザで前に v7 を選んでいても読まない。本番（変数なし）は false。
 */
export function adminThemeLocked(): boolean {
  return adminThemeDefault() === 'v8'
}
