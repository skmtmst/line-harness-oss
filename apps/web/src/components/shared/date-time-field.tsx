'use client'

import { Calendar, Clock, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import DateField, { formatLabel as formatDateLabel, parseDate } from './date-field'
import SelectField from './select-field'
import dateStyles from './date-field.module.css'
import styles from './date-time-field.module.css'

/**
 * 日時の選択・時刻の選択。Pencil ★V7「日付の選択」（V7 文書 `Fw065`）の仲間。
 *
 * ブラウザ任せの `<input type="datetime-local">` / `<input type="time">` は、
 * 表示が英語の書式になり、画面ごとに見た目も違った。欄の見た目は DateField と
 * 同じ（高さ40・14px）で、表示は日本語（例：`2026年10月1日（木）10:00`）。
 *
 * 値は今までどおりの文字列で受け渡す（日本時間）。
 * - 日時：`datetime-local` と同じ `YYYY-MM-DDTHH:mm`（空は `''`）。秒付き
 *   （`YYYY-MM-DDTHH:mm:ss`）の既存値も読める。書くときは秒を付けない
 * - 時刻：`time` と同じ `HH:mm`（空は `''`）。秒付きの既存値も読める
 *
 * 使い方は DateField と同じ。`value` を渡すと操作式、`defaultValue` だけなら
 * お任せ式（`name` と組むと隠し欄でそのまま送れる）。`onChange(次の値)`。
 *
 * - 日付をまだ選んでいないとき、時刻だけ先に選んでおける。日付を選ぶと
 *   その時刻で値が決まる（時刻が空のときは `10:00` になる）
 * - キーボード：欄で Enter・↓ で開く／日付は DateField と同じ／時・分は
 *   Tab で移って矢印で選ぶ／Esc で閉じて欄へ戻る
 * - `min`・`max` は日付の範囲だけ見る（`YYYY-MM-DDTHH:mm`）。時刻の前後は
 *   画面側の検証が今までどおり見る
 */
export default function DateTimeField({
  value,
  defaultValue = '',
  onChange,
  min,
  max,
  disabled = false,
  invalid = false,
  required = false,
  placeholder = '日時を選ぶ',
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
  /** お任せ式の検証用。見た目は変えず、読み上げにだけ必須と伝える。 */
  required?: boolean
  placeholder?: string
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const dialogId = `${fieldId}-datetime-dialog`
  const [inner, setInner] = useState(defaultValue)
  const current = value ?? inner
  const [open, setOpen] = useState(false)
  /** 日付より先に時刻だけ選んだときの置き場所。開くたびに今の値へ戻す。 */
  const [timeDraft, setTimeDraft] = useState<{ hours: number; minutes: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  const parsed = parseDateTime(current)
  const datePart = parsed ? current.slice(0, 10) : ''
  const shownTime = timeDraft ?? (parsed ? { hours: parsed.hours, minutes: parsed.minutes } : { hours: 10, minutes: 0 })

  const emit = (next: string) => {
    if (value === undefined) setInner(next)
    onChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setTimeDraft(null)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open ])

  useEffect(() => {
    if (!open) return
    popoverRef.current?.querySelector<HTMLElement>('button, select')?.focus()
  }, [open ])

  const openDialog = () => {
    if (disabled) return
    setTimeDraft(null)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    setTimeDraft(null)
    triggerRef.current?.focus()
  }

  const chooseDate = (date: string) => {
    if (!date) {
      emit('')
      return
    }
    const time = timeDraft ?? (parsed ? { hours: parsed.hours, minutes: parsed.minutes } : { hours: 10, minutes: 0 })
    emit(`${date}T${pad(time.hours)}:${pad(time.minutes)}`)
  }

  const chooseTime = (hours: number, minutes: number) => {
    setTimeDraft({ hours, minutes })
    if (datePart) emit(`${datePart}T${pad(hours)}:${pad(minutes)}`)
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  return (
    <div ref={rootRef} className={[dateStyles.root, className].filter(Boolean).join(' ')} onKeyDown={onRootKeyDown}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        className={dateStyles.field}
        disabled={disabled}
        data-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-open={open || undefined}
        onClick={() => (open ? close() : openDialog())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openDialog()
          }
        }}
      >
        <Calendar aria-hidden="true" className={dateStyles.icon} />
        <span className={parsed ? dateStyles.value : dateStyles.placeholder}>
          {parsed ? formatDateTimeLabel(parsed) : placeholder}
        </span>
      </button>
      {parsed && !disabled ? (
        <button
          type="button"
          className={dateStyles.clear}
          aria-label="日時を消す"
          onClick={() => {
            emit('')
            setTimeDraft(null)
          }}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div
          ref={popoverRef}
          id={dialogId}
          role="dialog"
          aria-label="日時を選ぶ"
          className={styles.popover}
          // 箱の中の押下はここで止める。呼び出し側が `<label>` で欄全体を包んでいると、
          // 箱の中の押下がラベル経由で欄本体へ再送達して開閉が裏返る（公開日時の試験で発生）。
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.dateWrap}>
            <DateField
              value={datePart}
              onChange={chooseDate}
              min={min?.slice(0, 10)}
              max={max?.slice(0, 10)}
              aria-label="日付"
            />
          </div>
          <div className={styles.timeRow}>
            <label className={styles.timeLabel}>
              時
              <SelectField
                aria-label="時"
                value={pad(shownTime.hours)}
                onChange={(event) => chooseTime(Number(event.target.value), shownTime.minutes)}
                options={HOURS.map((hour) => ({ value: pad(hour), label: `${hour}時` }))}
              />
            </label>
            <label className={styles.timeLabel}>
              分
              <SelectField
                aria-label="分"
                value={pad(shownTime.minutes)}
                onChange={(event) => chooseTime(shownTime.hours, Number(event.target.value))}
                options={MINUTES.map((minute) => ({ value: pad(minute), label: `${minute}分` }))}
              />
            </label>
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.closeBtn} onClick={close}>閉じる</button>
            <button type="button" className={styles.clearBtn} onClick={() => { emit(''); close() }}>消す</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * 時刻の選択。`time` の置き換え。欄の見た目は DateField と同じ（高さ40・14px）、
 * 表示は `10:00`。値は `HH:mm`（空は `''`）で受け渡す。
 *
 * `step` は `type="time"` との置き換えやすさのために受け付けるだけ（分の刻みを
 * 狭めない）。保存する値の形は変えない。
 */
export function TimeField({
  value,
  defaultValue = '',
  onChange,
  step,
  disabled = false,
  invalid = false,
  required = false,
  placeholder = '時刻を選ぶ',
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  step?: number
  disabled?: boolean
  invalid?: boolean
  /** お任せ式の検証用。見た目は変えず、読み上げにだけ必須と伝える。 */
  required?: boolean
  placeholder?: string
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}) {
  void step
  const autoId = useId()
  const fieldId = id ?? autoId
  const dialogId = `${fieldId}-time-dialog`
  const [inner, setInner] = useState(defaultValue)
  const current = value ?? inner
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const parsed = parseTime(current)

  const emit = (next: string) => {
    if (value === undefined) setInner(next)
    onChange?.(next)
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open ])

  const openDialog = () => {
    if (disabled) return
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const chooseTime = (hours: number, minutes: number) => {
    emit(`${pad(hours)}:${pad(minutes)}`)
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  const shownHours = parsed ? parsed.hours : 10
  const shownMinutes = parsed ? parsed.minutes : 0

  return (
    <div ref={rootRef} className={[dateStyles.root, className].filter(Boolean).join(' ')} onKeyDown={onRootKeyDown}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        className={dateStyles.field}
        disabled={disabled}
        data-invalid={invalid || undefined}
        aria-required={required || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-open={open || undefined}
        onClick={() => (open ? close() : openDialog())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openDialog()
          }
        }}
      >
        <Clock aria-hidden="true" className={dateStyles.icon} />
        <span className={parsed ? dateStyles.value : dateStyles.placeholder}>
          {parsed ? formatTimeLabel(parsed) : placeholder}
        </span>
      </button>
      {parsed && !disabled ? (
        <button type="button" className={dateStyles.clear} aria-label="時刻を消す" onClick={() => emit('')}>
          <X aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div
          id={dialogId}
          role="dialog"
          aria-label="時刻を選ぶ"
          className={styles.popover}
          // 日時の選択と同じく、箱の中の押下はここで止める（包んだ `<label>` への再送達を防ぐ）。
          onClick={(event) => event.stopPropagation()}
        >
          <div className={styles.timeRow}>
            <label className={styles.timeLabel}>
              時
              <SelectField
                aria-label="時"
                value={pad(shownHours)}
                disabled={disabled}
                onChange={(event) => chooseTime(Number(event.target.value), shownMinutes)}
                options={HOURS.map((hour) => ({ value: pad(hour), label: `${hour}時` }))}
              />
            </label>
            <label className={styles.timeLabel}>
              分
              <SelectField
                aria-label="分"
                value={pad(shownMinutes)}
                disabled={disabled}
                onChange={(event) => chooseTime(shownHours, Number(event.target.value))}
                options={MINUTES.map((minute) => ({ value: pad(minute), label: `${minute}分` }))}
              />
            </label>
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.closeBtn} onClick={close}>閉じる</button>
            <button type="button" className={styles.clearBtn} onClick={() => { emit(''); close() }}>消す</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)

export type ParsedDateTime = { date: Date; hours: number; minutes: number }

/** `YYYY-MM-DDTHH:mm`（秒付きも可）を読み解く。読めなければ null。 */
export function parseDateTime(value: string): ParsedDateTime | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const date = parseDate(value)
  const hours = Number(match[4])
  const minutes = Number(match[5])
  if (!date || hours > 23 || minutes > 59) return null
  return { date, hours, minutes }
}

/** 「2026年10月1日（木）10:00」 */
export function formatDateTimeLabel(parsed: ParsedDateTime): string {
  return `${formatDateLabel(parsed.date)}${pad(parsed.hours)}:${pad(parsed.minutes)}`
}

export type ParsedTime = { hours: number; minutes: number }

/** `HH:mm`（秒付きも可）を読み解く。読めなければ null。 */
export function parseTime(value: string): ParsedTime | null {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

/** 「10:00」 */
export function formatTimeLabel(parsed: ParsedTime): string {
  return `${pad(parsed.hours)}:${pad(parsed.minutes)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
