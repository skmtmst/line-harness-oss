'use client'

import { cloneElement, createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react'
import { readSaveFieldErrors } from '@/lib/api-field-errors'
import { useFormErrors, type FormErrors } from '@/lib/use-form-errors'
import { FieldContext, joinDescribedBy, useFieldContext } from './field-context'
import { FieldError } from './form-controls'

/** B-154：既存の検査・409の守りを残して、保存のcatchで欄の理由を受ける。 */
export function useSaveFormErrors() {
  const current = useFormErrors()
  const latest = useRef(current)
  latest.current = current
  const stable = useRef<FormErrors | null>(null)
  if (!stable.current) {
    // 保存のcallbackは同じ入口を使い、欄の状態は毎回最新の描画から読む。
    stable.current = Object.fromEntries(Object.keys(current).map((key) => [key,
      (...args: unknown[]) => Reflect.apply(latest.current[key as keyof FormErrors], latest.current, args),
    ])) as FormErrors
  }
  const fields = stable.current
  const apply = useCallback((errors: Record<string, string | null | undefined>): boolean => {
    const count = Object.values(errors).filter(Boolean).length
    return count > 0 && fields.setServerErrors(errors) === count
  }, [fields])
  const capture = useCallback((error: unknown, existing?: FormErrors): boolean => {
    const errors = readSaveFieldErrors(error)
    const count = Object.keys(errors).length
    if (!count) return false
    // 知らない欄を含むときは、既存の知らせも残す。理由を握りつぶさない。
    return (existing?.setServerErrors(errors) ?? 0) === count || fields.setServerErrors(errors) === count
  }, [fields])
  return useMemo(() => ({ ...fields, apply, capture }), [fields, apply, capture])
}

const Scope = createContext<FormErrors[]>([])
const errorRows = new WeakMap<HTMLElement, { users: number; previousWrap: string }>()

/** 型・編集窓の外側。DOMを増やさず、子の欄（別ファイルの入力部品も）へ渡す。 */
export function SaveErrorScope({ errors, children }: { errors: FormErrors; children: ReactNode }) {
  const parents = useContext(Scope)
  return <Scope.Provider value={[...parents, errors]}>{children}</Scope.Provider>
}

type ControlProps = {
  type?: string
  id?: string
  invalid?: boolean
  'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'
  'aria-describedby'?: string
  style?: React.CSSProperties
  onChange?: (...args: never[]) => unknown
  onInput?: (...args: never[]) => unknown
  onCheckedChange?: (...args: never[]) => unknown
  onValueChange?: (...args: never[]) => unknown
}

/**
 * APIの欄名を明記する共通部品。別名は names に並べる（表示名からの推測はしない）。
 * 包みのDOMを増やさないので、既存の寸法・直接の子を指定するCSSを保つ。
 * 入力検査は画面に残し、保存失敗を欄下・赤枠・最初の欄への移動にそろえる。
 */
export function SaveErrorField({ names, children }: { names: string[]; children: ReactElement<ControlProps> }) {
  const scopes = useContext(Scope)
  const inherited = useFieldContext()
  const autoId = useId()
  const isChoice = 'checked' in children.props || 'onCheckedChange' in children.props || children.props.type === 'checkbox' || children.props.type === 'radio'
  const controlId = children.props.id ?? (isChoice ? undefined : inherited?.controlId) ?? `${autoId}-save-field`
  const errorId = `${autoId}-save-error`
  const key = names.join('\n')
  const element = useRef<HTMLElement | null>(null)
  const registrations = scopes.map((fields) => fields.register)
  useLayoutEffect(() => {
    const el = document.getElementById(controlId)
    if (!el) return
    element.current = el
    const label = (el as HTMLInputElement).labels?.[0]?.textContent ?? el.getAttribute('aria-label') ?? key.split('\n')[0]
    const dispose = registrations.flatMap((register) => key.split('\n').map((name) => register(name, label, el)))
    return () => { for (const unregister of dispose) unregister(); element.current = null }
    // 登録関数はhookの生存期間中に固定。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, controlId, ...registrations])
  const message = scopes.flatMap((fields) => names.map((name) => fields.errorFor(name, element.current))).find(Boolean)
  useLayoutEffect(() => {
    if (!message) return
    const note = document.getElementById(errorId)
    const parent = note?.parentElement
    if (!note || !parent) return
    const layout = getComputedStyle(parent)
    if (!layout.display.includes('flex') || layout.flexDirection.startsWith('column')) return
    // 数値＋単位などの横並びでも、理由は最後の行へ置く。入力DOMと値は保つ。
    const row = errorRows.get(parent) ?? { users: 0, previousWrap: parent.style.flexWrap }
    row.users += 1
    errorRows.set(parent, row)
    parent.style.flexWrap = 'wrap'
    note.style.flexBasis = '100%'
    note.style.order = '1'
    return () => {
      row.users -= 1
      if (!row.users) {
        if (parent.style.flexWrap === 'wrap') parent.style.flexWrap = row.previousWrap
        errorRows.delete(parent)
      }
    }
  }, [message, errorId])
  const clear = () => { for (const fields of scopes) for (const name of names) fields.clear(name) }
  const props: ControlProps = { id: controlId }
  for (const event of ['onChange', 'onValueChange', 'onCheckedChange', 'onInput'] as const) {
    const original = children.props[event]
    if (original || event === 'onInput') props[event] = (...args: never[]) => { clear(); return original?.(...args) }
  }
  if (message) {
    props['aria-invalid'] = true
    props['aria-describedby'] = joinDescribedBy(children.props['aria-describedby'], errorId)
    props.style = { ...children.props.style, outline: '1px solid var(--color-danger)' }
    if (typeof children.type === 'string') props.style.borderColor = 'var(--color-danger)'
    else props.invalid = true
  }
  return <FieldContext.Provider value={{
    ...inherited,
    onInvalidReset: message && children.props.onChange ? () => children.props.onChange?.('' as never) : inherited?.onInvalidReset,
    invalid: Boolean(message) || Boolean(inherited?.invalid),
    required: Boolean(inherited?.required),
    describedBy: joinDescribedBy(inherited?.describedBy, message ? errorId : undefined),
  }}>
    {cloneElement(children, props)}
    <FieldError id={errorId}>{message}</FieldError>
  </FieldContext.Provider>
}

/** 畳んだ欄はAPIの欄名を先に登録し、保存失敗時に開いてから欄へ移る。 */
export function useSaveErrorReveal(names: string[], reveal: () => void) {
  const scopes = useContext(Scope)
  const key = names.join('\n')
  const registrations = scopes.map((fields) => fields.registerReveal)
  useLayoutEffect(() => {
    const dispose = registrations.flatMap((register) => key.split('\n').map((name) => register(name, reveal)))
    return () => { for (const unregister of dispose) unregister() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, reveal, ...registrations])
}
