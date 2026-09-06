import type { CommonVarChangeImpact, CommonVarDeleteImpact } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import { STATE_TEXT, notConnectedText } from '@/components/shared/not-connected'
import { placeholderText } from './delete-impact'

/**
 * 共通情報を**変える前**の影響確認（設計 `uNBlA` 14-1-B）。
 *
 * この画面は「値を直して保存する」だけの形になっていた。差し込み先が
 * 何十か所あっても、押した瞬間に全部が変わる。**変える前に、どこが
 * 変わるのかを見せる**のが設計の骨である。
 *
 * いま読める口は使用先台帳（`GET /api/common-vars/:id/delete-impact`）
 * だけである。ここからは「どこで使われているか」「いまどう出ているか」
 * 「送信済みで変わらないもの」が読める。
 *
 * **2026-09-04：変更後の文と文字数の検査もつながった。**
 * `POST /api/common-vars/:id/impact-preview`（PR #773）から、保存後の文・
 * 文字数・上限超えが返る。値を変えていないあいだは使用先台帳だけを読み、
 * 変えた時点で変更前確認へ切り替える。
 *
 * **口が答えられないところは、いまも `—` と理由を出す。** 差し込みの
 * 目印を本文から読み取れない使用先（`previewAvailable: false`）は変更後の
 * 文を作れない。そこを空文字で埋めると「変更後は空になる」と読める。
 */

/** 影響確認の読み込み状態。**実値0と、読めなかったを混ぜない。** */
export type ChangeImpactState = 'loading' | 'ready' | 'error' | 'forbidden'

/** 口がまだ無い節の呼び名。未接続の理由文をここから作る。 */
export const CHANGE_PREVIEW_SOURCE = '変更後の文と文字数の検査'

/** 「変更後の文」の節に出す理由。 */
export function changePreviewNotConnected(): string {
  return notConnectedText(CHANGE_PREVIEW_SOURCE)
}

/** 読み込みに失敗したときの状態。403は「見る権限がありません」と分ける。 */
export function impactStateFromError(err: unknown): ChangeImpactState {
  return err instanceof ApiError && err.status === 403 ? 'forbidden' : 'error'
}

/** 数が出ないときに、その理由を運用者の言葉で言う。 */
export function impactStateText(state: ChangeImpactState): string | null {
  if (state === 'loading') return STATE_TEXT.loading
  if (state === 'error') return STATE_TEXT.error
  if (state === 'forbidden') return STATE_TEXT.forbiddenView
  return null
}

/**
 * 保存すると何か所が変わるか。
 *
 * `total` には送信済みの記録も入っている。**送信済みは変わらない。**
 * まとめて「15か所が変わります」と言うと、もう送った分まで書き換わると
 * 読めてしまう。分けて数える。
 */
export function changeCounts(impact: CommonVarDeleteImpact | CommonVarChangeImpact): {
  immediate: number
  historical: number
  hidden: number
} {
  return {
    immediate: impact.blockingTotal,
    historical: impact.historicalTotal,
    hidden: impact.unscopedFormTotal,
  }
}

/**
 * 節の見出し文。
 *
 * **0か所は0か所と言う。** 差し込まれていない共通情報なら、保存しても
 * どこも変わらない。それが分かれば運用者はそのまま保存できる。
 */
export function changeSummaryText(impact: CommonVarDeleteImpact | CommonVarChangeImpact): string {
  const { immediate } = changeCounts(impact)
  if (immediate === 0) {
    return `${placeholderText(impact.variable.varKey)} はどこにも差し込まれていません。`
      + '保存しても、いま変わる場所はありません。'
  }
  return `保存すると、${placeholderText(impact.variable.varKey)} を差し込んでいる `
    + `${immediate.toLocaleString('ja-JP')}か所がすぐ変わります。`
}

/** 送信済みの分。**「変わりません」を書かないと、遡って直ると誤解される。** */
export function historicalText(impact: CommonVarDeleteImpact | CommonVarChangeImpact): string | null {
  const { historical } = changeCounts(impact)
  if (historical === 0) return null
  return `送信済みの${historical.toLocaleString('ja-JP')}か所は変わりません。`
    + 'すでに届いた文は書き換わりません。'
}

/** 名前を出せない使用先。**件数は隠さない。** */
export function hiddenText(impact: CommonVarDeleteImpact | CommonVarChangeImpact): string | null {
  if (impact.unavailableReferences.length === 0) return null
  return impact.unavailableReferences
    .map((ref) => `${ref.kindLabel}${ref.count.toLocaleString('ja-JP')}件（${ref.reason}）`)
    .join('／')
}

/** すぐ変わる使用先だけを、表に出す順で返す。送信済みは混ぜない。 */
export function immediateItems(impact: CommonVarDeleteImpact | CommonVarChangeImpact) {
  return impact.items.filter((item) => item.blocksDeletion)
}

/**
 * 保存が落ちた理由を、運用者の言葉にする。
 *
 * `fetchApi` は2xx以外を投げるので、`if (!res.success)` の枝には
 * 届かない。**そのまま catch で「保存に失敗しました」だけ出すと、
 * 権限が無いのか、対象が消えたのか、サーバーが落ちたのかが分からず、
 * 運用者は同じ操作を繰り返すしかなくなる。**
 *
 * 本文をそのまま出してよいのは400だけ（`BODY_MESSAGE_STATUSES`）。
 * それ以外は `API error: 500` のような内部文が入るので、status から
 * こちらで言葉を決める。
 */
export function saveErrorText(err: unknown): string {
  if (!(err instanceof ApiError)) {
    return '保存できませんでした。通信が切れている可能性があります。'
      + '接続を確かめて、もう一度お試しください。'
  }
  if (err.status === 400 && err.message && !/^API error: /.test(err.message)) {
    return err.message
  }
  switch (err.status) {
    case 400:
      return '入力の内容が受け付けられませんでした。名前と値を確かめてください。'
    case 401:
      return 'ログインの状態が切れています。ログインし直してから、もう一度お試しください。'
    case 403:
      return `${STATE_TEXT.forbiddenAct}。共通情報を保存できるのは管理者だけです。`
    case 404:
      return 'この共通情報は見つかりませんでした。'
        + 'ほかの人が削除したか、選んでいるLINEアカウントが違います。一覧から開き直してください。'
    case 409:
      return 'ほかの人が先に保存しました。最新の内容を読み込んでから、もう一度お試しください。'
    case 422:
      return '差し込み名は後から変えられません。名前と値だけを直してください。'
    case 429:
      return '短い時間に操作が集中しました。少し待ってから、もう一度お試しください。'
    default:
      return err.status >= 500
        ? 'サーバー側で保存できませんでした。時間をおいて、もう一度お試しください。'
          + '続く場合は管理者へ連絡してください。'
        : '保存できませんでした。もう一度お試しください。'
  }
}


/*
  ここから下は、変更後の文が読めるようになってから足したもの。
  上の関数は `CommonVarDeleteImpact` を受けるので、`CommonVarChangeImpact`
  もそのまま渡せる（項目が増えただけで、形は同じ）。
*/

/**
 * 保存を止めるかどうか。
 *
 * **止める理由が1つでもあれば保存させない。** 5,000文字を超える文を
 * 保存すると、その通は送信のときに落ちる。**落ちるのは保存の何日も
 * あとで、原因がこの操作だと結びつかない。**
 */
export function blockingErrors(impact: CommonVarChangeImpact): string[] {
  const seen = new Set<string>()
  for (const item of impact.items) for (const message of item.errors) seen.add(message)
  return [...seen]
}

/** 保存はできるが、目で確かめてほしいこと。 */
export function reviewWarnings(impact: CommonVarChangeImpact): string[] {
  const seen = new Set<string>()
  for (const item of impact.items) for (const message of item.warnings) seen.add(message)
  return [...seen]
}

/**
 * 1件ぶんの文字数の言い方。
 *
 * **上限が無い使用先で「/ 5,000」と書かない。** 上限があるのは LINE の
 * 本文になるものだけで、それ以外に上限を書くと、無い決まりを作ってしまう。
 */
export function characterCountText(item: CommonVarChangeImpact['items'][number]): string {
  if (item.nextCharacterCount === null) return '—'
  const next = item.nextCharacterCount.toLocaleString('ja-JP')
  if (item.characterLimit === null) return `${next}文字`
  return `${next} / ${item.characterLimit.toLocaleString('ja-JP')}文字`
}

/**
 * この1件が変更前確認のものか。
 *
 * `in` だけだと型が絞れず、`nextPreview` を読むところで落ちる。
 * 見分けを1か所に置いて、画面側は使うだけにする。
 */
export function isChangeItem(
  item: CommonVarDeleteImpact['items'][number] | CommonVarChangeImpact['items'][number],
): item is CommonVarChangeImpact['items'][number] {
  return 'changesOnSave' in item
}
