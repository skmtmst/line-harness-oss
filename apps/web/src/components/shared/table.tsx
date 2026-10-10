'use client'

import { FolderDotName, type FolderDotFolder } from './folder-dot'
import React from 'react'
import { useListUrlState } from './list-url-state'
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes, CSSProperties } from 'react'
import TruncatedText from './truncated-text'
import shell from './data-table.module.css'
import { loadFailureCopy } from './api-error-message'
import HelpTip from './help-tip'
import { FailureTitle, RetryLabel } from './retry-label'
import styles from './table.module.css'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { DelayedSkeleton, ListSkeleton } from './skeleton'
import presentationStyles from './table-presentation.module.css'
import { isRowControl } from './destination-policy'

type TableHeadRowProps = Omit<HTMLAttributes<HTMLTableRowElement>, 'children' | 'className'> & {
  children: ReactNode
  className?: string
}

export function TableHeadRow({
  children,
  className,
  density,
  presentation,
  as = 'tr',
  ...rowProps
}: TableHeadRowProps & { density?: 'standard' | 'comfortable'; presentation?: 'embedded'; as?: 'tr' | 'div' }) {
  const classes = [styles.headRow, density === 'comfortable' && styles.headComfortable, className]
    .filter(Boolean)
    .join(' ')
  return (
    <React.Fragment>{as === 'div' ? <div data-shared-part="list-head" role="row" className={classes} data-table-layout="columns" data-presentation={presentation} {...rowProps as HTMLAttributes<HTMLDivElement>}>
      {children}
    </div> : <tr data-shared-part="list-head" className={classes} data-presentation={presentation} {...rowProps}>
      {children}
    </tr>}</React.Fragment>
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
  /** 短い列では1行で省略し、titleで全文を読める。 */
  truncate?: boolean
  /** 白い板が狭いときだけ、補助列を畳む。見出しと本文で揃える。 */
  collapseAt?: 'narrow'
  /** 列の余った幅をこのセルに割り当てる。 */
  grow?: boolean
  /** 文字の先頭を名前のフォルダ印に揃える。 */
  inset?: string
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
  truncate,
  collapseAt,
  grow,
  inset,
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
    <th className={classes} data-align={align} scope={scope} data-cell-collapse={collapseAt} data-cell-grow={grow || undefined} data-cell-align={align} style={inset ? { paddingInlineStart: inset } : undefined} {...cellProps}>
      {truncate ? typeof children === 'string' ? <TruncatedText className={styles.truncated} value={children} /> : <span className={styles.truncated}>{children}</span> : children}
      {hasHelp ? (
        <HelpTip label={`${heading}の説明`}>
          {help}
          {helpHref ? <a href={helpHref}>くわしく</a> : null}
        </HelpTip>
      ) : null}
    </th>
  )
}

/**
 * Pencil V6 `RwC76` を正本にした一覧表の外枠。
 * 設計の節の印は表へ写す（data-design 受け口）。共通化で印を落とすと、
 * 画面の骨格の契約試験が節を見失う。
 */
export function DataTable({
  children,
  className,
  'data-design': dataDesign,
  presentation,
  density,
  columns,
  label,
  columnLayout,
  'aria-label': ariaLabel,
  grid,
}: {
  children: ReactNode
  className?: string
  'data-design'?: string
  /** 時間×卓と予約一覧の寸法、飲食店のカード内の密度、アカウントのカード内の表。指定した表だけに適用する。 */
  presentation?: 'ledger' | 'calendar' | 'inventory' | 'channels' | 'columns' | 'account-list' | 'account-handover' | 'connection-check'
  /** 連携画面の3種類の行（reviews・media・sample）と設定内の詰めた一覧（compact・records）。指定のない表の見た目は変えない。 */
  density?: 'reviews' | 'media' | 'sample' | 'compact' | 'records'
  /** 列の幅を持つ設定一覧。共通の枠・セル・行で描く。 */
  columns?: string
  label?: string
  'aria-label'?: string
  /** フレックスで並ぶ一覧。既定の表の余白は変えず、指定した表だけに使う。 */
  columnLayout?: { headHeight: string; rowHeight: string; gap: string; padding: string; numberInset?: string; nameInset?: string; headPadding?: string; headRadius?: string; rowGap?: string; headTextSize?: string; bodyTextSize?: string }
  /** 列の寸法が板ごとに決まる設定一覧（LINE通知）。セル・線・枠は共通部品が持つ。 */
  grid?: { columns: string; compactColumns?: string; padding: string; headPadding: string }
}) {
  const tableDensity = density === 'compact' || density === 'records' ? density : undefined
  const rowDensity = tableDensity ? undefined : density
  return (
    <div data-shared-part="list-table" className={[shell.frame, presentation && (presentationStyles as Record<string, string>)[presentation], className].filter(Boolean).join(' ')} data-density={rowDensity} data-table-density={tableDensity} data-table-presentation={presentation} data-column-layout={columnLayout ? '' : undefined} data-grid-table={grid ? '' : undefined} style={columns || columnLayout ? ({
      ...(columns ? { '--table-columns': columns } : {}),
      ...(columnLayout ? {
        '--table-head-height': columnLayout.headHeight, '--table-row-height': columnLayout.rowHeight,
        '--table-column-gap': columnLayout.gap, '--table-column-padding': columnLayout.padding,
        '--table-number-inset': columnLayout.numberInset ?? '0px', '--table-name-inset': columnLayout.nameInset ?? '0px',
        '--table-head-padding': columnLayout.headPadding ?? columnLayout.padding,
        '--table-head-radius': columnLayout.headRadius ?? '0px', '--table-row-gap': columnLayout.rowGap ?? '0px',
        '--table-head-text-size': columnLayout.headTextSize ?? 'var(--text-caption)',
        '--table-body-text-size': columnLayout.bodyTextSize ?? 'var(--text-label)',
      } : {}),
    } as CSSProperties) : undefined}>
      <table className={shell.table} data-design={dataDesign} data-table-presentation={presentation} aria-label={label ?? ariaLabel} style={grid ? {
        '--table-columns': grid.columns,
        '--table-compact-columns': grid.compactColumns ?? grid.columns,
        '--table-row-padding': grid.padding,
        '--table-head-padding': grid.headPadding,
      } as CSSProperties : undefined}>{children}</table>
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
  /** 行の余白からも開く。名前は通常の Link のままにする。 */
  href?: string
  onOpen?: () => void
  /** ★V7：行の高さ。`comfortable` は64px。未指定は58pxのまま。 */
  density?: 'standard' | 'comfortable' | 'template'
  /**
   * ★V8 仕上げ3回目（M10）④：消える行。渡すと 150ms で薄くなってから
   * 画面側が DOM から外す（外す側の合図は画面が持つ。ここは見た目だけ）。
   * 渡さなければ何も変わらない。
   */
  leaving?: boolean
  highlighted?: boolean
}

/** 標準一覧の高さ58pxの行。 */
export function Tr({ children, className, selected, interactive, href, onOpen, density, leaving, highlighted, onClick, onKeyDown, ...rowProps }: TrProps) {
  const [listState] = useListUrlState({ highlight: '' })
  const createdHighlight = Boolean(listState.highlight && listState.highlight === (rowProps as Record<string, unknown>)['data-row-id'])
  const canOpen = Boolean(href || onOpen || onClick || interactive)
  const classes = [shell.row, density === 'comfortable' && shell.rowComfortable, density === 'template' && shell.rowTemplate,
    interactive !== false && canOpen && shell.rowInteractive, (selected || createdHighlight) && shell.rowSelected, className].filter(Boolean).join(' ')
  const openLink = (newTab: boolean) => {
    if (!href) return
    if (newTab) window.open(href, '_blank', 'noopener,noreferrer')
    else window.location.assign(href)
  }
  return <tr data-shared-part="list-row" className={classes} aria-selected={selected === undefined ? undefined : selected}
    data-created-highlight={createdHighlight || undefined} data-leaving={leaving || undefined} data-highlighted={highlighted || undefined}
    {...rowProps} tabIndex={rowProps.tabIndex ?? (canOpen ? 0 : undefined)}
    onClick={(event) => {
      if (event.defaultPrevented || isRowControl(event.target, event.currentTarget) || window.getSelection()?.toString()) return
      if (href && (event.metaKey || event.ctrlKey || event.shiftKey)) { openLink(true); return }
      if (onOpen) { onOpen(); return }
      if (onClick) { onClick(event); return }
      if (href) { openLink(false); return }
      const link = event.currentTarget.querySelector<HTMLAnchorElement>('a[data-row-link],a[href]')
      if (!link) return
      if (event.metaKey || event.ctrlKey || event.shiftKey) window.open(link.href, '_blank', 'noopener,noreferrer')
      else link.click()
    }} onKeyDown={(event) => {
      onKeyDown?.(event)
      if (event.defaultPrevented || event.target !== event.currentTarget || !canOpen || event.key !== 'Enter') return
      event.preventDefault()
      if (onOpen) onOpen()
      else if (href) openLink(event.metaKey || event.ctrlKey)
      else event.currentTarget.click()
    }}>{children}</tr>
}

export type TdProps = Omit<TdHTMLAttributes<HTMLTableCellElement>, 'align' | 'children' | 'className'> & {
  children?: ReactNode
  align?: 'left' | 'right' | 'center'
  className?: string
  collapseAt?: 'narrow'
  grow?: boolean
}

/** 標準一覧の本文セル。 */
export function Td({ children, align = 'left', className, collapseAt, grow, ...cellProps }: TdProps) {
  const classes = [
    shell.bodyCell,
    align === 'right' && styles.right,
    align === 'center' && styles.center,
    className,
  ].filter(Boolean).join(' ')
  return <td className={classes} data-align={align} data-cell-collapse={collapseAt} data-cell-grow={grow || undefined} data-cell-align={align} {...cellProps}>{children}</td>
}

/** B-194: 名前のセルはフォルダの丸と名前1行だけ。 */
export function NameCell({ name, folder, className }: {
  name: ReactNode
  folder?: FolderDotFolder | null
  className?: string
}) {
  return (
    <td data-list-name-cell="" className={[shell.bodyCell, className].filter(Boolean).join(' ')}>
      <div className={shell.name}><FolderDotName folder={folder}>{name}</FolderDotName></div>
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
 *
 * `error` に捕まえた失敗を渡すと、403 は権限の案内にして再試行の口を
 * 出さず（押しても直らないため）、429 は待ち秒数を添える（m23m）。
 * 画面は `title`・`description` で上書きできる。
 */
export function TableStateRow({
  colSpan,
  kind,
  title,
  description,
  onRetry,
  retryLabel,
  error,
}: {
  colSpan: number
  kind: TableStateKind
  title?: string
  description?: string
  onRetry?: () => void
  retryLabel?: string
  error?: unknown
}) {
  const v8 = useAdminTheme() === 'v8'
  if (kind === 'loading' && v8) return <tr><td colSpan={colSpan} aria-busy="true" aria-label={title ?? TABLE_STATE_TEXT.loading.title}><DelayedSkeleton loading skeleton={<ListSkeleton columns={colSpan} />} /></td></tr>
  const text = TABLE_STATE_TEXT[kind]
  const failure = kind === 'error' && error !== undefined ? loadFailureCopy(error, 'この画面') : null
  return (
    <tr className={shell.row}>
      <td colSpan={colSpan} className={shell.bodyCell}>
        <div className={styles.stateCell} role={kind === 'error' ? 'alert' : 'status'}>
          <p className={styles.stateTitle}>{kind === 'error' ? <FailureTitle title={title ?? failure?.title ?? text.title} /> : (title ?? failure?.title ?? text.title)}</p>
          <p className={styles.stateDescription}>{description ?? failure?.description ?? text.description}</p>
          {kind === 'error' ? (
            <button type="button" onClick={onRetry ?? (() => window.location.reload())} className={styles.stateRetry}>
              <RetryLabel />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}
