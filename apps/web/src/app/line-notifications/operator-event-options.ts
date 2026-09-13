/*
 * 運用者へのお知らせを自動で出せる「きっかけ」の一覧。画面側の唯一の出どころ。
 *
 * **value は Worker の登録簿(apps/worker/src/services/operator-notification-
 * registry.ts)と1件ずつ一致させる。**登録簿に無い値は、公開できても自動発火
 * しない(dispatch が unknown_event_type で断る)。つまり運用者から見ると
 * 「公開したのに届かない」になる。N-327 (#663) が直したのはそこで、
 * **画面の語彙がずれると同じ穴がそのまま開く。**
 *
 * ずれたら落ちるように、突き合わせの契約試験を
 * apps/worker/src/services/operator-notification-screen-contract.test.ts
 * に置いてある。片方だけに足すとそこが赤くなる。
 *
 * ここを作る前は、作成画面と一覧画面が同じ語彙を別々に持っていて、
 * 片方だけ直すと一覧のラベルが消える作りだった。**出どころを1つにしてある。**
 *
 * 以前あった friend_add / cv_fire / incoming_webhook.custom は、登録簿にも
 * 発火する producer にも無かったため外した(選べるのに動かない状態だった)。
 * 動かすには producer を足す必要があり、別票で扱う。
 */
export type OperatorEventOption = {
  value: string
  label: string
}

export const OPERATOR_EVENT_OPTIONS: readonly OperatorEventOption[] = [
  { value: 'booking_created', label: '予約が入ったとき' },
  { value: 'broadcast_completed', label: '一斉配信が終わったとき' },
  { value: 'form_submitted', label: 'フォームに回答があったとき' },
  { value: 'ec_order_received', label: '注文を受け取ったとき' },
]

/** 作成画面の初期選択。一覧の並びの先頭にそろえる。 */
export const DEFAULT_OPERATOR_EVENT_TYPE = OPERATOR_EVENT_OPTIONS[0]!.value

/**
 * 保存済みルールのきっかけを運用者の言葉にする。
 *
 * 一覧に無い値は、登録簿から外された古いルールか、API を直接叩いて作られた
 * もの。**どちらも自動発火しないので、ラベルを作らずに注意を出す。**
 */
export function operatorEventLabel(eventType: string): string {
  return OPERATOR_EVENT_OPTIONS.find((option) => option.value === eventType)?.label
    ?? '接続先を確認してください'
}
