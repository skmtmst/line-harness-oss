'use client'

import { useEffect, useState, type FormEvent } from 'react'
import Header from '@/components/layout/header'
import Button from '@/components/shared/button'
import { api } from '@/lib/api'

export default function HqSettingsPage() {
  const [name, setName] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let cancelled = false
    void api.tenants.me()
      .then((response) => {
        if (!cancelled && response.success) setName(response.data.name)
      })
      .catch(() => {
        if (!cancelled) setError('統括名を読み込めませんでした。時間をおいてもう一度お試しください。')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [])

  const save = async (event: FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    setSaved(false)
    if (!trimmed) {
      setError('統括名を入力してください。')
      return
    }
    if (trimmed.length > 100) {
      setError('統括名は100文字以内で入力してください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const response = await api.tenants.updateName(trimmed)
      if (!response.success) throw new Error(response.error)
      setName(response.data.name)
      setSaved(true)
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '統括名を保存できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div data-design="Head"><Header title="統括設定" description="統括コンソールに表示する名前を管理します。" /></div>
      <form data-design="Form" onSubmit={save} className="max-w-2xl rounded-card border border-hairline bg-canvas p-6 shadow-sm">
        <label htmlFor="tenant-name" className="block text-sm font-semibold text-ink">統括名</label>
        <p className="mt-1 text-xs text-ink-secondary">100文字以内で入力してください。</p>
        <input
          id="tenant-name"
          name="tenantName"
          type="text"
          required
          maxLength={100}
          disabled={loading || saving}
          value={name}
          onChange={(event) => { setName(event.target.value); setSaved(false) }}
          className="mt-3 w-full rounded-control border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-accent disabled:opacity-60"
        />
        {error ? <p className="mt-3 text-sm text-danger" role="alert">{error}</p> : null}
        {saved ? <p className="mt-3 text-sm text-success" role="status">保存しました。</p> : null}
        <div className="mt-5">
          <Button type="submit" variant="primary" disabled={loading || saving}>{saving ? '保存中…' : '保存'}</Button>
        </div>
      </form>
    </div>
  )
}
