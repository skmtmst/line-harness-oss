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
  /**
   * 権限バッジを押したときの行き先。渡さなければ押せない印のまま。
   * 統括は、ここから店舗の一覧へ戻る（本文に別のボタンを置かない）。
   */
  onRoleClick?: () => void
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
  onRoleClick,
  userName,
  onLogout,
  className,
}: TopBarProps) {
  const classes = [styles.root, className].filter(Boolean).join(' ')
  const handleAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onAccountChange(event.target.value)
  }
  const current = accounts.find((account) => account.id === selectedAccountId)
  const manualLabel = <><BookIcon /><span>マニュアル</span></>

  return (
    <header className={classes} data-design-node="cBSCb">
      <div className={styles.titleGroup}>
        <h1 className={styles.title} title={title}>{title}</h1>
        {manualHref
          ? <Link href={manualHref} className={styles.manual}>{manualLabel}</Link>
          : <span className={styles.manualDisabled} aria-disabled="true" title="マニュアルは準備中です">{manualLabel}</span>}
      </div>

      <div className={styles.actions}>
        <label className={styles.accountField}>
          <span>LINEアカウント</span>
          {/*
            Pencil `cBSCb/xvrTI` は「印 ＋ 名前 ＋ ▾」の白い札。印は `select` の
            中へ置けないので、札の側に重ねて置き、`select` は透明にして上に敷く。
            自前のドロップダウンにしないのは、キーボードと読み上げが
            ブラウザの実装のまま使えるほうが確かなため。
          */}
          <span className={styles.accountPill}>
            <span className={styles.accountMark} aria-hidden="true">{current?.mark ?? current?.label.slice(0, 1) ?? ''}</span>
            <span className={styles.accountName}>{current?.label ?? ''}</span>
            <ChevronIcon />
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
          {onRoleClick
            ? <button type="button" className={styles.roleButton} onClick={onRoleClick}>{roleLabel}</button>
            : <span className={styles.role}>{roleLabel}</span>}
          <span className={styles.user} title={userName}>{userName}</span>
        </div>

        <span className={styles.separator} aria-hidden="true" />

        <button type="button" className={styles.logout} onClick={onLogout}>
          <LogOutIcon /><span>ログアウト</span>
        </button>
      </div>
    </header>
  )
}

/* Pencil のアイコンは lucide。同じ形を手で写す（外の読み込みを増やさない）。 */
function BookIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
      <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
    </svg>
  )
}

function LogOutIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}
