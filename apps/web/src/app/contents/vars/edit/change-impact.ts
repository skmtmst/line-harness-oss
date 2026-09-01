import type { CommonVar } from '@line-crm/shared'

/**
 * 共通情報を「変える前に影響を見る」（設計 `uNBlA` 14-1-B）。
 *
 * **共通情報は1か所直すと、差し込んでいる配信すべてが同時に変わる。**
 * それがこの機能の値打ちで、同時にいちばんの怖さでもある。だから設計は
 * 保存ボタンの前に「影響の要約」と「影響の一覧」を置いている。
 *
 * **いまは、その中身を取る口が無い。** 実装にあるのは
 * `GET /api/common-vars/:id/delete-impact` だけで、これは
 * 「消してよいか」を判定する口である。返すのは `blocksDeletion` と
 * 現在の文（`currentPreview`）で、**変更後の文も、文字数上限の判定も、
 * 「すぐ反映される」かどうかの区別も持っていない**。
 * 使い回すと「削除できるか」の数を「変更の影響」として読ませることになる
 * うえ、編集画面を開いただけで9種類の走査が走る（削除確認では窓を開く
 * まで走らせないようにしてある）。
 *
 * よって **数は作らない**。節だけ設計どおりに置き、値は `—` と
 * 「まだ繋がっていません」で埋める。必要な口は
 * `docs/design-qa/v6-common-var-change-impact-handoff.md` に書いた。
 */

/** 取得元の口が無い値。**実値の0（`0件`）とは別。** */
export const NOT_CONNECTED_VALUE = '—'

/** 未接続の理由。V6の言葉の決まり（未接続／読込中／取得失敗／権限不足）に合わせる。 */
export const NOT_CONNECTED_REASON =
  'まだ繋がっていません。変更の影響を調べる口が接続されると表示されます。'

export interface ImpactCardSpec {
  /** 撮影と試験で指す名前。 */
  key: 'usage' | 'immediate' | 'overflow' | 'sent'
  /** 見出し（設計 13/600）。 */
  title: string
  /** 注記（設計 12/500）。 */
  note: string
}

/**
 * 影響の要約カード4枚（設計 `uNBlA`）。
 *
 * **見出しは残し、数だけ `—` にする。** 見出しごと消すと、何の数が
 * 出るはずだったのかが読めなくなり、口が付いたときに誰も気付かない。
 */
export const IMPACT_CARDS: readonly ImpactCardSpec[] = [
  {
    key: 'usage',
    title: '差し込んでいる場所',
    note: NOT_CONNECTED_REASON,
  },
  {
    key: 'immediate',
    title: 'すぐ反映される設定',
    note: NOT_CONNECTED_REASON,
  },
  {
    key: 'overflow',
    title: '文字数の上限を超える場所',
    note: NOT_CONNECTED_REASON,
  },
  {
    key: 'sent',
    title: '送信済みで変わらない文',
    note: NOT_CONNECTED_REASON,
  },
]

/**
 * 影響の一覧に出す件数（設計 12/600）。
 *
 * **`0件` と書かない。** 「どこにも差し込まれていない」と読まれると、
 * 確かめずに保存されてしまう。
 */
export const IMPACT_LIST_COUNT_TEXT = `${NOT_CONNECTED_VALUE} 件`

/** 影響の一覧の理由。 */
export const IMPACT_LIST_REASON =
  'まだ繋がっていません。変更前後の文を比べる口が接続されると表示されます。'

/**
 * 「CSVで書き出す」が押せない理由（設計 `uNBlA` の右上）。
 *
 * 書き出す中身が影響の一覧そのものなので、一覧の口が無いあいだは
 * 書き出すものが無い。**押せる形で置かない。**
 */
export const CSV_BLOCKED_REASON =
  'まだ繋がっていません。影響の一覧が接続されると、CSVで書き出せます。'

/**
 * 保存を押せるか。
 *
 * **保存の口（`PATCH /api/common-vars/:id`）はある。** 押せないのは
 * 入力が足りないときと、対象のLINEアカウントが決まっていないときだけ。
 */
export function saveBlockedReason(input: {
  item: CommonVar | null
  accountId: string | null
  name: string
  saving: boolean
}): string | null {
  if (!input.item) return 'この共通情報を読み込めていません。'
  if (!input.accountId) return 'LINEアカウントを選択してください。'
  if (!input.name.trim()) return '共通情報名を入力してください。'
  if (input.saving) return '保存しています。'
  return null
}

/**
 * 削除の置き場所。
 *
 * **この画面から直接は消さない。** 以前はここに素の `confirm()` の削除が
 * あったが、使用先を確かめずに `DELETE` を投げるので、使われていれば
 * Worker が 409 を返して「削除に失敗しました」としか出なかった。
 * 使用先を数えて見せる確認は一覧側（設計 `yPkWe` 14-1-C・PR #611）に
 * ある。設計 `uNBlA` の追従バーにも削除は無い。**そちらへ寄せる。**
 */
export const DELETE_MOVED_NOTE =
  '削除は共通情報一覧から行います。差し込んでいる場所を確かめてからでないと消せません。'
