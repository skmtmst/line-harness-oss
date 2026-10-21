import { formatYen } from '@line-crm/shared'
import type { StyleSnapshot } from '@line-crm/shared'
import { formatDate } from '@/lib/format'
import type { StyleAnalytics } from './model'

/** Payment dates use their own window; a today's-only response cannot fill it. */
export function paymentAnalytics(snapshot: StyleSnapshot, tabs: StyleAnalytics['tabs']): StyleAnalytics {
  const payment = snapshot.payments
  const values = payment?.status === 'available' ? payment : null
  const period = values?.period
  const matches = period?.dateBasis === 'payment' && period.timeZone === snapshot.timeZone
    && Date.parse(period.from) === Date.parse(snapshot.from) && Date.parse(period.to) === Date.parse(snapshot.to)
  const availability: StyleAnalytics['availability'] = payment?.status === 'forbidden'
    ? { kind: 'forbidden', description: '支払いの記録を表示する権限がありません。' }
    : payment?.status === 'unavailable'
      ? { kind: 'unavailable', description: 'このアカウントの支払い集計は利用できません。0件としては扱いません。' }
      : !matches ? { kind: 'unmeasured', description: '選択した期間の支払い集計はまだ取得できていません。0件としては扱いません。' } : undefined
  const definitions = [
    ['paidAmount', '入金額', '入金した日が期間内の金額です。返金額を差し引く前の金額です。', true],
    ['paidCount', '入金件数', '入金した日が期間内の支払いの件数です。', false],
    ['refundedAmount', '返金額', '返金した日が期間内の金額です。入金した日とは分けて数えます。', true],
    ['refundedCount', '返金件数', '期間内に返金の記録がある支払いの件数です。', false],
    ['pendingCount', '支払い待ち', '期間内に作られ、支払い待ちになっている記録の件数です。', false],
    ['expiredCount', '期限切れ', '期間内に支払いと予約の両方が期限切れになった件数です。', false],
  ] as const
  const cards = availability ? [] : definitions.map(([id, title, help, money]) => {
    const value = values?.[id]
    const available = typeof value === 'number' && Number.isFinite(value)
    return { id, title, valueText: available ? money ? formatYen(value) : value.toLocaleString('ja-JP') : '—', unit: money ? '' : '件', help: available ? help : 'この値はまだ取得できていません。' }
  })
  const day = (value: string | number) => formatDate(value, { style: 'day', timeZone: snapshot.timeZone })
  return {
    tabs, tab: 'payments', cards, chart: null, table: null, availability,
    side: [
      { id: 'period', title: '集計期間', rows: [], note: `${day(snapshot.from)}〜${day(Date.parse(snapshot.to) - 1)}（${snapshot.timeZone}）。` },
      { id: 'how', title: '数え方', rows: [], note: '入金は入金した日、返金は返金した日で数えます。予約日・来店日や見込み売上とは別の数です。' },
    ],
  }
}
