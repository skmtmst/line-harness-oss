'use client'

/*
 * ★V8 `MyJP7` 予約して送るの小窓。友だち一覧の行の「…」から開き、受信箱を開かずに予約できる。
 * 文と日時を `POST /api/chats/:id/schedule` で予約する（友だちIDで引ける・二重押し防止の鍵つき）。
 * 絵：幅 520・余白 20・間 12。送るもの（テンプレートから入れる）→ 送る日時の札 → 注意 → 真ん中にキャンセル・予約。
 */
import { useEffect, useRef, useState } from 'react'
import { Clock3, FileText, ImagePlus } from 'lucide-react'
import type { ChatScheduleInput, Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { EntityKindDialog } from '@/components/shared/entity-picker-sources'
import Button from '@/components/shared/button'
import DateTimeField from '@/components/shared/date-time-field'
import Dialog, { DialogActions } from '@/components/shared/dialog'
import MediaSlot from '@/components/shared/media-slot'
import { TextArea } from '@/components/shared/text-field'
import styles from './schedule-dialog.module.css'

/* 日本時間の時計。サーバも端末も日本時間のつもりで扱う。 */
const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/* 日本時間での「日付+時刻」を作る（`Date.UTC` でずらして持つ）。 */
function jstDateTime(offsetDays: number, hour: number, minute: number): Date {
  const jstNow = new Date(Date.now() + JST_OFFSET_MS)
  return new Date(Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate() + offsetDays, hour, minute))
}

/* 次の月曜10時。今日が月曜で10時前なら今日。 */
function nextMonday10(): Date {
  const jstNow = new Date(Date.now() + JST_OFFSET_MS)
  const day = jstNow.getUTCDay()
  const pastTen = jstNow.getUTCHours() * 60 + jstNow.getUTCMinutes() >= 10 * 60
  let offset = (8 - day) % 7
  if (offset === 0 && pastTen) offset = 7
  return jstDateTime(offset, 10, 0)
}

function toLocalInput(date: Date): string {
  return date.toISOString().slice(0, 16)
}

/** 予約ボタンの文字（絵：「10/2 9:00 に予約」。時は0を付けない）。 */
export function formatReserveLabel(value: string): string {
  const [date, time] = value.split('T')
  const [, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':')
  return `${month}/${day} ${Number(hour)}:${minute} に予約`
}

type ScheduleChoice = 'tomorrow9' | 'tomorrow13' | 'monday10' | 'custom'

export default function ScheduleDialog({ friendId, friendName, accountId, onClose, onReserved }: {
  friendId: string
  friendName: string
  accountId: string | null
  onClose: () => void
  onReserved: () => void
}) {
  const [content, setContent] = useState('')
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const templateAnchor = useRef<HTMLButtonElement>(null)
  const [choice, setChoice] = useState<ScheduleChoice>('tomorrow9')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const keysRef = useRef(new IdempotencyKeyStore())

  useEffect(() => {
    setImageUrl(null)
  }, [accountId, friendId])

  useEffect(() => {
    setTemplates([])
    void api.templates.list(undefined, accountId ?? undefined).then((res) => {
      if (res.success) {
        setTemplates((res.data as unknown as Template[]).filter((t) => t.messageType === 'text'))
      }
    })
  }, [accountId])

  const presets: Array<{ key: Exclude<ScheduleChoice, 'custom'>; label: string; value: string }> = [
    { key: 'tomorrow9', label: '明日 9:00', value: toLocalInput(jstDateTime(1, 9, 0)) },
    { key: 'tomorrow13', label: '明日 13:00', value: toLocalInput(jstDateTime(1, 13, 0)) },
    { key: 'monday10', label: '月曜 10:00', value: toLocalInput(nextMonday10()) },
  ]
  const scheduledAt = choice === 'custom' ? custom : presets.find((p) => p.key === choice)?.value ?? ''

  const reserve = async () => {
    if (busy || uploading) return
    if (!content.trim() && !imageUrl) {
      setError('送る文か画像を入れてください')
      return
    }
    if (!scheduledAt) {
      setError('送る日時を選んでください')
      return
    }
    setBusy(true)
    setError('')
    const items: Array<{ input: ChatScheduleInput; done: () => void }> = []
    const at = `${scheduledAt}:00+09:00`
    if (imageUrl) items.push({ input: { messageType: 'image', content: JSON.stringify({ originalContentUrl: imageUrl, previewImageUrl: imageUrl }), scheduledAt: at }, done: () => setImageUrl(null) })
    if (content.trim()) items.push({ input: { content: content.trim(), scheduledAt: at }, done: () => setContent('') })
    let completed = 0
    try {
      for (const item of items) {
        const signature = JSON.stringify({ friendId, accountId, ...item.input })
        const result = await api.chats.schedule(friendId, item.input, keysRef.current.get(signature))
        if (!result.success) throw new Error(result.error || '予約できませんでした')
        keysRef.current.clear(signature)
        item.done()
        completed += 1
      }
      onReserved()
      onClose()
    } catch {
      // 結果が分からない失敗では鍵を残し、同じ予約の再試行を二重に作らない。
      if (completed) onReserved()
      setError(`${completed ? `${completed}件は予約済みです。残りを` : ''}予約できませんでした。通信状態を確認して、もう一度お試しください。`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      designWidth={520}
      title={`${friendName}さんに予約して送る`}
      busy={busy || uploading}
      error={error}
      designNode="MyJP7"
      onCancel={onClose}
      footerAlign="center"
      footer={<DialogActions><Button onClick={onClose} disabled={busy || uploading}>キャンセル</Button><Button variant="primary" onClick={() => void reserve()} disabled={busy || uploading} busy={busy} widthReserve="idle"><Clock3 aria-hidden="true" />{scheduledAt ? formatReserveLabel(scheduledAt) : '日時を選んで予約'}</Button></DialogActions>}
    >
      <div className={styles.body}>
        <div className={styles.group}>
          <p className={styles.label}>送るもの</p>
          <div>
            <TextArea
              density="compact"
              aria-label="送るもの"
              rows={3}
              value={content}
              disabled={busy}
              onChange={(event) => setContent(event.target.value)}
              placeholder="送る文を書きます"
            />
          </div>
          <div className={styles.row}>
            <Button
              ref={templateAnchor}
              type="button"
              aria-haspopup="dialog"
              disabled={busy || templates.length === 0}
              title={templates.length === 0 ? '文のテンプレートがありません' : undefined}
              onClick={() => setTemplateMenuOpen((value) => !value)}
            >
              <FileText size={15} aria-hidden="true" />テンプレートを選択
            </Button>
            {!imageUrl ? <MediaSlot title="画像を追加" accept="image/jpeg,image/png" maxBytes={1024 * 1024} scope={`${accountId}:${friendId}`} disabled={busy} onBusyChange={setUploading} onChange={setImageUrl}
              upload={async file => { const result = await api.uploads.image(file); if (!result.success) throw new Error(result.error || '画像を準備できませんでした'); return result.data.url }}
              renderTrigger={choose => <Button disabled={busy || uploading} busy={uploading} busyLabel="画像を準備中…" onClick={choose}><ImagePlus aria-hidden="true" />画像</Button>} /> : null}
            {templateMenuOpen ? <EntityKindDialog kind="template" options={templates} confirmLabel="この文を入れる"
              onCancel={() => setTemplateMenuOpen(false)}
              onConfirm={(id) => { const picked = templates.find((template) => template.id === id); if (picked) setContent(picked.messageContent); setTemplateMenuOpen(false) }} /> : null}
          </div>
          {imageUrl ? <MediaSlot title="予約する画像" value={imageUrl} size="compact" disabled={busy} onChange={setImageUrl} removable /> : null}
        </div>
        <div className={styles.group}>
          <p className={styles.label}>送る日時</p>
          <div className={styles.chips} role="group" aria-label="送る日時">
            {presets.map((preset) => (
              <button key={preset.key} type="button" className={styles.chip} disabled={busy} aria-pressed={choice === preset.key} onClick={() => setChoice(preset.key)}>
                {preset.label}
              </button>
            ))}
            <button type="button" className={styles.chip} disabled={busy} aria-pressed={choice === 'custom'} onClick={() => setChoice('custom')}>
              日時を決める
            </button>
          </div>
          {choice === 'custom' ? <DateTimeField disabled={busy} aria-label="送る日時を決める" value={custom} onChange={setCustom} /> : null}
        </div>
        <p className={styles.note}>受信箱の会話にも「これから送る予約」として出ます。</p>
      </div>
    </Dialog>
  )
}
