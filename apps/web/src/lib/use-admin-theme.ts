'use client'

import { useEffect, useState } from 'react'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

/*
 * 今の見た目が v8 かを返す。`document.documentElement.dataset.theme`
 * （layout.tsx の描画前スクリプトが localStorage から立てる）を読み、
 * 設定画面の切り替え（ADMIN_THEME_CHANGED_EVENT）にも追従する。
 * 描かない・切り替えない判定だけに使い、見た目の値は CSS 側が持つ。
 */
export function useIsV8(): boolean {
  const [isV8, setIsV8] = useState(
    () => typeof document !== 'undefined' && document.documentElement.dataset.theme === 'v8',
  )
  useEffect(() => {
    const onThemeChanged = () => {
      setIsV8(document.documentElement.dataset.theme === 'v8')
    }
    window.addEventListener(ADMIN_THEME_CHANGED_EVENT, onThemeChanged)
    return () => window.removeEventListener(ADMIN_THEME_CHANGED_EVENT, onThemeChanged)
  }, [])
  return isV8
}
