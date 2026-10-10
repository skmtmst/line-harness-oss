import type { CSSProperties, HTMLAttributes, ReactNode } from 'react'
import styles from './grid-table.module.css'

/** 板ごとの列幅と密度を受け取る共通の表。色・線・省略・役割は部品が持つ。 */
export type GridTableDesign = {
  columns: string
  gap: string
  rowPadding: string
  headPadding?: string
  padding?: string
  rowGap?: string
  rowHeight?: string
  headHeight?: string
  fontSize: string
  lineHeight?: string
  headFontSize?: string
  headLineHeight?: string
  color?: string
  headColor?: string
  headBackground?: string
}

export function GridTable({ children, label, design, framed = true, className }: {
  children: ReactNode
  label: string
  design: GridTableDesign
  framed?: boolean
  /** 幅と、狭い板での列の並びだけを渡す。 */
  className?: string
}) {
  const variables = Object.fromEntries(Object.entries(design).map(([key, value]) => [`--grid-table-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`, value]))
  return <div role="table" aria-label={label} className={[styles.table, className].filter(Boolean).join(' ')} data-framed={framed || undefined} style={variables as CSSProperties}>{children}</div>
}

export function GridHeadRow({ children }: { children: ReactNode }) {
  return <div role="row" className={styles.row} data-head="">{children}</div>
}

export function GridRow({ children, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div role="row" className={[styles.row, className].filter(Boolean).join(' ')} {...props}>{children}</div>
}

export function GridCell({ children, className, align, ...props }: HTMLAttributes<HTMLSpanElement> & { align?: 'left' | 'right' }) {
  return <span role="cell" data-align={align} className={[styles.cell, className].filter(Boolean).join(' ')} {...props}>{children}</span>
}
