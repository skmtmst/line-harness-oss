import type { ReactNode } from 'react'
import HelpTip from '@/components/shared/help-tip'
import styles from './page-templates.module.css'

export interface PageHeadingProps {
  title: ReactNode
  /** regular と未指定は既定（22/32）。compact は部品どおりの小さい見出し。 */
  headingSize?: 'regular' | 'compact' | 'large'
  description?: ReactNode
  help?: ReactNode
  identity?: ReactNode
  actions?: ReactNode
  /** 題と説明の下の行に置く、来た道の案内（★BG-B `qIp42` の `HLq5w`・`Y5UR7`）。 */
  crumbs?: ReactNode
  /**
   * 手順。型の共通部品 `<Steps>`（Fa8ED）を渡す。置き場所は1つだけ：題と説明のすぐ下・左寄せ・1行
   * （決まりの板 q1xNMz・2026-10-08 オーナー）。題の行の右には操作（actions）だけを置く。
   */
  steps?: ReactNode
}

/** 板の頭の寸法は型が持つ。操作・意味の説明は画面から渡す。 */
export function PageHeading({ title, description, help, identity, actions, crumbs, steps, headingSize }: PageHeadingProps) {
  return <header className={styles.heading} data-template-region="heading" data-heading-size={headingSize} data-has-steps={!!steps || undefined} data-has-crumbs={!!crumbs || undefined}>
    {identity ? <div className={styles.identity}>{identity}</div> : null}
    <div className={styles.headingText}>
      <div className={styles.titleRow}><h2 className={styles.title} title={typeof title === 'string' ? title : undefined}>{title}</h2>
        {help ? <HelpTip label={typeof title === 'string' ? `${title}の説明` : '画面の説明'}>{help}</HelpTip> : null}
      </div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    {crumbs ? <div className={styles.crumbs} data-template-region="crumbs">{crumbs}</div> : null}
    {steps ? <div className={styles.steps} data-template-region="steps">{steps}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>
}

export function PageFrame({ kind, children, boardId, standalone = false, hasFooter = false }: {
  kind: string; children: ReactNode; boardId?: string; standalone?: boolean; hasFooter?: boolean
}) {
  return <div className={styles.frame} data-page-template={kind} data-design-node={boardId} data-standalone={standalone || undefined} data-has-footer={hasFooter || undefined}>{children}</div>
}
