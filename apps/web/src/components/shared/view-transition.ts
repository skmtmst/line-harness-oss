import { flushSync } from 'react-dom'

type StartViewTransition = (callback: () => Promise<void>) => { updateCallbackDone?: Promise<void> } | undefined

/**
 * つながる移り変わりの小さな道具（V8「サクサク感」D）。
 *
 * タブ・絞り込みの切り替えなど、中身を入れ替えるときに使う。
 * `document.startViewTransition` が無いとき・動きを減らす設定のときは
 * 素通り（そのまま変えるだけ）にするので、どこでも安心して呼べる。
 *
 * ブラウザは「渡した callback が返した Promise が終わった時点」の画面を新しい絵として撮る。
 * 以前は callback が何も返さず（`void update()`）、React の setState は後のコマで
 * DOM へ反映されるので、古い画面どうしで移り変わっていた（切り替えが動きの後に飛ぶ）。
 * いまは callback の中で React の反映を flushSync で済ませ、update が Promise を返すときは
 * その終わりまで待ってから返す。
 *
 * 戻り値は、更新（と DOM への反映）が終わったら解決する Promise。待たなくてもよい。
 * `router.push` のような画面の移動は Next の側で後から描かれるので、この道具では待てない
 * （その場合は移動の前の画面で撮られる。呼び出し元で移動の完了を待つ Promise を返すこと）。
 */
export function withViewTransition(update: () => void | Promise<void>): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.resolve(update())
  }
  const reduce =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  const starter = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition
  if (reduce || typeof starter !== 'function') {
    return Promise.resolve(update())
  }
  let settle: Promise<void> | null = null
  const run = (): Promise<void> => {
    let result: void | Promise<void> = undefined
    // startViewTransition の callback は React の描画の外（後のコマ）で呼ばれるので flushSync してよい。
    flushSync(() => {
      result = update()
    })
    settle = Promise.resolve(result)
    return settle
  }
  const transition = starter.call(document, run)
  return transition?.updateCallbackDone ?? settle ?? Promise.resolve()
}
