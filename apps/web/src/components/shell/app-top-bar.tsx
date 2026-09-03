'use client'

import { usePathname, useRouter } from 'next/navigation'
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

/**
 * 権限の呼び名。**`owner` は「統括」**。
 *
 * 「オーナー」ではない。V6 の設計（Pencil `cBSCb`）が「統括」で、
 * 画面にもともと浮いていた「統括」ボタンは、この印へ畳んだ。
 */
const ROLE_LABELS: Record<string, string> = {
  owner: '統括',
  admin: '管理者',
  viewer: '閲覧のみ',
  staff: 'スタッフ',
}

export default function AppTopBar() {
  const pathname = usePathname() ?? '/'
  const { title, } = usePageChrome()
  const router = useRouter()
  const { accounts, selectedAccountId, setSelectedAccountId, clearSelectedAccountId } = useAccount()
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

  /**
   * 統括の印を押したら、店舗の一覧へ戻る。
   *
   * 2026-08-26 まで、本文の右上に「統括」ボタンが浮いていた（`HqReturnButton`）。
   * バーの印と同じ言葉が2つ並ぶので、印のほうへ畳んだ。統括以外は押せない。
   * すでに統括の画面にいるときも押せない。
   */
  const canReturnToHq = staffRole === 'owner' && !pathname.startsWith('/hq')
  const returnToHq = () => {
    clearSelectedAccountId()
    router.push('/hq')
  }

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
      // Masato の確定待ち。空のうちは押せない見た目にする（`docs/v6-common-rules.md` §11-2）。
      manualHref={null}
      accounts={options}
      selectedAccountId={selectedAccountId ?? ''}
      onAccountChange={setSelectedAccountId}
      roleLabel={ROLE_LABELS[staffRole] ?? ''}
      onRoleClick={canReturnToHq ? returnToHq : undefined}
      userName={staffName}
      onLogout={logout}
    />
  )
}
