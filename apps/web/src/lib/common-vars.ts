/**
 * 共通情報の画面で共通に使う言い換え。
 *
 * 一覧・登録・編集の3画面で同じ呼び名を出す必要がある。page.tsx から
 * 名前付きで持ち出すと、画面ファイルが他の画面の部品置き場になるので、
 * ここに置く。
 */

/**
 * 種別の呼び名。
 *
 * 保存できる種別は text / url / image / number の4つ（common_vars の
 * CHECK 制約）。Lステップの「標準・数値・長文・年月日」とは中身が違うので、
 * 「標準」だけ名前を合わせ、残りは実際に保存できるものの名前を出す。
 */
export const VAR_TYPE_LABELS: Record<string, string> = {
  text: '標準',
  url: 'URL',
  image: '画像',
  number: '数値',
}

/** 「2026-08-26T10:00」→「2026/08/26(水) 10:00」。列に収まる長さにする。 */
export function formatStamp(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value)
  if (!match) return value
  const [, y, m, d, hh, mm] = match
  const week = ['日', '月', '火', '水', '木', '金', '土'][
    new Date(Number(y), Number(m) - 1, Number(d)).getDay()
  ]
  return `${y}/${m}/${d}(${week})${hh ? ` ${hh}:${mm}` : ''}`
}
