'use client'

import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import FileDropzone from './file-drop'

export type ImageUploaderMode = 'url' | 'line-image'

export type ImageUploaderValue =
  | { mode: 'url'; url: string }
  | { mode: 'line-image'; originalContentUrl: string; previewImageUrl: string }

export interface ImageUploaderProps {
  mode: ImageUploaderMode
  value: ImageUploaderValue | null
  onChange: (next: ImageUploaderValue | null) => void
  label?: string
}

/**
 * 汎用画像アップローダー: ボタン + D&D + クリップボードペースト + プレビュー。
 *
 * mode='url' は単一 URL を返す (Event / Staff など)。
 * mode='line-image' は {originalContentUrl, previewImageUrl} を返す (Broadcast / Auto-reply / Template / Chats)。
 * 初版は preview = original の同 URL。後段で本格 resize が必要になれば worker 側で対応。
 */
export default function ImageUploader({ mode, value, onChange, label }: ImageUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [manualUrlMode, setManualUrlMode] = useState(false)

  const upload = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) {
        setError('画像ファイルのみアップロードできます')
        return
      }
      if (mode === 'line-image' && !['image/jpeg', 'image/png'].includes(file.type)) {
        setError('LINE 送信用は JPEG または PNG のみ対応')
        return
      }
      if (mode === 'line-image' && file.size > 1024 * 1024) {
        setError('LINE 送信用は 1MB 以下にしてください (preview サイズ制限)')
        return
      }
      if (file.size > 10 * 1024 * 1024) {
        setError('10MB 以下にしてください')
        return
      }
      setBusy(true)
      setError('')
      try {
        const res = await api.uploads.image(file)
        if (!res.success) {
          setError(res.error ?? 'アップロード失敗')
          return
        }
        const url = res.data.url
        if (mode === 'url') {
          onChange({ mode: 'url', url })
        } else {
          onChange({ mode: 'line-image', originalContentUrl: url, previewImageUrl: url })
        }
      } catch {
        setError('アップロード失敗')
      } finally {
        setBusy(false)
      }
    },
    [mode, onChange],
  )

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const f = files?.[0]
      if (f) void upload(f)
    },
    [upload],
  )

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      handleFiles(e.dataTransfer.files)
    },
    [handleFiles],
  )

  const onPaste = useCallback(
    (e: React.ClipboardEvent) => {
      const item = [...e.clipboardData.items].find((i) => i.type.startsWith('image/'))
      const file = item?.getAsFile()
      if (file) void upload(file)
    },
    [upload],
  )

  const previewUrl =
    value === null
      ? null
      : value.mode === 'url'
        ? value.url
        : value.previewImageUrl

  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium text-gray-700">{label}</div>}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setManualUrlMode((v) => !v)}
          className="text-xs text-action underline"
        >
          {manualUrlMode ? '画像アップロードに戻す' : 'URL を直接入力'}
        </button>
      </div>
      {manualUrlMode ? (
        <input
          type="url"
          value={
            value === null
              ? ''
              : value.mode === 'url'
                ? value.url
                : value.originalContentUrl
          }
          onChange={(e) => {
            const url = e.target.value
            if (!url) {
              onChange(null)
              return
            }
            if (mode === 'url') {
              onChange({ mode: 'url', url })
            } else {
              onChange({ mode: 'line-image', originalContentUrl: url, previewImageUrl: url })
            }
          }}
          placeholder="https://... (外部 CDN / R2 URL)"
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
        />
      ) : previewUrl ? (
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
          onPaste={onPaste}
          tabIndex={0}
          className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-4 transition-colors hover:border-gray-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-info"
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={previewUrl} alt="" className="h-24 w-24 rounded object-cover ring-1 ring-gray-200" />
            <div className="flex-1 space-y-2">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-medium text-gray-700 underline"
              >
                差し替え
              </button>
              <button
                type="button"
                onClick={() => onChange(null)}
                className="ml-3 text-xs font-medium text-rose-600 underline"
              >
                取り消し
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={mode === 'line-image' ? 'image/jpeg,image/png' : 'image/*'}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
        </div>
      ) : (
        // ★V7 `NQMnx` の落とす場所。押す・落とす・貼り付けの動きはそのまま。
        <div onPaste={onPaste}>
          <FileDropzone
            title="ここに画像を落とす"
            hint={mode === 'line-image' ? 'JPEG・PNG、10MB まで' : '画像ファイル、10MB まで'}
            accept={mode === 'line-image' ? 'image/jpeg,image/png' : 'image/*'}
            busy={busy}
            busyTitle="取り込んでいます…"
            rejectTitle="この画像は追加できません"
            rejectHint={mode === 'line-image' ? 'JPEG・PNG だけ選んでください' : '画像ファイルを選んでください'}
            onFiles={(files) => {
              const first = files[0]
              if (first) void upload(first)
            }}
          />
        </div>
      )}
      {error && <div className="text-xs text-rose-600">{error}</div>}
    </div>
  )
}
