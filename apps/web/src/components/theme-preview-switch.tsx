'use client'

import { useEffect, useState } from 'react'
import Toggle from '@/components/shared/toggle'
import { ADMIN_THEME_CHANGED_EVENT } from '@/lib/events'

/*
 * ★V8 移行②: 担当者が新しい見た目（V8・試作）を試すための切り替え。
 * 設定画面の一番下に1つだけ置く。
 *
 * 効き方: このブラウザの localStorage に `lh-admin-theme` として残り、
 * 次回以降は描画前のスクリプト（layout.tsx）が `<html data-theme>` に
 * 反映する。サーバ側・他の利用者には影響しない。作りかけの見た目なので
 * 見た目の確認専用であり、保存・送信などの動きはどちらのテーマでも同じ。
 */
export const ADMIN_THEME_STORAGE_KEY = 'lh-admin-theme'

/*
 * 切り替えの本体を外へ出す。localStorage に残すので次回以降も覚える。
 * 上バーの「前の見た目に戻す」は廃止したので、使うのは設定画面の切り替えだけ。
 */
export function applyAdminTheme(next: 'v7' | 'v8') {
  document.documentElement.dataset.theme = next
  try {
    localStorage.setItem(ADMIN_THEME_STORAGE_KEY, next)
  } catch {
    // プライベートモード等で保存できなくても、この画面だけの切り替えは効かせる
  }
  // v8 で初めて現れる部品（帯のベルなど）が、その場で値を取りに行けるようにする
  window.dispatchEvent(new Event(ADMIN_THEME_CHANGED_EVENT))
}

export default function ThemePreviewSwitch() {
  // null の間は描画しない（SSR と localStorage の差でちらつかないようにする）
  const [theme, setTheme] = useState<'v7' | 'v8' | null>(null)

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'v8' ? 'v8' : 'v7')
  }, [])

  const apply = (useV8: boolean) => {
    const next = useV8 ? 'v8' : 'v7'
    applyAdminTheme(next)
    setTheme(next)
  }

  if (theme === null) return null

  return (
    <div data-design="theme-preview" className="rounded-card border-hairline bg-canvas border p-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-ink text-sm font-semibold">画面の見た目（試作）</p>
          <p className="text-ink-secondary mt-1 text-xs leading-5">
            新しい画面の見た目（V8）をこのブラウザだけで試せます。作りかけの部分があります。
            保存や送信の動きはどちらでも同じです。
          </p>
        </div>
        <Toggle
          checked={theme === 'v8'}
          label="新しい見た目（V8・試作）を使う"
          onChange={apply}
        />
      </div>
    </div>
  )
}
