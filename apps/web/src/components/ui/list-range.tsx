import React from 'react'

/**
 * 一覧の件数表示（監査6 #667）。
 *
 * 画面ごとに「1件中1〜1件」「0〜0件 / 全0件」「N個中」「Nつのうち」
 * 「を表示しています」とバラバラだった書き方を、
 * 「N件中 X〜Y件を表示」の1形へ寄せる。ページ送り（前へ/次へ）の
 * ボタンは含めず、呼び出し側が共通 Pagination などを横に並べる。
 *
 * - 何か1件でもあるとき: `N件中 X〜Y件を表示`
 * - 0件のとき: `0件`（「0〜0件」は読めないため出さない。
 *   「条件に合うものはありません」の空状態は呼び出し側の仕事）
 * - 数字は3桁区切り。長い管理画面の件数でも読み違えないように。
 * - 名詞の前置きは `label` に任せる（例: label="記録" → `記録 N件中 …`）。
 *   「件」以外の助数（個・つ）は使わない。
 */
export default function ListRange({
  total,
  first,
  last,
  label,
  className,
}: {
  /** 絞り込み後の総件数（サーバが数えた値）。 */
  total: number
  /** 表示中の先頭の番号（1始まり。0件のときは 0 を渡す）。 */
  first: number
  /** 表示中の末尾の番号。 */
  last: number
  /** 件名の前置き。「記録」「成果地点」など。不要な画面は省略する。 */
  label?: string
  className?: string
}) {
  const t = Math.max(0, Math.floor(total))
  return (
    <span className={['text-ink-faint text-xs', className].filter(Boolean).join(' ')}>
      {label ? `${label} ` : null}
      {t === 0
        ? '0件'
        : `${t.toLocaleString('ja-JP')}件中 ${Math.max(0, first).toLocaleString('ja-JP')}〜${Math.max(0, last).toLocaleString('ja-JP')}件を表示`}
    </span>
  )
}
