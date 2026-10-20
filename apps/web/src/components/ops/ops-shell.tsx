'use client'

import { describeApiFailure } from '@/components/shared/api-error-message'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Building2,
  LayoutDashboard,
  LifeBuoy,
  Megaphone,
  ScrollText,
} from 'lucide-react'
import { api, type OpsMe } from '@/lib/api'
import Button from '@/components/shared/button'
import { adminSessionHeaders, captureAdminSessionHandoff } from '@/lib/admin-session'
import { logoutAndGoToLogin } from '@/lib/logout'
import ImpersonationBar from './impersonation-bar'
import RecoveryCodeNotice from '@/components/recovery-code-notice'
import { OpsShellV8 } from '@/v8/ops/public/shell/index'
import { setDocumentTitle } from '@/lib/document-title'

/**
 * 運営コンソールの外枠。★管理画面 37 系。
 *
 * 統括・店舗の共通メニュー（`J33xq`）は使わない。運営専用のサイドメニュー
 * （`jIZP0`）と環境帯（`OGkIw`）を持つ。メンバー管理はサイドメニューに置かず、
 * 左下のアカウントメニュー（37-9）から開く。
 */

const MENU: Array<{ href: string; label: string; icon: typeof LayoutDashboard }> = [
  { href: '/ops/dashboard', label: 'ダッシュボード', icon: LayoutDashboard },
  { href: '/ops/tenants', label: '契約先アカウント', icon: Building2 },
  { href: '/ops/support', label: 'お問い合わせ', icon: LifeBuoy },
  { href: '/ops/announcements', label: 'お知らせ', icon: Megaphone },
  { href: '/ops/knowledge', label: 'ナレッジ', icon: BookOpen },
  { href: '/ops/audit', label: '監査ログ', icon: ScrollText },
]

export default function OpsShell({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [me, setMe] = useState<OpsMe | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  const [checked, setChecked] = useState(false)
  const [loadError, setLoadError] = useState('')
  // ★管理画面：担当者の取得だけ落ちても外枠は落とさない。本文は普通に出す。
  const [meError, setMeError] = useState('')
  // ★V8：外枠は src/v8/ops/shell.tsx（統括・店舗と同じ外側に運営のメニュー）。互換経路は下のまま。


  /*
   * 狭い画面のメニューは開閉式。画面を移ったら閉じ、開いている間は
   * Escape と背面のスクロール停止に対応する。
   */
  // タブの題（「<画面名> | musubo」）。運営の画面は左メニューの名前を使う。
  useEffect(() => {
    const item = MENU.find((m) => pathname === m.href || pathname.startsWith(`${m.href}/`))
    setDocumentTitle(item ? `${item.label}（運営）` : '運営コンソール')
  }, [pathname])

  const load = useCallback(async () => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL
    try {
      try { localStorage.removeItem('lh_api_key') } catch { /* private-mode fallback uses the session handoff */ }
      const handoffToken = captureAdminSessionHandoff()
      const res = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include', headers: adminSessionHeaders(handoffToken) })
      if (!res.ok) {
        if (res.status === 401) { router.replace('/ops/login'); return }
        throw new Error('運営コンソールのログイン状態を確認できませんでした')
      }
      const body = await res.json() as { success?: boolean; data?: { platformAdmin?: boolean; platformAdminState?: string | null; recoveryCodesRemaining?: number | null }; csrfToken?: string }
      if (!body.success || !body.data) throw new Error('運営コンソールのログイン状態を確認できませんでした')
      if (body.csrfToken) {
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch { /* Bearer session remains usable */ }
      }
      if (!body.data.platformAdmin) {
        // 招待を受けて 2要素認証待ちの人は、設定画面へ（★管理画面 37-10-B）
        router.replace(body.data.platformAdminState === 'awaiting_totp' ? '/ops/two-factor' : '/ops/login?error=not_platform_admin')
        return
      }
      setRemaining(typeof body.data.recoveryCodesRemaining === 'number' ? body.data.recoveryCodesRemaining : null)
      setLoadError('')
    } catch (caught) {
      // 認証済みなのに後続APIが失敗した場合までログインへ戻すと、原因を隠したまま
      // ログイン画面とのループになる。401 だけを上で戻し、それ以外は画面に残す。
      // 口の生文言（英語の `Failed to fetch` など）をそのまま出さない。
      setLoadError(
        caught instanceof TypeError
          ? '通信できませんでした。ネットワークを確認してもう一度お試しください'
          : describeApiFailure(caught, '読み込み', { scope: 'hq' }),
      )
      setChecked(true)
      return
    }
    // セッションは通った。担当者の取得だけ落ちても外枠は落とさない。
    try {
      const meRes = await api.ops.me()
      if (!meRes.success) throw new Error(meRes.error)
      setMe(meRes.data)
      setMeError('')
    } catch (caught) {
      setMeError(
        caught instanceof TypeError
          ? '通信できませんでした。ネットワークを確認してもう一度お試しください'
          : describeApiFailure(caught, '読み込み', { scope: 'hq' }),
      )
    }
    setChecked(true)
  }, [router])

  useEffect(() => { void load() }, [load])

  if (!checked) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-canvas-sunken">
        <div className="h-8 w-8 animate-spin rounded-pill border-2 border-hairline border-t-accent-deep" />
      </div>
    )
  }

  // ★管理画面：セッション以外の失敗（担当者の取得）で外枠ごと落とさない。
  // 担当者が読めていない間は、外枠と本文を出したまま左下に1行出す。
  if (loadError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-canvas-sunken px-4">
        <div className="w-full max-w-md rounded-card border border-hairline bg-canvas p-6 text-center shadow-card-surface">
          <p role="alert" className="text-label font-medium text-danger">{loadError || '運営コンソールを読み込めませんでした'}</p>
          <div className="mt-4 flex justify-center gap-2">
            <Button variant="primary" onClick={() => { setChecked(false); setLoadError(''); void load() }}>もう一度試す</Button>
            <Button onClick={() => void logoutAndGoToLogin('/ops/login')}>ログインへ戻る</Button>
          </div>
        </div>
      </div>
    )
  }


    return (
      <OpsShellV8
        me={me}
        meError={meError}
        onRetryMe={() => { setChecked(false); setMeError(''); void load() }}
        pathname={pathname}
        banner={me?.impersonation ? <ImpersonationBar initial={me.impersonation} onChange={() => void load()} /> : null}
      >
        <RecoveryCodeNotice remaining={remaining} />
        {children}
      </OpsShellV8>
    )


}
