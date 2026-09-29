'use client'

import { Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import Button from '@/components/shared/button'
import { readFileAsBase64 } from '@/lib/hq-banners'

const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
const MAX_BYTES = 10 * 1024 * 1024

/**
 * 「画像を取り込む」。Pencil 35-2 `e5PzbL`。
 * PNG・JPEG・WebP、10MB まで（API と同じ）。手元で先に確かめ、だめなら理由を返す。
 */
export default function UploadButton({
  onUpload,
  onError,
  disabled,
}: {
  onUpload: (input: { filename: string; mimeType: string; data: string }) => Promise<void>
  onError: (message: string) => void
  disabled?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const handle = async (file: File | undefined) => {
    if (!file) return
    if (!ACCEPT.includes(file.type)) {
      onError('画像は PNG・JPEG・WebP のみ取り込めます')
      return
    }
    if (file.size > MAX_BYTES) {
      onError('ファイルが大きすぎます（上限 10MB）')
      return
    }
    setBusy(true)
    try {
      const data = await readFileAsBase64(file)
      await onUpload({ filename: file.name, mimeType: file.type, data })
    } catch (caught) {
      onError(caught instanceof Error && caught.message ? caught.message : '画像を取り込めませんでした')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void handle(event.target.files?.[0])}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={disabled || busy}>
        <Upload aria-hidden="true" className="h-4 w-4" />
        {busy ? '取り込み中…' : '画像を取り込む'}
      </Button>
    </>
  )
}
