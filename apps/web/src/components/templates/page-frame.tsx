import type { ReactNode } from 'react'
import HelpTip from '@/components/shared/help-tip'
import styles from './page-templates.module.css'

export interface PageHeadingProps {
  title: ReactNode
  /** 題はすべて22/700/32。compact は題の周りの余白・間隔だけを詰める。 */
  headingSize?: 'regular' | 'compact' | 'large'
  description?: ReactNode
  help?: ReactNode
  /**
   * @deprecated ★V8 では描かない（オーナー 2026-10-08「全部消す」）。
   * 板の頭の「← 〇〇へ」は、上の帯のパンくず（usePageCrumbs）と下の帯の［キャンセル］に任せる。
   * 渡しても型が捨てる（画面ごとに消して回らないための受け口。呼び出し側は追って外す）。
   */
  identity?: ReactNode
  actions?: ReactNode
  /** 題と説明の下の行に置く、来た道の案内（★BG-B `qIp42` の `HLq5w`・`Y5UR7`）。 */
  crumbs?: ReactNode
  steps?: ReactNode
  /** 作る型の手順の置き方。既定は題と説明の下の行。FU2aU の同行版は 'inline'。 */
  stepsPlacement?: 'below' | 'inline'
}

/** 型の外に残るページの題も同じ文字の決まりを使う。窓・カードには使わない。 */
export function PageTitle({ children, as: Tag = 'h2', className }: {
  children: string; as?: 'h1' | 'h2'; className?: string
}) {
  return <Tag className={[styles.pageTitle, className].filter(Boolean).join(' ')} title={children} data-page-title>{children}</Tag>
}

/** 板の頭の寸法は型が持つ。操作・意味の説明は画面から渡す。 */
export function PageHeading({ title, description, help, actions, crumbs, steps, headingSize, stepsPlacement = 'below' }: PageHeadingProps) {
  /* 戻る（identity）は描かない。戻るのは上の帯のパンくずと下の帯の［キャンセル］だけ（オーナー 2026-10-08）。 */
  return <header className={styles.heading} data-template-region="heading" data-heading-size={headingSize} data-has-steps={!!steps || undefined} data-has-crumbs={!!crumbs || undefined} data-steps-placement={stepsPlacement}>
    <div className={styles.headingText}>
      <div className={styles.titleRow}><h2 className={styles.title} title={typeof title === 'string' ? title : undefined}>{title}</h2>
        {help ? <HelpTip label={typeof title === 'string' ? `${title}の説明` : '画面の説明'}>{help}</HelpTip> : null}
      </div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    {crumbs ? <div className={styles.crumbs} data-template-region="crumbs">{crumbs}</div> : null}
    {steps ? <div className={styles.steps}>{steps}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>
}

export function PageFrame({ kind, children, boardId, standalone = false, hasFooter = false }: {
  kind: string; children: ReactNode; boardId?: string; standalone?: boolean; hasFooter?: boolean
}) {
  return <div className={styles.frame} data-page-template={kind} data-design-node={boardId} data-standalone={standalone || undefined} data-has-footer={hasFooter || undefined}>{children}</div>
}
