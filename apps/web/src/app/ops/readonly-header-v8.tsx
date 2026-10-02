'use client'

import type { ReactNode } from 'react'
import { useAdminTheme } from '@/lib/use-admin-theme'
import OpsPageHeader from '@/components/ops/ops-page-header'
import styles from './readonly-v8.module.css'

export default function ReadonlyHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  const theme = useAdminTheme()
  if (theme !== 'v8') return <OpsPageHeader title={title} actions={actions} />
  return <header className={styles.header}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className={styles.actions}>{actions}</div>}</header>
}
