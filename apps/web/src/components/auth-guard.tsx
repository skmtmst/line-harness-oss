'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { adminSessionHeaders, captureAdminSessionHandoff } from '@/lib/admin-session'
import { clearSelectionAfterAuthentication } from '@/lib/hq-navigation'
import { isPublicAuthPath } from '@/lib/auth-email'
import { SESSION_LOST_EVENT, type OpsImpersonation } from '@/lib/api'
import { forgetSessionSnapshot, rememberSessionSnapshot, type SessionSnapshot } from '@/lib/session-snapshot'
import { forgetAuthCheck, readAuthCheck, rememberAuthCheck } from '@/lib/auth-check-marker'
import { clearCommonCaches } from '@/lib/common-caches'
import { prefetchLineAccounts } from '@/lib/line-accounts-cache'
import TenantSuspended from './tenant-suspended'
import AuthPendingShell from './auth-pending-shell'
import { TenantAccessProvider, type TenantStatus } from './tenant-access-context'

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
let lastSessionCheck: { at: number; fingerprint: string; tenantStatus: TenantStatus } | null = null
/*
 * R505: 確認の要求世代。確認を始めるたびに1ずつ進む。
 *
 * 古いログインの確認応答が、新しいログインの名前・権限・CSRF・確認結果を
 * 上書きしないように、応答を当てはめる前にこの世代と開始時の指紋を照合する。
 * 進んでいたら（新しい画面の確認が始まっている）古い応答は捨て、
 * 新しい確認に任せる。
 */
let authSessionCheckSeq = 0

function sessionFingerprint(handoffToken: string): string {
  let csrf = ''
  try { csrf = localStorage.getItem('lh_csrf') ?? '' } catch { /* storageなし環境 */ }
  return `${handoffToken}\n${csrf}`
}

/** テストと、外から「次の遷移で必ず確認して」が必要なときの口。 */
export function invalidateAuthSessionCheck(): void {
  lastSessionCheck = null
  forgetSessionSnapshot()
  forgetAuthCheck()
  clearCommonCaches()
}

export default function AuthGuard({ children, suspendedSupport }: { children: React.ReactNode; suspendedSupport?: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const [tenantStatus, setTenantStatus] = useState<TenantStatus>('active')

  useEffect(() => {
    let cancelled = false

    if (isPublicAuthPath(pathname)) {
      setChecked(true)
      return () => { cancelled = true }
    }

    // セッション切れ・別タブでのログアウトは、次の遷移で必ず確認し直す。
    // 使い回していた共通の答えも捨てる（古い権限や別アカウントを見せない）。
    const invalidate = () => { lastSessionCheck = null; forgetSessionSnapshot(); forgetAuthCheck(); clearCommonCaches() }
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'lh_csrf' || event.key === 'lh_staff_role') invalidate()
    }
    window.addEventListener(SESSION_LOST_EVENT, invalidate)
    window.addEventListener('storage', onStorage)

    // URLハンドオフは遷移ごとに拾う（新しいトークンなら指紋が変わって再確認になる）。
    const handoffToken = captureAdminSessionHandoff()
    const fingerprint = sessionFingerprint(handoffToken)

    // 別のログイン・権限更新で指紋が変わったら、使い回しの答えは捨てる。
    // 古い権限や別アカウントの一覧・名簿・設定を見せない。
    if (lastSessionCheck && lastSessionCheck.fingerprint !== fingerprint) {
      clearCommonCaches()
    }

    if (
      lastSessionCheck
      && lastSessionCheck.tenantStatus === 'active'
      && lastSessionCheck.fingerprint === fingerprint
      && Date.now() - lastSessionCheck.at < SESSION_REUSE_MS
    ) {
      setTenantStatus(lastSessionCheck.tenantStatus)
      setChecked(true)
      return () => {
        cancelled = true
        window.removeEventListener(SESSION_LOST_EVENT, invalidate)
        window.removeEventListener('storage', onStorage)
      }
    }

    /*
     * 読み直した直後（タブ内の使い回しが消えた）でも、同じタブで確認が通っていれば
     * 中身を先に出し、下の確認は裏で走らせる（lib/auth-check-marker.ts）。
     * 失敗したらいつもどおりログインへ送り、停止中なら停止の画面に変わる。
     */
    const verified = readAuthCheck(fingerprint)
    if (verified) {
      if (verified.snapshot) rememberSessionSnapshot(verified.snapshot)
      setTenantStatus('active')
      setChecked(true)
    }

    // Verify the session via the HttpOnly cookie. /api/auth/session returns the
    // staff identity and refreshes the CSRF token if it was lost (e.g. reload).
    // 一覧の取得は確認の結果を要らないので、確認と並べて先に始める（直列にしない）。
    prefetchLineAccounts()
    /*
     * R505: この確認の世代と開始時の指紋。応答を当てはめる前に今と照合し、
     * 古ければ捨てる。成功応答の書き戻しも、失敗時のログインへの送りもしない。
     */
    const checkSeq = ++authSessionCheckSeq
    const startFingerprint = fingerprint
    // 古い応答を捨てたあと、誰も確認していなければ確認し直す。
    // 新しい画面の確認が走っているときはそれに任せて何もしない。
    const recheckAfterStale = () => {
      if (cancelled || checkSeq !== authSessionCheckSeq) return
      const freshSeq = ++authSessionCheckSeq
      void runSessionCheck(freshSeq, sessionFingerprint(handoffToken))
    }
    const runSessionCheck = async (mySeq: number, myFingerprint: string) => {
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
        // 新しい画面の確認が始まっていたら、この古い応答は捨てる。
        if (cancelled || mySeq !== authSessionCheckSeq) return
        // 別タブでログインし直していたら、この古い応答は捨てて確認し直す。
        if (sessionFingerprint(handoffToken) !== myFingerprint) {
          recheckAfterStale()
          return
        }
        if (data.data.name) localStorage.setItem('lh_staff_name', data.data.name)
        if (data.data.role) localStorage.setItem('lh_staff_role', data.data.role)
        const nextTenantStatus: TenantStatus = data.data.tenantStatus === 'suspended' || data.data.tenantStatus === 'archived'
          ? data.data.tenantStatus
          : 'active'
        setTenantStatus(nextTenantStatus)
        localStorage.setItem('lh_staff_permissions', JSON.stringify(data.data.permissionKeys ?? []))
        // N-424: 「見えるだけ」のキーは別枠で持つ。メニュー表示には両方を使う。
        localStorage.setItem('lh_staff_view_permissions', JSON.stringify(data.data.viewPermissionKeys ?? []))
        if (data.csrfToken) localStorage.setItem('lh_csrf', data.csrfToken)
        // 代理ログイン帯はこの結果を読む。同じ応答をもう一度取りに行かせない（V6R-S0-a）。
        const snapshot: SessionSnapshot = {
          impersonation: (data.data.impersonation as OpsImpersonation | null | undefined) ?? null,
          unfamiliarAt: typeof data.data.unfamiliarAt === 'string' ? data.data.unfamiliarAt : null,
          stepUpMethod: data.data.stepUpMethod === 'totp' || data.data.stepUpMethod === 'password'
            ? data.data.stepUpMethod
            : 'none',
        }
        rememberSessionSnapshot(snapshot)
        // 「消した」印の正本は共有の localStorage。新規タブ・再読込では
        // 印が残るので他タブの店舗選択を消さず、ログインし直しのときだけ
        // 一度だけ消える（NEXT-07）。sessionStorage の残存印も残存扱いにする。
        clearSelectionAfterAuthentication(localStorage, sessionStorage)
        // 確認した時点の指紋で記憶する（CSRF更新を受けたなら新しい値で）。
        const confirmedFingerprint = sessionFingerprint(handoffToken)
        lastSessionCheck = { at: Date.now(), fingerprint: confirmedFingerprint, tenantStatus: nextTenantStatus }
        // 読み直しても中身を先に出せるよう、このタブに印を残す（停止中は残さない）。
        rememberAuthCheck(confirmedFingerprint, nextTenantStatus, snapshot)
        if (!cancelled) setChecked(true)
      } catch {
        // 古い確認の失敗で新しいログインの状態を消さない。送りもしない。
        if (cancelled || mySeq !== authSessionCheckSeq) return
        if (sessionFingerprint(handoffToken) !== myFingerprint) {
          recheckAfterStale()
          return
        }
        lastSessionCheck = null
        forgetSessionSnapshot()
        forgetAuthCheck()
        if (!cancelled) router.replace('/login')
      }
    }

    runSessionCheck(checkSeq, startFingerprint)
    return () => {
      cancelled = true
      window.removeEventListener(SESSION_LOST_EVENT, invalidate)
      window.removeEventListener('storage', onStorage)
    }
  }, [pathname, router])

  // 初めての確認（開いた直後・ログイン直後）だけ。くるくるではなく外枠の骨組みで待つ。
  if (!checked) return <AuthPendingShell />

  if ((tenantStatus === 'suspended' || tenantStatus === 'archived') && !pathname.startsWith('/hq/support')) {
    return <TenantAccessProvider status={tenantStatus}><TenantSuspended /></TenantAccessProvider>
  }

  if ((tenantStatus === 'suspended' || tenantStatus === 'archived') && pathname.startsWith('/hq/support') && suspendedSupport) {
    return <TenantAccessProvider status={tenantStatus}>{suspendedSupport}</TenantAccessProvider>
  }

  return <TenantAccessProvider status={tenantStatus}>{children}</TenantAccessProvider>
}
