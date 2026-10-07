'use client'

import { useAdminTheme } from '@/lib/use-admin-theme'

/*
 * RqO7O：v8 の絵の失敗の文は「読み込めませんでした」「もう一度試す」。v7 は今の文のまま。
 * 表の中の失敗の行・数のカードの再試しなど、フックを持たない部品から使う。
 */
export function RetryLabel() {
  return <>{useAdminTheme() === 'v8' ? 'もう一度試す' : 'もう一度読み込む'}</>
}

export function FailureTitle({ title }: { title: string }) {
  const v8 = useAdminTheme() === 'v8'
  return <>{v8 ? title.replace(/表示できませんでした$/, '読み込めませんでした') : title}</>
}
