import type { FormHTMLAttributes, ReactNode } from 'react'
import SectionHeader from './section-header'
import styles from './settings-form-card.module.css'

/** ★V8 の設定カード：20の余白・12の間。保存口はカードの右下。 */
export function SettingsFormCard({ title, description, children, actions, ...props }: {
  title: string; description: string; children: ReactNode; actions?: ReactNode
} & Omit<FormHTMLAttributes<HTMLFormElement>, 'children' | 'title' | 'className'>) {
  return <form {...props} className={styles.card} aria-label={title}>
    <SectionHeader title={title} />
    <p className={styles.description}>{description}</p>
    {children}
    {actions ? <div className={styles.actions}>{actions}</div> : null}
  </form>
}

export function SettingsFormRow({ children, postal = false }: { children: ReactNode; postal?: boolean }) {
  return <div className={postal ? styles.postalRow : styles.row}>{children}</div>
}
