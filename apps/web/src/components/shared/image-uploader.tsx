'use client'

import { useCallback, useRef, useState } from 'react'
import MediaSlot from './media-slot'
import { uploadImageFile } from './media-library-upload'
import { TextField } from './text-field'

export type ImageUploaderMode = 'url' | 'line-image'

export type ImageUploaderValue =
  | { mode: 'url'; url: string }
  | { mode: 'line-image'; originalContentUrl: string; previewImageUrl: string }

export interface ImageUploaderProps {
  mode: ImageUploaderMode
  value: ImageUploaderValue | null
  onChange: (next: ImageUploaderValue | null) => void
  /** 欄の上の見出し。 */
  label?: string
  /** 枠の真ん中の太字の題（「メイン画像を追加」など）。 */
  title?: string
  /** 渡すと「登録メディアから選ぶ」を出す。 */
  onMediaPick?: () => void
  readOnly?: boolean
  disabled?: boolean
  size?: 'regular' | 'compact'
  /** url の形の上限（MB）。既定 10。 */
  maxMB?: number
}

/**
 * 画像を入れる所（共通の MediaSlot・Z7vd2）に、今までの送り先（api.uploads.image）と
 * 形式・大きさの検査をつないだもの。
 *
 * mode='url' は単一 URL を返す (Event / Staff など)。
 * mode='line-image' は {originalContentUrl, previewImageUrl} を返す (Broadcast / Auto-reply / Template / Chats)。
 * 初版は preview = original の同 URL。後段で本格 resize が必要になれば worker 側で対応。
 * 「URL で入れる」で URL の欄を開ける。貼り付け（Cmd+V）でも受ける。
 */
export default function ImageUploader({
  mode,
  value,
  onChange,
  label,
  title = '画像を追加',
  onMediaPick,
  readOnly = false,
  disabled = false,
  size = 'regular',
  maxMB = 10,
}: ImageUploaderProps) {
  const [manualUrlMode, setManualUrlMode] = useState(false)
  const lineImage = mode === 'line-image'
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const toValue = useCallback(
    (url: string): ImageUploaderValue =>
      lineImage ? { mode: 'line-image', originalContentUrl: url, previewImageUrl: url } : { mode: 'url', url },
    [lineImage],
  )

  const validate = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return '画像ファイルのみアップロードできます'
      if (lineImage && !['image/jpeg', 'image/png'].includes(file.type)) return 'LINE 送信用は JPEG または PNG のみ対応'
      if (lineImage && file.size > 1024 * 1024) return 'LINE 送信用は 1MB 以下にしてください (preview サイズ制限)'
      if (file.size > maxMB * 1024 * 1024) return `${maxMB}MB 以下にしてください`
      return ''
    },
    [lineImage, maxMB],
  )


  const url = value === null ? '' : value.mode === 'url' ? value.url : value.originalContentUrl
  const previewUrl = value === null ? '' : value.mode === 'url' ? value.url : value.previewImageUrl

  return (
    <div className="space-y-2">
      {label && <div className="text-sm font-medium text-ink-secondary">{label}</div>}
      <MediaSlot
        title={title}
        value={previewUrl || null}
        accept={lineImage ? 'image/jpeg,image/png' : 'image/*'}
        limitText={lineImage ? '1ファイル1メガバイト以内・JPEG・PNG' : `1ファイル${maxMB}メガバイト以内・画像`}
        validate={validate}
        upload={uploadImageFile}
        onChange={(next) => onChangeRef.current(next ? toValue(next) : null)}
        onUrl={readOnly ? undefined : () => setManualUrlMode((open) => !open)}
        onMediaPick={readOnly ? undefined : onMediaPick}
        readOnly={readOnly}
        disabled={disabled}
        size={size}
        acceptPaste
      >
        {manualUrlMode && !readOnly ? (
          <TextField
            type="url"
            aria-label={`${title.replace(/を追加$/, '')}の URL`}
            value={url}
            disabled={disabled}
            onChange={(event) => {
              const next = event.target.value
              onChangeRef.current(next ? toValue(next) : null)
            }}
            placeholder="https://... (外部 CDN / R2 URL)"
          />
        ) : null}
      </MediaSlot>
    </div>
  )
}
