import React from 'react'
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes, HTMLAttributes } from 'react'
import shell from './data-table.module.css'
import styles from './table.module.css'

type TableHeadRowProps = Omit<HTMLAttributes<HTMLTableRowElement>, 'children' | 'className'> & {
  children: ReactNode
  className?: string
}

export function TableHeadRow({ children, className, ...rowProps }: TableHeadRowProps) {
  const classes = [styles.headRow, className].filter(Boolean).join(' ')
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
}

/** Pencil V5/V6の `tPTMp` を正本にした表見出しセル。 */
export function Th({
  children,
  align = 'left',
  className,
  scope = 'col',
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

  return (
    <th className={classes} scope={scope} {...cellProps}>
      {children}
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

type TrProps = Omit<HTMLAttributes<HTMLTableRowElement>, 'children' | 'className'> & {
  children: ReactNode
  className?: string
}

/** 標準一覧の高さ58pxの行。 */
export function Tr({ children, className, ...rowProps }: TrProps) {
  return <tr className={[shell.row, className].filter(Boolean).join(' ')} {...rowProps}>{children}</tr>
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
