/**
 * つながる移り変わりの小さな道具（V8「サクサク感」D）。
 *
 * タブ・絞り込みの切り替えなど、中身を入れ替えるときに使う。
 * `document.startViewTransition` が無いとき・動きを減らす設定のときは
 * 素通り（そのまま変えるだけ）にするので、どこでも安心して呼べる。
 */
export function withViewTransition(update: () => void | Promise<void>): void {
  if (typeof document === 'undefined') {
    void update()
    return
  }
  const reduce =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  const starter = (
    document as Document & {
      startViewTransition?: (callback: () => void | Promise<void>) => unknown
    }
  ).startViewTransition
  if (reduce || typeof starter !== 'function') {
    void update()
    return
  }
  starter.call(document, () => {
    void update()
  })
}
