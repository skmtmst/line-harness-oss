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
  steps?: ReactNode
}

/** 板の頭の寸法は型が持つ。操作・意味の説明は画面から渡す。 */
export function PageHeading({ title, description, help, identity, actions, steps, headingSize }: PageHeadingProps) {
  return <header className={styles.heading} data-template-region="heading" data-heading-size={headingSize} data-has-steps={!!steps || undefined}>
    {identity}
    <div className={styles.headingText}>
      <div className={styles.titleRow}><h2 className={styles.title} title={typeof title === 'string' ? title : undefined}>{title}</h2>
        {help ? <HelpTip label={typeof title === 'string' ? `${title}の説明` : '画面の説明'}>{help}</HelpTip> : null}
      </div>
      {description ? <div className={styles.description}>{description}</div> : null}
    </div>
    {steps ? <div className={styles.steps}>{steps}</div> : null}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </header>
}

export function PageFrame({ kind, children, boardId, standalone = false, hasFooter = false }: {
  kind: string; children: ReactNode; boardId?: string; standalone?: boolean; hasFooter?: boolean
}) {
  return <div className={styles.frame} data-page-template={kind} data-design-node={boardId} data-standalone={standalone || undefined} data-has-footer={hasFooter || undefined}>{children}</div>
}
