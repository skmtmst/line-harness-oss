'use client'

import Link, { type LinkProps } from 'next/link'
import type { ChangeEvent } from 'react'
import styles from './top-bar.module.css'

export interface TopBarAccount {
  id: string
  label: string
}

export interface TopBarProps {
  title: string
  manualHref: LinkProps['href']
  accounts: TopBarAccount[]
  selectedAccountId: string
  onAccountChange: (accountId: string) => void
  roleLabel: string
  userName: string
  onLogout: () => void | Promise<void>
  className?: string
}

/**
 * Pencil V6 `cBSCb` を正本にした、管理画面共通のトップバー。
 *
 * 認証やアカウント取得は持たず、既存のコンテキストから受け取った値だけを
 * 表示する。これにより、見た目を全画面で共有しながら現行のデータ取得方法を
 * 変えずに段階移行できる。
 */
export default function TopBar({
  title,
  manualHref,
  accounts,
  selectedAccountId,
  onAccountChange,
  roleLabel,
  userName,
  onLogout,
  className,
}: TopBarProps) {
  const classes = [styles.root, className].filter(Boolean).join(' ')
  const handleAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onAccountChange(event.target.value)
  }

  return (
    <header className={classes} data-design-node="cBSCb">
      <div className={styles.titleGroup}>
        <h1 className={styles.title} title={title}>{title}</h1>
        <Link href={manualHref} className={styles.manual}>マニュアル</Link>
      </div>

      <div className={styles.spacer} aria-hidden="true" />

      <label className={styles.accountField}>
        <span>LINEアカウント</span>
        <select value={selectedAccountId} onChange={handleAccountChange} aria-label="LINEアカウント">
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>{account.label}</option>
          ))}
        </select>
      </label>

      <span className={styles.separator} aria-hidden="true" />

      <div className={styles.identity}>
        <span className={styles.role}>{roleLabel}</span>
        <span className={styles.user} title={userName}>{userName}</span>
      </div>

      <span className={styles.separator} aria-hidden="true" />

      <button type="button" className={styles.logout} onClick={onLogout}>ログアウト</button>
    </header>
  )
}
