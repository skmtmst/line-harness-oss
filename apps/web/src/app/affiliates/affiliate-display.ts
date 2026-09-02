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
