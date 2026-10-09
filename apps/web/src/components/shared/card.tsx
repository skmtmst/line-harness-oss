import React, { type CSSProperties, type HTMLAttributes, type ReactNode } from 'react'
import styles from './card.module.css'

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  children: ReactNode
  frame?: 'raised' | 'inset'
  layout?: 'block' | 'vertical' | 'horizontal'
  /**
   * 設定の箱。'settings' は16の余白・10の間（EC設定）。
   * 'integration'（外部連携の設定）・'preview'（見本）は枠と内側の間を持つ。指定したカードだけ。
   */
  spacing?: 'settings' | 'integration' | 'preview'
  overflow?: 'visible' | 'hidden'
  padding?: 'none' | 'compact' | 'default' | 'roomy' | 'spacious'
  corner?: 'card' | 'segment' | 'control'
  /** 板ごとの余白はトークンで渡す（例 'var(--tpl-...)'）。枠の描画はこの部品が持つ。 */
  contentPadding?: string
  /** V8 の入力の段・右の箱・一覧の小窓。既定のカードは変えない。 */
  variant?: 'default' | 'form' | 'aside' | 'panel'
  /** 枠と段の間を部品へ任せる連携設定のカード。既定の面は変えない。 */
  appearance?: 'outlined'
  /** 'tight' | 'normal' | 'loose' は決まった段。それ以外はトークン（例 'var(--tpl-...)'）を中の間として渡す。 */
  gap?: 'tight' | 'normal' | 'loose' | (string & {})
  /** 内側の線で寸法を保つカード（inset）・薄い面（muted）。指定した面だけに適用。 */
  surface?: 'inset' | 'muted'
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
  contentPadding,
  style,
  variant = 'default',
  appearance,
  gap,
  surface,
  spacing,
  ...props
}: CardProps) {
  const gapToken = gap === 'tight' || gap === 'normal' || gap === 'loose' ? gap : undefined
  const gapValue = gapToken ? undefined : gap
  const classes = [
    styles.card,
    corner === 'segment' ? styles.segment : null,
    frame === 'inset' ? styles.inset : null,
    variant !== 'default' ? styles[variant] : null,
    surface === 'inset' ? styles.inset : null,
    gap === 'tight' ? styles.gapTight : null,
    layout === 'vertical' ? styles.vertical : layout === 'horizontal' ? styles.horizontal : null,
    overflow === 'hidden' ? styles.overflowHidden : null,
    padding === 'compact' ? styles.paddingCompact : null,
    padding === 'default' ? styles.paddingDefault : null,
    padding === 'roomy' ? styles.paddingRoomy : null,
    padding === 'spacious' ? styles.paddingSpacious : null,
    spacing === 'integration' || spacing === 'preview' ? styles.spacedInset : null,
    spacing === 'integration' || spacing === 'preview' ? styles[spacing] : null,
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <section className={classes} data-design-part="card" data-appearance={appearance} data-gap={gapToken} data-spacing={spacing}
      data-card-surface={surface} data-card-corner={corner === 'control' ? corner : undefined}
      data-card-spacing={contentPadding || gapValue ? '' : undefined}
      style={contentPadding || gapValue ? { ...style, '--card-content-padding': contentPadding, '--card-content-gap': gapValue } as CSSProperties : style} {...props}>
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
