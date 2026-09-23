'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { adminSessionHeaders, captureAdminSessionHandoff } from '@/lib/admin-session'
import { clearSelectionAfterAuthentication } from '@/lib/hq-navigation'
import { isPublicAuthPath } from '@/lib/auth-email'
import { SESSION_LOST_EVENT } from '@/lib/api'

/*
 * PERF-07: 画面遷移のたびの /api/auth/session を短いあいだ再利用する。
 *
 * 以前は pathname が変わるたびに往復していた。管理画面は API が別サイトで
 * その往復は遅いので、直前に確認済みなら結果を使い回す。
 *
 * ただし「そのまま信用してよい期間」には限界がある。無効化の口は3つ:
 * - 期限: SESSION_REUSE_MS を過ぎたら必ず再確認する
 * - 指紋: セッション/CSRFトークンが変われば別のログインなので再確認する
 *   （URLハンドオフ、別タブでの再ログイン、権限変更によるCSRF更新を拾う）
 * - 合図: SESSION_LOST_EVENT（APIが401を返した）や別タブでの認証情報の
 *   書き換え（storageイベント）で即座に捨てる
 */
const SESSION_REUSE_MS = 30_000
let lastSessionCheck: { at: number; fingerprint: string } | null = null

function sessionFingerprint(handoffToken: string): string {
  let csrf = ''
  try { csrf = localStorage.getItem('lh_csrf') ?? '' } catch { /* storageなし環境 */ }
  return `${handoffToken}\n${csrf}`
}

/** テストと、外から「次の遷移で必ず確認して」が必要なときの口。 */
export function invalidateAuthSessionCheck(): void {
  lastSessionCheck = null
}

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    let cancelled = false

    if (isPublicAuthPath(pathname)) {
      setChecked(true)
      return () => { cancelled = true }
    }

    // セッション切れ・別タブでのログアウトは、次の遷移で必ず確認し直す。
    const invalidate = () => { lastSessionCheck = null }
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'lh_csrf' || event.key === 'lh_staff_role') invalidate()
    }
    window.addEventListener(SESSION_LOST_EVENT, invalidate)
    window.addEventListener('storage', onStorage)

    // URLハンドオフは遷移ごとに拾う（新しいトークンなら指紋が変わって再確認になる）。
    const handoffToken = captureAdminSessionHandoff()
    const fingerprint = sessionFingerprint(handoffToken)

    if (
      lastSessionCheck
      && lastSessionCheck.fingerprint === fingerprint
      && Date.now() - lastSessionCheck.at < SESSION_REUSE_MS
    ) {
      setChecked(true)
      return () => {
        cancelled = true
        window.removeEventListener(SESSION_LOST_EVENT, invalidate)
        window.removeEventListener('storage', onStorage)
      }
    }

    // Verify the session via the HttpOnly cookie. /api/auth/session returns the
    // staff identity and refreshes the CSRF token if it was lost (e.g. reload).
    const checkSession = async () => {
      try {
        try { localStorage.removeItem('lh_api_key') } catch { /* HttpOnly / bearer session is still usable */ }
        const apiUrl = process.env.NEXT_PUBLIC_API_URL
        const res = await fetch(`${apiUrl}/api/auth/session`, {
          credentials: 'include',
          headers: adminSessionHeaders(handoffToken),
        })
        if (!res.ok) throw new Error('unauthenticated')
        const data = await res.json()
        if (!data?.success || !data?.data) throw new Error('unauthenticated')
        if (data.data.name) localStorage.setItem('lh_staff_name', data.data.name)
        if (data.data.role) localStorage.setItem('lh_staff_role', data.data.role)
        localStorage.setItem('lh_staff_permissions', JSON.stringify(data.data.permissionKeys ?? []))
        // N-424: 「見えるだけ」のキーは別枠で持つ。メニュー表示には両方を使う。
        localStorage.setItem('lh_staff_view_permissions', JSON.stringify(data.data.viewPermissionKeys ?? []))
        if (data.csrfToken) localStorage.setItem('lh_csrf', data.csrfToken)
        // 「消した」印の正本は共有の localStorage。新規タブ・再読込では
        // 印が残るので他タブの店舗選択を消さず、ログインし直しのときだけ
        // 一度だけ消える（NEXT-07）。sessionStorage の残存印も残存扱いにする。
        clearSelectionAfterAuthentication(localStorage, sessionStorage)
        // 確認した時点の指紋で記憶する（CSRF更新を受けたなら新しい値で）。
        lastSessionCheck = { at: Date.now(), fingerprint: sessionFingerprint(handoffToken) }
        if (!cancelled) setChecked(true)
      } catch {
        lastSessionCheck = null
        if (!cancelled) router.replace('/login')
      }
    }

    checkSession()
    return () => {
      cancelled = true
      window.removeEventListener(SESSION_LOST_EVENT, invalidate)
      window.removeEventListener('storage', onStorage)
    }
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
      </div>
    )
  }

  return <>{children}</>
}
