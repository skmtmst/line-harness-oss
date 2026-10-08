'use client'

import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Upload } from 'lucide-react'
import Button from '@/components/shared/button'
import { validateCarouselImage } from './carousel-image-upload'
import styles from './carousel-image.module.css'

/** J60utHの小さな画像の枠。店と統括で送る口だけ替える。失敗しても元の画像・選んだファイルを残す。 */
export default function CarouselImage({ url, disabled, maxMB = 10, upload, onUploaded, onBusyChange, onMediaPick, onUrl, scope }: {
  url: string; disabled: boolean; maxMB?: number; scope: string
  upload: (file: File) => Promise<string>
  onUploaded: (url: string) => void
  onBusyChange: (busy: boolean) => void
  onMediaPick?: () => void
  onUrl: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const alive = useRef(true)
  const locked = useRef(false)
  const latestScope = useRef(scope)
  latestScope.current = scope
  const busyChange = useRef(onBusyChange)
  busyChange.current = onBusyChange
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)
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
      if (alive.current) setError(caught instanceof Error ? caught.message : '画像を登録できませんでした。')
    } finally {
      locked.current = false
      if (alive.current) { setBusy(false); busyChange.current(false) }
    }
  }
  return (
    <div className={styles.column}>
      <div className={styles.zone} role="group" aria-label="カードの画像" aria-busy={busy} data-drag={dragging || undefined}
        onDragOver={(event) => { event.preventDefault(); if (!disabled && !busy) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const chosen = event.dataTransfer.files[0]; if (chosen) void send(chosen) }}>
        {url ? <img className={styles.thumb} src={url} alt="カードの画像" /> : <ImagePlus className={styles.icon} aria-hidden="true" />}
        <span>{dragging ? '離すと追加します' : 'ここへドラッグ、または'}</span>
        <input ref={input} className={styles.input} aria-label="カードの画像ファイル" type="file" accept="image/jpeg,image/png" disabled={disabled || busy}
          onChange={(event) => { const chosen = event.target.files?.[0]; event.target.value = ''; if (chosen) void send(chosen) }} />
        <Button size="compact" disabled={disabled || busy} busy={busy} busyLabel="受け取り中…" onClick={() => input.current?.click()}><Upload className={styles.uploadIcon} aria-hidden="true" />ファイルを選ぶ</Button>
        <div className={styles.links}>
          {onMediaPick && <button type="button" disabled={disabled || busy} onClick={onMediaPick}>登録メディアから</button>}
          <button type="button" disabled={disabled || busy} onClick={onUrl}>URL で</button>
        </div>
        <span className={styles.hint}>{`JPEG・PNG、${maxMB}MB まで`}</span>
      </div>
      {file && <span className={styles.filename} title={file.name}>{file.name}</span>}
      {error && <span role="alert" className={styles.error}>{error}</span>}
      {error && file && !validateCarouselImage(file, maxMB) && <Button disabled={disabled || busy} onClick={() => void send(file)}>もう一度受け取る</Button>}
    </div>
  )
}
