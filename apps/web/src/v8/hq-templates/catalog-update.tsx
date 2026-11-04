'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { fetchApi } from '@/lib/api'

type Pending = { id: string; name: string; version: number; snapshot: string; definition: { settings: Record<string, unknown> } }
type Kind = 'booking_menu' | 'mileage_reward'

/** 店で変更した品は、統括の新版を確認してから採用または維持する。 */
export default function CatalogUpdate({ accountId, targetId, kind, canEdit, onChanged }: { accountId: string; targetId: string; kind: Kind; canEdit: boolean; onChanged: () => void }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState('')
  const [choice, setChoice] = useState<'adopt' | 'keep' | null>(null)
  const [busy, setBusy] = useState(false)
  const path = `${kind === 'booking_menu' ? '/api/booking/admin/menus' : '/api/mileage/rewards'}/${encodeURIComponent(targetId)}/hq-update?accountId=${encodeURIComponent(accountId)}`
  useEffect(() => {
    let live = true
    setPending(null); setError(''); setChoice(null)
    void fetchApi<{ success: true; data: Pending | null }>(path).then(result => { if (live) setPending(result.data) }).catch(() => { if (live) setError('統括からの更新を確認できませんでした。読み直してください。') })
    return () => { live = false }
  }, [path])
  const decide = async () => {
    if (!pending || !choice || busy || !canEdit) return
    setBusy(true); setError('')
    try {
      await fetchApi(path, { method: 'POST', body: JSON.stringify({ decisionId: pending.id, snapshot: pending.snapshot, action: choice }) })
      setChoice(null); setPending(null); onChanged()
    } catch { setChoice(null); setError('内容が変わったか、更新できませんでした。一覧を読み直して再確認してください。') }
    finally { setBusy(false) }
  }
  if (!pending && !error) return null
  const settings = pending?.definition.settings
  return <>
    {error && <Notice tone="warn" density="compact">{error}</Notice>}
    {pending && <Notice tone="info" density="compact" footer={canEdit ? <><Button onClick={() => setChoice('keep')} disabled={busy}>店の版を維持</Button><Button onClick={() => setChoice('adopt')} disabled={busy}>統括の新版を採用</Button></> : undefined}>
      統括「{pending.name}」の版 {pending.version} が届いています。新版：{String(settings?.name ?? '')}{kind === 'booking_menu' ? `・${String(settings?.duration_minutes ?? '—')}分・${String(settings?.base_price ?? '—')}円` : `・${String(settings?.requiredMiles ?? '—')}マイル`}。
    </Notice>}
    <ConfirmDialog open={choice !== null} title={choice === 'adopt' ? '統括の新版を採用しますか？' : '店の版を維持しますか？'} description={choice === 'adopt' ? '確認した統括の版を反映します。' : '現在の店の内容を残し、今回の版を見送ります。'} confirmLabel={choice === 'adopt' ? '採用する' : '維持する'} busy={busy} onConfirm={() => void decide()} onCancel={() => { if (!busy) setChoice(null) }} />
  </>
}
