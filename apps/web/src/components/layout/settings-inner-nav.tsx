'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { MENU_SECTION_BY_ID, type MenuItem } from '@/lib/menu'
import { SIDEBAR_FEATURE_BY_HREF } from '@/lib/feature-settings'
import styles from './settings-inner-nav.module.css'

/*
 * ★V8（夕41）：設定の画面どうしを行き来するための、白い板の中の左の
 * 「設定の中のメニュー」（幅 208）。
 *
 * 「設定の画面では左のメニューの歯車が選ばれた形」になる側の受け皿。
 * いまの画面は薄い地＋太字で示す。
 *
 * 項目の正本は左のメニューと同じ `lib/menu.ts` の「設定」組。ここでは
 * 絵の並び（夕41）に並べ直して出す。「会社とロゴ」は API ができるまで
 * 出さない（MIGRATION-RISKS §1-4・ユーザーの指示）。「プール管理」は
 * 絵の中のメニューに無いのでここには出さない（左のメニューからは
 * 今までどおり行ける）。
 */

/** 夕41 の絵の並び。左のメニュー（menu.ts）の並びとは違うので、ここで明示する。 */
const SETTINGS_TOP_ORDER = [
  '/accounts', // LINEアカウント
  '/staff', // ログインユーザー
  '/getting-started', // はじめの設定
  '/settings', // 機能設定
  '/emergency', // 運用状態
] as const

/** 「専用」の小見出しの下に並ぶ項目。 */
const SETTINGS_DEDICATED = ['/ec-commerce', '/line-notifications'] as const

/** 機能設定の下に付く2つの画面（絵の「下にマニュアルの正本表・ファイルの検査」）。 */
const SETTINGS_CHILDREN = [
  { href: '/settings/manual-links', label: 'マニュアルの正本表' },
  { href: '/settings/file-scan', label: 'ファイルの検査' },
] as const

/** この中のメニューを出す画面（左のメニューの「設定」が光る画面と同じ範囲）。 */
const SETTINGS_AREA_PATHS = [
  ...SETTINGS_TOP_ORDER,
  ...SETTINGS_DEDICATED,
]

/** いまのパスが設定の中のメニューを出す画面か。 */
export function isSettingsAreaPath(pathname: string): boolean {
  return SETTINGS_AREA_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  )
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'boolean')
}

const settingsSectionItems = MENU_SECTION_BY_ID.get('settings')?.items ?? []

export default function SettingsInnerNav() {
  const pathname = usePathname() ?? ''
  const { selectedAccountId } = useAccount()
  const [staffRole, setStaffRole] = useState<string | null>(null)
  const [staffPermissions, setStaffPermissions] = useState<string[]>([])
  const [staffViewPermissions, setStaffViewPermissions] = useState<string[]>([])
  const [visibility, setVisibility] = useState<Record<string, boolean> | null>(null)

  useEffect(() => {
    setStaffRole(localStorage.getItem('lh_staff_role'))
    try { setStaffPermissions(JSON.parse(localStorage.getItem('lh_staff_permissions') || '[]')) } catch { setStaffPermissions([]) }
    try { setStaffViewPermissions(JSON.parse(localStorage.getItem('lh_staff_view_permissions') || '[]')) } catch { setStaffViewPermissions([]) }
  }, [])

  /*
   * 任意機能の表示可否は左のメニューと同じ staff 向け read-model を読む
   * （キャッシュは共有）。取れていない間は任意機能を出さない。
   */
  useEffect(() => {
    if (!selectedAccountId) {
      setVisibility(null)
      return
    }
    let cancelled = false
    void import('@/lib/feature-visibility-cache')
      .then(({ loadFeatureVisibility }) => loadFeatureVisibility(selectedAccountId))
      .then((response) => {
        if (cancelled) return
        const features = response.success ? response.data?.features : undefined
        setVisibility(isBooleanRecord(features) ? features : {})
      })
      .catch(() => {
        if (!cancelled) setVisibility({})
      })
    return () => { cancelled = true }
  }, [selectedAccountId])

  /*
   * 見える項目だけを出す（夕41：見るだけの人には、見られる画面だけの
   * 設定の中のメニュー）。出し分けの決まりは左のメニューと同じ。
   */
  const itemVisible = (item: MenuItem): boolean => {
    if (item.href === '/staff' && staffRole !== 'owner' && staffRole !== 'admin') return false
    if (item.href === '/accounts' && staffRole === 'staff') return false
    const permissionKey = item.permissionKey ?? item.href
    if (staffRole === 'staff' && !item.required && !staffPermissions.includes(permissionKey) && !staffViewPermissions.includes(permissionKey)) return false
    const featureKey = SIDEBAR_FEATURE_BY_HREF[item.href]
    if (!featureKey) return true
    if (!visibility || visibility[featureKey] !== true) return false
    return true
  }

  const byHref = new Map(settingsSectionItems.map((item) => [item.href, item]))
  const topItems = SETTINGS_TOP_ORDER
    .map((href) => byHref.get(href))
    .filter((item): item is MenuItem => Boolean(item))
    .filter(itemVisible)
  const dedicatedItems = SETTINGS_DEDICATED
    .map((href) => byHref.get(href))
    .filter((item): item is MenuItem => Boolean(item))
    .filter(itemVisible)

  const itemActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`)

  const renderItem = (item: MenuItem) => {
    const active = item.href === '/settings'
      ? pathname === '/settings'
      : itemActive(item.href)
    const children = item.href === '/settings' ? SETTINGS_CHILDREN : []
    return (
      <li key={item.href}>
        <Link
          href={item.href}
          className={`${styles.item} ${active ? styles.itemActive : ''}`}
        >
          {item.label}
        </Link>
        {children.length > 0 && (
          <ul className={styles.children}>
            {children.map((child) => (
              <li key={child.href}>
                <Link
                  href={child.href}
                  className={`${styles.child} ${itemActive(child.href) ? styles.itemActive : ''}`}
                >
                  {child.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </li>
    )
  }

  return (
    <nav className={styles.root} aria-label="設定の中のメニュー">
      <ul className={styles.list}>
        {topItems.map(renderItem)}
      </ul>
      {dedicatedItems.length > 0 && (
        <>
          <p className={styles.groupLabel}>専用</p>
          <ul className={styles.list}>
            {dedicatedItems.map(renderItem)}
          </ul>
        </>
      )}
    </nav>
  )
}
