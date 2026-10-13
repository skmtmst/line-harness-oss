'use client'

import type { ReactNode } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { PageContent, PageFrame } from '@/components/templates/page-frame'

export default function BookingLedgerFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const params = useSearchParams()
  if (pathname !== '/booking/bookings' || params.get('view') !== 'month') return children

  return <PageFrame kind="list" boardId="R8tlbw" heightMode="content">
    <PageContent>{children}</PageContent>
  </PageFrame>
}
