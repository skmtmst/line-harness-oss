'use client'
import { useEffect, useState } from 'react'
import { api, fetchApi } from '@/lib/api'
import { Field } from './form-controls'
import { TextField } from './text-field'
import Button from './button'
export default function FormDocumentRetention({ accountId }: { accountId: string }) {
  const [days, setDays] = useState('')
  const [status, setStatus] = useState('')
  const [busy, setBusy] = useState(false)
  const [readOnly, setReadOnly] = useState(true)
  useEffect(() => {
    let active = true
    setDays(''); setStatus(''); setReadOnly(true)
    void Promise.all([api.staff.me(), fetchApi<{ data: { identityRetentionDays: number } }>(`/api/forms/document-settings/${encodeURIComponent(accountId)}`)])
      .then(([me, response]) => { if (active) { setDays(String(response.data.identityRetentionDays)); setReadOnly(!me.success || !['owner', 'admin'].includes(me.data.role)); } })
      .catch(() => { if (active) setStatus('保存日数を読み込めませんでした') })
    return () => { active = false }
  }, [accountId])
  const save = async () => {
    const value = Number(days)
    if (!Number.isInteger(value) || value < 1 || value > 3650) { setStatus('1〜3650日で入力してください'); return }
    setBusy(true); setStatus('')
    try {
      await fetchApi(`/api/forms/document-settings/${encodeURIComponent(accountId)}`, { method: 'PUT', body: JSON.stringify({ identityRetentionDays: value }) })
      setStatus('保存しました')
    } catch { setStatus('保存できませんでした。もう一度お試しください') }
    finally { setBusy(false) }
  }
  return <Field label="本人確認書類を保存する日数" note="これから受け取る書類に使います。期限を過ぎると自動で消します。">
    <TextField aria-label="本人確認書類を保存する日数" type="number" min={1} max={3650} value={days} readOnly={readOnly} disabled={busy} onChange={e => setDays(e.target.value)} />
    {!readOnly ? <Button onClick={() => void save()} disabled={busy || !days} busy={busy}>保存する</Button> : null}
    {status ? <p role="status">{status}</p> : null}
  </Field>
}
