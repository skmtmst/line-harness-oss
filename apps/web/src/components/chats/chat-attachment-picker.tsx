'use client'

import { useRef, useState } from 'react'
import { api } from '@/lib/api'

export type ChatAttachment =
  | { kind: 'image'; originalContentUrl: string; previewImageUrl: string; name: string }
  | { kind: 'video'; originalContentUrl: string; previewImageUrl: string; name: string }
  | { kind: 'file'; url: string; name: string }

interface Props {
  value: ChatAttachment | null
  onChange: (value: ChatAttachment | null) => void
}

async function prepareLineImage(file: File): Promise<File> {
  if (!['image/jpeg', 'image/png'].includes(file.type)) {
    throw new Error('画像はJPEGまたはPNGを選択してください')
  }
  if (file.size <= 1024 * 1024) return file

  const bitmap = await createImageBitmap(file)
  const maxEdge = 1600
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  // A shared original/preview URL must stay below LINE's preview limit. Mobile
  // photos are compressed automatically so staff do not need another app.
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((next) => next ? resolve(next) : reject(new Error('画像の圧縮に失敗しました')), 'image/jpeg', 0.78),
  )
  if (blob.size > 1024 * 1024) {
    throw new Error('画像を1MB以下にできませんでした。小さい画像を選択してください')
  }
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, { type: 'image/jpeg' })
}

async function makeVideoPreview(file: File): Promise<File> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'metadata'
    video.src = url
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('動画を読み込めませんでした'))
    })
    video.currentTime = Math.min(0.2, video.duration || 0)
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve()
      window.setTimeout(resolve, 500)
    })
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.min(video.videoWidth, 960))
    canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth))
    canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((next) => next ? resolve(next) : reject(new Error('プレビュー作成に失敗しました')), 'image/jpeg', 0.82),
    )
    return new File([blob], 'video-preview.jpg', { type: 'image/jpeg' })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export default function ChatAttachmentPicker({ value, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const choose = (accept: string) => {
    if (!inputRef.current) return
    inputRef.current.accept = accept
    inputRef.current.click()
  }

  const upload = async (file: File) => {
    setBusy(true)
    setError('')
    try {
      if (file.type.startsWith('image/')) {
        const prepared = await prepareLineImage(file)
        const result = await api.uploads.image(prepared)
        if (!result.success) throw new Error(result.error || '画像のアップロードに失敗しました')
        onChange({
          kind: 'image',
          originalContentUrl: result.data.url,
          previewImageUrl: result.data.url,
          name: file.name,
        })
      } else if (file.type === 'video/mp4') {
        // Generate the LINE-required preview automatically so mobile staff only
        // need to choose one video file.
        const [videoResult, previewFile] = await Promise.all([
          api.uploads.media(file),
          makeVideoPreview(file),
        ])
        if (!videoResult.success) throw new Error(videoResult.error || '動画のアップロードに失敗しました')
        const previewResult = await api.uploads.image(previewFile)
        if (!previewResult.success) throw new Error(previewResult.error || '動画プレビューの作成に失敗しました')
        onChange({
          kind: 'video',
          originalContentUrl: videoResult.data.url,
          previewImageUrl: previewResult.data.url,
          name: file.name,
        })
      } else {
        const result = await api.uploads.media(file)
        if (!result.success) throw new Error(result.error || 'ファイルのアップロードに失敗しました')
        onChange({ kind: 'file', url: result.data.url, name: file.name })
      }
      setOpen(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={busy}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-xl text-gray-700 hover:bg-gray-200 disabled:opacity-50"
        aria-label="画像・動画・ファイルを添付"
      >
        {busy ? <span className="text-xs">…</span> : '+'}
      </button>

      {open && (
        <div className="absolute bottom-12 left-0 z-20 flex gap-2 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl">
          <button type="button" onClick={() => choose('image/jpeg,image/png')} className="w-16 rounded-xl p-2 text-xs hover:bg-gray-50">
            <span className="mb-1 block text-2xl">🖼️</span>画像
          </button>
          <button type="button" onClick={() => choose('video/mp4')} className="w-16 rounded-xl p-2 text-xs hover:bg-gray-50">
            <span className="mb-1 block text-2xl">🎥</span>動画
          </button>
          <button type="button" onClick={() => choose('.pdf,.zip,.txt,.csv,.docx,.xlsx')} className="w-16 rounded-xl p-2 text-xs hover:bg-gray-50">
            <span className="mb-1 block text-2xl">📎</span>ファイル
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file) void upload(file)
        }}
      />
      {error && (
        <div className="absolute bottom-12 left-0 z-30 w-64 rounded-lg bg-rose-50 p-2 text-xs text-rose-700 shadow">
          {error}
        </div>
      )}
      {value && (
        <div className="absolute bottom-12 left-0 z-10 flex w-64 items-center gap-2 rounded-xl border border-emerald-200 bg-white p-2 shadow-lg">
          <span className="text-xl">{value.kind === 'image' ? '🖼️' : value.kind === 'video' ? '🎥' : '📎'}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-gray-700">{value.name}</span>
          <button type="button" onClick={() => onChange(null)} className="p-1 text-gray-400" aria-label="添付を取り消す">×</button>
        </div>
      )}
    </div>
  )
}
