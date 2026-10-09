'use client'

import { useState } from 'react'

/** 保存時の欄の誤り。通信の失敗は画面の通知に残す。 */
export function useFieldValidation() {
  const [errors, setErrors] = useState<Record<string, string>>({})
  const clear = (id: string) => setErrors((current) => {
    if (!current[id]) return current
    const next = { ...current }
    delete next[id]
    return next
  })
  const reject = (id: string, message: string) => {
    setErrors({ [id]: message })
    requestAnimationFrame(() => {
      const field = document.getElementById(id)
      field?.focus()
      field?.scrollIntoView?.({ block: 'center' })
    })
  }
  const attributes = (id: string) => ({
    onInput: () => clear(id),
    'aria-invalid': errors[id] ? true as const : undefined,
    'aria-describedby': errors[id] ? `${id}-error` : undefined,
  })
  return { error: (id: string) => errors[id], clear, reject, attributes }
}
