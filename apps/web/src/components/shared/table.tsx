import React from 'react'
import type { ReactNode, ThHTMLAttributes, HTMLAttributes } from 'react'
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
