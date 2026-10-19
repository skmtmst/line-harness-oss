import type { ReactNode } from 'react'
import Button from '@/components/shared/button'
import styles from './create-parts.module.css'

/*
 * 作る画面（CreatePage）の中でくり返し出る形。合格した2画面
 * （自動応答の作る① ・リマインダを作る① ）の作りをそのまま部品にした。
 * 寸法は globals.css の --tpl-side-* / --tpl-text-sm-lh だけを読む（画面の CSS に数字を書かない）。
 */

/** wrap：値が長いとき語の切れ目（空白）で折り返す。既定は1行＋省略＋title。 */
export type SummaryRow = { label: ReactNode; value: ReactNode; key?: string; wrap?: boolean }

/** 完了の印と題は中央、結果の説明は段落として読む。 */
export function CreateCompletionHeading({ icon, title, children }: { icon: ReactNode; title: ReactNode; children: ReactNode }) {
  return <div className={styles.completionHeading} data-part="create-completion-heading">
    <span className={styles.completionMark} aria-hidden="true">{icon}</span>
    <h2 className={styles.completionTitle}>{title}</h2>
    <p className={styles.completionDescription}>{children}</p>
  </div>
}

/** 右の列の「設定内容」の箱（絵 「右の箱 設定内容」）：余白16・題13/700/19・行は上下9＋下線・字12/17。 */
export function CreateSummaryCard({ title = '設定内容', rows, children, leading, beforeRows, description, descriptionItems, variant, completionIcon }: {
  title?: ReactNode; rows: SummaryRow[]; children?: ReactNode; leading?: ReactNode; beforeRows?: ReactNode
  description?: ReactNode; descriptionItems?: readonly ReactNode[]; completionIcon?: ReactNode
  variant?: 'link' | 'record' | 'completion'
}) {
  const heading = <><h2 className={styles.summaryTitle}>{title}</h2>
    {description ? <p className={styles.summaryDescription}>{description}</p> : null}
    {descriptionItems?.length ? <ul className={`${styles.summaryDescription} ${styles.summaryDescriptionList}`} role="list">
      {descriptionItems.map((item, index) => <li key={index}>{item}</li>)}
    </ul> : null}</>
  return (
    <section className={styles.summary} data-part="create-summary" data-variant={variant}>
      {completionIcon ? <div className={styles.summaryCompletion}>
        <span className={styles.completionIcon} aria-hidden="true">{completionIcon}</span>
        <div className={styles.summaryHead}>{heading}</div>
      </div> : description || descriptionItems?.length ? <div className={styles.summaryHead}>{heading}</div> : heading}
      {leading ?? beforeRows}
      {rows.length > 0 ? <dl className={styles.rows}>
        {rows.map((row, i) => (
          <div key={row.key ?? i} className={styles.row}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            <dd className={styles.rowValue} data-wrap={row.wrap ? '' : undefined} title={typeof row.value === 'string' ? row.value : undefined}>{row.value}</dd>
          </div>
        ))}
      </dl> : null}
      {children}
    </section>
  )
}

/** 右の列の箱の外に出す淡い案内（絵 「見え方は次の手順で」）。 */
export function CreatePreviewNote({ children }: { children: ReactNode }) {
  return <p className={styles.note} data-part="create-preview-note">{children}</p>
}

export type StarterItem = { key: string; name: string; lines: string[]; onUse: () => void; useLabel?: string }

/** 「ひな形から作る（任意）」のカード列。カードの中は1行ずつ、入りきらないときだけ「…」＋title。 */
export function CreateStarterCards({
  title,
  description,
  items,
  manage,
}: {
  title?: ReactNode
  description?: ReactNode
  items: StarterItem[]
  manage?: ReactNode
}) {
  return (
    <section className={styles.starter} data-part="create-starter">
      {title ? (
        <div className={styles.starterHead}>
          <h2 className={styles.starterTitle}>{title}</h2>
          {description ? <p className={styles.starterDescription}>{description}</p> : null}
        </div>
      ) : null}
      <div className={styles.starterGrid} style={{ ['--starter-cols' as string]: String(Math.max(1, items.length)) }}>
        {items.map((item) => (
          <div key={item.key} className={styles.starterCard}>
            <p className={styles.starterName} title={item.name}>{item.name}</p>
            {item.lines.map((line) => (
              <p key={line} className={styles.starterLine} title={line}>{line}</p>
            ))}
            <div className={styles.starterActions}>
              <Button type="button" onClick={item.onUse}>{item.useLabel ?? 'このひな形を使う'}</Button>
            </div>
          </div>
        ))}
      </div>
      {manage ? <div className={styles.starterFoot}>{manage}</div> : null}
    </section>
  )
}
