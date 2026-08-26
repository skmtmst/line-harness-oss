'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import TopBar from '@/components/shared/top-bar'
import { useAccount } from '@/contexts/account-context'
import { usePageChrome } from './page-chrome'
import { MENU_SECTIONS } from '@/lib/menu'
import { adminSessionHeaders, clearAdminSession } from '@/lib/admin-session'
import { AUTH_SELECTION_CLEARED_KEY } from '@/lib/hq-navigation'

/**
 * 共通トップバーを、いまの画面の値へつなぐ層。
 *
 * 見た目は `shared/top-bar.tsx`（Pencil `cBSCb`）が持つ。ここは値を集めるだけ。
 * 分けているのは、部品を1つの画面にも縛らないため（`v6-common-rules.md` §5-2）。
 */

/** ルート → メニューのラベル。長いほうから当てるので、`/tags/new` は「友だち属性」になる。 */
const MENU_LABELS: Array<[string, string]> = MENU_SECTIONS
  .flatMap((section) => section.items.map((item): [string, string] => [item.href, item.label]))
  .sort((a, b) => b[0].length - a[0].length)

/** ルートから既定の画面名を引く。当たらなければ空。 */
export function defaultTitleForPath(pathname: string): string {
  for (const [href, label] of MENU_LABELS) {
    if (pathname === href) return label
    if (href !== '/' && pathname.startsWith(`${href}/`)) return label
  }
  return ''
}

const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  viewer: '閲覧のみ',
  staff: 'スタッフ',
}

export default function AppTopBar() {
  const pathname = usePathname() ?? '/'
  const { title, } = usePageChrome()
  const { accounts, selectedAccountId, setSelectedAccountId } = useAccount()
  const [staffName, setStaffName] = useState('')
  const [staffRole, setStaffRole] = useState('')

  // AuthGuard が保存した値を読む。ここでは取りに行かない（二重に叩かない）。
  useEffect(() => {
    try {
      setStaffName(localStorage.getItem('lh_staff_name') ?? '')
      setStaffRole(localStorage.getItem('lh_staff_role') ?? '')
    } catch {
      // localStorage が使えない環境では名前を出さない
    }
  }, [pathname])

  const shownTitle = title ?? defaultTitleForPath(pathname)

  const options = useMemo(
    () => accounts.map((a) => ({ id: a.id, label: a.displayName || a.name })),
    [accounts],
  )

  const logout = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      if (apiUrl) {
        await fetch(`${apiUrl}/api/auth/logout`, {
          method: 'POST',
          credentials: 'include',
          headers: adminSessionHeaders(),
        })
      }
    } catch {
      // 通信に失敗しても、手元の後始末は必ず行う
    }
    try {
      localStorage.removeItem('lh_api_key')
      localStorage.removeItem('lh_csrf')
      localStorage.removeItem('lh_staff_name')
      localStorage.removeItem('lh_staff_role')
      localStorage.removeItem('lh_staff_permissions')
      sessionStorage.removeItem(AUTH_SELECTION_CLEARED_KEY)
    } catch {
      // ストレージが使えなくても、行き先だけは変える
    }
    clearAdminSession()
    window.location.href = '/login'
  }

  return (
    <TopBar
      title={shownTitle}
      // Masato の確定待ち。空のうちは押せない見た目にする（`v6-shell-contract.md` §11-2）。
      manualHref={null}
      accounts={options}
      selectedAccountId={selectedAccountId ?? ''}
      onAccountChange={setSelectedAccountId}
      roleLabel={ROLE_LABELS[staffRole] ?? ''}
      userName={staffName}
      onLogout={logout}
    />
  )
}
