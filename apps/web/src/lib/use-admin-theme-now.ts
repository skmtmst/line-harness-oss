'use client'

import { useSyncExternalStore } from 'react'
import { ADMIN_THEME_CHANGED_EVENT } from './events'

/*
 * 見た目のテーマ（v7/v8）を「いま」の値で読む。useAdminTheme と違い、2回目以降の
 * 描き直し（付け直し）では最初から本当の値を返す（サーバ描画と最初の水和だけ v7）。
 *
 * 設定の画面（白い板の中に「設定の中のメニュー」を置く V8 の画面）で使う。
 * 中のメニューを置くと外の枠が組み替わって画面が付け直される。useAdminTheme だと
 * 付け直しのたびに一度 v7 で描き、中のメニューが消えて枠が戻り、また付け直す…を繰り返す。
 */
function subscribe(onChange: () => void) {
  window.addEventListener?.(ADMIN_THEME_CHANGED_EVENT, onChange)
  return () => window.removeEventListener?.(ADMIN_THEME_CHANGED_EVENT, onChange)
}

function snapshot(): 'v7' | 'v8' {
  return document.documentElement.dataset?.theme === 'v8' ? 'v8' : 'v7'
}

export function useAdminThemeNow(): 'v7' | 'v8' {
  return useSyncExternalStore(subscribe, snapshot, () => 'v7')
}
