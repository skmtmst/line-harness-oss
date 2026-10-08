'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { adminThemeDefault, adminThemeLocked } from './admin-theme-default'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

/* SSR では useLayoutEffect が警告になるので、描き込み前にテーマを
   反映するため同型のエイリアスを使う（sidebar.tsx の collapsed と同じ形）。 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * 管理画面の見た目テーマ（`<html data-theme="v7|v8">`）を React の状態として読む。
 *
 * 最初の値は環境の既定（lib/admin-theme-default.ts。layout.tsx の `<html>` と同じ）。
 * SSR では `document` が読めないので、サーバとクライアントの最初の描画を
 * どちらも環境の既定にそろえる（hydration の不一致を起こさない）。検証環境
 * （NEXT_PUBLIC_ADMIN_THEME=v8）は最初から v8 なので、旧画面を一瞬選ばない。
 *
 * 本番（変数なし）は v7 で始め、描画前のスクリプト（layout.tsx の THEME_BOOT）が
 * localStorage の `lh-admin-theme` を `<html>` へ反映した値へ、レイアウト効果で
 * 揃える（描き込み前に切り替わる）。既定が v8 の環境は V8 固定なので v8 のまま。
 *
 * 設定画面の「画面の見た目（試作）」での切り替えは
 * ADMIN_THEME_CHANGED_EVENT が投げられるので、それで再読する。
 */
export function useAdminTheme(): 'v7' | 'v8' {
  const [theme, setTheme] = useState<'v7' | 'v8'>(adminThemeDefault)
  useIsoLayoutEffect(() => {
    // 既定が v8 の環境は V8 固定（layout.tsx と同じ）。<html> の値に関わらず v8。
    if (adminThemeLocked()) {
      setTheme('v8')
      return
    }
    // 偽の document で描く試験（dataset が無い）では v7 に倒す。
    const read = () => setTheme(document.documentElement.dataset?.theme === 'v8' ? 'v8' : 'v7')
    read()
    // 偽の window で描く試験では聞き口が無いので付けない。
    window.addEventListener?.(ADMIN_THEME_CHANGED_EVENT, read)
    return () => window.removeEventListener?.(ADMIN_THEME_CHANGED_EVENT, read)
  }, [])
  return theme
}
