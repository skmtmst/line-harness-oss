'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

export type UnsavedLeaveTarget =
  | { kind: 'link'; href: string }
  | { kind: 'history-back' }

/**
 * 未保存の変更がある間、画面を離れる操作を止める。
 *
 * - ブラウザ再読込・タブ終了: beforeunload で標準の確認を出す
 * - 左メニュー等の画面内リンク: クリックを捕まえて確認対話を出す
 * - 戻る操作: popstate で元の履歴位置へ戻してから確認対話を出す
 *
 * 保存成功や「保存せずに移動」の確認後は markClean() で dirty を外し、
 * 警告がもう出ないようにする。
 */
export function useUnsavedGuard(options: { dirty: boolean; busy?: boolean }) {
  const { dirty, busy = false } = options
  const router = useRouter()
  const [leaveTarget, setLeaveTarget] = useState<UnsavedLeaveTarget | null>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const allowHistoryLeaveRef = useRef(false)
  const skipRestoredPopRef = useRef(false)

  /*
   * ブラウザ再読込・タブ終了だけは画面内のDialogを出せないので、標準の確認を
   * dirtyな間だけ登録する。保存成功・account切替・unmountではeffect cleanupで外れる。
   */
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  /*
   * 左メニュー等のLinkも含めて、同一タブの画面内遷移を捕まえる。
   * browser backはブラウザ側が先に履歴を動かすため対象外にし、ここでは
   * 「クリックして別の管理画面へ行く」導線だけを安全に止める。
   */
  useEffect(() => {
    if (!dirty) return
    const onDocumentClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, window.location.href)
      const current = new URL(window.location.href)
      if (destination.origin !== current.origin || destination.href === current.href) return
      event.preventDefault()
      if (!busy) setLeaveTarget({ kind: 'link', href: `${destination.pathname}${destination.search}${destination.hash}` })
    }
    document.addEventListener('click', onDocumentClick, true)
    return () => document.removeEventListener('click', onDocumentClick, true)
  }, [dirty, busy])

  /*
   * App Routerにはpages routerのbeforePopStateがないため、戻る操作はpopstateで
   * ただちに元の履歴位置へ戻してから確認する。確認後だけ次のpopstateを通す。
   */
  useEffect(() => {
    if (!dirty) {
      skipRestoredPopRef.current = false
      return
    }
    const onPopState = () => {
      if (allowHistoryLeaveRef.current) {
        allowHistoryLeaveRef.current = false
        return
      }
      // history.go(1)で現在画面へ戻った直後のpopstateは、もう一度止めない。
      if (skipRestoredPopRef.current) {
        skipRestoredPopRef.current = false
        return
      }
      skipRestoredPopRef.current = true
      window.history.go(1)
      if (!busy) setLeaveTarget({ kind: 'history-back' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [dirty, busy])

  /** 確認で「保存せずに移動」が選ばれたとき、予定していた移動を実行する。 */
  const confirmLeave = useCallback(() => {
    if (!leaveTarget || busy) return
    setLeaveTarget(null)
    if (leaveTarget.kind === 'history-back') {
      allowHistoryLeaveRef.current = true
      window.history.back()
      return
    }
    router.push(leaveTarget.href)
  }, [leaveTarget, busy, router])

  const cancelLeave = useCallback(() => setLeaveTarget(null), [])

  return { leaveTarget, confirmLeave, cancelLeave }
}
