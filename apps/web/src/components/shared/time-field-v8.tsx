'use client'

import choiceStyles from './choice-field.module.css'
import { normalizeTimeInput, snapToStep, parseHm, normalizeStep, minuteOptions, nowInTokyo, formatValue, formatShown, formatTimePart as pad } from './time-field-input'
export { normalizeTimeInput, snapToStep } from './time-field-input'
export type { Hm, TimeInputResult } from './time-field-input'
import { inputPlaceholder } from './input-placeholder'
import { Clock3 } from 'lucide-react'
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import MenuPortal from './menu-portal'
import styles from './time-field-v8.module.css'
import { isImeComposing } from './ime'

/**
 * 時刻の欄（★V8）。Pencil V8.pen の提案「時刻を選ぶ（打つ＋2列から選ぶ）」YCOoR
 * （オーナー 2026-10-08「時間を選ぶものもこういう感じに」で採用）。
 *
 *   欄   閉じた外形と焦点は choice-field の共通の形。右の時計で時刻を選ぶ。
 *        空は「-- : --」。
 *        数字をそのまま打てる（0900・9:00・9 → 09:00）。範囲外は直さず理由を出す。
 *        きざみに合わない分は近い方へ合わせて知らせる。
 *   板   時計を押す／欄で ↓ で開く。白い板・薄い線・角丸12・影。
 *        「時」「分」の2列。1行30px、決まった高さで中をスクロールし、
 *        開いたときは選んだ値が見える位置へ。選んだ値は緑の地・白い太字。
 *        下に「今の時刻」（緑）と「消す」。
 *   キー 上下で動く・左右で列を移る・Enter で決める・Esc で閉じる。
 *        日本語の変換中の Enter では決めない。外を押すと閉じる。
 *   動き 提案 F：開く 150ms（不透明度＋大きさ 0.97→1）。動きを減らす設定では動かさない。
 */
export type TimeFieldV8Props = {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  /** 分のきざみ（分）。5・15 など。既定は 1（今までの欄と同じ）。 */
  minuteStep?: number
  /** 終了時刻だけ24:00を使える。通常の時刻入力は0〜23時のまま。 */
  allowEndOfDay?: boolean
  /** 互換の配置名。高さは共通36px、タッチ端末は44px。 */
  size?: TimeFieldSize
  pickerTrigger?: 'clock' | 'field'
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

export type TimeFieldSize = 'default' | 'field' | 'compact'

const ROW_PITCH = 32

export default function TimeFieldV8({
  value,
  defaultValue = '',
  onChange,
  minuteStep = 1,
  allowEndOfDay = false,
  size = 'default',
  pickerTrigger = 'clock',
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
  const parsed = parseHm(current, allowEndOfDay)
  const hours = allowEndOfDay ? [...HOURS, 24] : HOURS
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

  const minutes = (parsed?.hours ?? activeHour) === 24 ? [0] : minuteOptions(step, parsed?.minutes)

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
    const result = normalizeTimeInput(text, step, allowEndOfDay)
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
    const minutesPart = hours === 24 ? 0 : parsed ? parsed.minutes : activeMinute
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
    if (isImeComposing(event)) return
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
    if (isImeComposing(event)) return
    const list = column === 'hours' ? hours : minutes
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
        className={`${styles.field} ${choiceStyles.frame}`}
        data-choice-field data-choice-time data-choice-invalid={invalid || note?.kind === 'error' || undefined} data-choice-disabled={disabled || undefined}
        data-open={open || undefined}
        data-invalid={invalid || note?.kind === 'error' || undefined}
        data-disabled={disabled || undefined}
        data-readonly={readOnly || undefined}
        data-size={size === 'default' ? undefined : size}
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
          placeholder={inputPlaceholder(placeholder)}
          disabled={disabled}
          readOnly={readOnly}
          required={required}
          aria-required={required || undefined}
          aria-invalid={invalid || note?.kind === 'error' || undefined}
          data-choice-trigger
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
          onClick={pickerTrigger === 'field' ? () => { if (!open) openPanel() } : undefined}
        />
        {!readOnly && pickerTrigger === 'field' ? <Clock3 data-choice-chevron aria-hidden="true" /> : null}
        {readOnly || pickerTrigger === 'field' ? null : (
        <button
          type="button"
          className={styles.open} data-choice-action
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
        <MenuPortal open={open} align="start" gap={4} getAnchor={() => fieldRef.current} onClose={() => setOpen(false)}
          onReady={() => (activeColumn === 'hours' ? hourListRef : minuteListRef).current?.focus({ preventScroll: true })}>
          <div
            id={dialogId}
            role="dialog"
            aria-label="時刻を選ぶ"
            className={styles.panel}
            style={{ position: 'static' }}
            // 包んだ `<label>` への再送達を防ぐ（管理画面 の時刻の選択と同じ）。
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
                  {hours.map((hour) => (
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
