'use client'

/*
 * ★V8 `MyJP7` 予約して送るの小窓。友だち一覧の行の「…」から開き、受信箱を開かずに予約できる。
 * 文と日時を `POST /api/chats/:id/schedule` で予約する（友だちIDで引ける・二重押し防止の鍵つき）。
 * 画像は予約送信の口が無いため付けない。
 * 絵：幅 520・余白 20・間 12。送るもの（テンプレートから入れる）→ 送る日時の札 → 注意 → 真ん中にキャンセル・予約。
 */
import { useEffect, useRef, useState } from 'react'
import { Clock, FileText } from 'lucide-react'
import type { Template } from '@line-crm/shared'
import { api } from '@/lib/api'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import DateTimeField from '@/components/shared/date-time-field'
import Dialog from '@/components/shared/dialog'
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
  const [templates, setTemplates] = useState<Template[]>([])
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false)
  const templateAnchor = useRef<HTMLButtonElement>(null)
  const [choice, setChoice] = useState<ScheduleChoice>('tomorrow9')
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const keysRef = useRef(new IdempotencyKeyStore())

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
    if (busy) return
    if (!content.trim()) {
      setError('送るものを入力してください')
      return
    }
    if (!scheduledAt) {
      setError('送る日時を選んでください')
      return
    }
    setBusy(true)
    setError('')
    const signature = `${friendId}:${scheduledAt}`
    const result = await api.chats.schedule(
      friendId,
      { content: content.trim(), scheduledAt: `${scheduledAt}:00+09:00` },
      keysRef.current.get(signature),
    )
    setBusy(false)
    if (!result.success) {
      setError(result.error || '予約できませんでした')
      return
    }
    keysRef.current.clear(signature)
    onReserved()
    onClose()
  }

  return (
    <Dialog
      open
      designWidth={520}
      title={`${friendName}さんに予約して送る`}
      busy={busy}
      error={error}
      designNode="MyJP7"
      onCancel={onClose}
    >
      <div className={styles.body}>
        <div className={styles.group}>
          <p className={styles.label}>送るもの</p>
          <div className={styles.textBox}>
            <TextArea
              aria-label="送るもの"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="送る文を書きます"
            />
          </div>
          <div className={styles.row}>
            <Button
              ref={templateAnchor}
              type="button"
              aria-haspopup="menu"
              aria-expanded={templateMenuOpen}
              disabled={templates.length === 0}
              title={templates.length === 0 ? '文のテンプレートがありません' : undefined}
              onClick={() => setTemplateMenuOpen((value) => !value)}
            >
              <FileText size={15} aria-hidden="true" />テンプレートを選択
            </Button>
            <ActionMenu
              open={templateMenuOpen}
              anchorRef={templateAnchor}
              ariaLabel="テンプレートを選ぶ"
              onClose={() => setTemplateMenuOpen(false)}
              items={templates.map((template) => ({
                id: template.id,
                label: template.name,
                onSelect: () => { setContent(template.messageContent); setTemplateMenuOpen(false) },
              }))}
            />
          </div>
        </div>
        <div className={styles.group}>
          <p className={styles.label}>送る日時</p>
          <div className={styles.chips} role="group" aria-label="送る日時">
            {presets.map((preset) => (
              <button key={preset.key} type="button" className={styles.chip} aria-pressed={choice === preset.key} onClick={() => setChoice(preset.key)}>
                {preset.label}
              </button>
            ))}
            <button type="button" className={styles.chip} aria-pressed={choice === 'custom'} onClick={() => setChoice('custom')}>
              日時を決める
            </button>
          </div>
          {choice === 'custom' ? <DateTimeField aria-label="送る日時を決める" value={custom} onChange={setCustom} /> : null}
        </div>
        <p className={styles.note}>受信箱の会話にも「これから送る予約」として出ます。</p>
        {/* 絵は注意の下 12 にボタンが並ぶ（窓の下の線・帯なし）。共通の窓の帯は余白が 24 あるので、本文の続きに置く。 */}
        <div className={styles.footer}>
          <Button type="button" onClick={onClose} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={() => void reserve()} disabled={busy} busy={busy}>
            {!busy ? <Clock size={15} aria-hidden="true" /> : null}
            {scheduledAt ? formatReserveLabel(scheduledAt) : '日時を選んで予約'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
