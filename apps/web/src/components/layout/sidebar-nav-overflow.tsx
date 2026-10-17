'use client'



export function watchNavOverflow(nav: HTMLElement | null) {
  if (!nav || typeof ResizeObserver === 'undefined') return
  const update = () => {
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
    nav.style.setProperty('--nav-cut-top', `${Math.ceil(cutTop)}px`)
    nav.style.setProperty('--nav-cut-bottom', `${Math.ceil(cutBottom)}px`)
    if (more || above) nav.setAttribute('data-clipped', '')
    else nav.removeAttribute('data-clipped')
  }
  update()
  nav.addEventListener('scroll', update, { passive: true })
  const observer = new ResizeObserver(update)
  observer.observe(nav)
  for (const child of Array.from(nav.children)) observer.observe(child)
  // 区分が後から足される・開閉されるときも測り直す。
  const mutations = new MutationObserver(update)
  mutations.observe(nav, { childList: true, subtree: true })
  return () => {
    nav.removeEventListener('scroll', update)
    observer.disconnect()
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
