/**
 * 管理画面の見た目は常に V8（2026-10-09 オーナー決定「全画面を V8 に固定」）。
 *
 * 環境変数（NEXT_PUBLIC_ADMIN_THEME）・このブラウザに保存した選択（lh-admin-theme）・
 * 設定画面の「画面の見た目」は、もう見た目を変えない。本番・検証・開発の画面は v8 だけ。
 *
 * 例外は試験（vitest）の中だけ。古い v7 の画面のコードは機能ごとに書き換えるまで
 * 使われないまま残してあり、その試験が v7 を描けるように、試験の中でだけ
 * 「環境変数 NEXT_PUBLIC_ADMIN_THEME」と「<html data-theme>」での選択を残す。
 * `process.env.NODE_ENV` は書き出し時に 'production'（next dev では 'development'）へ
 * 置き換わるので、ブラウザに届く画面からこの口は開かない。
 */
export function adminThemeTestOnlyChoice(): boolean {
  return process.env.NODE_ENV === 'test'
}

/** 最初の描画の見た目。layout.tsx の `<html data-theme>` と use-admin-theme.ts の初期状態が同じ値を使う。 */
export function adminThemeDefault(): 'v7' | 'v8' {
  if (!adminThemeTestOnlyChoice()) return 'v8'
  return process.env.NEXT_PUBLIC_ADMIN_THEME === 'v8' ? 'v8' : 'v7'
}

/** V8 固定か。試験の中で既定を v7 にしたときだけ false（<html data-theme> の選択を読む）。 */
export function adminThemeLocked(): boolean {
  return adminThemeDefault() === 'v8'
}
