import React, { type HTMLAttributes, type ReactNode } from 'react'
import styles from './card.module.css'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode
  layout?: 'block' | 'vertical'
  overflow?: 'visible' | 'hidden'
  padding?: 'none' | 'default' | 'roomy'
}

/** Pencil V5のダッシュボードカードを正本にした共通の面。 */
export default function Card({
  children,
  className,
  layout = 'block',
  overflow = 'visible',
  padding = 'none',
  ...props
}: CardProps) {
  const classes = [
    styles.card,
    layout === 'vertical' ? styles.vertical : null,
    overflow === 'hidden' ? styles.overflowHidden : null,
    padding === 'default' ? styles.paddingDefault : null,
    padding === 'roomy' ? styles.paddingRoomy : null,
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
