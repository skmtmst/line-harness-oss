'use client'

import { inputPlaceholder } from './input-placeholder'
import { forwardRef, useEffect, useRef, type ForwardedRef, type HTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import { guardCompositionEnter } from './composition-enter'
import { joinDescribedBy, useFieldContext } from './field-context'
import styles from './text-field.module.css'
import { useContentChangeAccess, type ContentChangeAccess } from './use-content-change-access'
import { usePermissionLockTip } from './permission-lock-tip'

/*
 * 入力欄の正本（★V8 共通部品 Ume2U「入力欄」・i5BW8b「入力欄/複数行」・fDAyI「入力欄/エラー」）。
 *
 * 入力欄はこのファイルの2つだけ。form-controls.tsx の TextInput・TextArea は
 * ここを呼ぶだけの薄い包み（管理画面 の見た目の差だけを足す）。
 *
 * `Field`（form-controls.tsx）の中に置くと、説明・誤りの文・文字数の id を
 * aria-describedby に、誤りの有無を aria-invalid に、必須を aria-required に
 * 自動で付ける。呼ぶ側が直接渡した値はそのまま残し、足し合わせる。
 */

type ControlOwnProps = ContentChangeAccess & { invalid?: boolean; className?: string; /** 計算値だけに使う読み取り専用の欄。 */ derived?: boolean }

/** 読む・選択する操作は残し、値の変更だけを描画時と現在の両方で拒む。 */
function useTextControlAccess<T extends HTMLInputElement | HTMLTextAreaElement>(policy: ContentChangeAccess, ref: ForwardedRef<T>, describedBy?: string) {
  const provided = policy.lockedReason !== undefined || policy.canChangeNow !== undefined
  const access = useContentChangeAccess({ ...policy, disabled: provided ? policy.disabled : undefined })
  const lock = usePermissionLockTip<T>(access.lockedReason, describedBy)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const controlRef = (node: T | null) => {
    lock.ref.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) ref.current = node
  }
  return { ...access, lock, ref: access.provided ? controlRef : ref,
    canChangeNow: () => (!access.provided || mounted.current) && access.canChangeNow() }
}

function useControlA11y(props: {
  id?: string
  invalid?: boolean
  required?: boolean
  'aria-describedby'?: string
  'aria-invalid'?: InputHTMLAttributes<HTMLInputElement>['aria-invalid']
  'aria-required'?: InputHTMLAttributes<HTMLInputElement>['aria-required']
}) {
  const field = useFieldContext()
  const invalid = Boolean(props.invalid) || Boolean(field?.invalid)
  return {
    id: props.id ?? field?.controlId,
    'aria-label': field?.label,
    'aria-describedby': joinDescribedBy(props['aria-describedby'], field?.describedBy),
    'aria-invalid': props['aria-invalid'] ?? (invalid || undefined),
    'aria-required': props['aria-required'] ?? (field?.required && !props.required ? true : undefined),
    invalid,
  }
}

/**
 * 1行の入力欄（Ume2U）。幅は持たない（`width: 100%` で親に合わせる）。
 * 列の幅は呼び出し側で決める。
 */
export const TextField = forwardRef<
  HTMLInputElement,
  ControlOwnProps & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>
>(function TextField({ derived, invalid, className, id, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, onKeyDown, lockedReason, canChangeNow, ...rest }, ref) {
  const a11y = useControlA11y({ id, invalid, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired })
  const access = useTextControlAccess<HTMLInputElement>({ disabled: rest.disabled, lockedReason, canChangeNow }, ref, a11y['aria-describedby'])
  return (
    <><input
      ref={access.ref}
      type="text"
      data-design-node="Ume2U"
      data-input-field
      {...rest}
      disabled={lockedReason ? false : rest.disabled || access.disabled}
      readOnly={derived || rest.readOnly || (access.provided && access.blocked)}
      {...access.lock.handlers}
      onClick={access.provided ? event => { if (access.canChangeNow()) rest.onClick?.(event); else access.lock.handlers?.onClick(event) } : rest.onClick}
      onChange={access.provided ? event => { if (access.canChangeNow()) rest.onChange?.(event) } : rest.onChange}
      onInput={access.provided ? event => { if (access.canChangeNow()) rest.onInput?.(event) } : rest.onInput}
      onFocus={lockedReason ? event => { access.lock.handlers?.onFocus(); rest.onFocus?.(event) } : rest.onFocus}
      onBlur={lockedReason ? event => { access.lock.handlers?.onBlur(); rest.onBlur?.(event) } : rest.onBlur}
      data-look={derived ? 'derived' : (rest as Record<string, unknown>)['data-look'] as string | undefined}
      placeholder={inputPlaceholder(rest.placeholder)}
      onKeyDown={guardCompositionEnter(lockedReason ? event => { access.lock.handlers?.onKeyDown(event); if (!event.defaultPrevented) onKeyDown?.(event) } : onKeyDown)}
      id={a11y.id}
      required={required}
      aria-label={rest['aria-label'] ?? a11y['aria-label']}
      aria-describedby={access.lock.handlers?.['aria-describedby'] ?? a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
      className={[styles.field, styles.single, a11y.invalid && styles.invalid, className].filter(Boolean).join(' ')}
    />{access.lock.node}</>
  )
})

/** 前後に固定文字を添える1行欄。縦のFieldではlayout=fieldで高さを保つ。 */
export const AffixedTextField = forwardRef<
  HTMLInputElement,
  ControlOwnProps & { startAdornment?: ReactNode; endAdornment?: ReactNode; monospace?: boolean; layout?: 'inline' | 'field' } & Omit<InputHTMLAttributes<HTMLInputElement>, 'className'>
>(function AffixedTextField({ startAdornment, endAdornment, monospace, layout = 'inline', className, style, ...props }, ref) {
  const a11y = useControlA11y(props)
  return <span className={[styles.field, styles.single, styles.affixed, className].filter(Boolean).join(' ')}
    data-input-field style={style} aria-invalid={a11y['aria-invalid']} data-look={props.derived ? 'derived' : undefined} data-disabled={props.disabled || undefined} data-permission-locked={props.lockedReason ? '' : undefined} data-monospace={monospace || undefined} data-affixed-layout={layout}>
    {startAdornment !== undefined && <span className={styles.adornment} aria-hidden="true">{startAdornment}</span>}
    <TextField {...props} ref={ref} className={styles.affixedControl} />
    {endAdornment !== undefined && <span className={styles.adornment} aria-hidden="true">{endAdornment}</span>}
  </span>
})

/**
 * 複数行の入力欄（i5BW8b）。決まりは部品の中で持つ：
 * - 縦にだけ手で広げられる（横は広げられない）
 * - 最小の高さは 120px（★V8 の今の値）
 * 画面の側で resize を変えない。
 */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  ControlOwnProps & { compact?: boolean; density?: 'regular' | 'compact'; height?: 'post' | 'reply'; size?: 'short' | 'single-row' } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'>
>(function TextArea({ derived, compact, density, height, size, invalid, className, id, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired, onKeyDown, lockedReason, canChangeNow, ...rest }, ref) {
  const a11y = useControlA11y({ id, invalid, required, 'aria-describedby': describedBy, 'aria-invalid': ariaInvalid, 'aria-required': ariaRequired })
  const access = useTextControlAccess<HTMLTextAreaElement>({ disabled: rest.disabled, lockedReason, canChangeNow }, ref, a11y['aria-describedby'])
  return (
    <><textarea
      ref={access.ref}
      data-design-node="i5BW8b"
      data-input-field
      data-density={density}
      data-height={height}
      {...rest}
      disabled={lockedReason ? false : rest.disabled || access.disabled}
      readOnly={derived || rest.readOnly || (access.provided && access.blocked)}
      {...access.lock.handlers}
      onClick={access.provided ? event => { if (access.canChangeNow()) rest.onClick?.(event); else access.lock.handlers?.onClick(event) } : rest.onClick}
      onChange={access.provided ? event => { if (access.canChangeNow()) rest.onChange?.(event) } : rest.onChange}
      onInput={access.provided ? event => { if (access.canChangeNow()) rest.onInput?.(event) } : rest.onInput}
      onFocus={lockedReason ? event => { access.lock.handlers?.onFocus(); rest.onFocus?.(event) } : rest.onFocus}
      onBlur={lockedReason ? event => { access.lock.handlers?.onBlur(); rest.onBlur?.(event) } : rest.onBlur}
      placeholder={inputPlaceholder(rest.placeholder)}
      onKeyDown={guardCompositionEnter(lockedReason ? event => { access.lock.handlers?.onKeyDown(event); if (!event.defaultPrevented) onKeyDown?.(event) } : onKeyDown)}
      id={a11y.id}
      required={required}
      aria-label={rest['aria-label'] ?? a11y['aria-label']}
      aria-describedby={access.lock.handlers?.['aria-describedby'] ?? a11y['aria-describedby']}
      aria-invalid={a11y['aria-invalid']}
      aria-required={a11y['aria-required']}
      className={[styles.field, styles.multi, compact && styles.multiCompact, size === 'short' && styles.multiShort, size === 'single-row' && styles.multiSingleRow, a11y.invalid && styles.invalid, className].filter(Boolean).join(' ')}
    />{access.lock.node}</>
  )
})

/** 札や補助ボタンを含む入力の外枠。文字欄の線は、この箱の1本にまとめる。 */
export function InputFieldFrame(props: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-input-field />
}
