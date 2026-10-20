'use client'

import type { ReactNode } from 'react'
import Link from '@/components/shared/list-navigation'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import styles from './settings-screen.module.css'

/*
 * ★V8 設定の板（機能設定 ・マニュアルの正本表 ・ファイルの検査 ・
 * 運用状態 ・EC連携 ・LINE通知 ）の共通の外側。
 *
 * 型（SettingsPage）＋白い板の中の「設定の中のメニュー」（SettingsInnerNav inline）。
 * 型の値と絵の値が違う所（中のメニューの幅 208・メニューと本文の間 0・本文の幅の上限なし・
 * 板の頭の間 8／下 16・説明 12/17・下の帯の左右 12）は、この画面の中だけで
 * 変数を差し替える（型の部品は変えない）。値は globals.css の --tpl-sb-*。
 */
export function SbSettingsScreen({
  boardId,
  title,
  help,
  explanation,
  explanationKey,
  actions,
  children,
  preview,
  saveActions,
  saveStatus,
  savePlacement,
  layout = 'wide-nav',
  contentLayout,
  notice,
}: {
  /**
   * 板の作りの違い。wide-nav＝今の設定の板（中のメニュー 208・頭の間 8・説明 12）。
   * narrow-nav＝EC連携・LINE通知・運用状態の板（中のメニュー 200・頭は型のまま・本文の余白 16/24）。
   */
  layout?: 'wide-nav' | 'narrow-nav'
  contentLayout?: 'wide'
  boardId?: string
  title: ReactNode
  help?: ReactNode
  explanation?: ReactNode
  explanationKey?: string
  /** @deprecated ★V8 では板の頭に戻るを描かない（オーナー 2026-10-08）。戻るのは上の帯のパンくず。 */
  identity?: ReactNode
  actions?: ReactNode
  children: ReactNode
  preview?: ReactNode
  saveActions?: ReactNode
  saveStatus?: ReactNode
  savePlacement?: 'content'
  /** 板の頭の下・中のメニューより上の帯（競合の帯）。 */
  notice?: ReactNode
}) {
  return (
    <SettingsPage
      layout={layout}
      contentLayout={contentLayout}
      boardId={boardId}
      title={title}
      help={help}
      explanation={explanation}
      explanationKey={explanationKey}
      actions={actions}
      navigation={<SettingsInnerNav inline />}
      preview={preview}
      previewLayout={preview ? 'cards' : undefined}
      saveActions={saveActions}
      saveStatus={saveStatus}
      savePlacement={savePlacement}
      notice={notice}
    >
      <div className={styles.screen} data-sb-settings-screen="" data-sb-layout={layout}>{children}</div>
    </SettingsPage>
  )
}

/** 板の頭の戻るリンク（「← 機能設定へ」13/600・青）。 */
export function SbBackLink({ href, label }: { href: string; label: string }) {
  return <></>
}
