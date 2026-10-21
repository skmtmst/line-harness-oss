import { formatYen as yen } from '@line-crm/shared';
import { styleTerm, term } from '@/lib/terms'
import { paymentAnalytics } from './analytics-payments'
import { dailyAnalyticsChart } from './analytics-daily'
import type { StyleAnalyticsData, StyleBooking, StyleCard, StyleMetric, StyleSchedule, StyleScheduleEntry, StyleSnapshot } from '@line-crm/shared'
import type {
  DashboardRange, IndustryStyle, StyleAnalytics, StyleBadge, StyleBoard, StyleKpi, StyleLayout, StyleMonth, StyleMonthDay, StyleRow, StyleSideCard, StyleToday, StyleWeek,
} from './model'

/*
 * 口（API 組4）の生の値 → 画面の形（API-CONTRACT-4 §10 の「共通のアダプター」）。
 * 数は summary、盤・一覧・日週月は schedule、分析は analytics、表示を変えるは style の cards から作る。
 * 決まり：null は「—」＋理由（標本不足・未設定）、0 は実測の 0。取れない物（支払いなど）は見本の値で埋めない。
 */

const WEEK = '日月火水木金土'
const STATUS_TEXT: Record<StyleMetric['status'], string> = { available: '', insufficient_sample: '数が少ないため出せません', unconfigured: '未設定です' }

function parts(iso: string, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(new Date(iso)).map((x) => [x.type, x.value]))
  const date = `${p.year}-${p.month}-${p.day}`
  return { date, time: `${p.hour}:${p.minute}`, month: Number(p.month), day: Number(p.day), week: WEEK[new Date(`${date}T00:00:00Z`).getUTCDay()] }
}
export const hm = (iso: string, tz: string) => parts(iso, tz).time
const md = (iso: string, tz: string) => { const p = parts(iso, tz); return `${p.month}/${String(p.day).padStart(2, '0')}（${p.week}）` }
const dayLabel = (date: string) => { const d = new Date(`${date}T00:00:00Z`); return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEK[d.getUTCDay()]}）` }

const isRate = (m?: StyleMetric) => Boolean(m && (m.unit === '' || m.unit === 'ratio' || m.unit === '%' || m.unit === '率') && m.denominator !== undefined)
const isYen = (m?: StyleMetric) => m?.unit === '円'

/** 数のマスの値・単位（率は 0〜1 を %、円は ¥）。 */
export function metricValue(m?: StyleMetric): { value: number | null; valueText?: string; unit: string; reason: string } {
  if (!m) return { value: null, unit: '', reason: '口から返っていません' }
  const reason = m.value === null ? STATUS_TEXT[m.status] || '取れませんでした' : ''
  if (m.value === null) return { value: null, unit: isRate(m) ? '%' : isYen(m) ? '' : m.unit, reason }
  if (isRate(m)) return { value: Math.round(m.value * 1000) / 10, unit: '%', reason }
  if (isYen(m)) return { value: m.value, valueText: yen(m.value), unit: '', reason }
  return { value: m.value, unit: m.unit || '件', reason }
}

/** 前の期間との比べ（良い向きは緑）。どちらかが取れなければ出さない。 */
export function metricDelta(now?: StyleMetric, prev?: StyleMetric, lowerIsBetter = false): StyleKpi['delta'] {
  if (!now || !prev || now.value === null || prev.value === null) return null
  const diff = now.value - prev.value
  if (diff === 0) return null
  const sign = diff > 0 ? '+' : '−'
  const abs = Math.abs(diff)
  const text = isRate(now) ? `${sign}${Math.round(abs * 1000) / 10}pt` : isYen(now) ? `${sign}${yen(abs)}` : `${sign}${abs}${now.unit && now.unit !== '件' ? now.unit : ''}`
  const good = lowerIsBetter ? diff < 0 : diff > 0
  return { text, tone: good ? 'up' : 'down' }
}

const RANGE_WORD: Record<DashboardRange, string> = { today: '今日', week: '今週', month: '今月' }

type KpiSpec = { id: string; key: string; title: string; unit?: string; lower?: boolean; detail: (s: StyleSnapshot) => string; link?: { label: string; href: string }; help: string }

function kpi(spec: KpiSpec, s: StyleSnapshot): StyleKpi {
  const m = s.metrics[spec.key]
  const v = metricValue(m)
  return {
    id: spec.id, title: spec.title, value: v.value, valueText: v.valueText, unit: spec.unit ?? v.unit,
    delta: metricDelta(m, s.previous[spec.key], spec.lower),
    detail: v.reason || spec.detail(s), link: spec.link ?? null, help: m?.formula ? `${spec.help}（${m.formula}）` : spec.help,
  }
}

const NEW_HELP = '予約が入った日で数えます。来店日・面談日で数えるほかの数とは別です。'
const num = (s: StyleSnapshot, k: string) => s.metrics[k]?.value

function newKpi(s: StyleSnapshot, href: string, range: DashboardRange): StyleKpi {
  return { id: 'new', title: '新着予約', value: s.newBookings.length, unit: '件', delta: null, detail: `${RANGE_WORD[range]}入った予約`, link: { label: '一覧', href }, help: NEW_HELP }
}

/** 支払いの数は決済の口（API 組3）から。まだ無いので値を作らず、押すと準備中の窓（画面側で開く）。 */
function paymentKpi(range: DashboardRange): StyleKpi {
  return { id: 'income', title: `${RANGE_WORD[range]}の入金`, value: null, unit: '', delta: null, detail: `カードの請求は${term('S24')}`, link: { label: 'くわしく', href: '#preparing-payment' }, help: 'オンライン（Stripe）で受け取った額です。売上（料金×確定数）とは別の数です。' }
}

export function kpisFor(style: IndustryStyle, s: StyleSnapshot, range: DashboardRange): StyleKpi[] {
  const r = RANGE_WORD[range]
  if (style === 'restaurant') return [
    kpi({ id: 'today', key: 'bookings', title: `${r}の予約`, unit: `組・${num(s, 'guests') ?? '—'}人`, detail: () => `初めて ${num(s, 'firstTime') ?? '—'}・常連 ${num(s, 'regular') ?? '—'}`, link: { label: '一覧', href: '/restaurant-test/reservations' }, help: '取消・無断・押さえを除く予約です。来店日で数えます。' }, s),
    kpi({ id: 'waiting', key: 'attention', title: '対応待ち', detail: () => `未配席 ${num(s, 'unseated') ?? '—'}・枠を閉じる ${num(s, 'mediaCloseTasks') ?? '—'}`, link: { label: '内訳', href: '/restaurant-test/reservations' }, help: '承認待ち・卓が決まっていない予約・他の予約サイトの枠を閉じる知らせの数です。' }, s),
    kpi({ id: 'free', key: 'freeTables', title: '空席（いま）', unit: '卓', detail: () => '動いている卓のうち', link: { label: '座席表', href: '/restaurant-test/tables' }, help: '動いている卓のうち、いま予約が重なっていない卓の数です。' }, s),
    kpi({ id: 'noshow', key: 'noShowRate', title: '無断キャンセル率', lower: true, detail: () => '期間内', link: { label: '人を見る', href: '/friends' }, help: '無断キャンセルの割合です。' }, s),
    newKpi(s, '/restaurant-test/reservations', range),
  ]
  if (style === 'salon') return [
    kpi({ id: 'today', key: 'bookings', title: `${r}の予約`, detail: (x) => { const e = metricValue(x.metrics.estimatedRevenue); return e.valueText ? `見込み ${e.valueText}` : '見込み —' }, link: { label: '一覧', href: '/booking/bookings' }, help: '取消を除く予約です。来店日で数えます。' }, s),
    kpi({ id: 'waiting', key: 'attention', title: '対応待ち', detail: () => '承認待ち・来店の印がまだ', link: { label: '内訳', href: '/booking/bookings' }, help: '承認待ち・来店の印が付いていない予約など、お店が何かする必要がある数です。' }, s),
    kpi({ id: 'rebook', key: 'nextBookingRate', title: '次回予約率', detail: () => '過去30日', link: { label: '人を見る', href: '/friends' }, help: '施術のあと24時間以内に次の予約を入れた人の割合です。' }, s),
    kpi({ id: 'recall', key: 'recall', title: '呼び戻し待ち', detail: () => '次の予約がない人', link: { label: '友だち一覧', href: '/friends' }, help: '来店間隔の目安を過ぎ、次の予約がない人の数です。' }, s),
    kpi({ id: 'noshow', key: 'noShowRate', title: '無断キャンセル率', lower: true, detail: () => '無断／対象の予約', link: { label: '友だち一覧', href: '/friends' }, help: '対象期間の予約に対する無断キャンセルの割合です。期間と除外条件は計算式で確認できます。' }, s),
  ]
  if (style === 'consult') return [
    kpi({ id: 'meetings', key: 'bookings', title: `${r}の面談`, detail: (x) => `実施 ${num(x, 'visits') ?? '—'}`, link: { label: '一覧', href: '/booking/bookings' }, help: '取消を除く面談です。面談日で数えます。' }, s),
    kpi({ id: 'results', key: 'resultPending', title: '結果待ち', detail: () => '結果を付ける面談', link: { label: '付ける', href: '/booking/bookings' }, help: '面談が終わって、結果（検討中・成約・見送り）をまだ付けていない数です。' }, s),
    kpi({ id: 'week', key: 'weekBookings', title: '今週の面談', detail: () => '月曜〜日曜・面談日', link: { label: '一覧', href: '/booking/bookings' }, help: '今週（月〜日）の面談です。面談日で数えます。' }, s),
    kpi({ id: 'noshow', key: 'noShowRate', title: styleTerm('consult', 'V21'), lower: true, detail: () => '期間の面談で数えます', link: { label: '人を見る', href: '/friends' }, help: `${styleTerm('consult', 'V17')}の割合です。` }, s),
    newKpi(s, '/booking/bookings', range),
  ]
  return [
    kpi({ id: 'classes', key: 'classes', title: `${r}のクラス`, unit: '回', detail: (x) => `定員 ${num(x, 'capacity') ?? '—'}・上限なし ${num(x, 'unlimitedClasses') ?? '—'}`, link: { label: '一覧', href: '/events' }, help: '期間に始まる有効な回の数です。' }, s),
    kpi({ id: 'attendance', key: 'attendancePending', title: '出欠待ち', unit: '回', detail: () => '出席の印がまだの回', link: { label: '名簿', href: '/events' }, help: '終わった回のうち、出席の印をまだ付けていない回の数です。' }, s),
    kpi({ id: 'fill', key: 'classroomOccupancy', title: `${r}の埋まり`, detail: (x) => { const o = metricValue(x.metrics.onlineOccupancy); return `オンラインは ${o.value === null ? '—' : `${o.value}%`}` }, link: { label: '一覧', href: '/events' }, help: '教室の予約 ÷ 定員です。教室とオンラインは別に数えます。' }, s),
    paymentKpi(range),
    newKpi(s, '/events', range),
  ]
}

const STATE: Record<string, StyleBadge> = {
  confirmed: { label: term('S11'), tone: 'info' }, booked: { label: term('S11'), tone: 'info' }, requested: { label: term('S10'), tone: 'warning' }, pending: { label: term('S10'), tone: 'warning' },
  seated: { label: '着席中', tone: 'success' }, visited: { label: '来店済み', tone: 'neutral' }, completed: { label: '済み', tone: 'neutral' }, attended: { label: '出席', tone: 'success' },
  cancelled: { label: term('S15'), tone: 'neutral' }, rejected: { label: term('S16'), tone: 'neutral' }, expired: { label: '期限切れ', tone: 'warning' }, no_show: { label: '無断', tone: 'danger' }, held: { label: '押さえ', tone: 'neutral' },
}
const ACTIVE: Record<IndustryStyle, string> = { restaurant: styleTerm('restaurant', 'V15'), salon: styleTerm('salon', 'V15'), consult: styleTerm('consult', 'V15'), lesson: styleTerm('lesson', 'V15') }
export function bookingStatus(b: StyleBooking, style: IndustryStyle = 'restaurant'): StyleBadge {
  if (b.status === 'seated' || (b.attendance === 'visited' && !b.visited)) return { label: ACTIVE[style], tone: 'success' }
  if (b.status === 'no_show') return { label: styleTerm(style, 'V17'), tone: 'danger' }
  if (b.visited || b.status === 'completed' || b.status === 'attended') return { label: styleTerm(style, 'V16'), tone: b.status === 'attended' ? 'success' : 'neutral' }
  return STATE[b.status] ?? { label: b.status, tone: 'neutral' }
}

const MEET: Record<string, StyleBadge> = { online: { label: 'オンライン', tone: 'info' }, in_person: { label: '対面', tone: 'neutral' }, customer_choice: { label: 'お客さまが選ぶ', tone: 'neutral' } }
const SOURCE: Record<string, string> = { line: 'LINE', liff: 'LINE', phone: '電話', manual: '電話', walk_in: 'ウォークイン', web: 'Web', hotpepper: 'ホットペッパー', tabelog: '食べログ', restaurant_board: 'レストランボード' }

function rowOf(style: IndustryStyle, e: StyleScheduleEntry, sch: StyleSchedule, now: Date): StyleRow {
  const b = e.booking
  const tz = sch.timeZone
  const columnNames = e.columnIds.map((id) => sch.columns.find((c) => c.id === id)?.name).filter(Boolean).join('・')
  const base: StyleRow = { id: e.id, time: hm(e.startsAt, tz), endTime: `〜${hm(e.endsAt, tz)}`, name: b?.name ?? e.title, sub: b ? [b.designation === 'designated' ? '指名' : null, SOURCE[b.source] ?? b.source].filter(Boolean).join('・') : columnNames }
  if (e.kind === 'class' || !b) {
    const slot = sch.availability.slots.find((x) => x.entryId === e.id)
    const remaining = slot ? slot.remaining : undefined
    return { ...base, reservationId: e.classId, remaining: remaining ?? undefined, name: e.title, sub: columnNames || base.sub, vacancy: remaining === undefined ? undefined : remaining === null ? '○' : remaining <= 0 ? '×' : remaining <= 2 ? '△' : '○', waiting: undefined }
  }
  const state = bookingStatus(b, style)
  const live = !['cancelled', 'rejected', 'expired', 'no_show'].includes(b.status)
  const past = Date.parse(b.startsAt) <= now.getTime()
  const extra = { past, live, booking: { id: b.id, friendId: b.friendId, kind: b.kind, version: b.version, updatedAt: b.updatedAt, price: b.price, partySize: b.partySize, startsAt: b.startsAt, meetingUrl: b.meetingUrl } }
  if (style === 'restaurant') return { ...base, ...extra, reservationId: b.id, people: b.partySize, seat: columnNames || '—', course: e.title || '席のみ', courseNote: b.price ? `1人 ${yen(b.price)}` : '—', state, action: !live ? null : b.visited ? 'undo' : 'visit' }
  if (style === 'consult') return { ...base, ...extra, sub: e.title, meet: b.meetingMode ? MEET[b.meetingMode] : undefined, staff: columnNames || '—', state: b.visited && !b.outcome ? { label: '結果待ち', tone: 'warning' } : state, action: b.visited ? (b.outcome ? 'done' : 'result') : !live ? null : b.meetingUrl ? 'meet' : b.location ? 'place' : null, actionHref: b.meetingUrl ?? (b.location ? `https://maps.google.com/?q=${encodeURIComponent(b.location)}` : undefined) }
  return { ...base, ...extra, course: e.title, courseNote: b.price ? yen(b.price) : undefined, staff: columnNames || '—', state, action: b.visited ? 'done' : !live ? null : ['requested', 'pending'].includes(b.status) ? 'approve' : 'visit' }
}

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))
const pad = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const TONES = ['green', 'purple', 'blue', 'amber'] as const

function boardOf(style: IndustryStyle, sch: StyleSchedule, now: Date): StyleBoard {
  const tz = sch.timeZone
  const times = [...sch.entries.flatMap((e) => [hm(e.startsAt, tz), hm(e.endsAt, tz)]), ...sch.availability.slots.flatMap((s) => [hm(s.startsAt, tz), hm(s.endsAt, tz)])]
  // 予約が 0 件でも営業の時間帯が分かるよう、空きだけの日は 10:00〜20:00 を下限にする（b22bbd）。
  const hasEntries = sch.entries.length > 0
  const from = times.length ? Math.min(hasEntries ? Infinity : 600, Math.floor(Math.min(...times.map(toMin)) / 60) * 60) : 600
  const to = times.length ? Math.max(hasEntries ? 0 : 1200, from + 120, Math.ceil(Math.max(...times.map(toMin)) / 60) * 60) : 1200
  const today = parts(now.toISOString(), tz)
  const showsToday = sch.range === 'today' && sch.from.slice(0, 10) <= today.date && today.date < sch.to.slice(0, 10)
  const nowMin = toMin(today.time)
  const nextOf = (columnId: string) => sch.availability.slots.filter((s) => s.columnId === columnId && (!showsToday || toMin(hm(s.startsAt, tz)) >= nowMin)).sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0]
  const columns = sch.columns.map((c, i) => {
    const next = nextOf(c.id)
    const closed = sch.closures.find((x) => x.target !== 'store' && x.targetIds.includes(c.id))
    return { id: c.id, name: c.name, initial: c.name.slice(0, 1), tone: TONES[i % TONES.length], count: sch.entries.filter((e) => e.columnIds[0] === c.id).length, next: closed ? '休み' : next ? `次の空き ${hm(next.startsAt, tz)}` : '空きなし', off: Boolean(closed) }
  })
  const firstNext = columns.map((c) => ({ c, s: nextOf(c.id) })).filter((x) => x.s).sort((a, b) => a.s!.startsAt.localeCompare(b.s!.startsAt))[0]
  const entries: StyleBoard['entries'] = sch.entries.filter((e) => e.columnIds[0]).map((e) => {
    const b = e.booking
    const st = b ? bookingStatus(b, style) : { label: '', tone: 'info' as const }
    const state: StyleBoard['entries'][number]['state'] = !b ? 'booked' : b.visited ? 'done' : b.status === 'seated' || b.attendance === 'visited' ? 'active' : ['requested', 'pending'].includes(b.status) ? 'pending' : 'booked'
    return { id: e.id, columnId: e.columnIds[0], start: hm(e.startsAt, tz), end: hm(e.endsAt, tz), name: b?.name ?? e.title, menu: b ? e.title : '', state, stateLabel: st.label, nominated: b?.designation === 'designated' }
  })
  // 担当・卓の休み（closures）も盤に出す。人の custom_hours は残した営業時間なので休みの箱にしない。
  for (const c of sch.closures) {
    if (c.target === 'store' || c.kind === 'custom_hours' || c.kind === 'open') continue
    for (const id of c.targetIds) {
      if (!columns.some((x) => x.id === id)) continue
      for (const h of c.hours.length ? c.hours : [{ start: pad(from), end: pad(to) }]) entries.push({ id: `${c.id}:${id}:${h.start}`, columnId: id, start: h.start, end: h.end, name: `休み${c.reason ? `（${c.reason}）` : ''}`, menu: '予約は止めています', state: 'off', stateLabel: '', nominated: false })
    }
  }
  const seen = new Set<string>()
  const free = sch.availability.slots.filter((s) => (!showsToday || toMin(hm(s.startsAt, tz)) >= nowMin) && !seen.has(s.columnId) && seen.add(s.columnId)).map((s) => ({ columnId: s.columnId, start: hm(s.startsAt, tz) }))
  return { from: pad(from), to: pad(to), now: showsToday && nowMin >= from && nowMin <= to ? today.time : undefined, next: firstNext ? `${hm(firstNext.s!.startsAt, tz)} ${firstNext.c.name}` : undefined, columns, entries, free }
}

function weekOf(sch: StyleSchedule, now: Date): StyleWeek {
  const tz = sch.timeZone
  const today = parts(now.toISOString(), tz).date
  const days = sch.days.map((d) => {
    const closed = sch.availability.closedDates.includes(d.date)
    const freeCount = sch.availability.slots.filter((s) => s.date === d.date).length
    return { date: d.date, label: dayLabel(d.date), sub: closed ? '定休日' : freeCount ? `空き ${freeCount}` : '満', closed, today: d.date === today }
  })
  const entries = sch.entries.map((e) => ({ id: e.id, day: parts(e.startsAt, tz).date, start: hm(e.startsAt, tz), end: hm(e.endsAt, tz), title: e.title, name: e.booking?.name ?? '' }))
  const seen = new Set<string>()
  const free = sch.availability.slots.filter((s) => !seen.has(s.date) && seen.add(s.date)).map((s) => ({ day: s.date, start: hm(s.startsAt, tz), end: hm(s.endsAt, tz) }))
  const first = days[0]?.date ?? sch.from.slice(0, 10), last = days.at(-1)?.date ?? first
  const jp = (d: string) => { const x = new Date(`${d}T00:00:00Z`); return `${x.getUTCMonth() + 1}月${x.getUTCDate()}日（${WEEK[x.getUTCDay()]}）` }
  return { title: `${jp(first)} 〜 ${jp(last)}`, from: first, to: last, days, entries, free }
}

function monthOf(sch: StyleSchedule, selected: string, now: Date, rows: StyleRow[]): StyleMonth {
  const tz = sch.timeZone
  const today = parts(now.toISOString(), tz).date
  const start = new Date(`${sch.from.slice(0, 10)}T00:00:00Z`)
  const month = start.getUTCMonth()
  const lead = (start.getUTCDay() + 6) % 7
  const cells: StyleMonthDay[] = []
  const cursor = new Date(start); cursor.setUTCDate(cursor.getUTCDate() - lead)
  do {
    for (let i = 0; i < 7; i += 1) {
      const date = cursor.toISOString().slice(0, 10)
      const inMonth = cursor.getUTCMonth() === month
      const d = sch.days.find((x) => x.date === date)
      const closed = sch.availability.closedDates.includes(date)
      cells.push({ date, day: cursor.getUTCDate() === 1 ? `${cursor.getUTCMonth() + 1}/1` : String(cursor.getUTCDate()), inMonth, ...(inMonth ? closed ? { closed } : d && d.bookings > 0 ? { groups: d.bookings, people: d.people } : d ? { empty: true } : {} : {}), today: date === today })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  } while (cursor.getUTCMonth() === month)
  const sel = sch.days.find((d) => d.date === selected)
  const x = new Date(`${selected}T00:00:00Z`)
  return {
    title: `${start.getUTCFullYear()}年${month + 1}月`, days: cells,
    selected: { title: `${x.getUTCMonth() + 1}月${x.getUTCDate()}日（${WEEK[x.getUTCDay()]}）の予約`, total: sel ? `${sel.bookings}組・${sel.people}人` : '0組', moreLabel: `この日の一覧を開く（${sel?.bookings ?? 0}組）`, rows: rows.slice(0, 6).map((r) => ({ time: r.time, name: r.name, sub: r.people ? `${r.people}名` : r.sub ?? '', state: r.state ?? { label: '予約', tone: 'info' } })) },
  }
}

function sideFor(style: IndustryStyle, s: StyleSnapshot, sch: StyleSchedule, href: string): StyleSideCard[] {
  const tz = s.timeZone
  const fresh: StyleSideCard = {
    id: 'new', title: '新着予約（今日入った）', help: NEW_HELP, link: { label: '一覧', href },
    rows: s.newBookings.length ? s.newBookings.slice(0, 3).map((b) => ({ label: `${md(b.startsAt, tz)} ${hm(b.startsAt, tz)}`, value: style === 'restaurant' ? `${b.name}さま ${b.partySize}名` : `${b.name}さま` })) : [{ label: 'まだありません', value: '' }],
  }
  const pay: StyleSideCard = { id: 'pay', title: 'お支払い（今日）', help: '今日の入金はオンライン（Stripe）で受け取った額です。売上（料金×確定数）とは別の数です。', rows: [{ label: '今日の入金・未払い・返金', value: '—' }], action: { label: 'お支払いを見る', icon: 'send' } }
  const cards = [fresh, pay]
  // 口（summary・schedule）から返らないカードは消さずに置き、値は「—」。押すと準備中の窓（口が要る）。
  const waiting = (id: string, title: string, rows: string[], action: string): StyleSideCard => ({ id, title, rows: rows.map((label) => ({ label, value: '—' })), action: { label: action, icon: 'send' } })
  if (style === 'restaurant') cards.push(waiting('care', '今日気をつけること', ['アレルギー', '記念日', '無断歴あり'], 'くわしく見る'), waiting('waitlist', '席のキャンセル待ち', ['待っている人'], '空きを知らせる'))
  if (style === 'salon') cards.push(waiting('rebook', '次回予約がまだ', ['今日来た人のうち次の予約がまだ'], 'LINE で次回を案内する'))
  if (style === 'consult') {
    const byCol = sch.columns.map((c) => { const slots = sch.availability.slots.filter((x) => x.columnId === c.id).sort((a, b) => a.startsAt.localeCompare(b.startsAt)); return slots.length ? { label: c.name, value: `${hm(slots[0].startsAt, tz)}〜${hm(slots.at(-1)!.endsAt, tz)}` } : null }).filter((x): x is { label: string; value: string } => Boolean(x))
    cards.push({ id: 'free', title: '今日の空き', rows: byCol.length ? byCol : [{ label: sch.availability.status === 'available' ? '空きはありません' : '空きを出せません', value: '' }] })
  }
  return cards
}

const LINKS: Record<IndustryStyle, string> = { restaurant: '/restaurant-test/reservations', salon: '/booking/bookings', consult: '/booking/bookings', lesson: '/events' }

export function toToday(style: IndustryStyle, s: StyleSnapshot, sch: StyleSchedule, selected: string, range: DashboardRange, now = new Date()): StyleToday {
  const sorted = sch.entries.slice().sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  const rows = sorted.map((e) => rowOf(style, e, sch, now))
  const dayRows = rows.filter((_, i) => parts(sorted[i].startsAt, sch.timeZone).date === selected)
  return {
    style, asOf: s.asOf, hoursLabel: null,
    staff: sch.columns.filter((c) => c.kind !== 'unassigned').map((c) => ({ id: c.id, name: c.name })),
    kpis: kpisFor(style, s, range),
    alert: null,
    rows, rowsNote: `${rows.length}件中 1〜${rows.length}件`,
    board: boardOf(style, sch, now),
    week: sch.calendarView === 'week' || range === 'week' ? weekOf(sch, now) : null,
    month: range === 'month' ? monthOf(sch, selected, now, dayRows) : null,
    roster: null,
    side: sideFor(style, s, sch, LINKS[style]),
  }
}

/* ── 分析 ── */
type Menu = { menuId: string; bookings: number; visits: number; cancellations: number; estimatedRevenue: number | null; noShowRate?: StyleMetric }
type Staff = { staffId: string; bookings: number; utilization?: StyleMetric; designationRate?: StyleMetric; nextBookingRate?: StyleMetric; returnRate?: StyleMetric }
type Funnel = { route: string; friends?: number; bookings: number; performed: number; won: number }

const TABS: Record<IndustryStyle, [string, string][]> = {
  restaurant: [['reservations', '予約'], ['seats', '来店と席'], ['lost', '取りこぼし'], ['customers', 'お客さま'], ['line', 'LINE の効果'], ['payments', 'お支払い']],
  salon: [['overview', '概要'], ['customers', 'お客さま'], ['staff', styleTerm('salon', 'V29')], ['menu', 'メニュー'], ['route', '経路と LINE'], ['cancel', 'キャンセル'], ['payments', 'お支払い']],
  consult: [['overview', '概要'], ['staff', '担当者'], ['kinds', '面談の種類'], ['funnel', '流入と成果'], ['time', '時間帯'], ['cancel', '取消と無断'], ['payments', 'お支払い']],
  lesson: [['overview', '概要'], ['classes', '出席とクラス'], ['retention', '継続と退会'], ['trial', '体験と入会'], ['teachers', '講師'], ['line', 'LINE の効果'], ['payments', 'お支払い']],
}

const cell = (m?: StyleMetric | number | null) => {
  if (m === undefined || m === null) return { text: '—' }
  if (typeof m === 'number') return { text: m.toLocaleString('ja-JP') }
  const v = metricValue(m)
  return v.value === null ? { text: '—', note: !isRate(m) ? undefined : m.status === 'insufficient_sample' ? '出せない' : m.status === 'unconfigured' ? '未設定' : undefined } : { text: v.valueText ?? `${v.value}${v.unit === '%' ? '%' : ''}` }
}

export function toAnalytics(style: IndustryStyle, s: StyleSnapshot & { analytics: StyleAnalyticsData }, tab: string, names: Record<string, string>): StyleAnalytics {
  const tabs = TABS[style].map(([id, label]) => ({ id, label }))
  if (tab === 'payments') return paymentAnalytics(s, tabs)
  const a = s.analytics
  const pm = (a.periodMetrics as Record<string, StyleMetric> | undefined) ?? s.metrics
  const card = (id: string, key: string, title: string, lower = false) => {
    const v = metricValue(pm[key])
    return { id, title, valueText: v.value === null ? '—' : v.valueText ?? v.value.toLocaleString('ja-JP'), unit: v.valueText ? '' : v.unit, delta: metricDelta(pm[key], s.previous[key], lower) as { text: string; tone: 'up' | 'down' } | null, help: pm[key]?.formula || v.reason || title }
  }
  const cards = style === 'consult'
    ? [card('bookings', 'bookings', '予約'), card('visits', 'visits', '実施'), card('conversion', 'conversionRate', '成約率（90日）'), card('noshow', 'noShowRate', styleTerm(style, 'V21'), true), card('cancel', 'cancelRate', '取消率', true), card('return', 'returnRate', '再来率')]
    : style === 'lesson'
      ? [card('classes', 'classes', 'クラス'), card('visits', 'visits', '出席'), card('fill', 'classroomOccupancy', '教室の埋まり'), card('online', 'onlineOccupancy', 'オンラインの埋まり'), card('trial', 'trialConversion', '体験→入会'), card('noshow', 'noShowRate', styleTerm(style, 'V21'), true)]
      : [card('bookings', 'bookings', '予約数'), card('visits', 'visits', '来店数'), style === 'salon' ? card('revenue', 'estimatedRevenue', '見込み売上') : card('guests', 'guests', '人数'), card('rebook', 'nextBookingRate', '次回予約率'), card('return', 'returnRate', '再来率'), card('noshow', 'noShowRate', '無断キャンセル率', true)]
  const chart = dailyAnalyticsChart(style, a.dailyComparison)
  let table: StyleAnalytics['table']
  if (style === 'consult') {
    const f = (a.funnel as Funnel[] | undefined) ?? []
    table = { title: '流入と成果（友だち→予約→実施→成約）', help: '流入経路ごとの数です。', link: { label: '人を見る', href: '/friends' }, columns: [{ label: '流入経路' }, { label: '友だち', align: 'right' }, { label: '予約', align: 'right' }, { label: '実施', align: 'right' }, { label: '成約', align: 'right' }], rows: f.map((r) => ({ id: r.route, name: r.route === 'unknown' ? '経路が分からない' : r.route, sub: '', cells: [cell(r.friends ?? null), cell(r.bookings), cell(r.performed), cell(r.won)] })) }
  } else if (style === 'salon' || style === 'lesson') {
    const st = (a.staff as Staff[] | undefined) ?? []
    table = { title: styleTerm(style, 'V29'), help: `${styleTerm(style, 'V29')}ごとの数です。率は標本が少ないときは出しません（0% とは違います）。`, columns: [{ label: styleTerm(style, 'V29') }, { label: '予約', align: 'right' }, { label: '稼働率', align: 'right' }, { label: '指名率', align: 'right' }, { label: '次回予約率', align: 'right' }, { label: '再来率', align: 'right' }], rows: st.map((r) => ({ id: r.staffId, name: names[r.staffId] ?? r.staffId, sub: '', cells: [cell(r.bookings), cell(r.utilization), cell(r.designationRate), cell(r.nextBookingRate), cell(r.returnRate)] })) }
  } else {
    const mn = (a.menus as Menu[] | undefined) ?? []
    table = { title: 'コースごとの予約', help: 'コース（メニュー）ごとの数です。', columns: [{ label: 'コース' }, { label: '予約', align: 'right' }, { label: '来店', align: 'right' }, { label: '取消', align: 'right' }, { label: '無断率', align: 'right' }], rows: mn.map((r) => ({ id: r.menuId, name: names[r.menuId] ?? (r.menuId === 'null' || !r.menuId ? '席のみ' : r.menuId), sub: '', cells: [cell(r.bookings), cell(r.visits), cell(r.cancellations), cell(r.noShowRate)] })) }
  }
  const side: StyleAnalytics['side'] = [
    { id: 'pay', title: 'お支払い（この期間）', help: '入金・先払い・返金は決済の口（Stripe）から出します。', rows: [{ label: '入金額・先払いの割合・返金', value: '—' }], action: { label: 'お支払いを見る', icon: 'send' }, note: '売上（料金×確定数）と入金額は別の数です。' },
    { id: 'how', title: '数え方', rows: [], note: style === 'consult' ? '面談日で数えます。予約が入った日で数えるのは「新着予約」だけです。' : '来店日・開催日で数えます。予約が入った日で数えるのは「新着予約」だけです。' },
  ]
  return { tabs, tab: tabs.some((t) => t.id === tab) ? tab : tabs[0].id, cards, chart, table, side }
}

/* ── 表示を変える ── */
const CARD_LABEL: Record<string, string> = {
  'connection-alert': '接続の異常の帯', 'channel-close-alert': '他の予約サイトの枠を閉じる知らせ', 'today-seats': '席', reservations: '予約', customers: 'お客さま', analytics: '分析',
  ledger: '台帳', consultations: '面談', 'results-pending': '結果待ち', staff: '担当者', classes: 'クラス', members: '会員', trials: '体験',
  'getting-started': 'はじめにやること', inbox: '受信箱', deliveries: '配信',
}
const BASE: Record<IndustryStyle, string> = { restaurant: '飲食店', salon: 'サロン', consult: '面談・相談', lesson: '教室・レッスン' }

export function toLayout(style: IndustryStyle, cards: StyleCard[], version: number, defaults?: StyleCard[]): StyleLayout {
  const changed = defaults ? cards.filter((c, i) => defaults[i]?.id !== c.id || defaults[i]?.visible !== c.visible).length : 0
  return { base: BASE[style], changed, version, cards: cards.map((c) => ({ id: c.id, label: CARD_LABEL[c.id] ?? c.id, on: c.visible, locked: c.id.endsWith('-alert') })) }
}

/** 分析の日数 → 口の from/to（to は含まない。選んだ日を最後の日にする）。 */
export function analyticsWindow(date: string, days: number): { from: string; to: string } {
  const end = new Date(`${date}T00:00:00Z`); end.setUTCDate(end.getUTCDate() + 1)
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days)
  return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) }
}
