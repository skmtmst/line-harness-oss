import type { ReactNode } from 'react'
import Button from '@/components/shared/button'
import styles from './create-parts.module.css'

/*
 * 作る画面（CreatePage）の中でくり返し出る形。合格した2画面
 * （自動応答の作る① K7HWG・リマインダを作る① VE1u5）の作りをそのまま部品にした。
 * 寸法は globals.css の --tpl-side-* / --tpl-text-sm-lh だけを読む（画面の CSS に数字を書かない）。
 */

export type SummaryRow = { label: ReactNode; value: ReactNode; key?: string }

/** 右の列の「設定内容」の箱（絵 K7HWG「右の箱 設定内容」）：余白16・題13/700/19・行は上下9＋下線・字12/17。 */
export function CreateSummaryCard({ title = '設定内容', rows, children }: { title?: ReactNode; rows: SummaryRow[]; children?: ReactNode }) {
  return (
    <section className={styles.summary} data-part="create-summary">
      <h2 className={styles.summaryTitle}>{title}</h2>
      <dl className={styles.rows}>
        {rows.map((row, i) => (
          <div key={row.key ?? i} className={styles.row}>
            <dt className={styles.rowLabel}>{row.label}</dt>
            <dd className={styles.rowValue}>{row.value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </section>
  )
}

/** 右の列の箱の外に出す淡い案内（絵 K7HWG「見え方は次の手順で」）。 */
export function CreatePreviewNote({ children }: { children: ReactNode }) {
  return <p className={styles.note} data-part="create-preview-note">{children}</p>
}

export type StarterItem = { key: string; name: string; lines: string[]; onUse: () => void; useLabel?: string }

/** 「ひな形から作る（任意）」のカード列（絵 K7HWG・VE1u5）。カードの中は1行ずつ、入りきらないときだけ「…」＋title。 */
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
