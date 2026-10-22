'use client'

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { focusRemainsExpected, focusRevealedField } from './revealed-field-focus'

export type FormFieldProblem = {
  key: string
  /** 欄の名前（「送信者の名前」など）。上のまとめと照合に使う。 */
  label: string
}

/** `define` の第4引数。隠れた所にある欄の開け方と、印を数える束。 */
export type FormFieldOptions = {
  /** ：保存の検査と必須の札の正本。 */
  required?: boolean
  /**
   * 欄が隠れた所（別のカード・別のタブ・閉じた段・別の手順）にあるとき、
   * そこを開く関数。「1つ目へ」・保存で落ちたときに、移る前に呼ぶ。
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

/** reveal後のReact描画を待つ。段の開閉完了はfocus時に別途確認する。 */
function afterPaint(run: () => void) {
  requestAnimationFrame(() => requestAnimationFrame(run))
}

/**
 * 欄の id へ移る。閉じた段（details）の中なら開き、スクロールしてから
 * フォーカスする。自前の誤りの表（`Record<欄, 文>`）を持つ画面が、1つ目の欄へ移るときに使う。
 * 描き直しの後に呼べるよう、次のコマで動く。
 */
let cancelIdFocus = () => {}
export function focusFieldById(id: string) {
  cancelIdFocus()
  let cancelled = false
  let pending: ReturnType<typeof focusRevealedField> | undefined
  cancelIdFocus = () => { cancelled = true; pending?.cancel() }
  requestAnimationFrame(() => {
    if (cancelled || typeof document === 'undefined') return
    pending = focusRevealedField(() => document.getElementById(id))
  })
}

/**
 * 欄の検証を「離れた時点で1回・直せばすぐ消える・送るとき全部」に揃える
 * （★管理画面 sTJsh §6・ 欄で知らせて移る）。
 *
 * `tsx
 * const fields = useFormErrors
 * fields.define('name', '送信者の名前',  => name.trim ? null : '入力してください')
 * // 別のカード・タブにある欄は開き方と束を渡す
 * fields.define('card-1-body', 'カード2の本文', check, { reveal:  => setActive(1), group: 'card-1' })
 *
 * <Field label="送信者の名前" error={fields.error('name')}>
 *   <TextInput {...fields.bind('name')} value={name} onChange={...} />
 * </Field>
 *
 * // 保存ボタン:
 * if (fields.submit.length > 0) return  // 欄が赤くなり、1つ目の欄を開いてそこへ移る
 * // サーバーが欄の誤りを返したら:
 * fields.setServerErrors({ name: 'この名前はもう使われています' })
 * `
 *
 * - `define` は描画のたびに呼ぶ。チェックはその時点の値を見る関数なので、
 *   直すと描画が走り、エラーはその場で消える。
 * - 触っていない欄には何も出さない（blur または送信で初めて出る）。
 * - `submit` は全欄を検査し、落ちた1つ目の欄を開いてスクロールしフォーカスを移す。
 * - 束（group）の誤りの数は `countIn(束)` で読める（タブ・カードの赤い印）。
 * - サーバーの欄の誤りは、その欄に打ち直す（input・change）か次の送信で消える。
 */
export function useFormErrors() {
  const [, bump] = useState(0)
  const focusAfterCommit = useRef(false)
  const focusGeneration = useRef(0)
  const pendingFocus = useRef<ReturnType<typeof focusRevealedField> | null>(null)
  const queuedInteraction = useRef<(() => void) | null>(null)
  const cancelFocus = useCallback(() => {
    focusGeneration.current += 1
    queuedInteraction.current?.()
    queuedInteraction.current = null
    pendingFocus.current?.cancel()
    pendingFocus.current = null
  }, [])
  useLayoutEffect(() => cancelFocus, [cancelFocus])
  const watchInteraction = () => {
    document.addEventListener('pointerdown', cancelFocus, true)
    document.addEventListener('keydown', cancelFocus, true)
    queuedInteraction.current = () => {
      document.removeEventListener('pointerdown', cancelFocus, true)
      document.removeEventListener('keydown', cancelFocus, true)
    }
  }
  /** blur か送信で「見せてよい」になった欄 */
  const touchedRef = useRef(new Set<string>())
  /** 欄の定義（描画順＝まとめの並び順） */
  const defsRef = useRef(new Map<string, { label: string; check: () => string | null } & FormFieldOptions>())
  /*
   * 描画のたびに定義を作り直す（このあと同じ描画の中で define が全欄ぶん呼ばれる）。
   * 作り直さないと、消したカード・行の欄（card-2-text など）が古い値のまま残り、保存をずっと止める。
   */
  defsRef.current = new Map()
  /** 共通の欄部品が登録した定義。画面の描画で消さない。 */
  const registeredRef = useRef(new Map<string, Map<HTMLElement, string>>())
  const registrationOrder = useRef(new Map<string, number>())
  const rememberOrder = useCallback((key: string) => { if (!registrationOrder.current.has(key)) registrationOrder.current.set(key, registrationOrder.current.size) }, [])
  const revealsRef = useRef(new Map<string, () => void>())
  const registerReveal = useCallback((key: string, reveal: () => void) => {
    rememberOrder(key)
    revealsRef.current.set(key, reveal)
    return () => { if (revealsRef.current.get(key) === reveal) revealsRef.current.delete(key) }
  }, [rememberOrder])
  const definitions = () => {
    const all = new Map(defsRef.current)
    for (const [key, entries] of registeredRef.current) {
      if (!all.has(key) && entries.size) all.set(key, { label: entries.values().next().value!, check: () => null })
    }
    for (const [key, reveal] of revealsRef.current) {
      all.set(key, { label: key, check: () => null, ...all.get(key), reveal })
    }
    return new Map([...all].sort(([left], [right]) => {
      const a = defsRef.current.has(left) ? -1 : registrationOrder.current.get(left) ?? Number.MAX_SAFE_INTEGER
      const b = defsRef.current.has(right) ? -1 : registrationOrder.current.get(right) ?? Number.MAX_SAFE_INTEGER
      return a - b
    }))
  }
  const register = useCallback((key: string, label: string, el: HTMLElement) => {
    rememberOrder(key)
    const entries = registeredRef.current.get(key) ?? new Map<HTMLElement, string>()
    entries.set(el, label)
    registeredRef.current.set(key, entries)
    return () => {
      entries.delete(el)
      serverTargets.current.get(key)?.delete(el)
      if (!entries.size) registeredRef.current.delete(key)
    }
  }, [rememberOrder])
  /** 欄の要素（1つ目へフォーカスを移すため） */
  const elsRef = useRef(new Map<string, HTMLElement>())
  /** サーバーが返した欄の誤り。打ち直すか次の送信で消える。 */
  const serverRef = useRef(new Map<string, string>())
  const serverTargets = useRef(new Map<string, Set<HTMLElement>>())
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

  /** 同名の欄が背景にもあるとき、保存した編集窓の欄だけへ理由を渡す。 */
  const errorFor = (key: string, el: HTMLElement | null): string | null => {
    const targets = serverTargets.current.get(key)
    if (serverRef.current.has(key) && targets && (!el || !targets.has(el))) return null
    return error(key)
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
    serverTargets.current.delete(key)
    if (!serverRef.current.delete(key)) return
    bump((v) => v + 1)
  }

  /**
   * 欄へそのまま広げる `{ onBlur, ref }`。onBlur で検査を始め、
   * ref で要素を覚えて「1つ目へ移る」に使う。プルダウン・画像の枠などの
   * 束の枠（div）に付けてもよい（移るときは中の1つ目の押せる所へ）。
   */
  const bind = (key: string): { 'aria-required'?: boolean; onBlur: () => void; ref: (el: HTMLElement | null) => void } => ({
    'aria-required': defsRef.current.get(key)?.required,
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
    for (const [key, def] of definitions()) {
      if (problemOf(key)) problems.push({ key, label: def.label })
    }
    return problems
  }

  /** 束（カード・タブ・段）の中で、いま直してほしい欄の数。送信前は 0。 */
  const countIn = (group: string): number => {
    if (!submitted) return 0
    let count = 0
    for (const [key, def] of definitions()) {
      if (def.group === group && problemOf(key)) count += 1
    }
    return count
  }

  const focusElement = (key: string) => {
    const server = [...(serverTargets.current.get(key) ?? [])].find(node => node.isConnected)
    return server ?? elsRef.current.get(key) ?? [...(registeredRef.current.get(key)?.keys() ?? [])].find(node => node.isConnected)
  }

  /**
   * いま直してほしい欄のうち最初のものへ移る。隠れた所の欄は先に開き（reveal）、
   * 描き直しを待ってからスクロールしてフォーカスする。
   */
  const focusFirst = () => {
    const origin = document.activeElement
    cancelFocus()
    const generation = focusGeneration.current
    for (const [key, def] of definitions()) {
      if (!problemOf(key)) continue
      const target = [...(serverTargets.current.get(key) ?? [])].find((node) => node.isConnected)
      const el = focusElement(key)
      const resolve = () => {
        if (generation !== focusGeneration.current || !problemOf(key)) return null
        return focusElement(key)
      }
      const move = () => {
        if (generation !== focusGeneration.current) return
        if (!focusRemainsExpected(origin, resolve())) { cancelFocus(); return }
        queuedInteraction.current?.()
        queuedInteraction.current = null
        pendingFocus.current = focusRevealedField(resolve)
      }
      if (def.reveal && !target?.closest('[role="dialog"], [role="alertdialog"]')) {
        watchInteraction()
        def.reveal()
        afterPaint(move)
        return
      }
      // 要素を覚えていない欄（印だけの束）は次の欄へ進む。
      if (el) {
        move()
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
    cancelFocus()
    serverRef.current.clear()
    serverTargets.current.clear()
    const problems: FormFieldProblem[] = []
    for (const [key, def] of definitions()) {
      touchedRef.current.add(key)
      if (def.check()) problems.push({ key, label: def.label })
    }
    focusAfterCommit.current = problems.length > 0
    setSubmitted(true)
    bump((v) => v + 1)
    return problems
  }

  /**
   * サーバー（API）が返した欄の誤りを欄に出す（422 など欄の名前つき）。
   * 登録していない欄の名前は捨てて、出せた欄の数を返す。0 なら画面は今の帯で知らせる。
   */
  const setServerErrors = (errors: ServerFieldErrors): number => {
    cancelFocus()
    serverRef.current.clear()
    serverTargets.current.clear()
    let shown = 0
    for (const [key, message] of Object.entries(errors)) {
      if (!message || !definitions().has(key)) continue
      serverRef.current.set(key, message)
      touchedRef.current.add(key)
      const candidates = [...(registeredRef.current.get(key)?.keys() ?? [])].filter((node) => node.isConnected)
      const inDialog = candidates.filter((node) => node.closest('[role="dialog"], [role="alertdialog"]'))
      if (candidates.length) serverTargets.current.set(key, new Set(inDialog.length ? inDialog : candidates))
      if (!inDialog.length) definitions().get(key)?.reveal?.()
      shown += 1
    }
    focusAfterCommit.current = shown > 0
    setSubmitted(true)
    bump((v) => v + 1)
    return shown
  }

  /**
   * 手続きの検査（保存の直前に1つずつ見る形）で落ちた欄を1つ出す。
   * `define` の検査に書けない誤り（組み合わせ・別の部品の中の誤り）を欄に結び付けるときに使う。
   * 出し方・消え方はサーバーの欄の誤りと同じ（打ち直すか次の検査で消える）。
   */
  const fail = (key: string, message: string): boolean => setServerErrors({ [key]: message }) > 0

  /** 欄の外から直した（プルダウンを選び直したなど）ときに、その欄のサーバーの誤りを消す。 */
  const clear = (key: string) => clearServer(key)

  /** 開き直した窓・空に戻した入力で、触れた印・まとめ・サーバーの誤りを消す。 */
  const reset = () => {
    cancelFocus()
    focusAfterCommit.current = false
    touchedRef.current.clear()
    serverRef.current.clear()
    serverTargets.current.clear()
    setSubmitted(false)
    bump((v) => v + 1)
  }

  // Queue field focus only after React has committed errors and cleared saving.
  useLayoutEffect(() => {
    pendingFocus.current?.refresh()
    if (!focusAfterCommit.current) return
    focusAfterCommit.current = false
    const generation = focusGeneration.current
    const origin = document.activeElement
    watchInteraction()
    requestAnimationFrame(() => {
      if (generation !== focusGeneration.current) return
      const key = [...definitions().keys()].find(key => problemOf(key))
      if (!focusRemainsExpected(origin, key ? focusElement(key) : null)) { cancelFocus(); return }
      focusFirst()
    })
  })

  const requirement = (key: string) => ({ required: Boolean(defsRef.current.get(key)?.required) })
  return { register, registerReveal, define, requirement, error, errorFor, invalid, touch, bind, listProblems, countIn, focusFirst, submit, setServerErrors, fail, clear, reset }
}

export type FormErrors = ReturnType<typeof useFormErrors>
