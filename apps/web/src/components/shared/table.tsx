import React from 'react'
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from 'react'
import shell from './data-table.module.css'
import HelpTip from './help-tip'
import styles from './table.module.css'

type TableHeadRowProps = Omit<HTMLAttributes<HTMLTableRowElement>, 'children' | 'className'> & {
  children: ReactNode
  className?: string
}

export function TableHeadRow({
  children,
  className,
  density,
  ...rowProps
}: TableHeadRowProps & { density?: 'standard' | 'comfortable' }) {
  const classes = [styles.headRow, density === 'comfortable' && styles.headComfortable, className]
    .filter(Boolean)
    .join(' ')
  return (
    <tr className={classes} {...rowProps}>
      {children}
    </tr>
  )
}

type Scope = NonNullable<ThHTMLAttributes<HTMLTableCellElement>['scope']>

export type ThProps = Omit<
  ThHTMLAttributes<HTMLTableCellElement>,
  'align' | 'children' | 'className' | 'scope'
> & {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  scope?: Scope
  /**
   * 定義・分母・単位・言葉の意味。見出しのすぐ右の「？」へ入れる
   * （★V7・§2-1b）。表の下の注はここへ移し、2回書かない。
   */
  help?: ReactNode
  /** 「？」の見出し。省略時は見出し文字。読み上げ名は「{見出し}の説明」。 */
  helpLabel?: string
  /** 長い説明がある場所。渡すと吹き出しに「くわしく」が出る。 */
  helpHref?: string
}

/** Pencil V5/V6の `tPTMp` を正本にした表見出しセル。 */
export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
  help,
  helpLabel,
  helpHref,
  ...cellProps
}: ThProps) {
  const classes = [
    styles.cell,
    align === 'right' && styles.right,
    align === 'center' && styles.center,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const hasHelp = help !== undefined && help !== null
  const heading = helpLabel ?? (typeof children === 'string' ? children : 'この項目')

  return (
    <th className={classes} scope={scope} {...cellProps}>
      {children}
      {hasHelp ? (
        <HelpTip label={`${heading}の説明`}>
          {help}
          {helpHref ? <a href={helpHref}>くわしく</a> : null}
        </HelpTip>
      ) : null}
    </th>
  )
}

/** Pencil V6 `RwC76` を正本にした一覧表の外枠。 */
export function DataTable({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={[shell.frame, className].filter(Boolean).join(' ')}>
      <table className={shell.table}>{children}</table>
    </div>
  )
}

export type TrProps = Omit<HTMLAttributes<HTMLTableRowElement>, 'children' | 'className'> & {
  children: ReactNode
  className?: string
  /** ★V7：選んでいる行を薄い緑の地で示す。渡さなければ何も付けない。 */
  selected?: boolean
  /** ★V7：指を乗せた行に薄い地を敷く。押せる行・選べる行だけに付ける。 */
  interactive?: boolean
  /** ★V7：行の高さ。`comfortable` は64px。未指定は58pxのまま。 */
  density?: 'standard' | 'comfortable'
}

/** 標準一覧の高さ58pxの行。 */
export function Tr({ children, className, selected, interactive, density, ...rowProps }: TrProps) {
  const classes = [
    shell.row,
    density === 'comfortable' && shell.rowComfortable,
    interactive && shell.rowInteractive,
    selected && shell.rowSelected,
    className,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <tr
      className={classes}
      aria-selected={selected === undefined ? undefined : selected}
      {...rowProps}
    >
      {children}
    </tr>
  )
}

export type TdProps = Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align' | 'children' | 'className'> & {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
}

/** 標準一覧の本文セル。 */
export function Td({ children, align = 'left', className, ...cellProps }: TdProps) {
  const classes = [
    shell.bodyCell,
    align === 'right' && styles.right,
    align === 'center' && styles.center,
    className,
  ].filter(Boolean).join(' ')
  return <td className={classes} {...cellProps}>{children}</td>
}

/** 名前・副題・注記を同じ列にまとめる先頭セル。 */
export function NameCell({
  name,
  sub,
  memo,
  className,
}: {
  name: ReactNode
  sub?: ReactNode
  memo?: ReactNode
  className?: string
}) {
  return (
    <td className={[shell.bodyCell, className].filter(Boolean).join(' ')}>
      <div className={shell.name}>{name}</div>
      {sub ? <div className={shell.sub}>{sub}</div> : null}
      {memo ? <div className={shell.memo}>{memo}</div> : null}
    </td>
  )
}

/** 並び替えハンドル専用の先頭列。 */
export function HandleCell({ children }: { children?: ReactNode }) {
  return <td className={shell.handleCell}>{children}</td>
}

/** 行の右端に置く操作列。 */
export function ActionCell({ children, className }: { children?: ReactNode; className?: string }) {
  return <td className={[shell.bodyCell, shell.actionCell, className].filter(Boolean).join(' ')}>{children}</td>
}

export type SortDirection = 'asc' | 'desc' | 'none'

export type SortThProps = ThProps & {
  /** 並び順。`none` は印を出さず、押すと並べ替えを始める。 */
  sort: SortDirection
  onSort?: () => void
  /** 押したときの読み上げ名。未指定は見出し文字に「で並べ替える」を足す。 */
  sortLabel?: string
}

/**
 * ★V7：押して並べ替える見出しセル。
 *
 * 並び順は `aria-sort` と ▲▼ の印の両方で伝える（印だけ・読み上げだけにしない）。
 * 押せない見出しは今までどおり `Th` を使う。
 */
export function SortTh({ children, sort, onSort, sortLabel, help, helpLabel, helpHref, ...cellProps }: SortThProps) {
  const mark = sort === 'asc' ? '▲' : sort === 'desc' ? '▼' : null
  const name = typeof children === 'string' ? children : undefined
  return (
    <Th
      aria-sort={sort === 'none' ? 'none' : sort === 'asc' ? 'ascending' : 'descending'}
      help={help}
      helpLabel={helpLabel ?? name}
      helpHref={helpHref}
      {...cellProps}
    >
      <button
        type="button"
        onClick={onSort}
        aria-label={sortLabel ?? (name ? `${name}で並べ替える` : '並べ替える')}
        className={styles.sortButton}
      >
        <span>{children}</span>
        {mark ? (
          <span aria-hidden="true" className={styles.sortMark}>
            {mark}
          </span>
        ) : null}
      </button>
    </Th>
  )
}

export type TableStateKind = 'empty' | 'loading' | 'error'

const TABLE_STATE_TEXT: Record<TableStateKind, { title: string; description: string }> = {
  empty: { title: '記録はありません', description: '記録が増えると、ここに表示されます。' },
  loading: { title: '読み込んでいます', description: 'このまま少しお待ちください。' },
  error: { title: '表示できませんでした', description: '時間をおいて開き直してください。' },
}

/**
 * ★V7：表の中に1行で出す状態（空・読み込み中・失敗）。
 *
 * 「0件」と「読めなかった」を同じ顔にしない。失敗のときだけ、やり直す
 * ボタンを出す（`onRetry` が無いときは飾りボタンを置かない）。
 */
export function TableStateRow({
  colSpan,
  kind,
  title,
  description,
  onRetry,
  retryLabel = 'もう一度読み込む',
}: {
  colSpan: number
  kind: TableStateKind
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
}) {
  const text = TABLE_STATE_TEXT[kind]
  return (
    <tr className={shell.row}>
      <td colSpan={colSpan} className={shell.bodyCell}>
        <div className={styles.stateCell} role={kind === 'error' ? 'alert' : 'status'}>
          <p className={styles.stateTitle}>{title ?? text.title}</p>
          <p className={styles.stateDescription}>{description ?? text.description}</p>
          {kind === 'error' && onRetry ? (
            <button type="button" onClick={onRetry} className={styles.stateRetry}>
              {retryLabel}
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
