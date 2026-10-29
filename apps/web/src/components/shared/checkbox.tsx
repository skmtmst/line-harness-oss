'use client'

import { useEffect, useId, useRef, type InputHTMLAttributes, type ReactNode, type PointerEvent, type FocusEvent, type KeyboardEvent } from 'react'
import styles from './checkbox.module.css'
import { usePermissionLockTip } from './permission-lock-tip'

/**
 * チェックボックス。Pencil ★V8 `dQCCN`・`S9U7v`「チェック/オン・オフ」。
 *
 * 一覧の選択・すぐ反映しない設定の ON/OFF に使う。すぐ反映する切替は `Toggle`。
 * 形の手本は kobra.systems の Checkbox（コードは写していない）。
 *
 * - 本物の `<input type="checkbox">` を四角の上に透明に重ねる。クリック・Space・読み上げは
 *   ブラウザの標準のまま。見た目だけを ★管理画面 に合わせる
 * - 未選択の枠は `$ink-faint`（白地と 4.8:1）。`$hairline` は 1.4:1 で、部品の見分けに要る 3:1 に届かない
 * - `indeterminate`（一部選択）は一覧の見出しの「表示中をすべて選ぶ」に使う
 * - 文字（children）を押しても切り替わる。文字が無いときは `aria-label` を必ず渡す
 * - 動きは Pencil ★V8 の動きの表 `NF3uI`。印は一筆で描かれ、
 *   外すときは描き戻さずに薄くなって消える。印の線は `pathLength=1` にして、
 *   CSS が長さを知らなくても 0→1 で描けるようにしている
 */
export default function Checkbox({
  checked,
  onCheckedChange,
  indeterminate = false,
  invalid = false,
  description,
  lockedReason,
  error,
  children,
  className,
  id,
  ...rest
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** 一部選択（―）。checked より優先して見せる。 */
  indeterminate?: boolean
  invalid?: boolean
  /** 文字の下の補足（薄い字）。 */
  description?: ReactNode
  /**
   * 権限で使えない時も同じ欄を残し、焦点で理由を伝える。
   * 止まるのは click・change・Enter・Space だけ。他のイベントで変更を書き込まない。
   */
  lockedReason?: string
  /** 誤りの文。指定すると invalid とみなす。 */
  error?: ReactNode
  /** 横に並べる文字。押しても切り替わる。 */
  children?: ReactNode
  className?: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'className' | 'children'>) {
  const ref = useRef<HTMLInputElement>(null)
  const autoId = useId()
  const inputId = id ?? autoId
  const noteId = `${inputId}-note`
  const hasNote = Boolean(error || description)
  const isInvalid = invalid || Boolean(error)
  const describedBy = hasNote ? noteId : rest['aria-describedby']
  const lock = usePermissionLockTip<HTMLInputElement>(lockedReason, lockedReason ? [rest['aria-describedby'], hasNote ? noteId : undefined].filter(Boolean).join(' ') : describedBy)
  const setInputRef = (element: HTMLInputElement | null) => { ref.current = element; lock.ref.current = element }
  const lockHandlers = lock.handlers ? {
    ...lock.handlers,
    onPointerEnter: (event: PointerEvent<HTMLInputElement>) => { rest.onPointerEnter?.(event); lock.handlers?.onPointerEnter(event) },
    onPointerLeave: (event: PointerEvent<HTMLInputElement>) => { rest.onPointerLeave?.(event); lock.handlers?.onPointerLeave(event) },
    onFocus: (event: FocusEvent<HTMLInputElement>) => { rest.onFocus?.(event); lock.handlers?.onFocus() },
    onBlur: (event: FocusEvent<HTMLInputElement>) => { rest.onBlur?.(event); lock.handlers?.onBlur() },
    onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => { lock.handlers?.onKeyDown(event); if (!event.defaultPrevented) rest.onKeyDown?.(event) },
  } : undefined

  useEffect(() => {
    // indeterminate は属性ではなく DOM のプロパティにしか無い。
    if (ref.current) ref.current.indeterminate = indeterminate
  }, [indeterminate])

  return (
    <span className={[styles.root, className].filter(Boolean).join(' ')} data-disabled={rest.disabled || lockedReason ? 'true' : undefined}>
      <label className={styles.line} htmlFor={inputId}>
        <span className={styles.control}>
          <input
            {...rest}
            ref={lockedReason ? setInputRef : ref}
            id={inputId}
            type="checkbox"
            checked={checked}
            aria-invalid={isInvalid || undefined}
            aria-describedby={describedBy}
            onChange={(event) => { if (!rest.disabled && !lockedReason) onCheckedChange(event.target.checked) }}
            {...lockHandlers}
            className={styles.input}
          />
          <CheckboxMark />
        </span>
        {children ? <span className={styles.label}>{children}</span> : null}
      </label>
      {lock.node}
      {hasNote ? (
        <span id={noteId} className={error ? styles.error : styles.description}>{error ?? description}</span>
      ) : null}
    </span>
  )
}

/**
 * 印の線。外接する箱の中心が viewBox（24×24）の中心 (12, 12) に来るように置く。
 * 前の ✓（M4 12l5 5L20 6）は中心が (12, 11.5) で、箱の中で上へずれて見えた。
 */
export const CHECK_MARK_PATH = 'M6 12.5l4 4 8-9'
export const MINUS_MARK_PATH = 'M6 12h12'

/** 四角と印。本物の input の直後に置く（CSS の `.input:checked + .box` で色と印が変わる）。 */
function CheckboxMark() {
  return (
    <span aria-hidden="true" className={styles.box}>
      <svg className={`${styles.mark} ${styles.check}`} viewBox="0 0 24 24">
        <path d={CHECK_MARK_PATH} pathLength={1} />
      </svg>
      <svg className={`${styles.mark} ${styles.minus}`} viewBox="0 0 24 24">
        <path d={MINUS_MARK_PATH} pathLength={1} />
      </svg>
    </span>
  )
}

/**
 * 文字や札を自分で持つ部品（選ぶカードなど）が使う、チェックの四角だけ。
 * 大きさ・角丸・線・選んだ時の動きは Checkbox と同じ1種類。
 */
export function CheckboxControl({
  checked,
  onCheckedChange,
  invalid = false,
  ...rest
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  invalid?: boolean
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'checked' | 'onChange' | 'className' | 'children'>) {
  return (
    <span className={styles.control}>
      <input
        {...rest}
        type="checkbox"
        checked={checked}
        aria-invalid={invalid || undefined}
        onChange={(event) => { if (!rest.disabled) onCheckedChange(event.target.checked) }}
        className={styles.input}
      />
      <CheckboxMark />
    </span>
  )
}

/** 閲覧のみの選ぶ操作は描かない。対象外の行は、理由と枠を保つ。 */
export function UnavailableSelection({ label, reason = '閲覧のみのため選べません' }: { label: string; reason?: string }) {
  if (reason === '閲覧のみのため選べません') return null
  return <Checkbox checked={false} disabled aria-label={label} aria-description={reason} title={reason}
    onClick={(event) => event.stopPropagation()} onCheckedChange={() => {}} />
}

/** 保存や送信で反映する二択。即時反映のスイッチと同じデータ契約で移行できる。 */
export function SettingCheckbox({ checked, label, onChange, disabled, locked }: {
 checked: boolean; label: string; onChange?: (checked:boolean)=>void; disabled?:boolean; locked?:boolean
}) {
 return <span data-setting-checkbox className={styles.setting}><Checkbox checked={Boolean(locked || checked)} aria-label={label} disabled={locked || disabled} title={locked ? 'この設定は常にオンです' : undefined} aria-description={locked ? 'この設定は常にオンです' : undefined} onCheckedChange={onChange ?? (()=>{})} /></span>
}
