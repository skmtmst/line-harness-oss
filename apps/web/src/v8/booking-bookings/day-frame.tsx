'use client'

import type { ReactNode } from 'react'
import { CalendarDays, CalendarPlus, CalendarX, CircleAlert, Info } from 'lucide-react'
import { BookingPage, BookingSidebarLinks, BookingSidebarNotes, BookingSidebarSection } from '@/components/templates/booking-page'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import Button from '@/components/shared/button'
import Card, { CardHeader, CardContent } from '@/components/shared/card'
import Avatar from '@/components/shared/avatar'
import ListState from '@/components/shared/list-state'
import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { ReservationFacts } from '@/components/shared/reservation-board'
import { formatDay, formatNumber, formatTime } from '@/lib/format'
import { jstDate } from '@/lib/jst-datetime'
import type { BookingRequest } from '@/lib/api'

type Availability = { status: 'loading' | 'ready' | 'error' | 'unconfigured'; slots: { staffId: string; date: string; start: string; remaining: number; state: string }[] }
export function dayBookingSummary(rows: BookingRequest[], date: string, availability: Availability) {
  const active = rows.filter(row => !['cancelled', 'rejected', 'expired'].includes(row.status))
  const line = active.filter(row => row.source ? row.source === 'liff' : Boolean(row.friend_id)).length
  const slots = availability.slots.filter(slot => slot.date === date && slot.remaining > 0 && ['available', 'limited'].includes(slot.state))
  const phone = active.filter(row => row.source === 'phone').length
  return { active: active.length, line, phone, other: active.length - line - phone, requested: active.filter(row => row.status === 'requested').length,
    cancelled: rows.filter(row => ['cancelled', 'rejected', 'no_show'].includes(row.status)).length,
    sales: rows.filter(row => row.status === 'confirmed').reduce((sum, row) => sum + row.price_at_booking, 0),
    available: availability.status === 'ready' ? new Set(slots.map(slot => `${slot.staffId}/${slot.start}`)).size : null,
    next: active.filter(row => ['requested', 'confirmed'].includes(row.status) && Date.parse(row.ends_at) > Date.now()).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0] }
}

export default function PeopleDayFrame({ view, date, rows, ready, availability, actions, canWrite, onOpen, children }: {
  view: 'day' | 'week'; date: string; rows: BookingRequest[]; ready: boolean; availability: Availability
  actions: ReactNode; canWrite: boolean; onOpen: (id: string) => void; children: ReactNode
}) {
  if (view === 'week') return <BookingPage title="予約管理" actions={actions}>{children}</BookingPage>
  const summary = dayBookingSummary(rows, date, availability)
  const value = (count: number) => ready ? count : null
  const next = ready ? summary.next : undefined
  const day = formatDay(`${date}T00:00:00+09:00`)
  const period = date === jstDate() ? '今日' : day
  const stats = <KpiBand layout="booking">
    <KpiCard presentation="band" icon={<CalendarDays size={16} aria-hidden />} title={`${period}の予約`} value={value(summary.active)} unit="件" detail={ready ? `LINE ${summary.line}・電話 ${summary.phone}${summary.other ? `・その他 ${summary.other}` : ''}` : '読み込んでいます'} />
    <KpiCard presentation="band" icon={<CalendarPlus size={16} aria-hidden />} title="まだ空いている枠" value={ready ? summary.available : null} unit="枠" detail={availability.status === 'ready' ? 'この日の残り' : availability.status === 'error' ? '読み込めませんでした' : availability.status === 'unconfigured' ? '受付枠が未設定' : '読み込んでいます'} help="空き枠から担当と開始時刻の重複を除いて数えています。メニュー違いの同じ枠は1枠です。" helpDisplay="question" />
    <KpiCard presentation="band" icon={<CircleAlert size={16} aria-hidden />} title="未承認・要対応" value={value(summary.requested)} unit="件" detail="承認待ちの予約" />
    <KpiCard presentation="band" icon={<CalendarX size={16} aria-hidden />} title="キャンセル" value={value(summary.cancelled)} unit="件" detail="この日" />
  </KpiBand>
  const aside = <>
    <BookingSidebarSection title="次の予約" action={{ href: '/booking/bookings?view=list', label: period === "今日" ? "今日の予約をすべて見る" : "この日の予約をすべて見る" }}>
      {next ? <Card frame="inset" padding="compact" layout="vertical" gap="tight">
        <CardHeader size="panel" title={next.friend_name ?? '名前の登録なし'} meta={next.menu_name} action={<Avatar name={next.friend_name} size={32} />} />
        <CardContent><ReservationFacts items={[{ label: '日付', value: day }, { label: '時刻', value: `${formatTime(next.starts_at)}〜${formatTime(next.ends_at)}` }, { label: '担当', value: next.staff_name }]} /></CardContent>
        <Button variant="primary" onClick={() => onOpen(next.id)}>詳細を見る</Button>
        {canWrite ? <Button href={`/booking/bookings/detail?id=${encodeURIComponent(next.id)}`}>日時を変える</Button> : null}
      </Card> : <ListState kind="empty" title={ready ? '次の予約はありません' : '予約を読み込んでいます'} />}
    </BookingSidebarSection>
    <BookingSidebarSection title={`${period} 気をつけること`}><BookingSidebarNotes items={!ready ? [{ icon: <Info size={14} aria-hidden />, title: '読み込んでいます' }] : [
      summary.requested ? { icon: <CircleAlert size={14} aria-hidden />, title: `未承認の予約が${summary.requested}件`, detail: '承認するか、断るかを決めてください' } : { icon: <Info size={14} aria-hidden />, title: 'いま確認が必要な予約はありません' },
      ...(summary.phone + summary.other > 0 ? [{ icon: <Info size={14} aria-hidden />, title: 'LINE以外の予約があります', detail: '連絡方法も確認してください' }] : []),
    ]} /></BookingSidebarSection>
    <BookingSidebarSection title={`${day}の内訳`}><ReservationFacts items={[
      { label: '予約', value: ready ? `${summary.active}件` : '—' }, { label: 'うちLINEから', value: ready ? `${summary.line}件` : '—' },
      { label: 'うち電話', value: ready ? `${summary.phone}件` : '—' },
      ...(ready && summary.other > 0 ? [{ label: 'その他の受付', value: `${summary.other}件` }] : []),
      { label: '売上見込み', value: ready ? `¥${formatNumber(summary.sales)}` : '—' },
    ]} /></BookingSidebarSection>
    <BookingSidebarSection title="つながる先"><BookingSidebarLinks links={[
      { href: '/booking/menus', label: '予約設定', note: 'メニューと受付枠' },
      { href: '/reminders', label: 'リマインダ', note: '前日・当日のお知らせ' },
      { href: '/friends', label: '友だち', note: '来店の記録' },
      { href: '/conversions', label: 'コンバージョン', note: '予約が入った' },
    ]} /></BookingSidebarSection>
  </>
  return <BookingPage title="予約管理" help="担当者ごとの予約と空き枠を確認できます。" actions={actions} stats={stats} aside={aside}>
    {!canWrite ? <ReadOnlyNotice /> : null}{children}
  </BookingPage>
}
