'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import type { Folder } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import Progress from '@/components/shared/progress'
import Select from '@/components/shared/select'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { MEDIA_ACCEPT, extractMediaMetadata, putMediaFile, validateMediaFile } from './media-direct-upload'
import { formatMediaSize } from './media-usage-display'

type UploadState = 'ready' | 'preparing' | 'uploading' | 'verifying' | 'done' | 'error'

type UploadEntry = {
  file: File
  state: UploadState
  message: string
  retryable: boolean
  progress: number
  mediaId?: string | null
  /** 検査の状態。確かめ終わるまで中身は出さない。 */
  scanStatus?: 'pending' | 'clean' | 'rejected' | 'quarantined' | null
}

function scanChipProps(status: NonNullable<UploadEntry['scanStatus']>): { tone: 'info' | 'ok' | 'danger' | 'warn'; label: string } {
  if (status === 'clean') return { tone: 'ok', label: '使えます' }
  if (status === 'rejected') return { tone: 'danger', label: '使えません' }
  if (status === 'quarantined') return { tone: 'warn', label: '確認のため使えません' }
  return { tone: 'info', label: '確かめています' }
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
  const doneCount = entries.filter((entry) => entry.state === 'done').length
  /*
    全体の進みは実測だけ出す。登録を押す前（すべて登録待ち）は棒を出さない。
    一度でも登録を実行した（完了か、登録中の失敗がある）ときだけ
    Active（登録中）／Done／Partial を出す。
  */
  const attempted = entries.some((entry) => entry.state === 'done' || (entry.state === 'error' && entry.retryable))
  const uploadErrorCount = entries.filter((entry) => entry.state === 'error' && entry.retryable).length

  function removeEntry(index: number) {
    setEntries((current) => current.filter((_, entryIndex) => entryIndex !== index))
  }

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
        files: await Promise.all(pending.map(async ({ entry }) => ({
          filename: entry.file.name,
          mimeType: entry.file.type,
          sizeBytes: entry.file.size,
          folderId: folderId || null,
          metadata: await extractMediaMetadata(entry.file),
        }))),
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
          const mediaId = response.data.mediaId ?? null
          setEntries((current) => current.map((item, entryIndex) => (
            entryIndex === index
              ? { ...item, state: 'done', message: '入りました', retryable: false, progress: 100, mediaId, scanStatus: 'pending' }
              : item
          )))
          // 検査の状態を読む。確かめ終わるまで配信・公開には出さない。
          if (mediaId) {
            try {
              const scan = await api.fileScan.forMedia(mediaId, accountId)
              const status = scan.success ? scan.data.scan?.status ?? null : null
              setEntries((current) => current.map((item, entryIndex) => (
                entryIndex === index ? { ...item, scanStatus: status ?? 'pending' } : item
              )))
            } catch {
              // 読めなくても登録自体は済んでいる。確かめ中として置く。
            }
          }
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
        <div className="border-hairline flex items-center justify-between gap-3 border-b px-6 py-4">
          <h2 id={`${inputId}-title`} className="text-ink text-xl font-bold">ファイルを入れる</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="閉じる"
            className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken disabled:opacity-50"
          >
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 p-6">
        <FileDropzone
          title="ここにファイルをドラッグ、または押して選ぶ"
          hint="いちどに20件まで"
          accept={MEDIA_ACCEPT}
          multiple
          busy={busy}
          busyTitle="登録しています…"
          onFiles={stage}
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
              {busy || attempted ? null : (
                <p className="text-ink-faint text-xs">{entries.length}件中 {doneCount}件 完了</p>
              )}
            </div>
            {/*
              全体の進みは登録を実行してから出す（実測の完了数だけ）。
              登録前は同じ数字の重複になるので、上の「X件中 Y件 完了」だけにする。
            */}
            {busy ? (
              <Progress
                state="active"
                title="登録しています"
                percent={entries.length > 0 ? (doneCount / entries.length) * 100 : 0}
                countText={`${doneCount.toLocaleString()} / ${entries.length.toLocaleString()} 件`}
                className="mb-3"
              />
            ) : attempted ? (
              <Progress
                state={uploadErrorCount > 0 ? 'partial' : 'done'}
                title={uploadErrorCount > 0
                  ? `${doneCount.toLocaleString()}件を登録し、${uploadErrorCount.toLocaleString()}件は入りませんでした`
                  : `${doneCount.toLocaleString()}件を登録しました`}
                percent={entries.length > 0 ? (doneCount / entries.length) * 100 : 0}
                className="mb-3"
              />
            ) : null}
            <ul className="max-h-64 space-y-2 overflow-y-auto">
              {entries.map((entry, index) => {
                const sizeText = formatMediaSize(entry.file.size)
                const tone = entry.file.type.startsWith('image/') ? 'photo' as const : 'document' as const
                if (entry.state === 'uploading' || entry.state === 'preparing' || entry.state === 'verifying') {
                  return (
                    <li key={`${entry.file.name}-${entry.file.size}-${index}`} aria-live="polite">
                      <AttachmentRow
                        name={entry.file.name}
                        status="uploading"
                        percent={entry.progress}
                        uploadingText={entry.message || `送信中 ${entry.progress}%`}
                        tone={tone}
                      />
                    </li>
                  )
                }
                if (entry.state === 'error' && entry.retryable) {
                  return (
                    <li key={`${entry.file.name}-${entry.file.size}-${index}`} aria-live="polite">
                      <AttachmentRow
                        name={entry.file.name}
                        status="error"
                        errorText={entry.message}
                        tone={tone}
                        onRetry={() => setEntries((current) => current.map((item, entryIndex) => (
                          entryIndex === index ? { ...item, state: 'ready', message: '', retryable: false, progress: 0 } : item
                        )))}
                      />
                    </li>
                  )
                }
                if (entry.state === 'error') {
                  return (
                    <li key={`${entry.file.name}-${entry.file.size}-${index}`} aria-live="polite">
                      <AttachmentRow
                        name={entry.file.name}
                        status="error"
                        errorText={entry.message}
                        tone={tone}
                        onRemove={() => removeEntry(index)}
                      />
                    </li>
                  )
                }
                const scan = entry.state === 'done' ? scanChipProps(entry.scanStatus ?? 'pending') : null
                return (
                  <li key={`${entry.file.name}-${entry.file.size}-${index}`} aria-live="polite">
                    <AttachmentRow
                      name={entry.file.name}
                      meta={entry.state === 'done' ? `${sizeText}・入りました` : `${sizeText}・${entry.message || '登録できます'}`}
                      tone={tone}
                      onRemove={busy ? undefined : () => removeEntry(index)}
                    />
                    {scan ? (
                      <p className="mt-1 flex items-center gap-2">
                        <Chip tone={scan.tone}>{scan.label}</Chip>
                        {entry.scanStatus === 'pending' ? (
                          <span className="text-ink-faint text-xs">確かめ終わるまで配信・公開には出ません</span>
                        ) : null}
                      </p>
                    ) : null}
                  </li>
                )
              })}
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
