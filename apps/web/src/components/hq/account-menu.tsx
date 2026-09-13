'use client'

import { ChevronsUpDown, LogOut, MessageCircleQuestion, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { api } from '@/lib/api'
import { logoutAndGoToLogin } from '@/lib/logout'

/**
 * 統括メニューの下端「ログイン中のアカウント」と、押すと上に開くアカウントメニュー。
 * Pencil ★V6 36-1 `qAvlC/X6G9j6`（ブロック）と `qAvlC/bfhe6`（メニュー）。
 *
 * `docs/v6-common-rules.md` §1-2 の統括だけの例外。店舗の画面には置かない。
 *
 * プランの札（無料トライアル・残り日数）は課金（36-2）ができるまで置かず、
 * 代わりに役割の札を出す。「プロフィールを編集」「課金プラン」も同じ理由でまだ出さない
 * （出す＝使える、§7-10）。
 */
const ROLE_LABELS: Record<string, string> = {
  owner: '統括',
  admin: '管理者',
  staff: '担当者',
  viewer: '閲覧のみ',
}

export default function HqAccountMenu() {
  const pathname = usePathname()
  const menuId = useId()
  const [me, setMe] = useState<StaffMember | null>(null)
  const [fallbackName, setFallbackName] = useState('')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    try {
      setFallbackName(localStorage.getItem('lh_staff_name') ?? '')
    } catch {
      // ストレージが使えなくても、名前が空になるだけ
    }
    let cancelled = false
    void api.staff.me().then((res) => {
      if (!cancelled && res.success) setMe(res.data)
    }).catch(() => {
      // 取れなければ手元の名前だけで出す
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 画面が変わったら閉じる。外を押す・Esc でも閉じる。
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = me?.name || fallbackName || '—'
  const role = me?.role ? ROLE_LABELS[me.role] ?? me.role : ''
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'

  return (
    <div ref={rootRef} className="relative shrink-0 border-t border-hairline" data-design-node="X6G9j6">
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label="アカウントメニュー"
          data-design-node="bfhe6"
          className="absolute bottom-full left-2 z-30 mb-2 flex flex-col rounded-panel border border-hairline bg-canvas shadow-card"
          style={{ width: 300 }}
        >
          <div className="flex flex-col gap-1 px-4 pb-3 pt-4">
            <p className="text-body font-bold text-ink">{name}</p>
            {me?.email ? <p className="truncate text-caption text-ink-faint">{me.email}</p> : null}
            {role ? (
              <span className="mt-1 inline-flex h-5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep">{role}</span>
            ) : null}
          </div>
          <div className="border-t border-hairline" />
          <div className="flex flex-col p-2">
            <Link
              href="/hq/members"
              role="menuitem"
              className="flex h-10 items-center gap-3 rounded-control px-2 text-label font-semibold text-ink hover:bg-canvas-sunken focus-visible:bg-canvas-sunken"
            >
              <Users aria-hidden="true" className="h-4.5 w-4.5 text-ink-secondary" />
              <span className="whitespace-nowrap">メンバー管理</span>
              <span className="flex-1" />
              <span className="whitespace-nowrap text-micro font-normal text-ink-faint">権限者・担当店舗</span>
            </Link>
            <Link
              href="/hq/support"
              role="menuitem"
              className="flex h-10 items-center gap-3 rounded-control px-2 text-label font-semibold text-ink hover:bg-canvas-sunken focus-visible:bg-canvas-sunken"
            >
              <MessageCircleQuestion aria-hidden="true" className="h-4.5 w-4.5 text-ink-secondary" />
              お問い合わせ
            </Link>
          </div>
          <div className="border-t border-hairline" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void logoutAndGoToLogin()}
            className="flex h-11 items-center gap-3 px-4 text-label font-bold text-status-danger hover:bg-status-danger-soft focus-visible:bg-status-danger-soft"
          >
            <LogOut aria-hidden="true" className="h-4.5 w-4.5" />
            ログアウト
          </button>
        </div>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-canvas-sunken focus-visible:bg-canvas-sunken"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink text-label font-bold text-on-accent" aria-hidden="true">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-label font-bold text-ink">{name}</span>
          {role ? (
            <span className="inline-flex h-4.5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep">{role}</span>
          ) : null}
        </span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
      </button>
    </div>
  )
}
