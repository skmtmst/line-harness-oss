/*
 * 店のテンプレートの作る画面を、ほかの入口（統括のテンプレート）から使うときの口（2026-10-08 オーナー
 * 「統括は店の同じ機能の画面と同じ部品を使い回し、統括のときだけ配る口を足す」・B-29・B-36）。
 *
 * 渡さないときは今までどおり店の画面（店の口で保存・公開）。渡したときは：
 *   - 保存は呼ぶ側（統括の口）がする。画面は中身を組み立てて渡すだけ
 *   - フォルダの候補・戻る先・板の頭の説明・下の帯の主ボタン（［保存して配る］）を呼ぶ側が決める
 *   - 店のアカウントに結びつく欄（登録メディア・タグ・シナリオ・行うこと）は出さない（配った先の ID に直せないため）
 */
import type { ReactNode } from 'react'

/** 画面が組み立てて渡す中身。メッセージは形と本文、クーポン・リサーチは店と同じ形の payload。 */
export type TemplateHostContent =
  | { kind: 'message'; name: string; messageType: string; messageContent: string }
  | { kind: 'coupon' | 'research'; name: string; payload: Record<string, unknown> }

export interface TemplateEditHost {
  /** 板の頭の「← テンプレートへ」の行き先。 */
  backHref: string
  /** 板の頭の説明（統括：保存して配ると…）。 */
  description: string
  /** フォルダの候補（value は呼ぶ側が保存に使う値。未分類は ''）。 */
  folders: Array<{ value: string; label: string }>
  folder: string
  onFolderChange: (value: string) => void
  /** 呼ぶ側の保存・読み込み中。 */
  busy: boolean
  /** 頭の下に出す知らせ（保存の失敗・結果不明など）。 */
  notice?: ReactNode
  /** 下書きを保存（distribute=false）・保存して配る（distribute=true）。 */
  onSave: (content: TemplateHostContent, distribute: boolean) => void
  onCancel: () => void
  /** 主ボタンの言葉（既定「保存して配る」）。 */
  primaryLabel?: string
  /** 編集のとき、読み込んだ中身（メッセージ）。 */
  initialMessage?: { name: string; messageType: string; messageContent: string }
  /** 閲覧のみ（押せる操作を出さない）。 */
  readOnly?: boolean
}
