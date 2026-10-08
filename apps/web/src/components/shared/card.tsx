import React, { type HTMLAttributes, type ReactNode } from 'react'
import styles from './card.module.css'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode
  layout?: 'block' | 'vertical'
  overflow?: 'visible' | 'hidden'
  padding?: 'none' | 'default' | 'roomy' | 'spacious'
  /** V8 の入力の段・右の箱・一覧の小窓。既定のカードは変えない。 */
  variant?: 'default' | 'form' | 'aside' | 'panel'
  gap?: 'tight'
  /** 内側の線で寸法を保つカード。指定した面だけに適用。 */
  surface?: 'inset'
}

/** Pencil V5のダッシュボードカードを正本にした共通の面。 */
export default function Card({
  children,
  className,
  layout = 'block',
  overflow = 'visible',
  padding = 'none',
  variant = 'default',
  gap,
  surface,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    variant !== 'default' ? styles[variant] : null,
    surface === 'inset' ? styles.inset : null,
    gap === 'tight' ? styles.gapTight : null,
    layout === 'vertical' ? styles.vertical : null,
    overflow === 'hidden' ? styles.overflowHidden : null,
    padding === 'default' ? styles.paddingDefault : null,
    padding === 'roomy' ? styles.paddingRoomy : null,
    padding === 'spacious' ? styles.paddingSpacious : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes} data-design-part="card" {...props}>
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  meta,
  action,
  size = 'standard',
  actionTone = 'accent',
  headingLevel = 2,
  titleId,
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  size?: 'standard' | 'roomy' | 'stacked' | 'panel'
  actionTone?: 'accent' | 'info'
  headingLevel?: 2 | 3
  titleId?: string
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  return (
    <div
      className={[styles.header, size === 'roomy' && styles.headerRoomy, size === 'stacked' && styles.headerStacked, size === 'panel' && styles.headerPanel].filter(Boolean).join(' ')}
      data-design-node="t0jk8p"
    >
      <div className={styles.titleGroup}>
        <Heading id={titleId} className={styles.title}>{title}</Heading>
        {meta ? <span className={styles.meta}>{meta}</span> : null}
      </div>
      {action ? (
        <div className={`${styles.action} ${actionTone === 'info' ? styles.actionInfo : ''}`}>
          {action}
        </div>
      ) : null}
    </div>
  )
}
