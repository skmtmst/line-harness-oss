'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { adminThemeDefault, adminThemeLocked } from './admin-theme-default'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

/* SSR では useLayoutEffect が警告になるので、描き込み前にテーマを
   反映するため同型のエイリアスを使う（sidebar.tsx の collapsed と同じ形）。 */
const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/**
 * 管理画面の見た目テーマ。画面では常に 'v8'（2026-10-09 V8 固定。lib/admin-theme-default.ts）。
 *
 * 'v7' を返すのは試験（vitest）の中だけ：使われないまま残した古い v7 の画面の試験が、
 * NEXT_PUBLIC_ADMIN_THEME を付けずに `<html data-theme>` を v7 のまま描いたとき。
 * 試験が ADMIN_THEME_CHANGED_EVENT を投げたら `<html>` を読み直す。
 */
export function useAdminTheme(): 'v7' | 'v8' {
  const [theme, setTheme] = useState<'v7' | 'v8'>(adminThemeDefault)
  useIsoLayoutEffect(() => {
    if (adminThemeLocked()) {
      setTheme('v8')
      return
    }
    // ここから下は試験の中だけ。偽の document（dataset が無い）では v7 に倒す。
    const read = () => setTheme(document.documentElement.dataset?.theme === 'v8' ? 'v8' : 'v7')
    read()
    // 偽の window で描く試験では聞き口が無いので付けない。
    window.addEventListener?.(ADMIN_THEME_CHANGED_EVENT, read)
    return () => window.removeEventListener?.(ADMIN_THEME_CHANGED_EVENT, read)
  }, [])
  return theme
}
