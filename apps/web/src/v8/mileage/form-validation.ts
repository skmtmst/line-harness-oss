/** 入力の誤りは欄で知らせ、最初の欄を画面の中央へ移す。 */
export function focusMileageField(id: string) {
  requestAnimationFrame(() => {
    const field = document.getElementById(id)
    if (!field) return
    // 畳まれた詳しい設定も、誤りがあれば開いてから移る。
    let parent = field.parentElement
    while (parent) {
      if (parent instanceof HTMLDetailsElement) parent.open = true
      parent = parent.parentElement
    }
    field.focus({ preventScroll: true })
    field.scrollIntoView?.({ block: 'center' })
  })
}
