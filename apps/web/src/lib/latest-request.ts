/*
 * 画面の条件が変わったあとに届いた古い応答を捨てるための世代カウンタ。
 *
 * アカウント切替・条件変更・連打で、前の要求の応答が新しい状態の上に
 * 乗ると、画面には今の条件と合わない一覧・人数が残る（ATTR-01/10/12）。
 * 要求ごとに `begin()` で印を取り、応答が届いた時点で `current()` へ
 * 渡して照合する。条件が変わるたびに `invalidate()` を呼ぶと、
 * 飛んでいる要求はすべて「古い」扱いになる。
 *
 * React に依らない形にしてあるのは、画面ごとに似たコードを書かせない
 * ためと、照合の約束をコンポーネントなしで試験するため。
 */
export interface ResponseGate {
  /** 新しい要求を開始する。返す印を応答処理へ持たせる。 */
  begin(): number
  /** その印の要求がまだ最新か。条件変更・後続要求があれば false。 */
  current(token: number): boolean
  /** 条件やアカウントが変わった。進行中の要求をすべて古い扱いにする。 */
  invalidate(): void
}

export function createResponseGate(): ResponseGate {
  let generation = 0
  return {
    begin: () => ++generation,
    current: (token) => token === generation,
    invalidate: () => { generation += 1 },
  }
}
