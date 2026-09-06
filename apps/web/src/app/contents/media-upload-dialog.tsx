'use client'

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { Folder } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from './media-button'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'

type UploadState = 'ready' | 'uploading' | 'done' | 'error'

type UploadEntry = {
  file: File
  state: UploadState
  message: string
}

const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,audio/mpeg,audio/mp4,application/pdf'

const LIMITS = [
  { label: '画像', note: 'JPG・PNG・GIF・WebP ／ 10MBまで' },
  { label: '音声', note: 'MP3・M4A ／ 30MBまで' },
  { label: '動画', note: 'MP4 ／ 90MBまで' },
  { label: 'PDF', note: '20MBまで。LINEでは直接送れないので、リンクとして使います' },
]

function limitBytes(file: File): number | null {
  if (file.type.startsWith('image/')) return 10 * 1024 * 1024
  if (file.type.startsWith('audio/')) return 30 * 1024 * 1024
  if (file.type === 'video/mp4') return 90 * 1024 * 1024
  if (file.type === 'application/pdf') return 20 * 1024 * 1024
  return null
}

function validate(file: File): string {
  const limit = limitBytes(file)
  if (limit == null) return 'この形式は登録できません'
  if (file.size > limit) return `${Math.round(limit / 1024 / 1024)}MBを超えています`
  return ''
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('読み取りに失敗しました'))
    reader.readAsDataURL(file)
  })
}

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
  const inputRef = useRef<HTMLInputElement>(null)
  const [entries, setEntries] = useState<UploadEntry[]>([])
  const [folderId, setFolderId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

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
      const message = validate(file)
      return { file, state: message ? 'error' : 'ready', message } satisfies UploadEntry
    })
    setEntries(next)
    setError(files.length > 20 ? 'いちどに登録できるのは20件までです。先頭の20件を表示しています。' : '')
  }

  async function uploadReady() {
    if (!accountId || readyCount === 0 || busy) return
    setBusy(true)
    setError('')
    let completed = 0
    for (let index = 0; index < entries.length; index += 1) {
      if (entries[index]?.state !== 'ready') continue
      setEntries((current) => current.map((entry, entryIndex) => (
        entryIndex === index ? { ...entry, state: 'uploading', message: '登録しています' } : entry
      )))
      try {
        const entry = entries[index]
        if (!entry) continue
        const data = await readDataUrl(entry.file)
        const response = await api.media.upload({
          accountId,
          filename: entry.file.name,
          mimeType: entry.file.type,
          data,
          folderId: folderId || null,
        })
        if (!response.success) throw new Error(response.error)
        completed += 1
        setEntries((current) => current.map((item, entryIndex) => (
          entryIndex === index ? { ...item, state: 'done', message: '入りました' } : item
        )))
      } catch (caught) {
        const message = caught instanceof ApiError || caught instanceof Error
          ? caught.message
          : '登録できませんでした'
        setEntries((current) => current.map((item, entryIndex) => (
          entryIndex === index ? { ...item, state: 'error', message } : item
        )))
      }
    }
    setBusy(false)
    if (completed > 0) onComplete()
  }

  return (
    <Dialog
      open={open}
      title="ファイルを入れる"
      designNode="eXAJP"
      busy={busy}
      error={error || undefined}
      onCancel={onClose}
      footer={(
        <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t pt-4">
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
      )}
    >
      <div className="space-y-4">
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
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPT}
          className="sr-only"
          onChange={(event) => stage([...(event.target.files ?? [])])}
        />

        <div className="bg-info-bg text-info rounded-control p-3 text-xs leading-5">
          <p className="font-bold">LINEで送れる大きさ（超えると入れられません）</p>
          {LIMITS.map((limit) => <p key={limit.label}>{limit.label} {limit.note}</p>)}
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
                <li key={`${entry.file.name}-${entry.file.size}-${index}`} className={`rounded-control border p-3 ${entry.state === 'error' ? 'border-danger-bg bg-danger-bg' : 'border-hairline'}`}>
                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="text-ink min-w-0 truncate text-xs font-semibold" title={entry.file.name}>{entry.file.name}</span>
                    <span className={`shrink-0 text-xs font-semibold ${entry.state === 'error' ? 'text-danger' : entry.state === 'done' ? 'text-success' : 'text-ink-faint'}`}>
                      {entry.message || '登録できます'}
                    </span>
                  </div>
                  <p className="text-ink-faint mt-1 text-xs">{(entry.file.size / 1024 / 1024).toFixed(1)}MB</p>
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
    </Dialog>
  )
}
