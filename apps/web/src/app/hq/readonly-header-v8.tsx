'use client'
import type { ReactNode } from 'react'
import styles from './readonly-v8.module.css'
export default function ReadonlyHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return <header className={styles.header}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className={styles.actions}>{actions}</div>}</header>
}
