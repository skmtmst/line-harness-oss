'use client'
import { useCallback, useEffect, useState } from 'react'
import type { ApiResponse } from '@line-crm/shared'
import { fetchApi, describeSaveFailure } from '@/lib/api'
import { useStepUpGate } from '@/components/step-up-prompt'
import FormSection from '@/components/shared/form-section'
import { AuthDetailRow, AuthHelp } from '@/components/templates/auth-page'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Dialog from '@/components/shared/dialog'
import OtpInput from '@/components/shared/otp-input'
import TotpQr from '@/components/shared/totp-qr'
import { RecoveryCodePanel } from '@/v8/login/public/recovery-codes/index'
import { qrToDataURL } from '@/lib/qr-image'
import { readSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { forgetAuthCheck } from '@/lib/auth-check-marker'
import { logoutAndGoToLogin } from '@/lib/logout'
import { formatDate } from '@/lib/format'

type Self = { staffId: string; enabledAt: string | null; remaining: number | null; canEdit: boolean; notice: string | null }
export default function SelfMfa({ loginPath = '/login' }: { loginPath?: '/login' | '/ops/login' }) {
  const [self, setSelf] = useState<Self | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [relogin, setRelogin] = useState(false)
  const [codes, setCodes] = useState<string[]>([])
  const [setup, setSetup] = useState<{ manualKey: string; qr: string } | null>(null)
  const [code, setCode] = useState('')
  const stepUp = useStepUpGate()
  const load = useCallback(async () => {
    try { const res = await fetchApi<ApiResponse<Self>>('/api/auth/two-factor/self'); if (!res.success) throw new Error(res.error); setSelf(res.data) }
    catch (caught) { setError(describeSaveFailure(caught)) }
  }, [])
  useEffect(() => { void load() }, [load])
  const regenerate = async () => {
    if (busy || !self) return
    setBusy(true); setError('')
    try {
      const token = await stepUp.gate('auth.mfa.recovery', '回復コードを作り直す（前のコードは全部無効になります）')
      if (!token) return
      const res = await fetchApi<ApiResponse<{ recoveryCodes: string[] }>>('/api/auth/two-factor/recovery', { method: 'POST', headers: { 'X-Step-Up-Token': token }, body: '{}' })
      if (!res.success) throw new Error(res.error)
      const snapshot = readSessionSnapshot()
      if (snapshot) rememberSessionSnapshot({ ...snapshot, recoveryCodesRemaining: 8 })
      forgetAuthCheck()
      setCodes(res.data.recoveryCodes); setSelf({ ...self, remaining: 8 })
    } catch (caught) { setError(describeSaveFailure(caught)) }
    finally { setBusy(false) }
  }
  const reenroll = async () => {
    if (busy || !self) return
    setBusy(true); setError('')
    try {
      const token = self.enabledAt ? await stepUp.gate('auth.mfa.reenroll', '認証アプリを登録し直す') : null
      if (self.enabledAt && !token) return
      const res = await fetchApi<ApiResponse<{ manualKey: string; provisioningUri: string }>>(`/api/staff/${encodeURIComponent(self.staffId)}/two-factor/setup`, { method: 'POST', headers: token ? { 'X-Step-Up-Token': token } : undefined, body: '{}' })
      if (!res.success) throw new Error(res.error)
      setCode(''); setSetup({ manualKey: res.data.manualKey, qr: await qrToDataURL(res.data.provisioningUri, { width: 200, margin: 1 }) })
    } catch (caught) { setError(describeSaveFailure(caught)) }
    finally { setBusy(false) }
  }
  const confirmSetup = async () => {
    if (busy || !self || code.length !== 6) return
    setBusy(true); setError('')
    try {
      const res = await fetchApi<ApiResponse<{ recoveryCodes: string[] }>>(`/api/staff/${encodeURIComponent(self.staffId)}/two-factor/confirm`, { method: 'POST', body: JSON.stringify({ code }) })
      if (!res.success) throw new Error(res.error)
      setRelogin(true); setCodes(res.data.recoveryCodes); setSetup(null)
    } catch (caught) { setError(describeSaveFailure(caught)); setCode('') }
    finally { setBusy(false) }
  }
  return <>
    {self?.remaining !== null && self?.remaining !== undefined && self.remaining <= 2 ? <Notice tone="info" message={`回復コードの残りが${self.remaining}個です。認証アプリが使えない時に入れなくなる前に、作り直してください。`} /> : null}
    <FormSection id="self-mfa-title" title="自分の二段階認証" description="このアカウントでログインする時の確かめ">
      {error ? <Notice tone="danger" message={error} /> : null}
      {self?.notice ? <Notice tone="warn" message={self.notice} /> : null}
      <AuthDetailRow label="認証アプリ" value={self ? self.enabledAt ? `登録済み（${formatDate(self.enabledAt, { style: 'day' })}）` : '未登録' : '—'} actions={self?.canEdit ? <Button disabled={busy} onClick={reenroll}>{self.enabledAt ? '登録し直す' : '登録する'}</Button> : undefined} />
      <AuthDetailRow label="回復コード" value={`残り ${self?.remaining ?? '—'} / 8 個`} actions={self?.canEdit && self.enabledAt ? <Button disabled={busy} onClick={regenerate}>回復コードを作り直す</Button> : undefined} />
      <AuthHelp>作り直すと、前のコードは全部使えなくなります。新しい8個は、作った時に1回だけ表示します。</AuthHelp>
    </FormSection>
    <Dialog open={codes.length > 0} title="回復コードを控えてください" description="認証アプリが使えない時に、1つにつき1回だけ使えます。" onCancel={() => { setCodes([]); if (relogin) void logoutAndGoToLogin(loginPath); else void load() }} cancelLabel="閉じる">
      <RecoveryCodePanel codes={codes} continueLabel="控えました" onContinue={() => { setCodes([]); if (relogin) void logoutAndGoToLogin(loginPath); else void load() }} />
    </Dialog>
    <Dialog open={Boolean(setup)} title="二段階認証を設定" onCancel={() => setSetup(null)} confirmLabel="登録する" onConfirm={() => confirmSetup()} confirmDisabled={code.length !== 6} busy={busy} error={error}>
      {setup ? <><TotpQr {...setup} /><OtpInput visualLabel="認証コード（6桁）" label="認証コード（6桁）" value={code} onChange={setCode} busy={busy} /></> : null}
    </Dialog>
    {stepUp.prompt}
  </>
}
