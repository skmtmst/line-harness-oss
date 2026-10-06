'use client'

import HqSettingsNav from '@/app/hq/hq-settings-nav-v8'
import ReadonlyHeader from '@/app/hq/readonly-header-v8'
import '@/app/hq/readonly-v8.css'
import { useEffect, useState, type FormEvent } from 'react'
import Button from '@/components/shared/button'
import { TextField } from '@/components/shared/text-field'
import { usePageTitle } from '@/components/shell/page-chrome'
import { describeApiFailure, japaneseDetailOf } from '@/components/shared/api-error-message'
import { api } from '@/lib/api'
import './hq-settings-v8.css'

/**
 * 統括の情報。統括名の変更。
 * 旧「統括設定」の転送先（/hq/members?tab=tenant）はこの画面へ移した。
 */
export default function HqSettingsPage() {
  usePageTitle('統括の情報')
  const [canEdit, setCanEdit] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.staff.me()
      .then((response) => {
        if (!cancelled && response.success) {
          setCanEdit(response.data.role === 'owner' || response.data.role === 'admin')
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  return (
    <div data-design-node="K7HYu" className="flex flex-col gap-4">
      <ReadonlyHeader title="統括の情報" description="統括の名前です。各アカウントの画面の上と、メンバーへの招待メールに出ます。" />
      <div className="hq-settings-v8">
        <HqSettingsNav active="info" />
        <div className="hq-settings-v8__main">
          <TenantInfoTab canEdit={canEdit} />
          {/* 「運営による操作」は契約先には出さない（2026-10-06 利用者指定）。
              記録は残り続けるので、また見せるときは <OperatorHistory /> を戻すだけでよい。 */}
        </div>
      </div>
    </div>
  )
}

/** 「統括の情報」。統括名の変更（旧 /hq/members のタブ）。 */
function TenantInfoTab({ canEdit }: { canEdit: boolean }) {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!cancelled && response.success) setName(response.data.name ?? '')
      })
      .catch(() => {
        if (!cancelled) setError('統括名を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    const trimmed = name.trim()
    setSaved(false)
    if (!trimmed) return setError('統括名を入力してください。')
    if (trimmed.length > 100) return setError('統括名は100文字以内で入力してください。')
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name ?? trimmed)
      setSaved(true)
    } catch (caught) {
      // M026：再試行の言葉がない代替文にしない。共通の状態別案内へ渡す。
      setError(japaneseDetailOf(caught) || describeApiFailure(caught, '統括名の保存', {
        forbidden: '統括名の変更は管理者だけができます。必要なときは管理者の方に操作してもらってください。',
      }))
    } finally {
      setSaving(false)
    }
  }

  if (!canEdit) {
    return (
      <section className="rounded-card border border-hairline p-5">
        <dl><dt className="text-caption text-ink-secondary">統括名</dt><dd className="mt-2 text-label text-ink">{loading ? '読み込んでいます…' : error ? '読み込めませんでした' : name || '—'}</dd></dl>
        {error && <p role="alert" className="mt-2 text-caption text-danger">{error}</p>}
        <p className="mt-3 text-micro text-ink-faint">統括名の変更は管理者だけができます。</p>
      </section>
    )
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-card border border-hairline bg-canvas p-5">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="tenant-name" className="text-label font-medium text-ink">統括名</label>
        <TextField
          id="tenant-name"
          value={name}
          maxLength={100}
          disabled={loading || saving}
          onChange={(event) => { setName(event.target.value); setSaved(false) }}
          className="w-full"
        />
        <p className="text-micro text-ink-faint">会社名やブランド名など、メンバーが見てわかる名前にします</p>
      </div>
      {error ? <p className="text-label text-danger" role="alert">{error}</p> : null}
      {saved ? <p className="text-label text-accent-deep" role="status">保存しました。</p> : null}
      <div className="flex justify-end">
        <Button variant="primary" type="submit" disabled={loading || saving} busy={saving}>統括名を保存する</Button>
      </div>
    </form>
  )
}
