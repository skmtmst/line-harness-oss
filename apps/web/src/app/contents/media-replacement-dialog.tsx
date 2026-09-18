'use client'

import { useEffect, useRef, useState } from 'react'
import type { MediaItem, MediaReplacementImpact } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { checkedAtText, referenceKindText, referenceNameText } from './media-delete-impact'

export default function MediaReplacementDialog({
  source,
  accountId,
  onClose,
  onComplete,
}: {
  source: MediaItem | null
  accountId: string | null
  onClose: () => void
  onComplete: (message: string) => void
}) {
  const requestRef = useRef(0)
  const candidateRequestRef = useRef(0)
  const [candidates, setCandidates] = useState<MediaItem[]>([])
  const [candidateTotal, setCandidateTotal] = useState(0)
  const [candidatePage, setCandidatePage] = useState(1)
  /** 候補の読み込み状態。読込中・0件・失敗を分けて出す（N-205）。 */
  const [candidatePhase, setCandidatePhase] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading')
  /** 名前検索。確定した語だけをAPIへ送る（入力中の1文字ごとには呼ばない）。 */
  const [candidateQueryInput, setCandidateQueryInput] = useState('')
  const [candidateQuery, setCandidateQuery] = useState('')
  const [replacementId, setReplacementId] = useState('')
  const [impact, setImpact] = useState<MediaReplacementImpact | null>(null)
  const [phase, setPhase] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    requestRef.current += 1
    candidateRequestRef.current += 1
    setReplacementId('')
    setImpact(null)
    setPhase('idle')
    setBusy(false)
    setError('')
    setCandidatePage(1)
    setCandidateQueryInput('')
    setCandidateQuery('')
  }, [source])

  useEffect(() => {
    if (!source || !accountId) { setCandidates([]); setCandidateTotal(0); setCandidatePhase('empty'); return }
    const request = ++candidateRequestRef.current
    const requestedAccount = accountId
    setCandidatePhase('loading')
    void api.media.list(requestedAccount, {
      kind: source.kind,
      excludeId: source.id,
      query: candidateQuery || undefined,
      limit: 50,
      offset: (candidatePage - 1) * 50,
    })
      .then((response) => {
        // アカウント切替・窓の開き直し・検索で古くなった応答は捨てる。
        if (candidateRequestRef.current !== request) return
        if (!response.success) {
          setCandidatePhase('error')
          return
        }
        // 別アカウントの候補は出さない（共有 lineAccountId=null は残す）。
        const scoped = response.data.items.filter(
          (item) => item.lineAccountId == null || item.lineAccountId === requestedAccount,
        )
        setCandidates(scoped)
        setCandidateTotal(response.data.total)
        setCandidatePhase(scoped.length === 0 ? 'empty' : 'ready')
      })
      .catch(() => { if (candidateRequestRef.current === request) setCandidatePhase('error') })
  }, [accountId, candidatePage, candidateQuery, source])

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
          {/*
            N-205: 候補が多いと一覧から探せない。名前で絞り込み、
            絞り込んだ結果をそのままページ送りできる（検索とページングの併用）。
          */}
          <form
            className="mb-2 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              setCandidatePage(1)
              setCandidateQuery(candidateQueryInput.trim())
            }}
          >
            <input
              type="text"
              aria-label="差し替え候補を名前で検索"
              placeholder="名前で探す"
              value={candidateQueryInput}
              onChange={(event) => setCandidateQueryInput(event.target.value)}
              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
            <Button type="submit">検索</Button>
          </form>
          {candidatePhase === 'loading' ? (
            <p className="text-ink-faint mt-2 text-xs" role="status">差し替え候補を読み込んでいます…</p>
          ) : candidatePhase === 'error' ? (
            <p className="text-danger mt-2 text-xs" role="alert">差し替え候補を読み込めませんでした。読み直してから、もう一度お試しください。</p>
          ) : candidatePhase === 'empty' ? (
            <p className="text-ink-faint mt-2 text-xs">
              {candidateQuery
                ? `「${candidateQuery}」に合う候補が見つかりませんでした。`
                : '同じ種類の別メディアがありません。先に差し替え先を登録してください。'}
            </p>
          ) : (
            <>
              <Select
                aria-label="差し替え先"
                value={replacementId}
                options={[{ value: '', label: '別のメディアを選択' }, ...candidates.map((item) => ({ value: item.id, label: item.filename }))]}
                onChange={(value) => void selectReplacement(value)}
              />
              {candidateTotal > 50 ? (
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-ink-faint">候補 {candidateTotal}件{candidateQuery ? `（「${candidateQuery}」で絞り込み中）` : ''}</span>
                  <div className="flex gap-2">
                    <Button type="button" disabled={candidatePage <= 1} onClick={() => setCandidatePage((page) => page - 1)}>前へ</Button>
                    <Button type="button" disabled={candidatePage * 50 >= candidateTotal} onClick={() => setCandidatePage((page) => page + 1)}>次へ</Button>
                  </div>
                </div>
              ) : candidateQuery ? (
                <p className="text-ink-faint mt-2 text-xs">「{candidateQuery}」で絞り込み中（{candidateTotal}件）</p>
              ) : null}
            </>
          )}
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
