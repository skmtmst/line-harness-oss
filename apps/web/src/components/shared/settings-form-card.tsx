import type { ComponentPropsWithRef, FormHTMLAttributes, ReactNode } from 'react'
import SectionHeader from './section-header'
import Card from './card'
import styles from './settings-form-card.module.css'

/** ★V8 の設定カード：24の余白・12の間。保存口はカードの右下。 */
export function SettingsFormCard({ title, description, children, actions, ...props }: {
  title: string; description: string; children: ReactNode; actions?: ReactNode
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'children' | 'title' | 'className'>) {
  return <form {...props} className={styles.form} aria-label={title}>
    <Card variant="form" gap="normal">
    <SectionHeader title={title} />
    <p className={styles.description}>{description}</p>
    {children}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
    </Card>
  </form>
}

export function SettingsFormRow({ children, postal = false, layout, columns = 2, keepColumns = false, ...props }: {
  children: ReactNode
  postal?: boolean
  layout?: 'name-folder' | 'columns'
  columns?: 2 | 3
  /** 白い板が 1100 未満でも横並びを保つ（右の欄を畳んで本文が広いままの作る画面・絵 CnV1I・ELruS の 1152）。640 未満では縦に積む。 */
  keepColumns?: boolean
} & Omit<ComponentPropsWithRef<'div'>, 'children' | 'className' | 'style'>) {
  return <div {...props} className={layout === 'name-folder' ? styles.nameFolderRow : layout === 'columns' ? styles.columnsRow : postal ? styles.postalRow : styles.row} data-form-row={layout} data-form-columns={layout === 'columns' ? columns : undefined} data-keep-columns={keepColumns || undefined}>{children}</div>
}
