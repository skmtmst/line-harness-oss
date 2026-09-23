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
export function useUnsavedGuard(options: {
  dirty: boolean
  busy?: boolean
  /**
   * 戻る・進むの行き先が「同じ画面の中の移動」かを返す。
   * 段(pane)の切替だけがURLに出る画面では、戻る・進むは離脱ではない。
   * true のとき popstate を止めず・確認も出さず、そのまま通す。
   */
  samePage?: (destination: URL) => boolean
  /**
   * 「保存せずに移動」が確定したあと・実際に移動する直前に呼ぶ。
   * クエリだけ変わる画面内遷移（コンポーネントがアンマウントされない）でも
   * 「変更は消えます」と約束した通り、画面の入力を初期状態へ戻せるようにする。
   */
  onDiscard?: () => void
}) {
  const { dirty, busy = false, samePage, onDiscard } = options
  const router = useRouter()
  const [leaveTarget, setLeaveTarget] = useState<UnsavedLeaveTarget | null>(null)
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  const samePageRef = useRef(samePage)
  samePageRef.current = samePage
  const onDiscardRef = useRef(onDiscard)
  onDiscardRef.current = onDiscard
  const allowHistoryLeaveRef = useRef(false)
  const skipRestoredPopRef = useRef(false)
  /* 公開成功など「離れてよい」と決まった遷移の直前に立てる解除印。 */
  const disarmedRef = useRef(false)

  /*
   * ブラウザ再読込・タブ終了だけは画面内のDialogを出せないので、標準の確認を
   * dirtyな間だけ登録する。保存成功・account切替・unmountではeffect cleanupで外れる。
   */
  useEffect(() => {
    if (!dirty) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (disarmedRef.current || !dirtyRef.current) return
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
      if (disarmedRef.current) return
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target as { closest?: (selector: string) => Element | null } | null
      const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || anchor.target || anchor.hasAttribute('download')) return
      const destination = new URL(anchor.href, window.location.href)
      const current = new URL(window.location.href)
      if (destination.origin !== current.origin || destination.href === current.href) return
      // パスとクエリが同じで hash だけが変わる移動は画面内の見出しジャンプ。
      // 画面を離れないので確認を出さない（離すと「#見出し」リンクが全部確認になる）。
      if (destination.pathname === current.pathname && destination.search === current.search) return
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
      disarmedRef.current = false
      return
    }
    const onPopState = () => {
      if (disarmedRef.current) return
      if (allowHistoryLeaveRef.current) {
        allowHistoryLeaveRef.current = false
        return
      }
      // history.go(1)で現在画面へ戻った直後のpopstateは、もう一度止めない。
      if (skipRestoredPopRef.current) {
        skipRestoredPopRef.current = false
        return
      }
      /*
       * paneの切替だけが変わる、同じ画面の中の戻る・進むは離脱ではない。
       * ここで止めると「同じ画面に居たまま」なのに離脱確認が出る。
       */
      if (samePageRef.current?.(new URL(window.location.href))) return
      skipRestoredPopRef.current = true
      window.history.go(1)
      if (!busy) setLeaveTarget({ kind: 'history-back' })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [dirty, busy])

  /**
   * 確認で「保存せずに移動」が選ばれたとき、予定していた移動を実行する。
   *
   * `onDiscard` は移動の直前に呼ぶ。「変更は消えます」と約束したあと、
   * クエリだけ変わる画面内遷移（コンポーネントがアンマウントされない）でも
   * 画面の入力を初期状態へ戻せるようにするため。
   */
  const confirmLeave = useCallback(() => {
    if (!leaveTarget || busy) return
    setLeaveTarget(null)
    onDiscardRef.current?.()
    if (leaveTarget.kind === 'history-back') {
      allowHistoryLeaveRef.current = true
      window.history.back()
      return
    }
    router.push(leaveTarget.href)
  }, [leaveTarget, busy, router])

  const cancelLeave = useCallback(() => setLeaveTarget(null), [])

  /*
   * 公開成功のあとの画面遷移のように「未保存でも警告せず離れてよい」と
   * 決まった遷移の直前に呼ぶ。beforeunload・戻る・画面内リンクのどれも
   * もう止めない。画面に留まって dirty が降りたら自動で腕を戻す。
   */
  const disarm = useCallback(() => {
    disarmedRef.current = true
    setLeaveTarget(null)
  }, [])

  return { leaveTarget, confirmLeave, cancelLeave, disarm }
}
