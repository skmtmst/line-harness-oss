import React, { type HTMLAttributes, type ReactNode } from 'react'
import styles from './card.module.css'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode
  frame?: 'raised' | 'inset'
  layout?: 'block' | 'vertical'
  overflow?: 'visible' | 'hidden'
  padding?: 'none' | 'compact' | 'default' | 'roomy' | 'spacious'
  corner?: 'card' | 'segment'
  /** V8 の入力の段・右の箱・一覧の小窓。既定のカードは変えない。 */
  variant?: 'default' | 'form' | 'aside' | 'panel'
  /** 枠と段の間を部品へ任せる連携設定のカード。既定の面は変えない。 */
  appearance?: 'outlined'
  gap?: 'tight' | 'normal' | 'loose'
}

/** Pencil V5のダッシュボードカードを正本にした共通の面。 */
export default function Card({
  children,
  className,
  frame = 'raised',
  layout = 'block',
  overflow = 'visible',
  padding = 'none',
  corner = 'card',
  variant = 'default',
  appearance,
  gap,
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    corner === 'segment' ? styles.segment : null,
    frame === 'inset' ? styles.inset : null,
    variant !== 'default' ? styles[variant] : null,
    layout === 'vertical' ? styles.vertical : null,
    overflow === 'hidden' ? styles.overflowHidden : null,
    padding === 'compact' ? styles.paddingCompact : null,
    padding === 'default' ? styles.paddingDefault : null,
    padding === 'roomy' ? styles.paddingRoomy : null,
    padding === 'spacious' ? styles.paddingSpacious : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes} data-design-part="card" data-appearance={appearance} data-gap={gap} {...props}>
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
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  size?: 'standard' | 'roomy'
  actionTone?: 'accent' | 'info'
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  return (
    <div
      className={`${styles.header} ${size === 'roomy' ? styles.headerRoomy : ''}`}
      data-design-node="t0jk8p"
    >
      <div className={styles.titleGroup}>
        <Heading className={styles.title}>{title}</Heading>
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
