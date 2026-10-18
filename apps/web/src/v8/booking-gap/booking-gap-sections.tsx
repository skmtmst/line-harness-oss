'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Gap2Booking, Gap2Series } from '@line-crm/shared'
import { bookingSeriesApi } from '@/lib/api-gap2'
import { bookingPartyApi, type BookingParty } from '@/lib/api-gap2-pending'
import PartySection from './party-section'
import SeriesPanelSection from './series-panel-section'

/*
 * 予約の詳細パネルに足す段（繰り返し）。繰り返しの 1 回でない予約には何も出さない。
 * 読めないときは段を出さない（今までの詳細パネルのまま使える）。
 * 同伴の組（この組 N 人）は読む口がまだ無いので、読めたときだけ出し、取消は「現在準備中です」（B-314）。
 */
export default function BookingGapSections({ accountId, bookingId, seriesId, customerName, menuName, startsAt, canOperate, onChanged }: {
  accountId: string
  bookingId: string
  /** 予約の series_id（無ければ繰り返しではない）。 */
  seriesId: string | null
  customerName: string
  menuName: string
  startsAt: string
  canOperate: boolean
  onChanged: () => void
}) {
  const [data, setData] = useState<{ series: Gap2Series; bookings: Gap2Booking[] } | null>(null)
  const [party, setParty] = useState<BookingParty | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let current = true
    setData(null); setParty(null)
    /* 同伴の組：読む口はまだ無い。読めたときだけ段を出す（取消は準備中）。 */
    void Promise.resolve().then(() => bookingPartyApi.get(accountId, bookingId)).then((r) => { if (current) setParty(r.data) }).catch(() => undefined)
    if (!seriesId) return
    void Promise.resolve().then(() => bookingSeriesApi.get(accountId, seriesId)).then((r) => { if (current) setData(r.data) }).catch(() => undefined)
    return () => { current = false }
  }, [accountId, bookingId, seriesId, tick])
  const changed = useCallback(() => { setTick((n) => n + 1); onChanged() }, [onChanged])
  if (!data && !party) return null
  return <>
    {party ? <PartySection party={party} canOperate={canOperate} currentBookingId={bookingId} /> : null}
    {data ? <SeriesPanelSection series={data.series} bookings={data.bookings} accountId={accountId} customerName={customerName} menuName={menuName} bookingId={bookingId} startsAt={startsAt} canOperate={canOperate} onChanged={changed} /> : null}
  </>
}
