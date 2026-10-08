/*
 * 店の回答フォームの編集画面を、統括の回答フォーム（ひな形）から使うときの口（2026-10-08 オーナー
 * 「統括は店の同じ機能の画面と同じ部品を使い回し、統括のときだけ配る口を足す」・B-36）。
 * 絵：中身 u5MM7・答え終わったあと scJcP・受付と見た目 xRPdo・予約ブロック N4T9mO。
 *
 * 渡さないときは今までどおり店の画面（店の口で読み込み・保存・公開）。渡したときは：
 *   - 読み込み・保存は呼ぶ側（統括のひな形の口）。画面は中身を組み立てて渡すだけ
 *   - 右の列は「回答用URL」の代わりに「配った先」、下の帯の主ボタンは［保存して配る］
 *   - 店のアカウントに結びつく欄（登録メディアの画像・背景の画像・リンクの見え方・自動保存・
 *     公開前に試す）は出さない（ひな形の口に置き場が無い・配った先の ID に直せない）
 */
import type { ReactNode } from 'react'
import type { FormLayout } from '@line-crm/shared'
import type { FormRefs } from '@/components/forms/form-refs'

/** 画面が組み立てて渡す中身。 */
export interface FormHostContent {
  name: string
  description: string
  layout: FormLayout
  onSubmitTagId: string
}

export interface FormEditHost {
  /** 板の頭の「← 回答フォームへ」の行き先。 */
  backHref: string
  /** 読み込んだ中身（新しく作るときは空のフォーム）。 */
  initial: FormHostContent
  /** 選べる参照先（配った先で直せるものだけ）。 */
  refs: FormRefs
  /** スマホの見本の頭に出す名前。 */
  accountName: string
  /** 題の下の1行（下書き・配ったことがあるか）。 */
  statusLine: string
  /** 右の列「配った先」の文。 */
  distributedLine: string
  /** 呼ぶ側の保存中。 */
  busy: boolean
  /** 頭の下に出す知らせ（保存の失敗・版の衝突など）。 */
  notice?: ReactNode
  /** 下書きを保存（distribute=false）・保存して配る（distribute=true）。 */
  onSave: (content: FormHostContent, distribute: boolean) => void
  onCancel: () => void
  /** 閲覧のみ（押せる操作を出さない）。 */
  readOnly?: boolean
}
