'use client'

import { useCallback, useEffect, useState } from 'react'
import { bookingPartyApi, bookingSeriesApi, type BookingParty, type BookingSeriesOf } from '@/lib/api-gap2'
import PartySection from './party-section'
import SeriesPanelSection from './series-panel-section'

/*
 * 予約の詳細パネルに足す段（組・繰り返し）。どちらにも当たらない予約には何も出さない。
 * 読めないときは段を出さない（今までの詳細パネルのまま使える）。
 */
export default function BookingGapSections({ accountId, bookingId, customerName, menuName, startsAt, canOperate, onChanged }: {
  accountId: string
  bookingId: string
  customerName: string
  menuName: string
  startsAt: string
  canOperate: boolean
  onChanged: () => void
}) {
  const [party, setParty] = useState<BookingParty | null>(null)
  const [series, setSeries] = useState<BookingSeriesOf | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let current = true
    setParty(null); setSeries(null)
    void bookingPartyApi.get(accountId, bookingId).then((r) => { if (current) setParty(r.data) }).catch(() => undefined)
    void bookingSeriesApi.ofBooking(accountId, bookingId).then((r) => { if (current) setSeries(r.data) }).catch(() => undefined)
    return () => { current = false }
  }, [accountId, bookingId, tick])
  const changed = useCallback(() => { setTick((n) => n + 1); onChanged() }, [onChanged])
  if (!party && !series) return null
  return <>
    {party ? <PartySection party={party} accountId={accountId} canOperate={canOperate} currentBookingId={bookingId} onChanged={changed} /> : null}
    {series ? <SeriesPanelSection series={series} accountId={accountId} customerName={customerName} menuName={menuName} bookingId={bookingId} startsAt={startsAt} canOperate={canOperate} onChanged={changed} /> : null}
  </>
}
