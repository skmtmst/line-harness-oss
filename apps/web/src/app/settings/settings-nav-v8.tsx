'use client'
import type {ReactNode} from 'react'
import Link from '@/components/shared/list-navigation'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'
import styles from './settings-v8.module.css'
import {SettingsNavV8} from '@/components/layout/settings-nav-v8'
export {SettingsNavV8}

/**
 * 設定画面の共通の器。左のメニュー欄と、見出し（←戻る or 肩書き＋題＋説明）。
 * 各設定画面は中身だけを children に渡す。
 */
export function SettingsShellV8({
  title,
  description,
  back,
  children,
}: {
  title: string
  description?: string
  /** 配下の画面から機能設定へ戻る導線。機能設定自身では付けない。 */
  back?: { href: string; label: string }
  children: ReactNode
}) {
  return (
    <div className={styles.page}>
      {back && <Link href={back.href} className={styles.back}>← {back.label}</Link>}
      <ReadonlyHeaderV8 title={title} description={description ?? ''} />
      <div className={styles.shell}>
        <SettingsNavV8 />
        <div className={styles.main}>{children}</div>
      </div>
    </div>
  )
}
