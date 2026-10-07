'use client'

import Link from 'next/link'
import { Building2, Headset, ReceiptText, Users } from 'lucide-react'
import styles from './settings-nav.module.css'

export type HqSettingsNavKey = 'members' | 'info' | 'billing' | 'contact'

const ITEMS: { key: HqSettingsNavKey; label: string; href: string; Icon: typeof Users }[] = [
  { key: 'members', label: 'メンバー', href: '/hq/members', Icon: Users },
  { key: 'info', label: '統括の情報', href: '/hq/settings', Icon: Building2 },
  { key: 'billing', label: '請求', href: '/hq/billing', Icon: ReceiptText },
  { key: 'contact', label: 'お問い合わせ', href: '/hq/support', Icon: Headset },
]

/**
 * ★V8 統括の設定の中のメニュー（絵 `r4ARpV`・`JB8V1`・`b8xBtZ` の左の列）。
 * 型（ListPage）のフォルダの列に入れて使う。列の幅・余白・仕切り線は型が持つ。
 * v7 の `app/hq/hq-settings-nav-v8.tsx` と行き先・並びは同じ（import はできないので写した）。
 */
export default function HqSettingsNavV8({ active }: { active: HqSettingsNavKey }) {
  return (
    <nav aria-label="統括の設定" className={styles.nav}>
      <p className={styles.label}>統括の設定</p>
      <ul className={styles.list}>
        {ITEMS.map(({ key, label, href, Icon }) => (
          <li key={key}>
            <Link
              href={href}
              aria-current={key === active ? 'page' : undefined}
              className={key === active ? `${styles.item} ${styles.itemActive}` : styles.item}
            >
              <Icon aria-hidden="true" className={styles.icon} />
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
