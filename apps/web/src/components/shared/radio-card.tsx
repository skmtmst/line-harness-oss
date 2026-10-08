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
 * 押せる範囲はカード全体（label が丸ごと囲む）。V8 の箱（card・compact）は
 * 選んだことが**枠と面の色**で分かるので装飾の丸を出さない。読み上げと矢印
 * キーのために本物の input は残し、見えない大きさで置く（キーボードの位置は
 * 箱の枠に出す）。行（row）は素のラジオ行なので丸 18px をそのまま出す。
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
  /** V8 の上段に出す印。省略すると印は出さない（既定）。v7 では非表示。 */
  icon?: ReactNode
  /**
   * 選ぶカードの形。既定は箱（fNPdg/r3xz1W）。
   * `'row'` は箱なしの行（BHEl9 の素のラジオ行：丸 18・文字 13）。
   * `'compact'` は小さい箱（★BG-B の出力サイズ o2XyUk/aCyxg：
   * 角 8・余白 8/10・題 11/600・補足 10）。狭い脇のパネルに並べる選択肢に使う。
   * 画面の絵で行で並んでいる選択肢には `'row'` を使う。箱の合格は変えない。
   */
  variant?: 'card' | 'row' | 'compact'
  /**
   * 箱（card）の高さ。既定は絵の「選ぶカード」の 98。
   * `'short'` は高さ 90 の箱（★V8 E-3 ウォークインの卓のカード PUWyq：上に印・右上に丸・題・説明）。
   * 渡したときだけ効き、既定の見た目は変えない。
   */
  height?: 'default' | 'short'
  /** 横並びの小さい箱（j8p3yj）。既定のカード・行・v7 の寸法は変えない。 */
  size?: 'default' | 'small'
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
  icon,
  variant = 'card',
  height = 'default',
  size = 'default',
}: RadioCardProps) {
  return (
    <label
      className={[
        variant === 'row' ? styles.row : styles.card,
        variant === 'compact' ? styles.compact : null,
        variant === 'card' && height === 'short' ? styles.short : null,
        variant === 'card' && size === 'small' ? styles.small : null,
        checked ? styles.checked : null,
        disabled ? styles.disabled : null,
        invalid ? styles.invalid : null,
        className,
      ].filter(Boolean).join(' ')}
      data-variant={variant}
      onClick={disabled ? undefined : onClick}
    >
      {icon ? <span className={styles.topIcon} aria-hidden="true">{icon}</span> : null}
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
        {note ? <small className={styles.note} title={typeof note === 'string' ? note : undefined}>{note}</small> : null}
        {disabled && disabledReason ? <small className={styles.reason}>{disabledReason}</small> : null}
      </span>
    </label>
  )
}
