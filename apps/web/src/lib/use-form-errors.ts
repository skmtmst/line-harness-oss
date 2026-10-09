'use client'

import { useRef, useState } from 'react'

export type FormFieldProblem = {
  key: string
  /** 欄の名前（「送信者の名前」など）。上のまとめと照合に使う。 */
  label: string
}

/** `define` の第4引数。隠れた所にある欄の開け方と、印を数える束。 */
export type FormFieldOptions = {
  /**
   * 欄が隠れた所（別のカード・別のタブ・閉じた段・別の手順）にあるとき、
   * そこを開く関数。「1つ目へ」・保存で落ちたときに、移る前に呼ぶ（B-139）。
   */
  reveal?: () => void
  /**
   * 欄が属する束（カード・タブ・段の名前）。`countIn(束)` でその束の誤りを数え、
   * カードやタブの札に赤い印（件数）を付ける。
   */
  group?: string
}

/** 欄に結び付いたサーバーの誤り（欄の名前 → 理由の文）。 */
export type ServerFieldErrors = Record<string, string | null | undefined>

const FOCUSABLE = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

/** 欄の要素から、フォーカスを受けられる要素を選ぶ（束の枠なら中の1つ目）。 */
function focusTarget(el: HTMLElement): HTMLElement {
  if (el.matches(FOCUSABLE)) return el
  return el.querySelector<HTMLElement>(FOCUSABLE) ?? el
}

/** 開く（reveal）の後、描き直しを待つ。2コマ待てば React の描き直しと配置が済む。 */
function afterPaint(run: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(run))
}

/**
 * 欄の id へ移る（B-139）。閉じた段（details）の中なら開き、スクロールしてから
 * フォーカスする。自前の誤りの表（`Record<欄, 文>`）を持つ画面が、1つ目の欄へ移るときに使う。
 * 描き直しの後に呼べるよう、次のコマで動く。
 */
export function focusFieldById(id: string) {
  requestAnimationFrame(() => {
    const el = typeof document === 'undefined' ? null : document.getElementById(id)
    if (!el) return
    const disclosure = el.closest('details')
    if (disclosure && !disclosure.open) disclosure.open = true
    const target = focusTarget(el)
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
  })
}

/**
 * 欄の検証を「離れた時点で1回・直せばすぐ消える・送るとき全部」に揃える
 * （★V7 sTJsh §6・B-139 欄で知らせて移る）。
 *
 * ```tsx
 * const fields = useFormErrors()
 * fields.define('name', '送信者の名前', () => name.trim() ? null : '入力してください')
 * // 別のカード・タブにある欄は開き方と束を渡す
 * fields.define('card-1-body', 'カード2の本文', check, { reveal: () => setActive(1), group: 'card-1' })
 *
 * <Field label="送信者の名前" error={fields.error('name')}>
 *   <TextInput {...fields.bind('name')} value={name} onChange={...} />
 * </Field>
 *
 * // 保存ボタン:
 * if (fields.submit().length > 0) return  // 欄が赤くなり、1つ目の欄を開いてそこへ移る
 * // サーバーが欄の誤りを返したら:
 * fields.setServerErrors({ name: 'この名前はもう使われています' })
 * ```
 *
 * - `define` は描画のたびに呼ぶ。チェックはその時点の値を見る関数なので、
 *   直すと描画が走り、エラーはその場で消える。
 * - 触っていない欄には何も出さない（blur または送信で初めて出る）。
 * - `submit()` は全欄を検査し、落ちた1つ目の欄を開いてスクロールしフォーカスを移す。
 * - 束（group）の誤りの数は `countIn(束)` で読める（タブ・カードの赤い印）。
 * - サーバーの欄の誤りは、その欄に打ち直す（input・change）か次の送信で消える。
 */
export function useFormErrors() {
  const [, bump] = useState(0)
  /** blur か送信で「見せてよい」になった欄 */
  const touchedRef = useRef(new Set<string>())
  /** 欄の定義（描画順＝まとめの並び順） */
  const defsRef = useRef(new Map<string, { label: string; check: () => string | null } & FormFieldOptions>())
  /** 欄の要素（1つ目へフォーカスを移すため） */
  const elsRef = useRef(new Map<string, HTMLElement>())
  /** サーバーが返した欄の誤り。打ち直すか次の送信で消える。 */
  const serverRef = useRef(new Map<string, string>())
  /** 打ち直しでサーバーの誤りを消す見張り（要素ごとに1つ） */
  const listenersRef = useRef(new WeakMap<HTMLElement, () => void>())
  /** 送信ボタンが押されたか。押すまでは上のまとめを出さない。 */
  const [submitted, setSubmitted] = useState(false)

  /**
   * 欄の検査を登録する。描画のたびに全欄ぶん呼ぶ。順序がまとめの並びになる。
   * `check` は正しければ null、直してほしければ理由の文を返す。
   */
  const define = (key: string, label: string, check: () => string | null, options?: FormFieldOptions) => {
    defsRef.current.set(key, { label, check, ...options })
  }

  /** 今の値で落ちているか（触れたかは見ない）。サーバーの誤りも含む。 */
  const problemOf = (key: string): string | null => {
    const own = defsRef.current.get(key)?.check() ?? null
    return own ?? serverRef.current.get(key) ?? null
  }

  /** その欄へ出す文。触れていなければ null。 */
  const error = (key: string): string | null => {
    if (!touchedRef.current.has(key)) return null
    return problemOf(key)
  }

  /** 欄を赤くするか。Field の error と input の invalid へ渡す。 */
  const invalid = (key: string): boolean => error(key) !== null

  /** blur で「見せてよい」欄にする。独自の onBlur 内で使うときはこちら。 */
  const touch = (key: string) => {
    if (touchedRef.current.has(key)) return
    touchedRef.current.add(key)
    bump((v) => v + 1)
  }

  const clearServer = (key: string) => {
    if (!serverRef.current.delete(key)) return
    bump((v) => v + 1)
  }

  /**
   * 欄へそのまま広げる `{ onBlur, ref }`。onBlur で検査を始め、
   * ref で要素を覚えて「1つ目へ移る」に使う。プルダウン・画像の枠などの
   * 束の枠（div）に付けてもよい（移るときは中の1つ目の押せる所へ）。
   */
  const bind = (key: string): { onBlur: () => void; ref: (el: HTMLElement | null) => void } => ({
    onBlur: () => touch(key),
    ref: (el) => {
      if (!el) {
        elsRef.current.delete(key)
        return
      }
      elsRef.current.set(key, el)
      if (!listenersRef.current.has(el)) {
        const clear = () => clearServer(key)
        el.addEventListener('input', clear)
        el.addEventListener('change', clear)
        listenersRef.current.set(el, clear)
      }
    },
  })

  /** いま直してほしい欄（送信後だけ評価する）。直すとまとめからも消える。 */
  const listProblems = (): FormFieldProblem[] => {
    if (!submitted) return []
    const problems: FormFieldProblem[] = []
    for (const [key, def] of defsRef.current) {
      if (problemOf(key)) problems.push({ key, label: def.label })
    }
    return problems
  }

  /** 束（カード・タブ・段）の中で、いま直してほしい欄の数。送信前は 0。 */
  const countIn = (group: string): number => {
    if (!submitted) return 0
    let count = 0
    for (const [key, def] of defsRef.current) {
      if (def.group === group && problemOf(key)) count += 1
    }
    return count
  }

  /** 要素へスクロールしてフォーカスする。 */
  const moveTo = (el: HTMLElement) => {
    const target = focusTarget(el)
    target.scrollIntoView?.({ block: "center" })
    target.focus({ preventScroll: true })
  }

  /**
   * いま直してほしい欄のうち最初のものへ移る。隠れた所の欄は先に開き（reveal）、
   * 描き直しを待ってからスクロールしてフォーカスする。
   */
  const focusFirst = () => {
    for (const [key, def] of defsRef.current) {
      if (!problemOf(key)) continue
      const el = elsRef.current.get(key)
      if (def.reveal) {
        def.reveal()
        afterPaint(() => {
          const shown = elsRef.current.get(key)
          if (shown) moveTo(shown)
        })
        return
      }
      // 要素を覚えていない欄（印だけの束）は次の欄へ進む。
      if (el) {
        moveTo(el)
        return
      }
    }
  }

  /**
   * 送信前の総点検。全欄を「見せてよい」にして検査し、落ちた欄を返す。
   * 空なら保存へ進んでよい。落ちがあれば1つ目の欄へ移る。
   * 前回のサーバーの誤りは送り直すので消す。
   */
  const submit = (): FormFieldProblem[] => {
    serverRef.current.clear()
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

  /**
   * サーバー（API）が返した欄の誤りを欄に出す（422 など欄の名前つき）。
   * 登録していない欄の名前は捨てて、出せた欄の数を返す。0 なら画面は今の帯で知らせる。
   */
  const setServerErrors = (errors: ServerFieldErrors): number => {
    serverRef.current.clear()
    let shown = 0
    for (const [key, message] of Object.entries(errors)) {
      if (!message || !defsRef.current.has(key)) continue
      serverRef.current.set(key, message)
      touchedRef.current.add(key)
      shown += 1
    }
    setSubmitted(true)
    bump((v) => v + 1)
    if (shown > 0) requestAnimationFrame(focusFirst)
    return shown
  }

  /** 開き直した窓・空に戻した入力で、触れた印・まとめ・サーバーの誤りを消す。 */
  const reset = () => {
    touchedRef.current.clear()
    serverRef.current.clear()
    setSubmitted(false)
    bump((v) => v + 1)
  }

  return { define, error, invalid, touch, bind, listProblems, countIn, focusFirst, submit, setServerErrors, reset }
}

export type FormErrors = ReturnType<typeof useFormErrors>
