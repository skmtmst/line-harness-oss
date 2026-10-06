'use client'

import { ChevronsUpDown, CreditCard, LogOut, MessageCircleQuestion, Users } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { StaffMember } from '@line-crm/shared'
import { api } from '@/lib/api'
import MenuPortal from '@/components/shared/menu-portal'
import { billingChip, trialDaysLabel, type BillingSummary } from '@/lib/hq-billing'
import { logoutAndGoToLogin } from '@/lib/logout'

/**
 * 統括メニューの下端「ログイン中のアカウント」と、押すと上に開くアカウントメニュー。
 * Pencil ★V6 36-1 `qAvlC/X6G9j6`（ブロック）と `qAvlC/bfhe6`（メニュー）。
 *
 * `docs/v6-common-rules.md` §1-2 の統括だけの例外。アカウントの画面には置かない。
 *
 * プランの札（無料トライアル）は課金の状態（`api.hqBilling.summary`）から出す。
 * 課金対象外（運営）の統括には札を出さず、役割の札だけにする。
 * 「プロフィールを編集」は本人の情報を変える画面ができるまで出さない（出す＝使える、§7-10）。
 *
 * 開いたメニューの整え方は運営コンソール（`components/ops/ops-shell.tsx` の
 * `OpsAccountMenu`）に合わせる（Pencil 承認 2026-10-06・
 * `LINE-Harness-V8-B.pen` の `s6kZt/wmfIZ`、利用者回答「この内容でOK」）。
 * ・最上層の器（`MenuPortal`）に出す。脇メニューの幅や `overflow` に切られない。
 * ・幅は 240（`w-60`）で固定。行の右に説明の字を置かない（はみ出しの元）。
 * ・行の高さは 40（`h-10`）、区切りは `h-px bg-divider-soft`。
 * ・頭の課金の一言は、役目の札のとなりに灰色の小さい字で1行だけ
 *   （例「無料トライアル 残り14日」）。色の付いた札も、下に足す行も作らない。
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
  /*
   * Esc は押したボタンへフォーカスを戻すので、ここでも受ける。
   * 受け取りは捕捉（capture）にして、ここで伝播を止める。
   *
   * ★本番ポートの再検証（幅1152px）で見つかった不具合の直し。
   * 狭い画面の脇メニュー（`components/layout/sidebar.tsx`）も同じ
   * `document` の Escape を聞いている。素のまま（bubble）で受けると
   * 先に登録済みの脇メニュー側が先に動き、
   * ・脇メニュー自体も閉じる
   * ・閉じたあとの後始末でハンバーガーへ焦点を奪う
   * ため、ここで戻した焦点が上書きされていた。
   * 捕捉は bubble より必ず先に動くので、ここで止めればアカウント
   * メニューだけが閉じ、脇メニューは開いたまま・焦点はこのボタンに残る。
   */
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
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
          className="w-60 rounded-md border border-hairline bg-canvas py-2 shadow-lg"
          // 最上層では位置は器が決める（absolute は使わない）。
          style={{ position: 'static' }}
        >
          <div className="px-3.5 pb-2.5 pt-1.5">
            <p className="truncate text-label font-bold text-ink">{name}</p>
            {me?.email ? <p className="truncate text-nano text-ink-faint">{me.email}</p> : null}
            {role || planNote ? (
              <p className="mt-1 flex items-center gap-1.5">
                {role ? (
                  <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-nano font-bold text-accent-deep">{role}</span>
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
            className="flex h-10 w-full items-center gap-2.5 px-3.5 text-label font-bold text-danger hover:bg-status-danger-soft focus-visible:bg-status-danger-soft"
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
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-pill bg-ink text-label font-bold text-on-accent" aria-hidden="true">
          {initial}
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-label font-bold text-ink">{name}</span>
          <span className="flex items-center gap-1.5">
            {chip ? (
              <PlanChip chip={chip} />
            ) : role ? (
              <span className="inline-flex h-4.5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep">{role}</span>
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
          ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-status-warn-soft px-2 text-nano font-bold text-status-warn-deep'
          : chip.tone === 'danger'
            ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-status-danger-soft px-2 text-nano font-bold text-danger'
            : chip.tone === 'ok'
              ? 'inline-flex h-4.5 w-fit items-center rounded-pill bg-accent-soft px-2 text-nano font-bold text-accent-deep'
              : 'inline-flex h-4.5 w-fit items-center rounded-pill bg-step-idle px-2 text-nano font-bold text-ink-secondary'
      }
    >
      {chip.label}
    </span>
  )
}
