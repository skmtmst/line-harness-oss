'use client'

import SupportInbox from '@/components/support/support-inbox'
import { usePageTitle } from '@/components/shell/page-chrome'

/**
 * `/support` は旧URLで、`public/_redirects` が `/chats?channel=email` へ
 * 308 で飛ばす。ブックマークやリッチメニューから踏まれる可能性があるので
 * 画面自体は残す。
 *
 * 中身は `components/support/support-inbox.tsx`。page.tsx は既定エクスポート
 * 以外を持てないため、受信箱から使い回す本体は部品側に置いている。
 *
 * 画面名は上部バーへ渡す。メニュー（`lib/menu.ts`）に `/support` の項目が
 * 無いため、既定のままでは帯が空白になる。
 */
export default function SupportPage() {
  usePageTitle('問い合わせ')
  return <SupportInbox channel="email" />
}
