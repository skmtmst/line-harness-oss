'use client'

import Link from 'next/link'
import { useEffect, type ChangeEvent } from 'react'
import { SIDEBAR_TOGGLE_EVENT } from '@/lib/events'
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
   * マニュアルの行き先。**空文字と null のときは、そもそも描かない。**
   * URLは Masato 確定待ちで、いまは `manual-links.ts` が全部空。
   * 空のまま Link にすると `/` へ飛んでしまい、開いた人が画面を見失う。
   * 押せない札を「準備中」の吹き出し付きで置くのもやめた。出す＝使える
   * （`docs/v6-common-rules.md` §5-5、§7-10）。
   */
  manualHref?: string | null
  accounts: TopBarAccount[]
  selectedAccountId: string
  onAccountChange: (accountId: string) => void
  /** 統括配下ではアカウントを切り替えないため非表示にする。 */
  showAccountSwitcher?: boolean
  roleLabel: string
  /**
   * 権限バッジを押したときの行き先。渡さなければ押せない印のまま。
   * 統括は、ここから店舗の一覧へ戻る（本文に別のボタンを置かない）。
   */
  onRoleClick?: () => void
  userName: string
  onLogout: () => void | Promise<void>
  /**
   * ★V8：ベルの未読の件数。数の取得は呼び出し側が持つ（ここでは取らない）。
   * v7 では描かない。
   */
  notificationUnreadCount?: number
  /**
   * ★V8 外側の左側（畳むボタンとパンくず）を出すか。
   * 左メニューの無い殻（停止中のワークスペース等）では渡さない。
   * 畳むボタンは投げるだけなので、受け手の無い場所に置くと
   * 押しても何も起きない偽の操作になる。
   */
  v8Chrome?: boolean
  /**
   * ★V8：パンくずの手前の段。「ホーム」「一斉配信」など。
   * 渡されなければ従来どおり選んでいるアカウント名を出す。
   * v7 では描かない。
   */
  crumbs?: { label: string; href?: string }[] | null
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
  showAccountSwitcher = true,
  roleLabel,
  onRoleClick,
  userName,
  onLogout,
  notificationUnreadCount = 0,
  v8Chrome = false,
  crumbs,
  className,
}: TopBarProps) {
  const classes = [styles.root, className].filter(Boolean).join(' ')
  const handleAccountChange = (event: ChangeEvent<HTMLSelectElement>) => {
    onAccountChange(event.target.value)
  }
  const current = accounts.find((account) => account.id === selectedAccountId)

  /*
   * ★V8 外側の合図。⌘\ で左メニューを畳む。
   * v7 では動きを出さない（テーマが v8 のときだけ受け付ける）。
   * 帯の探す欄は V8 で外したので、探す欄への焦点合図は持たない
   * （探すのは各一覧の中の欄が受ける）。
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      if (document.documentElement.dataset.theme !== 'v8') return
      if (e.key === '\\') {
        e.preventDefault()
        window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <header className={classes} data-design-node="cBSCb">
      {/*
        ★V8 外側（Pencil `y3gx8R`）：左に畳むボタンとパンくず
        （アカウント › 画面名）。v7 では .v8-only が消す。
        左メニューを持つ殻（v8Chrome）のときだけ出す。
        現在位置はここでも h1 を持つ（v7 の h1 は v8 で隠れるため）。
      */}
      {v8Chrome ? (
        <div className={`${styles.v8Left} v8-only`}>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="メニューを畳む・広げる"
            title="メニューを畳む（⌘\）"
            onClick={() => window.dispatchEvent(new Event(SIDEBAR_TOGGLE_EVENT))}
          >
            <PanelLeftIcon />
          </button>
          <nav className={styles.crumbs} aria-label="パンくず">
            {/*
              手前の段。ページが crumbs を渡したらそれを出す
              （一覧からの詳細で「一斉配信 › 配信名」）。渡さない画面は
              従来どおり選んでいるアカウント名。未選択（統括の一覧など）
              では「店舗を選択」と出さず、画面名だけにする。
            */}
            {crumbs && crumbs.length > 0 ? (
              crumbs.map((crumb) => (
                <span key={crumb.label} className={styles.crumbFromWrap}>
                  {crumb.href ? (
                    <Link href={crumb.href} className={styles.crumbFromLink}>{crumb.label}</Link>
                  ) : (
                    <span className={styles.crumbFrom}>{crumb.label}</span>
                  )}
                  <span className={styles.crumbSep} aria-hidden="true">›</span>
                </span>
              ))
            ) : current ? (
              <>
                <span className={styles.crumbFrom}>{current.label}</span>
                <span className={styles.crumbSep} aria-hidden="true">›</span>
              </>
            ) : null}
            <h1 className={styles.crumbCurrent} title={title}>{title}</h1>
          </nav>
        </div>
      ) : null}

      <div className={`${styles.titleGroup} ${v8Chrome ? 'v7-only' : ''}`}>
        <h1 className={styles.title} title={title}>{title}</h1>
        {manualHref
          ? <Link href={manualHref} className={styles.manual}><BookIcon /><span>マニュアル</span></Link>
          : null}
      </div>

      <div className={styles.actions}>
        {showAccountSwitcher ? <>
          {/*
            ★V8: 帯の探す欄はオーナー決定で外した（2026-10-01）。
            探すのは各一覧の中の欄が受ける。ここには行き先の曖昧な
            全体検索を置かない。
          */}
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
            <span className={styles.accountName}>{current?.label ?? '店舗を選択'}</span>
            <ChevronIcon />
            <select
              className={styles.accountSelect}
              value={selectedAccountId}
              onChange={handleAccountChange}
              aria-label="LINEアカウント"
            >
              {/*
                未選択を表す option。これが無いと value="" のとき、札の表示は空なのに
                ブラウザは先頭の店舗を選んだと読み上げて食い違う（NEXT-07）。
                「未選択へ戻る」は操作として意味を持たないので選べない形にする。
              */}
              <option value="" disabled>店舗を選択</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          </span>
          </label>
          {/*
            ★V8: 通知。押すと通知の一覧（/notifications）を開く。
            未読は赤い丸で右上に出す（100以上は 99+）。
          */}
          <Link
            href="/notifications"
            className={`${styles.iconButton} v8-only`}
            aria-label={notificationUnreadCount > 0 ? `通知（未読 ${notificationUnreadCount} 件）` : '通知'}
          >
            <BellIcon />
            {notificationUnreadCount > 0 ? (
              <span className={styles.bellBadge} aria-hidden="true">
                {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
              </span>
            ) : null}
          </Link>
          <span className={styles.separator} aria-hidden="true" />
        </> : null}

        <div className={styles.identity}>
          {/* ★V8: 自分（36px の顔）。名まえの頭1文字を丸いタイルで出す。 */}
          <span className={`${styles.avatar} v8-only`} aria-hidden="true">
            {userName.trim().slice(0, 1)}
          </span>
          {onRoleClick
            ? <button type="button" className={styles.roleButton} onClick={onRoleClick}>{roleLabel}</button>
            : <span className={styles.role}>{roleLabel}</span>}
          <span className={styles.user} title={userName}>{userName}</span>
        </div>

        <span className={styles.separator} aria-hidden="true" />

        <button type="button" className={styles.logout} onClick={onLogout} aria-label="ログアウト">
          <LogOutIcon /><span aria-hidden="true">ログアウト</span>
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

/* ★V8: メニューの畳み（lucide `panel-left`） */
function PanelLeftIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M9 3v18" />
    </svg>
  )
}

/* ★V8: 通知（lucide `bell`） */
function BellIcon() {
  return (
    <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.268 21a2 2 0 0 0 3.464 0" />
      <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
    </svg>
  )
}
