'use client'

import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import styles from './date-field.module.css'

/**
 * 日付の選択。Pencil ★V7「日付の選択」（V7 文書 `Fw065`）。
 *
 * ブラウザ任せの `<input type="date">` は、表示が英語の書式になり、画面ごとに見た目も違った。
 * 値は今までどおり `YYYY-MM-DD` の文字列（空は ''）で受け渡すので、`type="date"` の
 * `value` / `onChange(event.target.value)` をそのまま置き換えられる。
 *
 * - 表示は「2026年9月23日（水）」。暦は6週を常に出す（月によって高さが変わらない）
 * - キーボード：欄で Enter・↓ で開く／矢印で1日・1週／PageUp・PageDown で月／Home・End で週の端／
 *   Enter・Space で選ぶ／Esc で閉じて欄へ戻る
 * - 動き：暦は motion-fast で欄の下から出る。月送りは段が 12px 横から薄く入る（motion-base）
 */
export default function DateField({
  value,
  onChange,
  min,
  max,
  disabled = false,
  invalid = false,
  placeholder = '日付を選ぶ',
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: {
  value: string
  onChange: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  invalid?: boolean
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
  const dialogId = `${fieldId}-calendar`
  const selected = parseDate(value)
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState<Date>(() => selected ?? today())
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  const month = useMemo(() => new Date(focused.getFullYear(), focused.getMonth(), 1), [focused])
  const days = useMemo(() => sixWeeks(month), [month])
  const minDate = parseDate(min ?? '')
  const maxDate = parseDate(max ?? '')
  const isDisabled = (day: Date) => Boolean((minDate && day < minDate) || (maxDate && day > maxDate))

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  useEffect(() => {
    if (!open) return
    gridRef.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus()
  }, [open, focused])

  const openCalendar = () => {
    if (disabled) return
    setFocused(selected ?? today())
    setSlide(null)
    setOpen(true)
  }

  const close = () => {
    setOpen(false)
    triggerRef.current?.focus()
  }

  const moveTo = (next: Date) => {
    if (next.getFullYear() !== focused.getFullYear() || next.getMonth() !== focused.getMonth()) {
      setSlide(next > focused ? 'next' : 'prev')
    }
    setFocused(next)
  }

  const choose = (day: Date) => {
    if (isDisabled(day)) return
    onChange(formatValue(day))
    close()
  }

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step: Record<string, () => Date> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, -1),
      PageDown: () => addMonths(focused, 1),
      Home: () => addDays(focused, -focused.getDay()),
      End: () => addDays(focused, 6 - focused.getDay()),
    }
    if (step[event.key]) {
      event.preventDefault()
      moveTo(step[event.key]())
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      choose(focused)
    }
  }

  const onRootKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      close()
    }
  }

  return (
    <div ref={rootRef} className={[styles.root, className].filter(Boolean).join(' ')} onKeyDown={onRootKeyDown}>
      {name ? <input type="hidden" name={name} value={value} /> : null}
      <button
        ref={triggerRef}
        id={fieldId}
        type="button"
        className={styles.field}
        disabled={disabled}
        data-invalid={invalid || undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? dialogId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-open={open || undefined}
        onClick={() => (open ? setOpen(false) : openCalendar())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault()
            openCalendar()
          }
        }}
      >
        <Calendar aria-hidden="true" className={styles.icon} />
        <span className={selected ? styles.value : styles.placeholder}>{selected ? formatLabel(selected) : placeholder}</span>
      </button>
      {selected && !disabled ? (
        <button type="button" className={styles.clear} aria-label="日付を消す" onClick={() => onChange('')}>
          <X aria-hidden="true" />
        </button>
      ) : null}

      {open ? (
        <div id={dialogId} role="dialog" aria-label="日付を選ぶ" className={styles.popover}>
          <div className={styles.header}>
            <button type="button" className={styles.nav} aria-label="前の月" onClick={() => moveTo(addMonths(focused, -1))}>
              <ChevronLeft aria-hidden="true" />
            </button>
            <p className={styles.month} aria-live="polite">{`${month.getFullYear()}年${month.getMonth() + 1}月`}</p>
            <button type="button" className={styles.nav} aria-label="次の月" onClick={() => moveTo(addMonths(focused, 1))}>
              <ChevronRight aria-hidden="true" />
            </button>
          </div>
          <div className={styles.weekdays} aria-hidden="true">
            {WEEKDAYS.map((label, index) => (
              <span key={label} data-weekday={index === 0 ? 'sun' : index === 6 ? 'sat' : undefined}>{label}</span>
            ))}
          </div>
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${month.getFullYear()}年${month.getMonth() + 1}月`}
            className={styles.grid}
            data-slide={slide ?? undefined}
            key={formatValue(month)}
            onKeyDown={onGridKeyDown}
          >
            {[0, 1, 2, 3, 4, 5].map((week) => (
              <div role="row" key={week} className={styles.week}>
                {days.slice(week * 7, week * 7 + 7).map((day) => {
                  const inMonth = day.getMonth() === month.getMonth()
                  const isSelected = Boolean(selected && sameDay(day, selected))
                  const isToday = sameDay(day, today())
                  const off = isDisabled(day)
                  return (
                    <div role="gridcell" key={formatValue(day)} aria-selected={isSelected || undefined}>
                      <button
                        type="button"
                        tabIndex={sameDay(day, focused) ? 0 : -1}
                        className={styles.day}
                        data-outside={inMonth ? undefined : true}
                        data-selected={isSelected || undefined}
                        data-today={isToday || undefined}
                        aria-disabled={off || undefined}
                        aria-label={`${formatLabel(day)}${isToday ? '、今日' : ''}`}
                        onClick={() => choose(day)}
                      >
                        {day.getDate()}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className={styles.footer}>
            <button type="button" className={styles.today} disabled={isDisabled(today())} onClick={() => choose(today())}>今日</button>
            <button type="button" className={styles.reset} onClick={() => { onChange(''); close() }}>消す</button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

function today(): Date {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate())
}

/** `YYYY-MM-DD`（`YYYY-MM-DDTHH:mm` の日付部分も可）を、その日の 0 時の Date にする。 */
export function parseDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return null
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 「2026年9月23日（水）」 */
export function formatLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日（${WEEKDAYS[date.getDay()]}）`
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function addMonths(date: Date, months: number): Date {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1)
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), last))
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/** その月の1日を含む週の日曜から、6週・42日。 */
function sixWeeks(month: Date): Date[] {
  const start = addDays(month, -month.getDay())
  return Array.from({ length: 42 }, (_, index) => addDays(start, index))
}
