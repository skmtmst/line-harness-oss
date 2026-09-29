import type { ReactNode } from 'react'
import styles from './radio-card.module.css'

/**
 * ラジオカード。「この中から1つだけ選ぶ」選択肢をカードで出す共通部品。
 *
 * 監査 DEEP-02／共通仕様「入力欄と選択カード」§2:
 * ●・○ の文字や role の無い button ではなく、**本物の input[type=radio]** を
 * 使う。同じ `name` のラジオ群は Tab で群に入り、矢印キーと Space で
 * 選べて、読み上げにも選択状態が伝わる。
 *
 * 押せる範囲はカード全体（label が丸ごと囲む）。装飾の丸は input 自体を
 * `appearance: none` で描き直すので、読み上げには何も増えない。
 * 外円 20px・内点 8px・間に白い隙間。選択中のカードは淡い緑＋強めの枠。
 *
 * 使い方:
 *   <RadioCardGroup legend="配信方法" className="grid gap-3 md:grid-cols-3">
 *     <RadioCard name="delivery-method" value="new" checked={...} onChange={...}
 *                title="新しいメッセージを作成" note="一から作ります。" />
 *   </RadioCardGroup>
 */

/**
 * 1つだけ選ぶ群を fieldset/legend で束ねる。legend は読み上げの「群名」に
 * なるので必ず渡す。画面上に同じ名前の見出しがすでにあるときは
 * 既定（`legendVisible` なし）で視覚的には隠し、読み上げだけに効かせる。
 * `className` はカードを並べる内側のコンテナへ付く（既定は縦1列）。
 */
export function RadioCardGroup({
  legend,
  legendVisible = false,
  className,
  children,
}: {
  /** 群の名前。例「基準日の選択」「配信方法」。 */
  legend: string
  /** true にすると群名を見出しとして表示する。既定は読み上げ専用。 */
  legendVisible?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={legendVisible ? styles.legend : 'sr-only'}>{legend}</legend>
      <div className={[styles.items, className].filter(Boolean).join(' ')}>{children}</div>
    </fieldset>
  )
}

export interface RadioCardProps {
  /** 同じ群で同じ name。矢印キーで行き来できるのは同じ name のラジオ同士だけ。 */
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  /** 選択肢の名前。 */
  title: string
  /** 補足。選ぶと何が起きるか（実行を伴う選択ならその動作）を書く。 */
  note?: ReactNode
  disabled?: boolean
  /**
   * 選べない理由。disabled のときは必ず併記する。
   * 「選べないのに選択済みの見た目」にはしない（選択中の着色は付けない）。
   */
  disabledReason?: string
  /** エラー状態。選択が必須なのに未確定、など。 */
  invalid?: boolean
  /**
   * 選択済みのカードをもう一度押したときにも呼ばれるクリック。
   * 「テンプレートを選択」のように、再選択で別画面を開き直す選択肢だけに使う。
   */
  onClick?: () => void
  className?: string
}

export default function RadioCard({
  name,
  value,
  checked,
  onChange,
  title,
  note,
  disabled = false,
  disabledReason,
  invalid = false,
  onClick,
  className,
}: RadioCardProps) {
  return (
    <label
      className={[
        styles.card,
        checked ? styles.checked : null,
        disabled ? styles.disabled : null,
        invalid ? styles.invalid : null,
        className,
      ].filter(Boolean).join(' ')}
      onClick={disabled ? undefined : onClick}
    >
      <input
        type="radio"
        className={styles.radio}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-invalid={invalid || undefined}
        onChange={() => onChange(value)}
      />
      <span className={styles.body}>
        <strong className={styles.title}>{title}</strong>
        {note ? <small className={styles.note}>{note}</small> : null}
        {disabled && disabledReason ? <small className={styles.reason}>{disabledReason}</small> : null}
      </span>
    </label>
  )
}
