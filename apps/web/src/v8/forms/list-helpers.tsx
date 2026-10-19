'use client'

/*
 * ★V8 回答フォームの一覧（Pencil「★V8 画面の地図」の回答フォームの行）。
 * 一覧 ・1152 ・閲覧のみ ・アーカイブ・削除の窓 。
 *
 * 動き（呼ぶ API・権限・失敗の扱い・URL の指定）は今までの V8 一覧
 * （app/form-submissions/list-v8.tsx）と同じ。見た目だけを型（ListPage）と部品で組み直した。
 * 動きの一覧は同じ場所の BEHAVIOR.md。
 */
export const VIEWER_NOTE = '閲覧のみで見ています。変える操作はオーナーか管理者に頼んでください。'
