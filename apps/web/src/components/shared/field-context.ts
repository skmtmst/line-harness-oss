'use client'

import { createContext, useContext } from 'react'

/**
 * `Field`（form-controls.tsx）が中の入力欄へ渡す読み上げの情報。
 *
 * 入力欄（TextField・TextArea）はここから
 * - `aria-describedby`（説明・誤りの文・文字数の id）
 * - `aria-invalid`（誤りの文が出ている間だけ）
 * - `aria-required`（必須の札があるとき）
 * - `id`（ラベルの htmlFor。欄に id が無いとき）
 * を受け取る。Field を直せば、中に置いた全部の入力欄に行き渡る。
 */
export type FieldContextValue = {
  controlId?: string
  describedBy?: string
  invalid: boolean
  required: boolean
}

export const FieldContext = createContext<FieldContextValue | null>(null)

export function useFieldContext(): FieldContextValue | null {
  return useContext(FieldContext)
}

/** 呼ぶ側の `aria-describedby` と Field の分を、重ねずにつなぐ。 */
export function joinDescribedBy(...ids: Array<string | undefined>): string | undefined {
  const list = ids.flatMap((id) => (id ? id.split(/\s+/) : [])).filter(Boolean)
  const unique = Array.from(new Set(list))
  return unique.length > 0 ? unique.join(' ') : undefined
}
