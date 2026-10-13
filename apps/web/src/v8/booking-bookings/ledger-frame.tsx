'use client'

import type { ReactNode } from 'react'
import { PageFrame } from '@/components/templates/page-frame'

export default function BookingLedgerFrame({ children, view }: { children: ReactNode; view: string }) {
  if (view !== 'month') return <div className="flex flex-col gap-4" data-design-node="acRIl">{children}</div>

  return <PageFrame kind="list" boardId="R8tlbw" heightMode="content">
    {children}
  </PageFrame>
}
