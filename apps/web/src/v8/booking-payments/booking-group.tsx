'use client'

import { useEffect, useState } from 'react'
import { bookingAdvancedApi } from '@/lib/api/helpers/booking-advanced'
import type { BookingGroupView } from '@line-crm/shared'
import ListState from '@/components/shared/list-state'
import { PartySection } from '@/v8/booking-gap/public/party-section/index'

/** 組の表示は Nx1kq の共通段へ集約する。別店・別予約の返事は表示しない。 */
export function BookingGroupSection({ accountId, bookingId, canOperate, onChanged }: { accountId: string; bookingId: string; canOperate: boolean; onChanged?: () => void }) {
  const [snapshot, setSnapshot] = useState<{ key: string; group: BookingGroupView | null; error: unknown; loading: boolean } | null>(null)
  const [tick, setTick] = useState(0)
  const key = `${accountId}:${bookingId}`
  useEffect(() => {
    let alive = true
    setSnapshot((previous) => previous?.key === key ? { ...previous, loading: true } : null)
    void Promise.resolve().then(() => bookingAdvancedApi.group(accountId, bookingId)).then((res) => {
      if (alive) setSnapshot({ key, group: res.data, error: null, loading: false })
    }).catch((error: unknown) => {
      if (alive) setSnapshot((previous) => ({ key, group: previous?.key === key ? previous.group : null, error, loading: false }))
    })
    return () => { alive = false }
  }, [accountId, bookingId, key, tick])
  const reload = () => {
    setSnapshot((previous) => previous?.key === key ? { ...previous, loading: true } : null)
    setTick((n) => n + 1)
  }
  const current = snapshot?.key === key ? snapshot : null
  return <>
    {current?.error ? <ListState kind="error" title="失敗：この組を読み込めませんでした" description={current.group ? '前に読み込んだ内容を表示しています。読み直すまで取消はできません。' : '読み込めていないため人数は分かりません。'} error={current.error} onRetry={reload} retrying={current.loading} /> : null}
    {current?.group && current.group.members.length >= 2 ? <PartySection key={key} party={current.group} accountId={accountId} currentBookingId={bookingId} permissionAllowed={canOperate} canOperate={canOperate && !current.error && !current.loading}
      operationDisabledReason={!canOperate ? undefined : current.loading ? '組の状態を読み直しています。完了してから操作してください。' : current.error ? '組の状態を確かめられません。この組を読み直してください。' : undefined}
      onReload={reload} onChanged={() => { reload(); onChanged?.() }} /> : null}
  </>
}
