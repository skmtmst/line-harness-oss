'use client'
import { useLayoutEffect, useRef, useState, type SyntheticEvent } from 'react'

/** 共通の入力を持つ窓の初期値と現在値を比べる。値は画面のメモリーだけに置く。 */
export function formInputSnapshot(root: HTMLElement): string {
  const controls = root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement>('input,textarea,select,[contenteditable="true"],[role="combobox"],[role="switch"],[role="checkbox"],[role="radio"],[aria-haspopup="listbox"]')
  return JSON.stringify(Array.from(controls, (control) => {
    if (control instanceof HTMLInputElement) return [control.name || control.id, control.type, control.type === 'checkbox' || control.type === 'radio' ? control.checked : control.value]
    if (control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement) return [control.name || control.id, control.value]
    return [control.getAttribute('aria-label'), control.getAttribute('aria-checked'), control.getAttribute('aria-selected'), control.textContent]
  }))
}
export function useFormInputDirty(open: boolean) {
  const ref = useRef<HTMLElement | null>(null)
  const initial = useRef('')
  const touched = useRef(false)
  const [dirty, setDirty] = useState(false)
  const update = () => {
    if (!ref.current || !open) return
    setDirty(formInputSnapshot(ref.current) !== initial.current)
  }
  useLayoutEffect(() => {
    if (!open) { touched.current = false; initial.current = ''; if (dirty) setDirty(false); return }
    if (!ref.current) return
    if (!touched.current) initial.current = formInputSnapshot(ref.current)
    else update()
  })
  const onChangeCapture = () => { touched.current = true; update() }
  const onClickCapture = (event: SyntheticEvent) => {
    if (!(event.target as Element).closest?.('[role="option"],[role="switch"],[role="checkbox"],[role="radio"]')) return
    touched.current = true
    queueMicrotask(update)
  }
  const resetBaseline = (snapshot: string) => { initial.current = snapshot; touched.current = true; update() }
  return { ref, dirty, onChangeCapture, onClickCapture, resetBaseline }
}
