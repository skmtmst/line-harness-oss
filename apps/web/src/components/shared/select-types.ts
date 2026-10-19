import type { ReactNode } from 'react'
import type { StatusBadgeTone } from './status-badge'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** ★V8 の開いた中身で行の先頭に出す印（対応状況の色の点など）。互換経路では出さない。 */
  leading?: ReactNode
  /** ★V8 の開いた中身で名前の下に出す1行の説明（「押したら」YPzmo）。候補が多く間引く一覧では出さない。 */
  description?: string
  /** 対応状況の札の地・文字・点に使う色。treatment='pill' のときだけ適用する。 */
  tone?: StatusBadgeTone
}

/** 「＋ 〇〇」を押した後の板に渡すもの。 */
export interface SelectCreateContext {
  /** 一覧へ戻る（［やめる］・Esc）。 */
  back: () => void
  /** 作ったものを選んで閉じる。 */
  finish: (value: string) => void
}

export interface SelectCreateAction {
  /** 一覧の下の行の文（「新しいフォルダを作る」）。 */
  label: string
  /** 押した後、同じ板に出す中身（iBuZH）。 */
  render: (context: SelectCreateContext) => ReactNode
}

export interface SelectProps {
  'aria-label': string
  className?: string
  defaultOpen?: boolean
  disabled?: boolean
  error?: string
  /** 理由を Field が描くとき、欄の赤枠だけを出す。 */
  invalid?: boolean
  id?: string
  label?: string
  name?: string
  onChange: (value: string) => void
  options: SelectOption[]
  size?: 'standard' | 'page-size' | 'full' | 'content'
  /** 表示の幅をcontentへ変えても、一覧の表示件数の役目は保つ。 */
  pageSizeControl?: boolean
  value: string
  /**
   * 箱の幅（px）。渡すと size の幅を上書きする
   * （ の絞り込み欄 122〜136 など板ごとの絵幅）。
   */
  width?: number
  /**
   * 見せ方。既定 'box' は枠の箱。'text' は枠なし文字＋上下矢印
   * （ の並び替えどおり）。'pill' は対応状況の丸い札。V8 にだけ適用する。
   */
  treatment?: 'box' | 'text' | 'pill'
  /**
   * 箱の先頭の図柄（ のよく使う絞り込みの栞どおり）。
   * 渡さなければ出ない。
   */
  icon?: ReactNode
  /**
   * 先頭の図柄と値の並べ方。既定は箱の両端へ寄せる（会話の頭・よく使う絞り込みの絵どおり、
   * 値が図柄と上下矢印の間で釣り合う）。`'start'` を渡すと値を図柄のすぐ右へ寄せる
   * （★V8 デリバリー受注の注文履歴 `OzHLO`：余白12・印15・間6で文字が x1120 から始まる絵）。
   * 渡さない箱は今までどおり。
   */
  valueAlign?: 'start'
  /** 栞付きの絞り込みなど、既存の絵が矢印を持たない欄。開く操作と読み上げは共通。 */
  showChevron?: boolean
  /** 狭い道具の段では印だけにする。値・候補・読み上げ名は保持する。 */
  iconOnly?: boolean
  /**
   * ★V8 だけ：開いた中身の一番下に区切りと「＋ 〇〇」を置き、押すと同じ板で作れるようにする
   * （dLffh・iBuZH。ふつうは FolderSelect が渡す）。渡さなければ出ない（閲覧のみ・権限なし）。
   */
  createAction?: SelectCreateAction
  /** ★V8 の開いた中身の上の小さな見出し（label・選択肢の頭から出ないとき。dLffh の「フォルダ」）。 */
  menuHeading?: string
}
