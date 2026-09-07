'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Folder } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from './media-button'
import Select from '@/components/shared/select'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { MEDIA_ACCEPT, putMediaFile, validateMediaFile } from './media-direct-upload'

type UploadState = 'ready' | 'preparing' | 'uploading' | 'verifying' | 'done' | 'error'

type UploadEntry = {
  file: File
  state: UploadState
  message: string
  retryable: boolean
  progress: number
}

const LIMITS = [
  { label: '画像', note: 'JPG・PNG・GIF・WebP ／ 10MBまで' },
  { label: '音声', note: 'MP3・M4A ／ 200MBまで' },
  { label: '動画', note: 'MP4 ／ 200MBまで' },
  { label: 'PDF', note: '20MBまで。LINEでは直接送れないので、リンクとして使います' },
]

export default function MediaUploadDialog({
  open,
  accountId,
  folders,
  initialFolderId,
  onClose,
  onComplete,
}: {
  open: boolean
  accountId: string | null
  folders: Folder[]
  initialFolderId: string
  onClose: () => void
  onComplete: () => void
}) {
  const inputId = useId()
  const [mounted, setMounted] = useState(false)
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useOverlayFocus(open, onClose, busy)

  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    setEntries([])
    setFolderId(initialFolderId === '__ungrouped__' ? '' : initialFolderId)
    setBusy(false)
    setError('')
  }, [initialFolderId, open])

  const readyCount = useMemo(
    () => entries.filter((entry) => entry.state === 'ready').length,
    [entries],
  )
  const errorCount = entries.filter((entry) => entry.state === 'error').length

  function stage(files: File[]) {
    const next = files.slice(0, 20).map((file) => {
      const message = validateMediaFile(file)
      return { file, state: message ? 'error' : 'ready', message, retryable: false, progress: 0 } satisfies UploadEntry
    })
    setEntries(next)
    setError(files.length > 20 ? 'いちどに登録できるのは20件までです。先頭の20件を表示しています。' : '')
  }

  async function uploadReady() {
    if (!accountId || readyCount === 0 || busy) return
    setBusy(true)
    setError('')
    let completed = 0
    const pending = entries
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => entry.state === 'ready')
    setEntries((current) => current.map((entry) => (
      entry.state === 'ready' ? { ...entry, state: 'preparing', message: '送信を準備しています', progress: 0 } : entry
    )))
    try {
      const prepared = await api.media.prepareUploads({
        accountId,
        files: pending.map(({ entry }) => ({
          filename: entry.file.name,
          mimeType: entry.file.type,
          sizeBytes: entry.file.size,
          folderId: folderId || null,
        })),
      })
      if (!prepared.success || prepared.data.sessions.length !== pending.length) {
        throw new Error('送信の準備結果を確認できませんでした')
      }
      for (let position = 0; position < pending.length; position += 1) {
        const selected = pending[position]
        const session = prepared.data.sessions[position]
        if (!selected || !session) continue
        const { index, entry } = selected
        try {
          setEntries((current) => current.map((item, entryIndex) => (
            entryIndex === index ? { ...item, state: 'uploading', message: '送信中 0%', progress: 0 } : item
          )))
          const etag = await putMediaFile(session, entry.file, (progress) => {
            setEntries((current) => current.map((item, entryIndex) => (
              entryIndex === index
                ? { ...item, progress, message: `送信中 ${progress}%` }
                : item
            )))
          })
          setEntries((current) => current.map((item, entryIndex) => (
            entryIndex === index ? { ...item, state: 'verifying', message: '中身を確認しています', progress: 100 } : item
          )))
          const response = await api.media.completeUpload(session.id, { accountId, etag })
          if (!response.success || response.data.status !== 'completed') throw new Error('登録を完了できませんでした')
          completed += 1
          setEntries((current) => current.map((item, entryIndex) => (
            entryIndex === index ? { ...item, state: 'done', message: '入りました', retryable: false, progress: 100 } : item
          )))
        } catch (caught) {
          const message = caught instanceof ApiError || caught instanceof Error
            ? caught.message
            : '登録できませんでした'
          setEntries((current) => current.map((item, entryIndex) => (
            entryIndex === index ? { ...item, state: 'error', message, retryable: true } : item
          )))
        }
      }
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error
        ? caught.message
        : '送信を準備できませんでした'
      setEntries((current) => current.map((item) => (
        item.state === 'preparing' ? { ...item, state: 'error', message, retryable: true } : item
      )))
      setError(message)
    }
    setBusy(false)
    if (completed > 0) onComplete()
  }

  if (!open) return null

  const overlay = (
    <div
      className="bg-ink/40 fixed inset-0 z-90 flex items-center justify-center overflow-y-auto p-4"
      data-design-node="eXAJP"
      role="presentation"
      onMouseDown={(event) => {
        if (!busy && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${inputId}-title`}
        aria-busy={busy || undefined}
        tabIndex={-1}
        className="border-hairline max-h-screen w-full max-w-2xl overflow-y-auto rounded-card border bg-canvas shadow-xl"
      >
        <div className="border-hairline border-b px-6 py-4">
          <h2 id={`${inputId}-title`} className="text-ink text-xl font-bold">ファイルを入れる</h2>
        </div>
        <div className="space-y-4 p-6">
        <label
          htmlFor={inputId}
          className="border-info text-info rounded-card flex min-h-32 cursor-pointer flex-col items-center justify-center border border-dashed p-5 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            stage([...event.dataTransfer.files])
          }}
        >
          <span className="text-sm font-bold">ここにファイルをドラッグ、または押して選ぶ</span>
          <span className="text-ink-faint mt-1 text-xs">いちどに20件まで</span>
        </label>
        <input
          id={inputId}
          type="file"
          multiple
          accept={MEDIA_ACCEPT}
          className="sr-only"
          onChange={(event) => stage([...(event.target.files ?? [])])}
        />

        <div className="bg-info-bg text-info rounded-control p-3 text-xs leading-5">
          <p className="font-bold">LINEで送れる大きさ（超えると入れられません）</p>
          {LIMITS.map((limit) => <p key={limit.label}>{limit.label} {limit.note}</p>)}
          <p className="mt-2 font-semibold">大きなファイルも管理画面を経由せず、保存先へ直接送ります。</p>
          <p className="mt-2 font-semibold">中身の形式とファイル名の拡張子が食い違うものは保存できません。</p>
          <p className="font-semibold">公開リンクが作られるため、個人情報の取り扱いに注意してください。</p>
        </div>

        {entries.length > 0 ? (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-ink text-sm font-bold">入れているもの</p>
              <p className="text-ink-faint text-xs">{entries.length}件中 {entries.filter((entry) => entry.state === 'done').length}件 完了</p>
            </div>
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {entries.map((entry, index) => (
                <li key={`${entry.file.name}-${entry.file.size}-${index}`} aria-live="polite" className={`rounded-control border p-3 ${entry.state === 'error' ? 'border-danger-bg bg-danger-bg' : 'border-hairline'}`}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-ink min-w-0 truncate text-xs font-semibold" title={entry.file.name}>{entry.file.name}</span>
                    <span className={`shrink-0 text-xs font-semibold ${entry.state === 'error' ? 'text-danger' : entry.state === 'done' ? 'text-success' : 'text-ink-faint'}`}>
                      {entry.message || '登録できます'}
                    </span>
                  </div>
                  <p className="text-ink-faint mt-1 text-xs">{(entry.file.size / 1024 / 1024).toFixed(1)}MB</p>
                  {entry.state === 'done' ? <div className="bg-success mt-2 h-1 w-full rounded-pill" aria-hidden="true" /> : null}
                  {entry.state === 'uploading' || entry.state === 'preparing' || entry.state === 'verifying' ? (
                    <progress className="mt-2 h-1 w-full" max={100} value={entry.progress} aria-label={`${entry.file.name}の送信進捗`} />
                  ) : null}
                  {entry.state === 'error' ? <div className="bg-danger mt-2 h-1 w-full rounded-pill" aria-hidden="true" /> : null}
                  {entry.state === 'error' && entry.retryable ? (
                    <button
                      type="button"
                      className="text-action mt-2 text-xs font-bold"
                      onClick={() => setEntries((current) => current.map((item, entryIndex) => (
                        entryIndex === index ? { ...item, state: 'ready', message: '', retryable: false, progress: 0 } : item
                      )))}
                    >
                      この1件を再試行
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <label htmlFor={`${inputId}-folder`} className="text-ink-secondary mb-1 block text-xs font-semibold">入れるフォルダ</label>
          <Select
            aria-label="入れるフォルダ"
            value={folderId}
            options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
            onChange={setFolderId}
          />
        </div>
        </div>
        {error ? <p className="bg-danger-bg text-danger mx-6 mb-4 rounded-control p-3 text-xs" role="alert">{error}</p> : null}
        <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-6 py-4">
          <p className={errorCount > 0 ? 'text-danger text-xs font-semibold' : 'text-ink-faint text-xs'}>
            {errorCount > 0 ? `${errorCount}件は登録できません` : `${entries.length}件を選択中`}
          </p>
          <div className="flex items-center gap-2">
            <Button type="button" onClick={onClose} disabled={busy}>閉じる</Button>
            <Button type="button" variant="primary" onClick={() => void uploadReady()} disabled={busy || readyCount === 0 || !accountId}>
              {busy ? '登録しています…' : `${readyCount}件を登録する`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )

  return mounted && typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay
}
