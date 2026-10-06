'use client'

import { useSyncExternalStore } from 'react'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'

/*
 * 設定の画面の入口（page.tsx）で v7 / v8 を分けるときのテーマの読み方。
 *
 * useAdminTheme は描き直すたびに最初は 'v7' から始まる（SSR と揃えるため）。
 * 設定の画面は「設定の中のメニュー」を白い板の中に置くと、外枠が本文の
 * 包みを外す（useSettingsNavInline）。包みが変わると入口ごと作り直され、
 * そのたびに 'v7' → 'v8' と戻って、メニューが出る・消えるを繰り返していた
 * （Maximum update depth exceeded）。
 * ここでは SSR と最初の読み込みだけ 'v7'、作り直しのときは今の値を最初から返す。
 */
const subscribe = (onChange: () => void) => {
  window.addEventListener?.(ADMIN_THEME_CHANGED_EVENT, onChange)
  return () => window.removeEventListener?.(ADMIN_THEME_CHANGED_EVENT, onChange)
}
const readClient = (): 'v7' | 'v8' => (document.documentElement.dataset?.theme === 'v8' ? 'v8' : 'v7')
const readServer = (): 'v7' | 'v8' => 'v7'

export function useSettingsTheme(): 'v7' | 'v8' {
  return useSyncExternalStore(subscribe, readClient, readServer)
}
