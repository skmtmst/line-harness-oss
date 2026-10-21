import type { FormHTMLAttributes, ReactNode } from 'react'
import AuthCard from '@/components/auth/auth-card'
import styles from './auth-page.module.css'

/** Login confirmation and enrollment share the login card and its spacing. */
export function AuthPage({ title, help, titleId, boardId, steps, brandName, titleAlign = 'start', layout = 'admin', children }: { title: string; help?: ReactNode; titleId?: string; boardId?: string; steps?: ReactNode; brandName?: string; titleAlign?: 'center' | 'start'; layout?: 'admin' | 'ops'; children: ReactNode }) {
  return <AuthCard variant="totp" title={title} titleId={titleId} description={help} cardNode={boardId} authLayout={layout} brandName={brandName} titleAlign={titleAlign} steps={steps}>{children}</AuthCard>
}

export function AuthForm(props: FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} className={styles.form} />
}

export function AuthStack({ children }: { children: ReactNode }) {
  return <div className={styles.stack}>{children}</div>
}

export function AuthActions({ children }: { children: ReactNode }) {
  return <div className={styles.actions}>{children}</div>
}

export function AuthHelp({ children }: { children: ReactNode }) {
  return <p className={styles.help}>{children}</p>
}

export function AuthDetailRow({ label, value, actions }: { label: string; value: ReactNode; actions?: ReactNode }) {
  return <div className={styles.detailRow}>
    <div className={styles.detailValue}><h3>{label}</h3><strong>{value}</strong></div>
    {actions}
  </div>
}
