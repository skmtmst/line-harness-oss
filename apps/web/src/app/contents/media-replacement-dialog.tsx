'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { MediaItem, MediaReplacementImpact } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from './media-button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { checkedAtText, referenceKindText, referenceNameText } from './media-delete-impact'

export default function MediaReplacementDialog({
  source,
  items,
  accountId,
  onClose,
  onComplete,
}: {
  source: MediaItem | null
  items: MediaItem[]
  accountId: string | null
  onClose: () => void
  onComplete: (message: string) => void
}) {
  const requestRef = useRef(0)
  const candidates = useMemo(
    () => source ? items.filter((item) => item.id !== source.id && item.kind === source.kind) : [],
    [items, source],
  )
  const [replacementId, setReplacementId] = useState('')
  const [impact, setImpact] = useState<MediaReplacementImpact | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    requestRef.current += 1
    setReplacementId('')
    setImpact(null)
    setPhase('idle')
    setBusy(false)
    setError('')
  }, [source])

  async function selectReplacement(id: string) {
    setReplacementId(id)
    setImpact(null)
    setError('')
    if (!source || !accountId || !id) {
      setPhase('idle')
      return
    }
    const request = requestRef.current + 1
    requestRef.current = request
    setPhase('loading')
    try {
      const response = await api.media.replacementImpact(source.id, id, accountId)
      if (requestRef.current !== request) return
      if (!response.success) throw new Error(response.error)
      setImpact(response.data)
      setPhase('ready')
    } catch (caught) {
      if (requestRef.current !== request) return
      setPhase('error')
      setError(caught instanceof Error ? caught.message : '差し替えたときの影響を確認できませんでした')
    }
  }

  async function replace() {
    if (!source || !accountId || !impact || !impact.canReplace || busy) return
    setBusy(true)
    setError('')
    try {
      const response = await api.media.replaceUsages(source.id, accountId, {
        replacementMediaId: impact.replacement.id,
        expectedRevision: impact.revision,
      })
      if (!response.success) throw new Error(response.error)
      const verification = response.data.verification === 'verified'
        ? '差し替え後の使用先も確認できました。'
        : '差し替えは完了しましたが、残りの使用先は確認中です。'
      onComplete(`${response.data.replacedUsageCount}か所を「${impact.replacement.filename}」へ差し替えました。${verification}`)
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : '使用先を差し替えられませんでした'
      setError(message)
      setBusy(false)
      if (caught instanceof ApiError && caught.status === 409 && caught.data) {
        setImpact(caught.data as MediaReplacementImpact)
        setPhase('ready')
      }
    }
  }

  return (
    <Dialog
      open={source !== null}
      title={source ? `「${source.filename}」の使用先を差し替える` : ''}
      description="元のメディアは消さず、使われている場所だけを既存の別メディアへ付け替えます。"
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={(
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" onClick={onClose} disabled={busy}>閉じる</Button>
          <Button type="button" variant="primary" onClick={() => void replace()} disabled={busy || !impact?.canReplace}>
            {busy ? '差し替えています…' : '使用先を差し替える'}
          </Button>
        </div>
      )}
    >
      <div className="space-y-4">
        <div>
          <label className="text-ink-secondary mb-1 block text-xs font-semibold">差し替え先</label>
          <Select
            aria-label="差し替え先"
            value={replacementId}
            options={[{ value: '', label: '別のメディアを選択' }, ...candidates.map((item) => ({ value: item.id, label: item.filename }))]}
            onChange={(value) => void selectReplacement(value)}
          />
          {candidates.length === 0 ? (
            <p className="text-ink-faint mt-2 text-xs">同じ種類の別メディアがありません。先に差し替え先を登録してください。</p>
          ) : null}
        </div>

        {phase === 'loading' ? (
          <p className="text-ink-faint text-xs">差し替わる場所を確認しています…</p>
        ) : phase === 'error' ? (
          <p className="text-danger text-xs" role="alert">影響を確認できませんでした。読み直してから、もう一度お試しください。</p>
        ) : impact ? (
          <div className="space-y-3">
            <div className={`rounded-control p-3 text-xs ${impact.canReplace ? 'bg-accent-soft text-accent-deep' : 'bg-danger-bg text-danger'}`}>
              {impact.canReplace
                ? `${impact.replaceableCount}か所すべてを差し替えられます。`
                : `${impact.usageCount}か所のうち${impact.replaceableCount}か所だけ差し替えられます。一括操作は実行しません。`}
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {impact.references.map((reference, index) => (
                <li key={`${reference.kind}-${index}`} className="border-hairline rounded-control border p-3 text-xs">
                  <p className="text-ink font-semibold">{referenceKindText(reference.kind)}「{referenceNameText(reference)}」</p>
                  <p className={reference.replaceable ? 'text-success mt-1' : 'text-danger mt-1'}>
                    {reference.replaceable ? '差し替えられます' : reference.reason || 'この画面からは差し替えられません'}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-ink-faint text-xs">{checkedAtText(impact.checkedAt)} 時点で確認</p>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
