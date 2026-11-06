'use client'

import type { ReactNode } from 'react'
import { PageFrame } from '@/components/templates/page-frame'

export default function BookingLedgerFrame({ children, view }: { children: ReactNode; view: string }) {
  return <PageFrame kind="list" boardId={view === 'month' ? 'R8tlbw' : 'acRIl'} heightMode="content">
    {children}
  </PageFrame>
}
