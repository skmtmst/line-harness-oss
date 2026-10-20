'use client'
import { twoFactorFailureMessage } from '@/v8/login/two-factor/two-factor-error'
import { responseApiError } from '@/lib/api'
import { useEffect, useState } from 'react'
import { LogIn } from 'lucide-react'
import {
  adminSessionHandoffPath,
  adminSessionHeaders,
  captureTwoFactorChallenge,
  captureTwoFactorMethod,
  clearTwoFactorChallenge,
  storeAdminSession,
  takeTwoFactorNextPath,
  type TwoFactorMethod,
} from '@/lib/admin-session'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import OtpInput, { otpFailureMessage } from '@/components/shared/otp-input'
import styles from './two-factor-ops.module.css'
import { Field } from '@/components/shared/form-controls'
import { Steps } from '@/components/templates/steps'
import Card from '@/components/shared/card'
import SectionHeader from '@/components/shared/section-header'
import { AuthPage, AuthActions, AuthHelp } from '@/components/templates/auth-page'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'


/*
 * ★V8-B 運営 ログイン 2段目（板 「6桁の確認」）。
 *
 * 運営のログイン（/ops/login）でパスワードを確かめたあと、`/login/two-factor?next=ops#lh_2fa=…`
 * で来たときだけ出す。動き（合言葉の受け取り・確認の口・運営権限の確かめ・失敗の文）は
 * 管理画面 の app/login/two-factor/page.tsx と同じ。見た目だけ絵どおりに1枚のカードへまとめた。
 */

/* 通信断・JSON でない返事は技術文言を出さない（管理画面 の two-factor-error と同じ決まりを写した）。 */
export function opsTwoFactorFailureMessage(caught: unknown, fallback = '認証できませんでした'): string {
  return twoFactorFailureMessage(caught, fallback)
}

export default function OpsTwoFactorV8({ scope = 'ops', brandName }: { scope?: 'ops' | 'admin'; brandName?: string }) {
  const saveErrors = useSaveFormErrors()
  const [typedCode, setCode] = useState('')
  const [recovery, setRecovery] = useState(false)
  const [succeeded, setSucceeded] = useState(false)
  /** 失敗のたびに6マスを作り直し、1マス目へ戻す。 */
  const [attempt, setAttempt] = useState(0)
  const [challenge, setChallenge] = useState('')
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [method, setMethod] = useState<TwoFactorMethod>('line')

  // 方法の受け取りは合言葉より先に（合言葉の受け取りで hash が消えるため。管理画面 と同じ順）。
  useEffect(() => { setMethod(captureTwoFactorMethod()); setChallenge(captureTwoFactorChallenge()); setReady(true) }, [])

  const missingChallenge = ready && !challenge

  const finish = (href: string) => {
    setSucceeded(true)
    window.setTimeout(() => window.location.assign(href), 420)
  }

  /* 6桁目が入った瞬間に送る（送るボタンも残す）。送っている間・送り終えた後は二重に送らない。 */
  const submit = async (entered?: string) => {
    const code = entered ?? typedCode
    if (loading || succeeded) return
    if (!challenge) return setError('ログインの情報が見つかりませんでした。ログインからやり直してください。')
    if (recovery && code.length !== 8) return setError('8文字の回復コードを入力してください')
    if (!recovery && code.length !== 6) return setError('6桁の認証コードを入力してください')
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/two-factor/verify`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken: challenge, code: recovery ? `${code.slice(0, 4)}-${code.slice(4)}` : code }),
      })
      const body = await response.json() as { success: boolean; error?: string; data?: { sessionToken?: string }; csrfToken?: string }
      if (!response.ok || !body.success) throw responseApiError(response, JSON.stringify(body), undefined, undefined, { preserveBodyMessage: true, fallbackMessage: '認証できませんでした' })
      if (body.data?.sessionToken) storeAdminSession(body.data.sessionToken, body.csrfToken)
      else if (body.csrfToken) {
        try { localStorage.setItem('lh_csrf', body.csrfToken) } catch (saveFailure) {
          saveErrors.capture(saveFailure) /* Cookie のセッションで足りる */ }
      }
      const nextPath = takeTwoFactorNextPath()
      // 運営へ戻す前に、セッションと運営権限を確かめる（省くと /ops/login との往復になる）。
      if (nextPath === '/ops') {
        const session = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/auth/session`, {
          credentials: 'include',
          headers: adminSessionHeaders(body.data?.sessionToken),
        })
        const sessionBody = await session.json().catch(() => ({})) as { success?: boolean; data?: { platformAdmin?: boolean; platformAdminState?: string | null } }
        if (!session.ok || !sessionBody.success || !sessionBody.data) {
          throw new Error('ログイン状態を確認できませんでした。もう一度ログインしてください')
        }
        if (!sessionBody.data.platformAdmin) {
          if (sessionBody.data.platformAdminState === 'awaiting_totp') {
            clearTwoFactorChallenge()
            finish(adminSessionHandoffPath('/ops/two-factor', body.data?.sessionToken, body.csrfToken))
            return
          }
          throw new Error('このアカウントは運営メンバーとして有効ではありません。招待メールのリンクから登録を完了してください')
        }
      }
      clearTwoFactorChallenge()
      finish(adminSessionHandoffPath(nextPath, body.data?.sessionToken, body.csrfToken))
    } catch (caught) {
      const fieldFailure = saveErrors.capture(caught)

      { if (!fieldFailure)

      setError(otpFailureMessage(opsTwoFactorFailureMessage(caught))) }
      setCode('')
      setAttempt((current) => current + 1)
    } finally { setLoading(false) }
  }

  return (
    <SaveErrorScope errors={saveErrors}><AuthPage layout={scope} brandName={brandName} title={recovery ? "回復コードでログイン" : scope === 'admin' ? "二段階認証" : "6桁の確認"} steps={ready && challenge && scope === 'admin' ? <Steps label="ログインの手順" steps={[{ label: method === 'password' ? 'メールログイン' : 'LINEログイン', state: 'done' }, { label: recovery ? '回復コード' : '二段階認証', state: 'current' }]} /> : undefined} boardId={recovery ? undefined : 'tOPeY'} titleId="ops-two-factor-title" help={scope === 'admin' && recovery ? '登録の時に控えた回復コードを1つ入れてください。使ったコードは、もう使えません。' : undefined}>

        {scope === 'ops' && ready && challenge ? <AuthHelp>{recovery ? '登録の時に控えた回復コードを1つ入れてください。使ったコードは、もう使えません。' : `${method === 'password' ? 'パスワード' : 'LINEでのログイン'}を確かめました。認証アプリに出ている6桁を入れてください。認証アプリが使えないときは、運営のオーナーに連絡してください。`}</AuthHelp> : null}

        {missingChallenge ? (
          <Notice tone="info" id="ops-two-factor-missing" message="ログインの情報が見つかりませんでした。ログインからやり直してください。" action={<Button variant="text" size="inline" href={scope === 'ops' ? '/ops/login' : '/login'} onClick={clearTwoFactorChallenge}>ログインに戻る</Button>} />
        ) : error ? <Notice tone="danger" id="ops-two-factor-error" message={error} /> : null}
        <Field density="input" contentGap={12} optional={false} label={<span id="ops-two-factor-code-label">{recovery ? '回復コード（8文字）' : '認証コード（6桁）'}</span>}>
          <SaveErrorField names={["typedCode","code"]} key={`${recovery}-${attempt}`}><OtpInput
            length={recovery ? 8 : 6} format={recovery ? 'recovery' : 'digits'} id={recovery ? 'recovery-code' : undefined}
            value={typedCode} onComplete={recovery ? undefined : entered => void submit(entered)}
            onChange={next => { setCode(next); if (error) setError('') }} labelledBy="ops-two-factor-code-label"
            describedBy={missingChallenge ? 'ops-two-factor-missing' : error ? 'ops-two-factor-error' : undefined}
            invalid={Boolean(error)} success={succeeded} busy={loading} disabled={missingChallenge || succeeded} autoFocus
          /></SaveErrorField>
        </Field>
        {recovery ? <><AuthHelp>控えた8個のうち、まだ使っていない1つを入れます。貼り付けもできます。</AuthHelp><AuthHelp>回復コードも無い時は、オーナー（運営）に連絡して、登録をやり直します。</AuthHelp></> : scope === 'admin' ? <p className={styles.foot}>コードは約30秒ごとに更新されます</p> : null}
        <Button
          variant="primary" fullWidth
          className={styles.submit}
          onClick={() => void submit()}
          disabled={loading || missingChallenge || succeeded || (recovery ? typedCode.length !== 8 : scope === 'admin' && typedCode.length !== 6)}
          busy={loading || succeeded}
          busyLabel="確認しています…"
        >
          {scope === 'ops' && !recovery ? <LogIn aria-hidden="true" className={styles.icon} /> : null}{scope === 'ops' && !recovery ? 'ログイン' : '確認してログイン'}
        </Button>
        <Card surface="muted" padding="compact" layout="vertical" gap="normal">
          <SectionHeader title={recovery ? '認証アプリが手元に在る時' : 'コードを入力できない場合'} />
          <AuthActions><Button variant="text" size="inline" disabled={loading || succeeded} onClick={() => { setRecovery(value => !value); setCode(''); setError('') }}>{recovery ? '6桁のコードで入る' : '回復コードを使う'}</Button>
            <Button variant="text" size="inline" href={scope === 'ops' ? '/ops/login' : '/login'} onClick={clearTwoFactorChallenge}>ログインに戻る</Button>
            {scope === 'admin' && !recovery && challenge && method === 'line' ? <Button variant="text" size="inline" href="/login" onClick={clearTwoFactorChallenge}>別のLINEアカウントでログイン</Button> : null}
          </AuthActions>
        </Card>

    </AuthPage></SaveErrorScope>
  )
}
