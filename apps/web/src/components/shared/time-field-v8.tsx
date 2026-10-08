'use client'

import { Clock3 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import MenuPortal from './menu-portal'
import styles from './time-field-v8.module.css'

/**
 * 時刻の欄（★V8）。Pencil V8.pen の提案「時刻を選ぶ（打つ＋2列から選ぶ）」YCOoR
 * （オーナー 2026-10-08「時間を選ぶものもこういう感じに」で採用）。
 *
 *   欄   高さ36・角丸10・枠 control-border・左に「09 : 00」・右に時計（28角）。
 *        空は「-- : --」。開いている／打っている間は緑の枠 2px。
 *        数字をそのまま打てる（0900・9:00・9 → 09:00）。範囲外は直さず理由を出す。
 *        きざみに合わない分は近い方へ合わせて知らせる。
 *   板   時計を押す／欄で ↓ で開く。白い板・薄い線・角丸12・影。
 *        「時」「分」の2列。1行30px、決まった高さで中をスクロールし、
 *        開いたときは選んだ値が見える位置へ。選んだ値は緑の地・白い太字。
 *        下に「今の時刻」（緑）と「消す」。
 *   キー 上下で動く・左右で列を移る・Enter で決める・Esc で閉じる。
 *        日本語の変換中の Enter では決めない。外を押すと閉じる。
 *   動き 提案 F：開く 150ms（不透明度＋大きさ 0.97→1）。動きを減らす設定では動かさない。
 *
 * 値の形は v7 と同じ `HH:mm`（日本時間・空は `''`）。保存の動きは呼ぶ側のまま。
 */
export type TimeFieldV8Props = {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** 分のきざみ（分）。5・15 など。既定は 1（今までの欄と同じ）。 */
  minuteStep?: number
  disabled?: boolean
  /** 閲覧のみ。値は見せるが打てず、時計も出さない（押せないボタンを置かない決まり）。 */
  readOnly?: boolean
  invalid?: boolean
  required?: boolean
  placeholder?: string
  id?: string
  name?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
}

type Column = 'hours' | 'minutes'

/** 1行の高さ（30）＋行の間（2）。開いたときの位置合わせに使う。 */
const ROW_PITCH = 32

export default function TimeFieldV8({
  value,
  defaultValue = '',
  onChange,
  minuteStep = 1,
  disabled = false,
  readOnly = false,
  invalid = false,
  required = false,
  placeholder = '-- : --',
  id,
  name,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
}: TimeFieldV8Props) {
  const autoId = useId()
  const fieldId = id ?? autoId
  const dialogId = `${fieldId}-time-dialog`
  const noteId = `${fieldId}-time-note`
  const step = normalizeStep(minuteStep)
  const [inner, setInner] = useState(defaultValue)
  const current = value ?? inner
  const parsed = parseHm(current)
  const [text, setText] = useState(() => (parsed ? formatShown(parsed) : ''))
  const [editing, setEditing] = useState(false)
  const [note, setNote] = useState<{ kind: 'error' | 'info'; text: string } | null>(null)
  const [open, setOpen] = useState(false)
  const [activeColumn, setActiveColumn] = useState<Column>('hours')
  const [activeHour, setActiveHour] = useState(10)
  const [activeMinute, setActiveMinute] = useState(0)
  const fieldRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const hourListRef = useRef<HTMLDivElement>(null)
  const minuteListRef = useRef<HTMLDivElement>(null)
  /** 開いた直後だけ、列が描かれたら位置合わせと焦点を行う（器が中身を描くのは位置を測った後）。 */
  const pendingOpenRef = useRef({ hours: false, minutes: false })

  const minutes = minuteOptions(step, parsed?.minutes)

  // 外から値が替わったら、打っている最中でなければ欄の字を合わせる。
  useEffect(() => {
    if (editing) return
    setText(parsed ? formatShown(parsed) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current])

  const emit = (next: string) => {
    if (value === undefined) setInner(next)
    onChange?.(next)
  }

  const openPanel = (column: Column = 'hours') => {
    if (disabled || readOnly) return
    setActiveHour(parsed ? parsed.hours : 10)
    setActiveMinute(parsed ? parsed.minutes : minutes[0] ?? 0)
    setActiveColumn(column)
    pendingOpenRef.current = { hours: true, minutes: true }
    setOpen(true)
  }

  const closePanel = (focusInput = true) => {
    setOpen(false)
    if (focusInput) inputRef.current?.focus()
  }

  const setHourList = (node: HTMLDivElement | null) => {
    hourListRef.current = node
    if (node && pendingOpenRef.current.hours) {
      pendingOpenRef.current.hours = false
      scrollToRow(node, activeHour)
      node.focus({ preventScroll: true })
    }
  }
  const setMinuteList = (node: HTMLDivElement | null) => {
    minuteListRef.current = node
    if (node && pendingOpenRef.current.minutes) {
      pendingOpenRef.current.minutes = false
      scrollToRow(node, minutes.indexOf(activeMinute))
    }
  }

  /** 打った字を決める。空は消す、読めない・範囲外は直さず理由。 */
  const commitText = () => {
    setEditing(false)
    if (readOnly) return
    // 触っただけ（字が今の値のまま）なら何もしない。きざみに合わない既存の値を黙って変えない。
    if (parsed && text === formatShown(parsed)) {
      if (note?.kind === 'error') setNote(null)
      return
    }
    const result = normalizeTimeInput(text, step)
    if (result.kind === 'empty') {
      setNote(null)
      if (current !== '') emit('')
      setText('')
      return
    }
    if (result.kind === 'error') {
      setNote({ kind: 'error', text: result.message })
      return
    }
    setNote(result.note ? { kind: 'info', text: result.note } : null)
    setText(formatShown(result.time))
    const next = formatValue(result.time)
    if (next !== current) emit(next)
  }

  const chooseHour = (hours: number) => {
    const minutesPart = parsed ? parsed.minutes : activeMinute
    setActiveHour(hours)
    setNote(null)
    emit(formatValue({ hours, minutes: minutesPart }))
  }

  const chooseMinute = (minutesValue: number) => {
    const hoursPart = parsed ? parsed.hours : activeHour
    setActiveMinute(minutesValue)
    setNote(null)
    emit(formatValue({ hours: hoursPart, minutes: minutesValue }))
  }

  const chooseNow = () => {
    const now = nowInTokyo()
    const snapped = snapToStep(now, step)
    setNote(null)
    emit(formatValue(snapped.time))
    closePanel()
  }

  const clear = () => {
    setNote(null)
    emit('')
    setText('')
    closePanel()
  }

  const onInputKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isComposing(event)) return
    if (event.key === 'ArrowDown' && !open) {
      event.preventDefault()
      openPanel()
      return
    }
    if (event.key === 'Enter') {
      // 欄の中の Enter は打った字を決めるだけ（包んだフォームを送らない）。
      event.preventDefault()
      commitText()
      return
    }
    if (event.key === 'Escape' && open) {
      event.preventDefault()
      closePanel()
    }
  }

  const onListKeyDown = (column: Column) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (isComposing(event)) return
    const list = column === 'hours' ? HOURS : minutes
    const active = column === 'hours' ? activeHour : activeMinute
    const setActive = column === 'hours' ? setActiveHour : setActiveMinute
    const listRef = column === 'hours' ? hourListRef : minuteListRef
    const index = Math.max(0, list.indexOf(active))
    const move = (nextIndex: number) => {
      const clamped = Math.min(list.length - 1, Math.max(0, nextIndex))
      setActive(list[clamped])
      keepRowVisible(listRef.current, clamped)
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(index + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        move(index - 1)
        return
      case 'Home':
        event.preventDefault()
        move(0)
        return
      case 'End':
        event.preventDefault()
        move(list.length - 1)
        return
      case 'ArrowRight':
      case 'ArrowLeft': {
        event.preventDefault()
        const nextColumn: Column = column === 'hours' ? 'minutes' : 'hours'
        setActiveColumn(nextColumn)
        ;(nextColumn === 'hours' ? hourListRef : minuteListRef).current?.focus({ preventScroll: true })
        return
      }
      case 'Enter':
      case ' ': {
        event.preventDefault()
        if (column === 'hours') {
          chooseHour(active)
          setActiveColumn('minutes')
          minuteListRef.current?.focus({ preventScroll: true })
        } else {
          chooseMinute(active)
          closePanel()
        }
        return
      }
      case 'Escape':
        event.preventDefault()
        event.stopPropagation()
        closePanel()
        return
      default:
    }
  }

  const shownHour = parsed ? parsed.hours : null
  const shownMinute = parsed ? parsed.minutes : null

  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')}>
      {name ? <input type="hidden" name={name} value={current} /> : null}
      <div
        ref={fieldRef}
        className={styles.field}
        data-open={open || undefined}
        data-invalid={invalid || note?.kind === 'error' || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
      >
        <input
          ref={inputRef}
          id={fieldId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          className={styles.input}
          value={text}
          placeholder={placeholder}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || note?.kind === 'error' || undefined}
          role="combobox"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={[ariaDescribedBy, note ? noteId : null].filter(Boolean).join(' ') || undefined}
          title={parsed ? formatValue(parsed) : undefined}
          onChange={(event) => {
            setEditing(true)
            setText(event.target.value)
            if (note?.kind === 'error') setNote(null)
          }}
          onBlur={() => commitText()}
          onKeyDown={onInputKeyDown}
        />
        {readOnly ? null : (
        <button
          type="button"
          className={styles.open}
          aria-label="時刻の一覧を開く"
          aria-expanded={open}
          aria-controls={open ? dialogId : undefined}
          disabled={disabled}
          // 欄の焦点を外さずに押す（押した瞬間に打った字が決まってしまわないように）。
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (open ? closePanel() : openPanel())}
        >
          <Clock3 aria-hidden="true" />
        </button>
        )}
      </div>
      {note ? (
        <p id={noteId} className={styles.note} data-kind={note.kind} role={note.kind === 'error' ? 'alert' : 'status'}>
          {note.text}
        </p>
      ) : null}

      {open ? (
        <MenuPortal open={open} align="start" gap={4} getAnchor={() => fieldRef.current} onClose={() => setOpen(false)}>
          <div
            id={dialogId}
            role="dialog"
            aria-label="時刻を選ぶ"
            className={styles.panel}
            style={{ position: 'static' }}
            // 包んだ `<label>` への再送達を防ぐ（v7 の時刻の選択と同じ）。
            onClick={(event) => event.stopPropagation()}
          >
            <div className={styles.columns}>
              <div className={styles.column}>
                <div className={styles.columnHead} id={`${fieldId}-hours-head`}>時</div>
                <div
                  ref={setHourList}
                  role="listbox"
                  aria-label="時"
                  tabIndex={0}
                  className={styles.list}
                  data-active={activeColumn === 'hours' || undefined}
                  aria-activedescendant={`${fieldId}-h-${activeHour}`}
                  onFocus={() => setActiveColumn('hours')}
                  onKeyDown={onListKeyDown('hours')}
                >
                  {HOURS.map((hour) => (
                    <div
                      key={hour}
                      id={`${fieldId}-h-${hour}`}
                      role="option"
                      aria-selected={shownHour === hour}
                      className={styles.option}
                      data-selected={shownHour === hour || undefined}
                      data-active={(activeColumn === 'hours' && activeHour === hour) || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        chooseHour(hour)
                        setActiveColumn('hours')
                      }}
                    >
                      {pad(hour)}
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.divider} aria-hidden="true" />
              <div className={styles.column}>
                <div className={styles.columnHead}>分</div>
                <div
                  ref={setMinuteList}
                  role="listbox"
                  aria-label="分"
                  tabIndex={0}
                  className={styles.list}
                  data-active={activeColumn === 'minutes' || undefined}
                  aria-activedescendant={`${fieldId}-m-${activeMinute}`}
                  onFocus={() => setActiveColumn('minutes')}
                  onKeyDown={onListKeyDown('minutes')}
                >
                  {minutes.map((minute) => (
                    <div
                      key={minute}
                      id={`${fieldId}-m-${minute}`}
                      role="option"
                      aria-selected={shownMinute === minute}
                      className={styles.option}
                      data-selected={shownMinute === minute || undefined}
                      data-active={(activeColumn === 'minutes' && activeMinute === minute) || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        chooseMinute(minute)
                        closePanel()
                      }}
                    >
                      {pad(minute)}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className={styles.foot}>
              <button type="button" className={styles.now} onClick={chooseNow}>今の時刻</button>
              <button type="button" className={styles.clear} onClick={clear}>消す</button>
            </div>
          </div>
        </MenuPortal>
      ) : null}
    </div>
  )
}

export type Hm = { hours: number; minutes: number }

export type TimeInputResult =
  | { kind: 'empty' }
  | { kind: 'ok'; time: Hm; note: string | null }
  | { kind: 'error'; message: string }

/**
 * 打った字を `HH:mm` に直す。
 * - `0900`・`900`・`9:00`・`9：00`・`9`・`09`・`9時`・`9時30分`・全角数字を読む
 * - 時が 24 以上・分が 60 以上は直さず理由を返す
 * - きざみに合わない分は近い方へ合わせ、知らせる文を付ける
 */
export function normalizeTimeInput(raw: string, minuteStep = 1): TimeInputResult {
  const text = raw.normalize('NFKC').replace(/\s+/g, '')
  if (text === '' || text === '--:--') return { kind: 'empty' }
  let hours: number
  let minutes: number
  const separated = /^(\d{1,2})(?::|時)(\d{1,2})?分?$/.exec(text)
  const digits = /^\d{1,4}$/.exec(text)
  if (separated) {
    hours = Number(separated[1])
    minutes = separated[2] === undefined ? 0 : Number(separated[2])
  } else if (digits) {
    if (text.length <= 2) {
      hours = Number(text)
      minutes = 0
    } else {
      hours = Number(text.slice(0, text.length - 2))
      minutes = Number(text.slice(-2))
    }
  } else {
    return { kind: 'error', message: '「0900」「9:00」の形で入れてください' }
  }
  if (hours > 23) return { kind: 'error', message: '時は 0〜23 で入れてください' }
  if (minutes > 59) return { kind: 'error', message: '分は 0〜59 で入れてください' }
  const snapped = snapToStep({ hours, minutes }, normalizeStep(minuteStep))
  return {
    kind: 'ok',
    time: snapped.time,
    note: snapped.changed ? `${normalizeStep(minuteStep)}分きざみなので ${formatValue(snapped.time)} にしました` : null,
  }
}

/** きざみの近い方へ合わせる。23時台で 24:00 になるときは下へ。 */
export function snapToStep(time: Hm, minuteStep: number): { time: Hm; changed: boolean } {
  const step = normalizeStep(minuteStep)
  if (time.minutes % step === 0) return { time, changed: false }
  let total = time.hours * 60 + Math.round(time.minutes / step) * step
  if (total >= 24 * 60) total = time.hours * 60 + Math.floor(time.minutes / step) * step
  return { time: { hours: Math.floor(total / 60), minutes: total % 60 }, changed: true }
}

/** `HH:mm`（秒付きも可）を読む。読めなければ null。 */
function parseHm(value: string): Hm | null {
  const match = /^(\d{2}):(\d{2})/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return { hours, minutes }
}

/** 60 を割り切る 1〜60 の整数だけ受ける。それ以外は 1。 */
function normalizeStep(step: number): number {
  return Number.isInteger(step) && step >= 1 && step <= 60 && 60 % step === 0 ? step : 1
}

/** 分の列。きざみに合わない今の値があれば、その値も並べて選んだ形で見せる。 */
function minuteOptions(step: number, currentMinute?: number): number[] {
  const list = Array.from({ length: 60 / step }, (_, index) => index * step)
  if (currentMinute !== undefined && !list.includes(currentMinute)) {
    list.push(currentMinute)
    list.sort((a, b) => a - b)
  }
  return list
}

function nowInTokyo(): Hm {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date())
  const hours = Number(parts.find((part) => part.type === 'hour')?.value ?? 0)
  const minutes = Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  return { hours: hours % 24, minutes }
}

function isComposing(event: KeyboardEvent<HTMLElement>): boolean {
  // 日本語の変換中（確定の Enter を含む）は何もしない。Safari は keyCode 229 だけ立つ。
  return event.nativeEvent.isComposing || event.keyCode === 229
}

function scrollToRow(list: HTMLElement | null, index: number) {
  if (!list || index < 0) return
  // 選んだ値の上に1行見えるように（絵の 08 の下に 09）。
  list.scrollTop = Math.max(0, (index - 1) * ROW_PITCH)
}

function keepRowVisible(list: HTMLElement | null, index: number) {
  if (!list) return
  const top = index * ROW_PITCH
  const bottom = top + ROW_PITCH
  if (top < list.scrollTop) list.scrollTop = top
  else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
}

const HOURS = Array.from({ length: 24 }, (_, index) => index)

function formatValue(time: Hm): string {
  return `${pad(time.hours)}:${pad(time.minutes)}`
}

/** 欄に見せる字。絵の「09 : 00」。 */
function formatShown(time: Hm): string {
  return `${pad(time.hours)} : ${pad(time.minutes)}`
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}
