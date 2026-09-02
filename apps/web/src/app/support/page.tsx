'use client'

import SupportInbox from '@/components/support/support-inbox'

/**
 * `/support` は旧URLで、`public/_redirects` が `/chats?channel=email` へ
 * 308 で飛ばす。ブックマークやリッチメニューから踏まれる可能性があるので
 * 画面自体は残す。
 *
 * 中身は `components/support/support-inbox.tsx`。page.tsx は既定エクスポート
 * 以外を持てないため、受信箱から使い回す本体は部品側に置いている。
 */
export default function SupportPage() {
  return <SupportInbox channel="email" />
}
