/** 束の枠なら、道具のボタンより入力欄を先に選ぶ。 */
const ENTRY = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]), select:not([disabled]), [contenteditable="true"]'
const FOCUSABLE = `${ENTRY}, button:not([disabled]), [tabindex]:not([tabindex="-1"])`

function focusTarget(el: HTMLElement): HTMLElement {
  if (el.matches(FOCUSABLE)) return el
  return el.querySelector<HTMLElement>(ENTRY) ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el
}

/**
 * 即時のfocusを優先する。開いた段がまだnative非表示で失敗した時だけ、
 * その段の実際の開閉完了を購読する。再試行時は現在の欄を取り直す。
 */
export function focusRevealedField(resolve: () => HTMLElement | null | undefined) {
  let active = true
  let ownFocus = false
  let current: HTMLElement | null = null
  let disclosure: HTMLDetailsElement | null = null
  let animationGeneration = 0
  let watched: Animation[] = []
  let owner: Document | null = null
  let scope: Element | null | undefined

  const cancel = () => {
    active = false
    animationGeneration += 1
    disclosure?.removeEventListener('toggle', ready)
    disclosure?.removeEventListener('transitionend', ready)
    disclosure?.removeEventListener('transitioncancel', ready)
    owner?.removeEventListener('focusin', onFocus, true)
    owner?.removeEventListener('pointerdown', cancel, true)
    owner?.removeEventListener('keydown', cancel, true)
  }
  const onFocus = () => { if (!ownFocus) cancel() }
  const listen = (document: Document) => {
    if (owner) return
    owner = document
    owner.addEventListener('focusin', onFocus, true)
    owner.addEventListener('pointerdown', cancel, true)
    owner.addEventListener('keydown', cancel, true)
  }
  const watchAnimations = () => {
    const animations = disclosure?.getAnimations?.({ subtree: true }).filter(animation => animation.playState !== 'finished' && animation.playState !== 'idle') ?? []
    if (!animations.length || (animations.length === watched.length && animations.every((animation, i) => animation === watched[i]))) return
    watched = animations
    const generation = ++animationGeneration
    void Promise.allSettled(animations.map(animation => animation.finished)).then(() => {
      if (active && generation === animationGeneration) ready()
    })
  }
  function attempt() {
    if (!active) return
    const el = resolve()
    if (el === undefined) { listen(document); return }
    if (!el?.isConnected) { cancel(); return }
    if (scope === undefined) scope = el.closest('[role="dialog"], [role="alertdialog"]')
    if (scope && (!scope.isConnected || !scope.contains(el))) { cancel(); return }
    current = el
    const next = el.closest('details')
    if (next !== disclosure) {
      disclosure?.removeEventListener('toggle', ready)
      disclosure?.removeEventListener('transitionend', ready)
      disclosure?.removeEventListener('transitioncancel', ready)
      disclosure = next
      watched = []
      animationGeneration += 1
    }
    if (disclosure) disclosure.open = true
    const target = focusTarget(el)
    ownFocus = true
    target.scrollIntoView?.({ block: 'center' })
    target.focus({ preventScroll: true })
    ownFocus = false
    if (target.ownerDocument.activeElement === target || target.contains(target.ownerDocument.activeElement)) { cancel(); return }
    if (!disclosure) { cancel(); return }
    disclosure.addEventListener('toggle', ready)
    disclosure.addEventListener('transitionend', ready)
    disclosure.addEventListener('transitioncancel', ready)
    listen(el.ownerDocument)
    watchAnimations()
  }
  function ready() {
    if (!active) return
    if (disclosure && !disclosure.open) { cancel(); return }
    attempt()
    if (active && current?.isConnected && !disclosure?.getAnimations?.({ subtree: true }).some(animation => animation.playState !== 'finished' && animation.playState !== 'idle')) cancel()
  }
  attempt()
  return {
    cancel,
    /** Reactのcommitで欄が差し替わった場合だけ、新しい接続へ移る。 */
    refresh() {
      if (!active) return
      const el = resolve()
      if (el === undefined) return
      if (!el) { cancel(); return }
      if (el !== current) attempt()
    },
  }
}
