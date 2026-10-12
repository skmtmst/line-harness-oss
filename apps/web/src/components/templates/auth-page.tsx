import type { FormHTMLAttributes, ReactNode } from 'react'
import AuthCard from '@/components/auth/auth-card'
import styles from './auth-page.module.css'

/** B-263: inherit the existing V8 login card, including its spacing tokens. */
export function AuthPage({ title, help, titleId, boardId, children }: { title: string; help?: ReactNode; titleId?: string; boardId?: string; children: ReactNode }) {
  return <AuthCard variant="totp" title={title} titleId={titleId} description={help} cardNode={boardId}>{children}</AuthCard>
}

export function AuthForm(props: FormHTMLAttributes<HTMLFormElement>) {
  return <form {...props} className={styles.form} />
}
