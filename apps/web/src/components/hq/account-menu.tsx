'use client'

import { Building2, ChevronsUpDown, CreditCard, LifeBuoy, LogOut, MessageCircleQuestion, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { api } from '@/lib/api'
import MenuPortal from '@/components/shared/menu-portal'
import { billingChip, trialDaysLabel, type BillingSummary } from '@/lib/hq-billing'
import { logoutAndGoToLogin } from '@/lib/logout'
import { useAccount } from '@/contexts/account-context'
import { canReturnToHqFrom } from '@/lib/hq-return'
import { requestUnsavedAction } from '@/lib/unsaved-action'
import styles from './account-menu.module.css'

/**
 * 統括メニューの下端「ログイン中のアカウント」と、押すと上に開くアカウントメニュー。
 * Pencil ★V6 36-1 `qAvlC/X6G9j6`（ブロック）と `qAvlC/bfhe6`（メニュー）。
 *
 * `docs/v8-design-rules.md` §5 の統括だけの例外。アカウントの画面には置かない。
 *
 * プランの札（無料トライアル）は課金の状態（`api.hqBilling.summary`）から出す。
 * 課金対象外（運営）の統括には札を出さず、役割の札だけにする。
 * 「プロフィールを編集」は本人の情報を変える画面ができるまで出さない（出す＝使える、§7-10）。
 *
 * 開いたメニューの整え方は運営コンソール（`components/ops/ops-shell.tsx` の
 * `OpsAccountMenu`）に合わせる（Pencil 承認 2026-10-06・
 * `LINE-Harness-V8-B.pen` の `s6kZt/wmfIZ`）。
 * ・最上層の器（`MenuPortal`）に出す。脇メニューの幅や `overflow` に切られない。
 * ・幅は 240（`w-60`）で固定。行の右に説明の字を置かない（はみ出しの元）。
 * ・行の高さは 40（`h-10`）、区切りは `h-px bg-divider-soft`。
 * ・頭の課金の一言は、役目の札のとなりに灰色の小さい字で1行だけ
 *   （例「無料トライアル 残り14日」）。色の付いた札も、下に足す行も作らない。
 */
const ROLE_LABELS: Record<string, string> = {
  owner: 'オーナー',
  admin: '管理者',
  staff: 'スタッフ',
  viewer: '閲覧のみ',
}

export default function HqAccountMenu() {
  const pathname = usePathname()
  const menuId = useId()
  const [me, setMe] = useState<StaffMember | null>(null)
  const [billing, setBilling] = useState<BillingSummary | null>(null)
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
    void api.hqBilling.summary().then((res) => {
      if (!cancelled && res.success) setBilling(res.data)
    }).catch(() => {
      // 課金の状態が取れなければ札を出さないだけ
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 画面が変わったら閉じる。外を押したときは器（`MenuPortal`）が閉じる。
  useEffect(() => setOpen(false), [pathname])
  // Esc は押したボタンへフォーカスを戻すので、ここでも受ける。
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const name = me?.name || fallbackName || '—'
  const role = me?.role ? ROLE_LABELS[me.role] ?? me.role : ''
  const initial = name.trim().slice(0, 1).toUpperCase() || '?'
  const chip = billing ? billingChip(billing) : null
  const daysLeft = billing ? trialDaysLabel(billing) : null
  /*
   * 開いたメニューの頭に出す課金の一言（承認の絵 `s6kZt/wmfIZ`）。
   * 役目の札のとなりに灰色の小さい字で1行だけ出す。色の付いた札も、
   * 下に足す行も作らない（どちらも枠からはみ出す元）。
   * 例：「無料トライアル 残り14日」。
   */
  const planNote = chip ? `${chip.label}${daysLeft ? ` ${daysLeft}` : ''}` : ''
  return (
    <div ref={rootRef} className="relative shrink-0 border-t border-hairline" data-design-node="X6G9j6">
      {open ? (
        <MenuPortal
          open={open}
          align="start"
          getAnchor={() => triggerRef.current}
          onClose={() => setOpen(false)}
        >
        <div
          id={menuId}
          role="menu"
          aria-label="アカウントメニュー"
          data-design-node="bfhe6"
          className="w-60 rounded-mini border border-hairline bg-canvas py-2 shadow-float"
          // 最上層では位置は器が決める（absolute は使わない）。
          style={{ position: 'static' }}
          onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
            const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])'))
            if (items.length === 0) return
            event.preventDefault()
            const current = items.indexOf(document.activeElement as HTMLElement)
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
            items[next].focus()
          }}
        >
          <div className="px-3.5 pb-2.5 pt-1.5">
            <p className="truncate text-label font-medium text-ink">{name}</p>
            {me?.email ? <p className="truncate text-nano text-ink-faint">{me.email}</p> : null}
            {role || planNote ? (
              <p className="mt-1 flex items-center gap-1.5">
                {role ? (
                  <span className="rounded-pill bg-accent-soft px-1.5 py-0.5 text-nano font-medium text-accent-deep">{role}</span>
                ) : null}
                {planNote ? <span className="truncate text-nano text-ink-faint">{planNote}</span> : null}
              </p>
            ) : null}
          </div>
          <div className="h-px bg-divider-soft" />
          <MenuLink href="/hq/members" icon={Users}>メンバー管理</MenuLink>
          {me?.role !== 'staff' ? (
            // 担当者には出さない（権限表: 課金プランは担当者 不可）。
            <MenuLink href="/hq/billing" icon={CreditCard}>課金プラン</MenuLink>
          ) : null}
          <MenuLink href="/hq/support" icon={MessageCircleQuestion}>お問い合わせ</MenuLink>
          <div className="h-px bg-divider-soft" />
          <button
            type="button"
            role="menuitem"
            onClick={() => void logoutAndGoToLogin()}
            className="flex h-10 w-full items-center gap-2.5 px-3.5 text-label font-medium text-danger hover:bg-status-danger-soft focus-visible:bg-status-danger-soft"
          >
            <LogOut aria-hidden="true" className="h-4 w-4" />
            ログアウト
          </button>
        </div>
        </MenuPortal>
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink text-label font-medium text-on-accent" aria-hidden="true">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-label font-medium text-ink">{name}</span>
          <span className="flex items-center gap-1.5">
            {chip ? (
              <PlanChip chip={chip} />
            ) : role ? (
              <span className="inline-flex h-4.5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-medium text-accent-deep">{role}</span>
            ) : null}
            {daysLeft ? <span className="text-nano text-ink-faint">{daysLeft}</span> : null}
          </span>
        </span>
        <ChevronsUpDown aria-hidden="true" className="h-4 w-4 shrink-0 text-ink-faint" />
      </button>
    </div>
  )
}

/**
 * メニューの1行。運営コンソールの `MenuLink` と同じ整え方
 * （高さ40・左右の余白 3.5・アイコン 16px）。右に説明の字は置かない。
 */
function MenuLink({ href, icon: Icon, children }: { href: string; icon: typeof Users; children: ReactNode }) {
  return (
    <Link
      href={href}
      role="menuitem"
      className="flex h-10 items-center gap-2.5 px-3.5 text-label font-semibold text-ink hover:bg-canvas-sunken focus-visible:bg-canvas-sunken"
    >
      <Icon aria-hidden="true" className="h-4 w-4 text-ink-secondary" />
      {children}
    </Link>
  )
}

/** プランの札。色は課金の状態ごと（`billingChip` の tone）。 */
function PlanChip({ chip }: { chip: { label: string; tone: string } }) {
  return (
    <span
      className={
        chip.tone === 'warn'
          ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-status-warn-soft px-2 text-nano font-medium text-status-warn-deep'
          : chip.tone === 'danger'
            ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-status-danger-soft px-2 text-nano font-medium text-danger'
            : chip.tone === 'ok'
              ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-medium text-accent-deep'
              : 'inline-flex h-4.5 w-fit items-center rounded-pill bg-step-idle px-2 text-nano font-medium text-ink-secondary'
      }
    >
      {chip.label}
    </span>
  )
}

/* ===================================================================
 * ★V8 左下の自分とメニュー（オーナー 2026-10-07・絵 V8.pen `zUg8S/T7XSI6/shBJJ`、
 * 開いた形 `ZBjxY/Xn3xt`「G. 左下の自分とメニュー」）。
 *
 * 店の画面・統括の画面の両方で、左メニューのいちばん下に置く。上の帯の
 * 名前・ログアウト・［統括へ］はやめて、ここへまとめた。v7 の統括は上の
 * `HqAccountMenu` のまま（1画素も変えない）。
 *
 * 行の出し分け（絵の3つの形）：
 *   - 店の画面・オーナー/管理者：統括に戻る／メンバー／請求／お問い合わせ／ログアウト
 *   - 統括の画面：メンバー／請求（担当者には出さない）／お問い合わせ／ログアウト
 *   - 店の画面・スタッフ/閲覧のみ：お問い合わせ／ログアウト
 * 「統括に戻る」の権限と行き先は上の帯の切り替えと同じ（`canReturnToHqFrom`）。
 * =================================================================== */

export type SidebarAccountMenuProps = {
  /** 統括の画面（左メニューが統括のもの）か。 */
  hq: boolean
  /** 左メニューを畳んだ形（幅 64）。顔だけを出す。 */
  collapsed?: boolean
}

/** 店の画面で、どの行を出すか。統括の画面は `hq` で決める。 */
export function sidebarAccountRows({ hq, role, canReturnToHq }: { hq: boolean; role: string; canReturnToHq: boolean }): Array<'hq' | 'members' | 'billing' | 'support' | 'logout'> {
  if (hq) {
    // 担当者には請求を出さない（権限表: 課金プランは担当者 不可。v7 の統括と同じ）。
    return role === 'staff' ? ['members', 'support', 'logout'] : ['members', 'billing', 'support', 'logout']
  }
  if (role === 'owner' || role === 'admin') {
    return canReturnToHq ? ['hq', 'members', 'billing', 'support', 'logout'] : ['members', 'billing', 'support', 'logout']
  }
  return ['support', 'logout']
}

export function SidebarAccountMenu({ hq, collapsed = false }: SidebarAccountMenuProps) {
  const pathname = usePathname() ?? '/'
  const router = useRouter()
  const { clearSelectedAccountId } = useAccount()
  const menuId = useId()
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [billing, setBilling] = useState<BillingSummary | null>(null)
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // AuthGuard が保存した値を読む（上の帯と同じ。ここでは取りに行かない）。
  useEffect(() => {
    try {
      setName(localStorage.getItem('lh_staff_name') ?? '')
      setRole(localStorage.getItem('lh_staff_role') ?? '')
    } catch {
      // ストレージが使えなくても、名前が空になるだけ
    }
  }, [pathname])

  // プランの一言はオーナー・管理者にだけ出す（請求を見られる人）。取れなければ出さないだけ。
  const seesBilling = role === 'owner' || role === 'admin'
  useEffect(() => {
    if (!seesBilling) return
    let cancelled = false
    void api.hqBilling.summary().then((res) => {
      if (!cancelled && res.success) setBilling(res.data)
    }).catch(() => {
      // 課金の状態が取れなければ一言を出さないだけ
    })
    return () => { cancelled = true }
  }, [seesBilling])

  // 画面が変わったら閉じる。外を押したときは器（`MenuPortal`）が閉じる。
  useEffect(() => setOpen(false), [pathname])
  // 開いたら最初の行へ。Esc は閉じて枠へ戻す。
  useEffect(() => {
    if (!open) return
    // 器（`MenuPortal`）は開いた次の描画で中身を出すので、1こま待ってから移す。
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus()
    })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      window.cancelAnimationFrame(frame)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const canReturnToHq = canReturnToHqFrom(role, pathname, hq)
  const rows = sidebarAccountRows({ hq, role, canReturnToHq })
  const roleLabel = role ? ROLE_LABELS[role] ?? role : ''
  const chip = seesBilling && billing ? billingChip(billing) : null
  const daysLeft = seesBilling && billing ? trialDaysLabel(billing) : null
  const planNote = chip ? `${chip.label}${daysLeft ? ` ${daysLeft}` : ''}` : ''
  const headNote = [roleLabel, planNote].filter(Boolean).join('・')
  const shownName = name || '—'
  const initial = shownName.trim().slice(0, 1).toUpperCase() || '?'

  const close = () => setOpen(false)
  const returnToHq = () => {
    requestUnsavedAction(() => {
      close()
      clearSelectedAccountId()
      router.push('/hq')
    })
  }

  return (
    <div className={styles.root} data-design-node="shBJJ" data-collapsed={collapsed ? '' : undefined}>
      {open ? (
        <MenuPortal open={open} align="start" gap={8} getAnchor={() => triggerRef.current} onClose={close}>
          <div
            ref={menuRef}
            id={menuId}
            role="menu"
            aria-label="自分のメニュー"
            data-design-node="Xn3xt"
            className={styles.menu}
            onKeyDown={(event: ReactKeyboardEvent<HTMLElement>) => {
              if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
              const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'))
              if (items.length === 0) return
              event.preventDefault()
              const current = items.indexOf(document.activeElement as HTMLElement)
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : event.key === 'ArrowDown' ? (current + 1) % items.length : (current - 1 + items.length) % items.length
              items[next].focus()
            }}
          >
            <div className={styles.head}>
              <p className={styles.headName} title={shownName}>{shownName}</p>
              {headNote ? <p className={styles.headNote} title={headNote}>{headNote}</p> : null}
            </div>
            <div className={styles.rule} role="separator" />
            {rows.includes('hq') ? (
              <>
                <button type="button" role="menuitem" className={styles.row} onClick={returnToHq}>
                  <Building2 aria-hidden="true" className={styles.rowIcon} />
                  統括に戻る
                </button>
                <div className={styles.rule} role="separator" />
              </>
            ) : null}
            {rows.includes('members') ? <SidebarMenuLink href="/hq/members" icon={Users} onSelect={close}>メンバー</SidebarMenuLink> : null}
            {rows.includes('billing') ? <SidebarMenuLink href="/hq/billing" icon={CreditCard} onSelect={close}>請求</SidebarMenuLink> : null}
            <SidebarMenuLink href="/hq/support" icon={LifeBuoy} onSelect={close}>お問い合わせ</SidebarMenuLink>
            <div className={styles.rule} role="separator" />
            <button type="button" role="menuitem" className={styles.row} onClick={() => void logoutAndGoToLogin()}>
              <LogOut aria-hidden="true" className={styles.rowIcon} />
              ログアウト
            </button>
          </div>
        </MenuPortal>
      ) : null}

      <button
        ref={triggerRef}
        type="button"
        className={styles.trigger}
        aria-label={`自分のメニュー（${shownName}${roleLabel ? `・${roleLabel}` : ''}）`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        title={collapsed ? shownName : undefined}
        // Enter・Space はボタンそのものが開く。矢印でも開けるようにする（メニューの決まり）。
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className={styles.face} aria-hidden="true">{initial}</span>
        <span className={styles.text} aria-hidden="true">
          <span className={styles.name}>{shownName}</span>
          {roleLabel ? <span className={styles.role}>{roleLabel}</span> : null}
        </span>
        <ChevronsUpDown aria-hidden="true" className={styles.chevron} />
      </button>
    </div>
  )
}

/** ★V8 メニューの1行（高さ40・角丸8・左右10・アイコン16）。右に説明の字は置かない。 */
function SidebarMenuLink({ href, icon: Icon, onSelect, children }: { href: string; icon: typeof Users; onSelect: () => void; children: ReactNode }) {
  return (
    <Link href={href} prefetch={false} role="menuitem" className={styles.row} onClick={onSelect}>
      <Icon aria-hidden="true" className={styles.rowIcon} />
      {children}
    </Link>
  )
}
