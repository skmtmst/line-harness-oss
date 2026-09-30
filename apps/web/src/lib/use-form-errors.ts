'use client'

import { useRef, useState } from 'react'

export type FormFieldProblem = {
  key: string
  /** 欄の名前（「送信者の名前」など）。上のまとめと照合に使う。 */
  label: string
}

/**
 * 欄の検証を「離れた時点で1回・直せばすぐ消える・送るとき全部」に揃える
 * （★V7 sTJsh §6）。
 *
 * ```tsx
 * const fields = useFormErrors()
 * fields.define('name', '送信者の名前', () => name.trim() ? null : '入力してください')
 *
 * <Field label="送信者の名前" error={fields.error('name')}>
 *   <TextInput {...fields.bind('name')} value={name} onChange={...} invalid={fields.invalid('name')} />
 * </Field>
 *
 * // 保存ボタン:
 * if (fields.submit().length > 0) return  // まとめが出て1つ目の欄へ移る
 * ```
 *
 * - `define` は描画のたびに呼ぶ。チェックはその時点の値を見る関数なので、
 *   直すと描画が走り、エラーはその場で消える。
 * - 触っていない欄には何も出さない（blur または送信で初めて出る）。
 * - `submit()` は全欄を検査し、落ちた欄へフォーカスを移す。
 */
export function useFormErrors() {
  const [, bump] = useState(0)
  /** blur か送信で「見せてよい」になった欄 */
  const touchedRef = useRef(new Set<string>())
  /** 欄の定義（描画順＝まとめの並び順） */
  const defsRef = useRef(new Map<string, { label: string; check: () => string | null }>())
  /** 欄の要素（1つ目へフォーカスを移すため） */
  const elsRef = useRef(new Map<string, HTMLElement>())
  /** 送信ボタンが押されたか。押すまでは上のまとめを出さない。 */
  const [submitted, setSubmitted] = useState(false)

  /**
   * 欄の検査を登録する。描画のたびに全欄ぶん呼ぶ。順序がまとめの並びになる。
   * `check` は正しければ null、直してほしければ理由の文を返す。
   */
  const define = (key: string, label: string, check: () => string | null) => {
    defsRef.current.set(key, { label, check })
  }

  /** その欄へ出す文。触れていなければ null。 */
  const error = (key: string): string | null => {
    if (!touchedRef.current.has(key)) return null
    return defsRef.current.get(key)?.check() ?? null
  }

  /** 欄を赤くするか。Field の error と input の invalid へ渡す。 */
  const invalid = (key: string): boolean => error(key) !== null

  /** blur で「見せてよい」欄にする。独自の onBlur 内で使うときはこちら。 */
  const touch = (key: string) => {
    if (touchedRef.current.has(key)) return
    touchedRef.current.add(key)
    bump((v) => v + 1)
  }

  /**
   * 欄へそのまま広げる `{ onBlur, ref }`。onBlur で検査を始め、
   * ref で要素を覚えて「1つ目へフォーカス」に使う。
   */
  const bind = (key: string): { onBlur: () => void; ref: (el: HTMLElement | null) => void } => ({
    onBlur: () => touch(key),
    ref: (el) => {
      if (el) elsRef.current.set(key, el)
      else elsRef.current.delete(key)
    },
  })

  /** いま直してほしい欄（送信後だけ評価する）。直すとまとめからも消える。 */
  const listProblems = (): FormFieldProblem[] => {
    if (!submitted) return []
    const problems: FormFieldProblem[] = []
    for (const [key, def] of defsRef.current) {
      if (def.check()) problems.push({ key, label: def.label })
    }
    return problems
  }

  /** いま直してほしい欄のうち最初のものへフォーカスを移す。 */
  const focusFirst = () => {
    for (const [key, def] of defsRef.current) {
      if (!def.check()) continue
      // 欄群（チェックの束など）にはフォーカスする要素が無いので次へ進む。
      const el = elsRef.current.get(key)
      if (el) {
        el.focus()
        return
      }
    }
  }

  /**
   * 送信前の総点検。全欄を「見せてよい」にして検査し、落ちた欄を返す。
   * 空なら保存へ進んでよい。落ちがあれば1つ目の欄へフォーカスを移す。
   */
  const submit = (): FormFieldProblem[] => {
    const problems: FormFieldProblem[] = []
    for (const [key, def] of defsRef.current) {
      touchedRef.current.add(key)
      if (def.check()) problems.push({ key, label: def.label })
    }
    setSubmitted(true)
    bump((v) => v + 1)
    if (problems.length > 0) requestAnimationFrame(focusFirst)
    return problems
  }

  return { define, error, invalid, touch, bind, listProblems, focusFirst, submit }
}

export type FormErrors = ReturnType<typeof useFormErrors>
