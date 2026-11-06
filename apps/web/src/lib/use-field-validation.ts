'use client'

import { useState } from 'react'

export type FieldProblem = { id: string; message: string }

/** 入力欄が描画されたあと、最初の誤りを画面の中央へ出す。 */
export function focusFormField(id: string) {
  requestAnimationFrame(() => {
    const root = document.getElementById(id)
    const field = root?.matches('input, textarea, button, [contenteditable="true"]')
      ? root : root?.querySelector<HTMLElement>('input, textarea, button, [contenteditable="true"]')
    field?.focus({ preventScroll: true })
    field?.scrollIntoView?.({ block: 'center' })
  })
}

/** 保存で全欄を検査。値を直すと、その欄の理由と赤い枠も消える。 */
export function useFieldValidation(problems: FieldProblem[]) {
  const [submitted, setSubmitted] = useState(false)
  const error = (id: string) => submitted ? problems.find((problem) => problem.id === id)?.message : undefined
  return {
    error,
    bind: (id: string) => ({ id, invalid: Boolean(error(id)), 'aria-describedby': error(id) ? `${id}-error` : undefined }),
    reset: () => setSubmitted(false),
    submit: () => {
      setSubmitted(true)
      if (!problems.length) return true
      focusFormField(problems[0].id)
      return false
    },
  }
}
