'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

/* SSR では useLayoutEffect が警告になるので、描き込み前にテーマを
   反映するため同型のエイリアスを使う（sidebar.tsx の collapsed と同じ形）。 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * 管理画面の見た目テーマ（`<html data-theme="v7|v8">`）を React の状態として読む。
 *
 * 描画前のスクリプト（app/layout.tsx の THEME_BOOT）が localStorage の
 * `lh-admin-theme` を `<html>` へ反映済みなので、クライアントでは既に
 * 正しい値が入っている。SSR では `document` が読めず 'v7' を返すが、
 * クライアントの最初の描画も 'v7' にしておき、レイアウト効果で本当の値へ
 * 揃える（hydration の不一致を起こさず、描画前に切り替わる）。
 *
 * 設定画面の「画面の見た目（試作）」での切り替えは
 * ADMIN_THEME_CHANGED_EVENT が投げられるので、それで再読する。
 */
export function useAdminTheme(): 'v7' | 'v8' {
  const [theme, setTheme] = useState<'v7' | 'v8'>('v7')
  useIsoLayoutEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === 'v8' ? 'v8' : 'v7')
    read()
    window.addEventListener(ADMIN_THEME_CHANGED_EVENT, read)
    return () => window.removeEventListener(ADMIN_THEME_CHANGED_EVENT, read)
  }, [])
  return theme
}
