'use client'

import Link from 'next/link'
import type { ChangeEvent } from 'react'
import styles from './top-bar.module.css'

export interface TopBarAccount {
  id: string
  label: string
  /** 頭の1文字。アイコンの代わりに出す。無ければ名前の1文字目。 */
  mark?: string
}

export interface TopBarProps {
  title: string
  /**
   * マニュアルの行き先。**空文字と null のときは押せなくする。**
   * URLは Masato 確定待ちで、いまは `manual-links.ts` が全部空。
   * 空のまま Link にすると `/` へ飛んでしまい、開いた人が画面を見失う。
   */
  manualHref?: string | null
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
  const current = accounts.find((account) => account.id === selectedAccountId)

  return (
    <header className={classes} data-design-node="cBSCb">
      <div className={styles.titleGroup}>
        <h1 className={styles.title} title={title}>{title}</h1>
        {manualHref
          ? <Link href={manualHref} className={styles.manual}>マニュアル</Link>
          : <span className={styles.manualDisabled} aria-disabled="true" title="マニュアルは準備中です">マニュアル</span>}
      </div>

      <div className={styles.spacer} aria-hidden="true" />

      <label className={styles.accountField}>
        <span>LINEアカウント</span>
        {/*
          Pencil `cBSCb` は「印 ＋ 名前 ＋ ▾」の白い札。印は `select` の中へ
          置けないので、札の側に重ねて置き、`select` は透明にして上に敷く。
          自前のドロップダウンにしないのは、キーボードと読み上げが
          ブラウザの実装のまま使えるほうが確かなため。
        */}
        <span className={styles.accountPill}>
          <span className={styles.accountMark} aria-hidden="true">{current?.mark ?? current?.label.slice(0, 1) ?? ''}</span>
          <span className={styles.accountName}>{current?.label ?? ''}</span>
          <span className={styles.accountChevron} aria-hidden="true">▾</span>
          <select
            className={styles.accountSelect}
            value={selectedAccountId}
            onChange={handleAccountChange}
            aria-label="LINEアカウント"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>{account.label}</option>
            ))}
          </select>
        </span>
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
