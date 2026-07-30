'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const items = [
  {
    href: '/booking/staff',
    label: 'シフト',
    icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z',
  },
  {
    href: '/chats',
    label: 'メッセージ',
    icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    href: '/booking/bookings',
    label: '予約管理',
    icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
] as const

export default function MobileQuickNav() {
  const pathname = usePathname()

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 grid min-h-16 grid-cols-3 border-t border-gray-200 bg-white/95 px-2 pt-1.5 shadow-[0_-4px_16px_rgba(15,23,42,0.08)] backdrop-blur lg:hidden"
      style={{ paddingBottom: 'max(0.375rem, env(safe-area-inset-bottom))' }}
      aria-label="よく使う管理機能"
    >
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold ${
              active ? 'bg-green-50 text-green-700' : 'text-gray-500'
            }`}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={item.icon} />
            </svg>
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
