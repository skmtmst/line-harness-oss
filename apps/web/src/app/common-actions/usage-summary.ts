/** 利用先の種類。増えたらここへ足す。 */
const CONSUMER_LABELS: Record<string, string> = {
  scenario: 'シナリオ',
  automation: 'オートメーション',
  auto_reply: '自動応答',
  broadcast: '一斉配信',
  reminder: 'リマインダ',
  form: '回答フォーム',
  rich_menu: 'リッチメニュー',
  entry_route: '流入リンク',
}

type BindingForSummary = {
  consumerType: string
}

type BindingForCount = {
  runningCount?: number | null
  waitingCount?: number | null
  olderRunningCount?: number | null
  olderWaitingCount?: number | null
}

/*
 * 監査 R469: 実行中・待機中の合計。1か所でも未取得（null）があれば
 * 合計は確定しないので null を返し、画面は「—」で出す。
 * 未取得を 0 に混ぜて「処理なし」に見せない。利用先が無いときは 0。
 */
export function sumBindingCount(
  bindings: BindingForCount[],
  key: 'runningCount' | 'waitingCount' | 'olderRunningCount' | 'olderWaitingCount',
): number | null {
  let sum = 0
  for (const binding of bindings) {
    const value = binding[key]
    if (value === null || value === undefined) return null
    sum += value
  }
  return sum
}

/**
 * 「使われている場所」の副題。設計は件数だけでなく **何機能からか** を出す。
 *
 * **どの機能から呼ばれているかが分かると、直す前に見る場所が決まる。**
 * 「38か所」だけでは、1つの機能に集中しているのか広く使われているのかが
 * 読めない。
 *
 * 決めごと：
 * - **利用先が無いときは機能数を出さない。**0を「0機能から」と書くより、
 *   「まだどこからも呼ばれていません」のほうが読める
 * - **知らない種類が来ても落とさない。**そのまま数に入れ、名前は出さない
 *   （型に無い値が来たときに、件数まで嘘になるのを避ける）
 */
export function usageSummaryDetail(bindings: BindingForSummary[]): string {
  if (bindings.length === 0) return 'まだどこからも呼ばれていません'
  const kinds = new Set(bindings.map((b) => b.consumerType).filter(Boolean))
  if (kinds.size === 0) return '版を固定した利用先'
  const names = [...kinds]
    .map((kind) => CONSUMER_LABELS[kind])
    .filter((name): name is string => Boolean(name))
  const from = names.length === kinds.size ? `（${names.join('・')}）` : ''
  return `版を固定した利用先・${kinds.size}機能から${from}`
}
