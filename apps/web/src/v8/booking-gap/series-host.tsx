'use client'

import { useMemo } from 'react'
import { useRouter } from 'next/navigation'
import type { BookingMenu, BookingStaff } from '@/lib/api'
import SeriesBookingDrawer from './series-drawer'
import { seriesTimeZone } from './series-model'

/** 予約管理の「繰り返して入れる」の入口。?series=new&seriesAt=…&seriesMenu=…&seriesStaff=…&seriesFriend=…&seriesName=… で開く。 */
export const SERIES_QUERY_KEYS = ['series', 'seriesAt', 'seriesMenu', 'seriesStaff', 'seriesFriend', 'seriesName', 'seriesTimeZone'] as const

export default function SeriesHost({ params, accountId, menus, staffList, basePath }: {
  params: URLSearchParams
  accountId: string
  menus: BookingMenu[]
  staffList: BookingStaff[]
  basePath: string
}) {
  const router = useRouter()
  const at = params.get('seriesAt') ?? ''
  const menu = menus.find((m) => m.id === params.get('seriesMenu'))
  const staff = staffList.find((s) => s.id === params.get('seriesStaff')) ?? null
  const friendId = params.get('seriesFriend') ?? ''
  const open = params.get('series') === 'new' && Boolean(at && menu && friendId)
  const summary = useMemo(() => menu && at ? ({
    customerName: params.get('seriesName') ?? 'お客さま', friendId, menuId: menu.id, menuName: menu.name, durationMin: menu.duration_minutes,
    timeZone: seriesTimeZone(params.get('seriesTimeZone') ?? undefined),
    staffId: staff?.id ?? null, staffName: staff?.display_name ?? '指名なし', startsAt: at,
    endsAt: new Date(new Date(at).getTime() + menu.duration_minutes * 60_000).toISOString(),
  }) : null, [menu, staff, at, friendId, params])
  const close = () => {
    const next = new URLSearchParams(params.toString())
    for (const key of SERIES_QUERY_KEYS) next.delete(key)
    const query = next.toString()
    router.replace(query ? `${basePath}?${query}` : basePath)
  }
  if (!summary) return null
  return <SeriesBookingDrawer open={open} accountId={accountId} summary={summary} onClose={close} onCreated={close} />
}
