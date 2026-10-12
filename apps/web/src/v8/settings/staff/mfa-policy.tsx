'use client'
import { useEffect, useState } from 'react'
import { describeSaveFailure, fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'
import Toggle from '@/components/shared/toggle'
import FormSection from '@/components/shared/form-section'
import Notice from '@/components/shared/notice'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import ListState from '@/components/shared/list-state'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { useStepUpGate } from '@/components/step-up-prompt'

type Policy = { required: boolean; canEdit: boolean; impersonating?: boolean }
export default function MfaPolicy({ loginPath = '/login' }: { loginPath?: '/login' | '/ops/login' }) {
  const saveErrors = useSaveFormErrors()
  const [policy, setPolicy] = useState<Policy | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [turnOn, setTurnOn] = useState(false)
  const stepUp = useStepUpGate()
  const load = async () => {
    setError('')
    try { const result = await fetchApi<ApiResponse<Policy>>('/api/auth/two-factor/policy'); if (!result.success) throw new Error(result.error); setPolicy(result.data) }
    catch { setError('二段階認証の設定を読み込めませんでした') }
  }
  useEffect(() => { void load() }, [])
  const save = async (required: boolean) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const token = required ? null : await stepUp.gate('auth.mfa.policy', 'ログインの二段階認証をOffにする')
      if (!required && !token) return
      const result = await fetchApi<ApiResponse<{ required: boolean; relogin: boolean }>>('/api/auth/two-factor/policy', {
        method: 'PUT', headers: token ? { 'X-Step-Up-Token': token } : undefined, body: JSON.stringify({ required }),
      })
      if (!result.success) throw new Error(result.error)
      const data = result.data
      setPolicy(current => current ? { ...current, required: data.required } : null)
      setTurnOn(false)
      if (data.relogin) window.location.assign(loginPath)
    } catch (caught) { if (!saveErrors.capture(caught)) setError(describeSaveFailure(caught)) }
    finally { setBusy(false) }
  }
  if (policy?.impersonating) return null
  return <SaveErrorScope errors={saveErrors}><FormSection id="mfa-policy-title" title="ログインの二段階認証" description="この統括の全員に適用します。Offでも、本人が登録した二段階認証は使います。"
    action={policy?.canEdit ? <SaveErrorField names={["required"]}><Toggle checked={policy.required} label="ログインで二段階認証を必須にする" disabled={busy} onChange={value => value ? setTurnOn(true) : void save(false)} /></SaveErrorField> : undefined}>
    {error ? <Notice tone="danger" message={error} /> : null}
    {policy ? <Notice tone="info" message={`ログインで二段階認証を必須にする：${policy.required ? 'On' : 'Off'}`} /> : <ListState kind={error ? 'error' : 'loading'} onRetry={() => void load()} />}
    <ConfirmDialog open={turnOn} title="二段階認証をOnにする" description="全員が一度ログアウトします。まだ登録していない人は、次のログインで登録できます。" confirmLabel="Onにする" onConfirm={() => void save(true)} onCancel={() => setTurnOn(false)} busy={busy} error={error} />
    {stepUp.prompt}
  </FormSection></SaveErrorScope>
}
