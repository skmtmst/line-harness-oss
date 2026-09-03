/**
 * LINEアカウントの乗り換え・引き継ぎ（設計 ★V6 33-4 `nx3XW`）。
 *
 * **口がまだ無い**（台帳 #133）。この画面は流れを描いて止める。
 * 人数は作らない。
 */

/** 設計の 5 段。 */
export const HANDOVER_STEPS = [
  { order: 1, label: '引き継ぎコードを出す' },
  { order: 2, label: '受け取り先で読む' },
  { order: 3, label: '事前確認' },
  { order: 4, label: '競合の判断' },
  { order: 5, label: '本実行と照合' },
] as const

/**
 * 事前確認の 4 区分（設計の言葉）。
 *
 * **合計が元の友だち数と必ず合う**こと。合わないと、どこかの人が
 * 消えたように見える。口ができたら、この形で受ける。
 */
export const MATCH_BUCKETS = [
  { key: 'auto', label: '自動で一致', note: 'そのまま引き継げます' },
  { key: 'review', label: '要確認', note: '人が決めてください' },
  { key: 'unmatched', label: '一致しない', note: '引き継げません' },
  { key: 'lookalike', label: '別人の可能性', note: '名前と画像だけ似ています' },
] as const

export type MatchBucketKey = (typeof MATCH_BUCKETS)[number]['key']

export type MatchCounts = Record<MatchBucketKey, number>

/**
 * 4 区分の合計が、元の友だち数と合っているか。
 *
 * **合わない結果を画面に出さない。** 出すと、運用者は「どこかの人が
 * 消えた」と読む。合わないときは数を出さず、取れていないと書く。
 */
export function totalsMatch(counts: MatchCounts | null, sourceTotal: number | null): boolean {
  if (!counts || sourceTotal === null) return false
  const sum = MATCH_BUCKETS.reduce((n, b) => n + (counts[b.key] ?? 0), 0)
  return sum === sourceTotal
}

/**
 * プロバイダーが違うときの断り。
 *
 * **同じ人でも別のIDになる。** LINE に変換するしくみが無いので、
 * 自動ではつなげない。これを書かずに進めると、事前確認で
 * 「一致しない」が大量に出た理由が分からない。
 */
export const DIFFERENT_PROVIDER_NOTE =
  'プロバイダーが違うので、友だちのIDは自動でつなげません。同じ人でも別のIDになります。'
  + 'LINEに変換するしくみがないので、対応表を取り込むか、1件ずつ手で結びつけてください。'
  + '利用目的・規約・同意の確認も要ります。'
