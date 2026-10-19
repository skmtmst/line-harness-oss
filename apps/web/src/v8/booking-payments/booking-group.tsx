'use client'

import { useEffect, useState } from 'react'
import { bookingAdvancedApi } from '@/lib/api/helpers/booking-advanced'
import type { BookingGroupView } from '@line-crm/shared'
import ListState from '@/components/shared/list-state'
import { PartySection } from '@/v8/booking-gap/public/party-section/index'

/** 組の表示は Nx1kq の共通段へ集約する。別店・別予約の返事は表示しない。 */
export function BookingGroupSection({ accountId, bookingId, canOperate, onChanged }: { accountId: string; bookingId: string; canOperate: boolean; onChanged?: () => void }) {
  const [snapshot, setSnapshot] = useState<{ key: string; group: BookingGroupView | null; error: unknown } | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${accountId}:${bookingId}`
  useEffect(() => {
    let alive = true
    setSnapshot((previous) => previous?.key === key ? { ...previous, error: null } : null)
    void Promise.resolve().then(() => bookingAdvancedApi.group(accountId, bookingId)).then((res) => {
      if (alive) setSnapshot({ key, group: res.data, error: null })
    }).catch((error: unknown) => {
      if (alive) setSnapshot((previous) => ({ key, group: previous?.key === key ? previous.group : null, error }))
    })
    return () => { alive = false }
  }, [accountId, bookingId, key, tick])
  const current = snapshot?.key === key ? snapshot : null
  return <>
    {current?.error ? <ListState kind="error" title="この組を読み込めませんでした" error={current.error} onRetry={() => setTick((n) => n + 1)} /> : null}
    {current?.group && current.group.members.length >= 2 ? <PartySection key={key} party={current.group} accountId={accountId} currentBookingId={bookingId} canOperate={canOperate && !current.error}
      onReload={() => setTick((n) => n + 1)} onChanged={() => { setTick((n) => n + 1); onChanged?.() }} /> : null}
  </>
}
