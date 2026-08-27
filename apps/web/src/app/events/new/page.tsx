'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import EventWizard from '@/components/events/event-wizard'
import { useAccount } from '@/contexts/account-context'
import ListState from '@/components/shared/list-state'

function NewEventPageInner() {
  const { selectedAccountId } = useAccount()
  const sp = useSearchParams()

  // ①を保存するとイベントが実在するので、以降は ?id= を連れて進む。
  const eventId = sp.get('id')
  const parsed = Number(sp.get('step') ?? '1')
  const step = parsed === 2 || parsed === 3 ? (parsed as 2 | 3) : 1

  if (!selectedAccountId) {
    return (
      <div data-design-node="MKrPY">
        <ListState kind="empty" title="LINEアカウントを選択してください" description="サイドバーで運用するLINEアカウントを選んでください。" />
      </div>
    )
  }

  return (
    <div data-design-node="MKrPY">
      <EventWizard accountId={selectedAccountId} eventId={eventId} step={step} />
    </div>
  )
}

export default function NewEventPage() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <NewEventPageInner />
    </Suspense>
  )
}
