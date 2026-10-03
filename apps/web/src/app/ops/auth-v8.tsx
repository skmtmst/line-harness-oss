'use client'

/*
 * ★V8-B 運営の認証の外枠（`D9JALJ`・`qod6X`・`tVaUh`）。
 * 真ん中の白い札。v7 の認証の器（AuthCard）とは別の器として持つ。
 * v7 を直す必要が出たら各 route 側も同じ判断を入れる。
 */
import type { ReactNode } from 'react'
import styles from './auth-v8.module.css'

export function OpsAuthV8({
  node,
  title,
  description,
  footNote,
  children,
}: {
  node: string
  title: string
  description?: ReactNode
  footNote?: string
  children: ReactNode
}) {
  return (
    <div className={styles.stage}>
      <div className={styles.brand} aria-hidden="true">
        <span className={styles.brandMark}>m</span>
        <p className={styles.brandName}>
          musubo
          <span className={styles.brandSub}>運営コンソール</span>
        </p>
      </div>
      <div data-design-node={node} className={styles.card}>
        <h1 className={styles.title}>{title}</h1>
        <p className={styles.eyebrow}>運営コンソール</p>
        {description ? <div className={styles.description}>{description}</div> : null}
        {children}
      </div>
      {footNote ? <p className={styles.footNote}>{footNote}</p> : null}
    </div>
  )
}

export function OpsAuthOr() {
  return (
    <div className={styles.orRow} aria-hidden="true">
      <span className={styles.orLine} />
      <span className={styles.orText}>または</span>
      <span className={styles.orLine} />
    </div>
  )
}
