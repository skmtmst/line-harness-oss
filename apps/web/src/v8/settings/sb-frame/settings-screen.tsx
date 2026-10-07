'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import styles from './settings-screen.module.css'

/*
 * ★V8 設定の板（機能設定 ywFJT・マニュアルの正本表 cIdA2・ファイルの検査 PfA4o・
 * 運用状態 Y4LkX1・EC連携 GmVR5・LINE通知 g3iDs）の共通の外側。
 *
 * 型（SettingsPage）＋白い板の中の「設定の中のメニュー」（SettingsInnerNav inline）。
 * 型の値と絵の値が違う所（中のメニューの幅 208・メニューと本文の間 0・本文の幅の上限なし・
 * 板の頭の間 8／下 16・説明 12/17・下の帯の左右 12）は、この画面の中だけで
 * 変数を差し替える（型の部品は変えない）。値は globals.css の --tpl-sb-*。
 */
export function SbSettingsScreen({
  boardId,
  title,
  description,
  identity,
  actions,
  children,
  saveActions,
  saveStatus,
  layout = 'wide-nav',
}: {
  /**
   * 板の作りの違い。wide-nav＝今の設定の板（中のメニュー 208・頭の間 8・説明 12）。
   * narrow-nav＝EC連携・LINE通知・運用状態の板（中のメニュー 200・頭は型のまま・本文の余白 16/24）。
   */
  layout?: 'wide-nav' | 'narrow-nav'
  boardId?: string
  title: ReactNode
  description?: ReactNode
  identity?: ReactNode
  actions?: ReactNode
  children: ReactNode
  saveActions?: ReactNode
  saveStatus?: ReactNode
}) {
  return (
    <SettingsPage
      boardId={boardId}
      title={title}
      description={description}
      identity={identity}
      actions={actions}
      navigation={<SettingsInnerNav inline />}
      saveActions={saveActions}
      saveStatus={saveStatus}
    >
      <div className={styles.screen} data-sb-settings-screen="" data-sb-identity={identity ? '' : undefined} data-sb-layout={layout}>{children}</div>
    </SettingsPage>
  )
}

/** 板の頭の戻るリンク（「← 機能設定へ」13/600・青）。 */
export function SbBackLink({ href, label }: { href: string; label: string }) {
  return <Link href={href} className={styles.back}>{`← ${label}`}</Link>
}
