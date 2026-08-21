'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import EventWizard from '@/components/events/event-wizard'
import { useAccount } from '@/contexts/account-context'

function NewEventPageInner() {
  const { selectedAccountId } = useAccount()
  const sp = useSearchParams()

  // ①を保存するとイベントが実在するので、以降は ?id= を連れて進む。
  const eventId = sp.get('id')
  const parsed = Number(sp.get('step') ?? '1')
  const step = parsed === 2 || parsed === 3 ? (parsed as 2 | 3) : 1

  if (!selectedAccountId) {
    return (
      <>
        <Header title="イベントを作る" />
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-12 text-center text-sm">
          サイドバーでアカウントを選択してください
        </div>
      </>
    )
  }

  return (
    <>
      <div data-design="Head">
        <Header title="イベントを作る" description="3つの段階に分けて登録します" />
      </div>
      <EventWizard accountId={selectedAccountId} eventId={eventId} step={step} />
    </>
  )
}

export default function NewEventPage() {
  return (
    <Suspense fallback={<Header title="イベントを作る" />}>
      <NewEventPageInner />
    </Suspense>
  )
}
