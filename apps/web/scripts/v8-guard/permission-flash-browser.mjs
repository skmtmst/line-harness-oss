/** 描かれるフレームを読み、待機を権限不足と取り違えた文を保存する。 */
export function observePermissionFrames() {
  const frames = []
  let active = true
  const permissionCopy = /権限.{0,16}(?:確認しています|確認中|ありません)|閲覧のみで見ています|この操作は.{0,20}だけができます/
  const visible = element => {
    if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false
    const box = element.getBoundingClientRect(), css = getComputedStyle(element)
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < innerHeight
      && css.visibility === 'visible' && css.display !== 'none' && Number(css.opacity) > 0
  }
  const sample = () => {
    if (!active) return
    const messages = new Set()
    const root = document.querySelector('main') ?? document.body
    if (root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      while (walker.nextNode()) {
        const node = walker.currentNode, text = node.textContent?.trim()
        if (text && permissionCopy.test(text) && node.parentElement && visible(node.parentElement)) messages.add(text)
      }
      for (const element of root.querySelectorAll('h1,[role=status],[role=note],[role=alert],[data-read-only-notice]')) {
        if (permissionCopy.test(element.innerText) && visible(element)) messages.add(element.innerText.trim())
      }
      for (const element of root.querySelectorAll('[aria-label]')) {
        const label = element.getAttribute('aria-label')
        if (permissionCopy.test(label) && visible(element)) messages.add(label)
      }
    }
    frames.push({ t: performance.now(), url: location.pathname + location.search, title: document.title,
      headings: [...document.querySelectorAll('main h1')].filter(visible).map(element => element.textContent), messages: [...messages] })
    requestAnimationFrame(sample)
  }
  window.permissionFrames = { frames, reset() { frames.length = 0 }, stop() { active = false } }
  requestAnimationFrame(sample)
}

export function assertNoPermissionFlash(frames) {
  if (!frames.length) throw new Error('切り替え中のフレームがありません')
  const failures = frames.filter(frame => frame.messages.length)
  if (failures.length) throw new Error(`権限の文が切り替えに出ました: ${JSON.stringify(failures)}`)
}
