'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import MediaSlot from '@/components/shared/media-slot'
import { validateCarouselImage } from './carousel-image-upload'
import styles from './carousel-image.module.css'

/** 受け取りの失敗理由。日本語の理由だけを出し、「API error: 500」などの英語は案内文に置き換える。 */
function uploadReasonOf(caught: unknown): string {
  const text = caught instanceof Error ? String(caught.message) : ''
  return /^API error: /.test(text) || !/[ぁ-んァ-ヶ一-龠]/u.test(text) ? '' : text
}

/** カードの画像。共通の画像を入れる所（MediaSlot・Z7vd2）の小さい形。店と統括で送る口だけ替える。失敗しても元の画像・選んだファイルを残す。 */
export default function CarouselImage({ url, disabled, maxMB = 10, upload, onUploaded, onBusyChange, onMediaPick, onUrl, scope }: {
  url: string; disabled: boolean; maxMB?: number; scope: string
  upload: (file: File) => Promise<string>
  onUploaded: (url: string) => void
  onBusyChange: (busy: boolean) => void
  onMediaPick?: () => void
  onUrl: () => void
}) {
  const alive = useRef(true)
  const locked = useRef(false)
  const latestScope = useRef(scope)
  latestScope.current = scope
  const busyChange = useRef(onBusyChange)
  busyChange.current = onBusyChange
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  useEffect(() => { alive.current = true; return () => { alive.current = false; busyChange.current(false) } }, [])
  const send = async (selected: File) => {
    if (disabled || locked.current) return
    setFile(selected); setError('')
    const invalid = validateCarouselImage(selected, maxMB)
    if (invalid) { setError(invalid); return }
    const requestedScope = scope
    locked.current = true; setBusy(true); busyChange.current(true)
    try {
      const nextUrl = await upload(selected)
      if (!alive.current) return
      if (latestScope.current !== requestedScope) { setError('編集中のカードかアカウントが変わったため、画像を反映しませんでした。選び直してください。'); return }
      onUploaded(nextUrl); setFile(null)
    } catch (caught) {
      if (alive.current) setError(uploadReasonOf(caught) || '画像を登録できませんでした。')
    } finally {
      locked.current = false
      if (alive.current) { setBusy(false); busyChange.current(false) }
    }
  }
  return (
    <div className={styles.column}>
      <MediaSlot
        size="compact"
        title="画像を追加"
        previewAlt="カードの画像"
        value={url || null}
        accept="image/jpeg,image/png"
        limitText={`${maxMB}MB 以内`}
        busy={busy}
        error={error}
        disabled={disabled}
        onFile={(chosen) => void send(chosen)}
        onRemove={() => onUploaded('')}
        onMediaPick={onMediaPick}
        onUrl={onUrl}
      />
      {file && <span className={styles.filename} title={file.name}>{file.name}</span>}
      {error && file && !validateCarouselImage(file, maxMB) && <Button disabled={disabled || busy} onClick={() => void send(file)} busy={Boolean(busy)} busyLabel="処理中…">もう一度受け取る</Button>}
    </div>
  )
}
