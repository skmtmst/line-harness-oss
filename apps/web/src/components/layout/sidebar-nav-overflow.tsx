'use client'
import { cancelMeasurement, scheduleMeasurement } from '../shared/dom-measurement-batch'
import { observeElementResize } from '../shared/element-resize-observer'



export function watchNavOverflow(nav: HTMLElement | null) {
  if (!nav) return
  let active = true
  const key = {}
  const read = () => {
    if (!active) return () => {}
    const more = nav.scrollHeight - nav.clientHeight - nav.scrollTop > 1
    const above = nav.scrollTop > 1
    let cutTop = 0
    let cutBottom = 0
    if (more || above) {
      const box = nav.getBoundingClientRect()
      for (const row of Array.from(nav.querySelectorAll<HTMLElement>('a, button'))) {
        const rect = row.getBoundingClientRect()
        if (rect.height === 0) continue
        if (more && rect.top < box.bottom && rect.bottom > box.bottom) cutBottom = Math.max(cutBottom, box.bottom - rect.top)
        if (above && rect.top < box.top && rect.bottom > box.top) cutTop = Math.max(cutTop, rect.bottom - box.top)
      }
    }
    const top = `${Math.ceil(cutTop)}px`, bottom = `${Math.ceil(cutBottom)}px`, clipped = more || above
    const topChanged = nav.style.getPropertyValue('--nav-cut-top') !== top
    const bottomChanged = nav.style.getPropertyValue('--nav-cut-bottom') !== bottom
    const clippedChanged = nav.hasAttribute('data-clipped') !== clipped
    return () => {
      if (!active) return
      if (topChanged) nav.style.setProperty('--nav-cut-top', top)
      if (bottomChanged) nav.style.setProperty('--nav-cut-bottom', bottom)
      if (clippedChanged) {
        if (clipped) nav.setAttribute('data-clipped', '')
        else nav.removeAttribute('data-clipped')
      }
    }
  }
  const update = () => { if (active) scheduleMeasurement(key, read) }
  let children: Element[] = [], stopObserving = () => {}
  const observeChildren = () => {
    const next = Array.from(nav.children)
    if (next.length === children.length && next.every((child, index) => child === children[index])) return
    stopObserving()
    children = next
    stopObserving = observeElementResize([nav, ...children], update)
  }
  // Also observe an empty navigation; groups may arrive after account/permission data.
  stopObserving = observeElementResize([nav], update)
  observeChildren()
  update()
  nav.addEventListener('scroll', update, { passive: true })
  const mutations = new MutationObserver(() => { if (active) { observeChildren(); update() } })
  mutations.observe(nav, { childList: true, subtree: true, characterData: true })
  return () => {
    active = false
    cancelMeasurement(key)
    nav.removeEventListener('scroll', update)
    stopObserving()
    mutations.disconnect()
  }
}


// ─── メニュー定義 ───
//
// Pen.dev の V5正式共通メニュー（`J33xq`）に合わせている。
// 区分・並び・呼び名は設計が出どころで、勝手に足したり並べ替えたりしない。
//
// 行き先（href）は実装側の都合で決まる。設計は画面の名前しか持たないので、
// 「設計の名前 → 実装のルート」の対応をここで引き受けている。
// 例: 設計の「受信箱」は実装の /chats、「タグ」は /tags。
//
// 設計に無い画面（重複検出、プール管理など）は、対応する画面のタブとして
// 中に入っている。サイドバーから消しても行けなくならない。

/*
 * 項目そのものは `@/lib/menu` に置いてある。機能設定と同じものを読む。
 * ここに別で並べていた頃は、メニューにしか無い項目・機能設定にしか無い
 * 項目が双方にできて、切り替えても消えない項目があった。
 */

export function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every((entry) => typeof entry === 'boolean')
}
