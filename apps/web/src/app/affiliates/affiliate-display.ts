/**
 * 成果・アフィリエイト画面の言葉づかい（設計 `PouPn` / `n5VVTb`）。
 *
 * **内部IDとデータベースの語は運用者の画面に出さない。**
 *
 * 置き換え表をJSXへ直に書くと、直したそばから戻る。`クリック (ref_tracking)`
 * は一度直したが、その修正（PR #563）が取り込まれないまま `codex/development`
 * が先へ進み、画面には内部名が出たままになった。**JSXの中の文字列は、誰も
 * 見張っていない。** ここへ集めて契約テストで固定する。
 */

/**
 * 名前が取れないときの言い方。
 *
 * **IDの断片で代用しない。** `friend-4…` は運用者にとって名前ではないし、
 * 途中で切れている以上、識別にも使えない。何も分からない断片を出すより、
 * 「取れなかった」と書くほうが正確に伝わる。
 */
export const NAME_UNAVAILABLE = '名前を取得できませんでした'

/** 友だち・紹介者の名前。`null` は「名無し」ではなく「取れなかった」。 */
export function personNameText(name: string | null | undefined): string {
  const trimmed = name?.trim()
  return trimmed ? trimmed : NAME_UNAVAILABLE
}

/**
 * 集計カードの見出し。
 *
 * `ref_tracking` は流入計測を貯めている表の名前で、運用者には通じない。
 * どの表から数えたかは画面の関心ではない。
 */
export const CLICK_SUMMARY_LABEL = 'クリック'

/**
 * リンクの合言葉の列見出し。
 *
 * 値そのもの（`north` など）は運用者が決めてURLに出す符号なので出してよい。
 * 出してはいけないのは列名の `ref_code` のほう。
 */
export const LINK_CODE_HEADING = 'リンクコード'

/**
 * 同じ人が二重に数えられている疑い。
 *
 * `identity_key` はWorker側の突き合わせ用の列名。しかも見出しに `uppercase`
 * が効いていたので、画面には `IDENTITY_KEY` と大文字で出ていた。
 */
export const DUPLICATE_FLAG_TITLE = '同じ友だちの重複'

/** 重複の見出し。件数は実値なので `0件` と混ぜない（0件なら節ごと出さない）。 */
export function duplicateFlagHeading(count: number): string {
  return `${DUPLICATE_FLAG_TITLE}（${count.toLocaleString('ja-JP')}件）`
}

/**
 * 重複の札に出す名前。
 *
 * 重複の一覧はIDしか返さないので、読み込み済みのジャーニーから名前を引く。
 * **引けなければ作らない。** まだ読み込んでいないページの友だちは
 * `NAME_UNAVAILABLE` になる。下のジャーニー表でも同じ行が目立つ色になるので、
 * 名前を推測してまで埋める必要はない。
 */
export function duplicateFriendNameText(
  friendId: string,
  people: ReadonlyArray<{ friendId: string; displayName: string | null }>,
): string {
  return personNameText(people.find((person) => person.friendId === friendId)?.displayName)
}

/**
 * 同じ注文・同じ成果地点へ2件以上の成果が立った疑い（IDEA-16）。
 *
 * 同じ注文が別の出来事IDで届き直すと、冪等の札が違うので別の成果が立つ。
 * 自動で消さず、注文番号を根拠に人が確認する。`conversion_events` の列名や
 * JSONのキー名は画面に出さない。
 */
export const ORDER_DUPLICATE_TITLE = '同じ注文の重複'

/**
 * 成果の起こりになった注文の最新状態（IDEA-16）。
 * `normalized_status` のコードは出さない。返金・取消済みの注文を成果として
 * 認めないための確認材料。
 */
export const APPROVAL_ORDER_STATUS_TEXT: Record<'current' | 'refunded' | 'cancelled', string> = {
  current: '通常の注文',
  refunded: '返金済み',
  cancelled: '取り消し済み',
}

/**
 * 支払い確定の行の状態（IDEA-16）。`affiliate_reward_entries.status` の
 * コードは画面に出さない。行が無い成果は「まだ確定していない」と見せ、
 * この表のどれにも当てはめない。
 */
export const REWARD_ENTRY_STATUS_TEXT: Record<string, string> = {
  pending: '確定待ち',
  approved: '承認済み',
  held: '保留中',
  payable: '支払い可能',
  settled: '締めに入った',
  paid: '支払い済み',
  reversed: '取り消された',
}

/** 締めの状態（IDEA-16）。`affiliate_settlements.state` のコードは出さない。 */
export const SETTLEMENT_STATE_TEXT: Record<string, string> = {
  preview: '締めの確認中',
  closed: '締め済み',
  exported: '書き出し済み',
  paid: '支払い済み',
  partial: '一部だけ支払い済み',
  failed: '失敗',
}

/** 支払いCSV束の状態（IDEA-16）。`affiliate_payout_batches.state` のコードは出さない。 */
export const PAYOUT_BATCH_STATE_TEXT: Record<string, string> = {
  created: 'CSVを作成した',
  approved: 'CSVを確認した',
  exported: 'CSVを書き出した',
  imported: '支払い結果を取り込んだ',
}

/** 取り込んだ支払い結果（IDEA-16）。`affiliate_payout_results.result` のコードは出さない。 */
export const PAYOUT_RESULT_TEXT: Record<string, string> = {
  paid: '支払い完了',
  failed: '支払い失敗',
  returned: '支払いが戻った',
}

/**
 * まとめて承認へ入れず人が見る成果の理由（IDEA-16）。
 *
 * 同じ友だちの重複（従来の札）に加えて、同じ注文の重複候補と、元の注文が
 * 返金・取り消し済みの成果を確認対象にする。理由は根拠と一緒に画面へ出す。
 * 理由が1つでもあれば、行を選ぶ・まとめて承認する対象から外す。
 */
export function approvalReviewReasons(item: {
  duplicateFlag: boolean
  sameOrderDuplicate?: boolean
  orderStatus?: 'current' | 'refunded' | 'cancelled' | null
}): string[] {
  const reasons: string[] = []
  if (item.duplicateFlag) reasons.push(DUPLICATE_FLAG_TITLE)
  if (item.sameOrderDuplicate) reasons.push(ORDER_DUPLICATE_TITLE)
  if (item.orderStatus === 'refunded' || item.orderStatus === 'cancelled') {
    reasons.push(`注文は${APPROVAL_ORDER_STATUS_TEXT[item.orderStatus]}`)
  }
  return reasons
}
