import type { BookingMenu, BookingStaff } from '@/lib/api'
import type { StyleBoard, StyleRow, StyleSideCard } from '@/v8/style-dashboard/public/sample-parts/index'
import { INITIAL_MENUS, type AccountStyle, fieldsToLayout, type RestaurantFloor, type ReservationBoardResource } from '@line-crm/shared'
import type { DashboardScene, DatetimeSample, SampleKpi, SampleReservation, StyleExperienceScript, TalkMessage } from './script-types'

/*
 * スタイル体験の見本の台本（スタイル × 5 段）。お客さまの名前が「見本 〇〇」の作り物で、写真を使わない。
 * 本線に無い機能（予約でベルの数が上がる知らせ・席が光る・月謝・別の会議の道具・購入の画面など）は書かない。
 * 本線と食い違わないことは script.test.ts が照らす（数の帯の並び・カード・言葉・リッチメニュー）。
 */

const menuButtons=(style:AccountStyle)=>INITIAL_MENUS[style].buttons.map(button=>({...button}))

const kpis = (...values: Array<[SampleKpi['metric'], number | null, string, string?]>): SampleKpi[] =>
  values.map(([metric, value, unit, valueText]) => ({ metric, value, unit, ...(valueText ? { valueText } : {}) }))

/* ── 飲食 ─────────────────────────────────────────── */

const TABLES: ReservationBoardResource[] = [
  { id: 'table-1', label: 'A1', active: true, capacity: 4 },
  { id: 'table-2', label: 'A2', active: true, capacity: 4 },
  { id: 'table-3', label: 'B1', active: true, capacity: 2 },
  { id: 'private', label: '個室', active: true, capacity: 6 },
]

const seat = (id: string, name: string, guests: number, table: string, start: string, end: string, extra: Partial<SampleReservation> = {}): SampleReservation => ({
  id, kind: 'seats', version: 1, scopeId: 'sample-store', day: 1, start, end, status: 'confirmed', customerName: name,
  guestCount: guests, resourceIds: [table], resourceLabel: TABLES.find(t => t.id === table)?.label ?? null, source: 'line',
  courseName: null, note: null, dining: null, holdExpiresAt: null, ...extra,
})

const BOOKED = [
  seat('r-yuta', '見本 ゆうた', 2, 'table-3', '17:30', '19:00'),
  seat('r-haruto', '見本 はると', 6, 'private', '19:00', '21:00', { courseName: '季節のコース' }),
]
const SAKURA = seat('r-sakura', '見本 さくら', 4, 'table-1', '18:00', '20:00', { courseName: 'おまかせコース' })

const FLOOR: RestaurantFloor = {
  id: 'sample-floor', storeId: 'sample-store', name: '1階', width: 360, height: 250, version: 1, outline: [],
  fixtures: [{ id: 'entrance', kind: 'entrance', x: 140, y: 220, width: 80, height: 30 }, { id: 'kitchen', kind: 'kitchen', x: 260, y: 0, width: 100, height: 70 }],
  tables: [
    { id: 'table-1', x: 20, y: 20, width: 100, height: 64, rotation: 0, shape: 'rectangle' },
    { id: 'table-2', x: 140, y: 20, width: 100, height: 64, rotation: 0, shape: 'rectangle' },
    { id: 'table-3', x: 20, y: 120, width: 80, height: 64, rotation: 0, shape: 'circle' },
    { id: 'private', x: 140, y: 110, width: 140, height: 84, rotation: 0, shape: 'rectangle' },
  ],
}

const restaurantRow = (state: StyleRow['state']): StyleRow => ({ id: 'row-sakura', time: '18:00', name: '見本 さくら', people: 4, seat: 'A1', course: 'おまかせコース', state, highlight: true })
const BOOKED_ROWS: StyleRow[] = [
  { id: 'row-yuta', time: '17:30', name: '見本 ゆうた', people: 2, seat: 'B1', state: { label: '予約確定', tone: 'info' } },
  { id: 'row-haruto', time: '19:00', name: '見本 はると', people: 6, seat: '個室', state: { label: '予約確定', tone: 'info' } },
]
const restaurantRows = (state?: StyleRow['state']): StyleRow[] => state ? [BOOKED_ROWS[0], restaurantRow(state), BOOKED_ROWS[1]] : BOOKED_ROWS
const NEW_BOOKING: StyleSideCard = { id: 'new-bookings', title: '新着予約', rows: [{ label: '見本 さくら さま', value: '4名・18:00' }] }
const restaurantKpis = (bookings: number, free: number, utilization: number, newBookings: number) =>
  kpis(['bookings', bookings, '件'], ['attention', 1, '件'], ['freeTables', free, '卓'], ['tableUtilization', utilization, '', `${utilization}%`], ['noShowRate', 2, '', '2%'], ['newBookings', newBookings, '件'])

const RESTAURANT_TALK_REMIND: TalkMessage = { from: 'shop', text: '明日 18:00 に 4名さまのご予約を承っています。お気をつけてお越しください。', time: '18:00' }

/* ── サロン・面談 ─────────────────────────────────────── */

const menu = (id: string, name: string, minutes: number, price: number, description: string | null, sort: number): BookingMenu => ({
  id, name, category_label: null, description, duration_minutes: minutes, buffer_after_minutes: 0, base_price: price, price_mode: price ? 'fixed' : 'free',
  sort_order: sort, is_active: 1, auto_tag_id: null,
})
const staff = (id: string, name: string, role: string, sort: number): BookingStaff => ({
  id, name, display_name: name, role, profile_image_url: null, bio: null, sort_order: sort, is_designation_optional: 1, is_active: 1,
})

const SALON_MENUS = [menu('cut', 'カット', 60, 5500, 'シャンプー・ブローつき', 1), menu('color', 'カット＋カラー', 120, 12000, '根元から毛先まで', 2), menu('treatment', 'トリートメント', 30, 3300, null, 3)]
const SALON_STAFF = [staff('aoi', '見本 あおい', 'スタイリスト', 1), staff('ren', '見本 れん', 'スタイリスト', 2)]

const salonBoard = (state: 'booked' | 'active' | 'done', withNew: boolean): StyleBoard => ({
  from: '10:00', to: '15:00',
  columns: [
    { id: 'aoi', name: '見本 あおい', initial: 'あ', tone: 'green', count: withNew ? 3 : 2, next: '次の空き 14:00' },
    { id: 'ren', name: '見本 れん', initial: 'れ', tone: 'purple', count: 1, next: '次の空き 10:00' },
  ],
  entries: [
    { id: 'b-1', columnId: 'aoi', start: '10:00', end: '11:00', name: '見本 ゆい', menu: 'カット', state: 'done', stateLabel: '来店済み' },
    { id: 'b-2', columnId: 'ren', start: '12:00', end: '13:00', name: '見本 そら', menu: 'トリートメント', state: 'booked', stateLabel: '予約' },
    ...(withNew ? [{ id: 'b-new', columnId: 'aoi', start: '11:30', end: '12:30', name: '見本 みお', menu: 'カット', state, stateLabel: state === 'done' ? '来店済み' : state === 'active' ? '来店中' : '予約', selected: true }] : []),
  ],
  free: [],
})
const salonRow = (state: StyleRow['state']): StyleRow => ({ id: 'row-mio', time: '11:30', name: '見本 みお', course: 'カット', staff: '見本 あおい', state, highlight: true })
const salonKpis = (bookings: number, rebook: number, newBookings: number) =>
  kpis(['bookings', bookings, '件'], ['attention', 0, '件'], ['nextBookingRate', rebook, '', `${rebook}%`], ['paidAmount', null, '', '¥38,500'], ['newBookings', newBookings, '件'])

/** 面談の空き（45 分）。remaining 0 は満席。 */
const slot = (day: number, start: string, remaining = 1): DatetimeSample['slots'][number] => ({
  day, start, end: `${start.slice(0, 2)}:45`, timeZone: 'Asia/Tokyo', capacity: 1, remaining, state: remaining ? 'available' : 'full',
})
const CONSULT_MENU = menu('first', '初めてのご相談', 45, 0, '会い方はオンラインか対面', 1)
const consultBoard = (state: 'booked' | 'pending' | 'done', withNew: boolean): StyleBoard => ({
  from: '10:00', to: '15:00',
  columns: [
    { id: 'kai', name: '見本 かい', initial: 'か', tone: 'blue', count: withNew ? 2 : 1, next: '次の空き 11:00' },
    { id: 'nana', name: '見本 なな', initial: 'な', tone: 'amber', count: 1, next: '次の空き 10:00' },
  ],
  entries: [
    { id: 'c-1', columnId: 'nana', start: '10:30', end: '11:15', name: '見本 りく', menu: '対面', state: 'booked', stateLabel: '予約' },
    ...(withNew ? [{ id: 'c-new', columnId: 'kai', start: '10:00', end: '10:45', name: '見本 ひな', menu: 'オンライン', state, stateLabel: state === 'pending' ? '結果待ち' : state === 'done' ? '実施済み' : '予約', selected: true }] : []),
  ],
  free: [],
})
const consultRow = (state: StyleRow['state']): StyleRow => ({ id: 'row-hina', time: '10:00', endTime: '10:45', name: '見本 ひな', meet: { label: 'オンライン', tone: 'info' }, staff: '見本 かい', state, highlight: true })
const consultKpis = (results: number, week: number, newBookings: number) =>
  kpis(['bookings', 4, '件'], ['resultPending', results, '件'], ['weekBookings', week, '件'], ['noShowRate', 3, '', '3%'], ['newBookings', newBookings, '件'])

/* ── 教室（最小版だけ。クラスの予約の LIFF は描く部分の切り出しの後） ───────────────── */

const lessonKpis = (attendance: number, occupancy: number, newBookings: number) =>
  kpis(['classes', 3, '件'], ['attendancePending', attendance, '件'], ['classroomOccupancy', occupancy, '', `${occupancy}%`], ['paidAmount', null, '', '¥24,000'], ['newBookings', newBookings, '件'])

/* ── 標準・EC（予約は無い。共通のダッシュボード） ───────────────────── */

const STANDARD_FORM = fieldsToLayout([
  { name: 'name', label: 'お名前', type: 'text', required: true },
  { name: 'tel', label: '電話番号', type: 'tel' },
  { name: 'plan', label: 'ご希望', type: 'radio', options: ['資料がほしい', '話を聞きたい'], required: true },
])

const card = (id: string, title: string, rows: StyleSideCard['rows']): StyleSideCard => ({ id, title, rows })
const standardDashboard = (friends: number, unreplied: number, sent: number): DashboardScene => ({
  kpis: kpis(['friends', friends, '人'], ['unreplied', unreplied, '件'], ['deliveries', sent, '件']),
  cards: [
    { id: 'inbox', card: card('inbox', '受信箱', [{ label: '返していない', value: `${unreplied}件` }]) },
    { id: 'deliveries', card: card('deliveries', '配信', [{ label: '今月送った', value: `${sent}件` }]) },
  ],
})
const ecDashboard = (friends: number, orders: number, sent: number): DashboardScene => ({
  kpis: kpis(['friends', friends, '人'], ['orders', orders, '件'], ['deliveries', sent, '件']),
  cards: [
    { id: 'ec-orders', card: card('ec-orders', '注文', [{ label: '今日の注文', value: `${orders}件` }]) },
    { id: 'ec-repeat', card: card('ec-repeat', 'リピート', [{ label: '2回目の購入', value: '12人' }]) },
  ],
})

export const STYLE_EXPERIENCE_SCRIPT: StyleExperienceScript = {
  version: 1,
  order: ['restaurant', 'salon', 'consult', 'lesson', 'standard', 'ec'],
  tabs: [
    { label: '飲食店', styles: ['restaurant'] },
    { label: 'サロン', styles: ['salon'] },
    { label: '面談・相談', styles: ['consult'] },
    { label: '教室・レッスン', styles: ['lesson'] },
    { label: '標準・EC', styles: ['standard', 'ec'] },
  ],
  styles: {
    restaurant: {
      label: '飲食店',
      account: 'musubo - 和食 -',
      can: [
        { text: 'LINE から席・人数・コースの予約を受けられます', basis: 'apps/liff/src/pages/seat' },
        { text: '空いている卓へ割り当て、空席と卓の稼働率を数えます', basis: 'STYLE_DEFAULT_METRIC_IDS.restaurant.freeTables・tableUtilization' },
        { text: '帰ったあとに来店のお礼を送れます（初期セットでは止めた状態で入ります）', basis: "standardStarter('restaurant').reminder-thanks" },
      ],
      steps: [{ key: 'reserve', label: '予約' }, { key: 'accept', label: '受付' }, { key: 'remind', label: 'リマインド' }, { key: 'visit', label: '来店' }, { key: 'thanks', label: 'お礼' }],
      scenes: [
        {
          step: 'reserve', ms: 3500, line: 'お客さまが LINE から人数・日時・コースを選んで予約します',
          phone: { part: 'seat-pick', title: 'ご予約', step: 1, data: { guestCount: 4, date: { day: 1, time: '18:00' }, picked: '18:00', course: 'おまかせコース', times: [{ time: '17:00', available: true }, { time: '17:30', available: true }, { time: '18:00', available: true }, { time: '18:30', available: true }, { time: '19:00', available: false }, { time: '19:30', available: true }] } },
          dashboard: { kpis: restaurantKpis(8, 3, 62, 2), rows: restaurantRows() },
          board: { kind: 'reservation-board', data: { entries: BOOKED, resources: TABLES } },
        },
        {
          step: 'accept', ms: 3500, line: '空いている卓に割り当てられ、台帳に入ります',
          phone: { part: 'booking-facts', title: 'ご予約', step: 2, steps: ['人数・日時・コース', '確認'], data: { heading: 'ご予約を受け付けました', body: '確認の LINE をお送りしました。', done: true, facts: [{ label: '日時', at: { day: 1, time: '18:00' } }, { label: '人数', value: '4名' }, { label: 'コース', value: 'おまかせコース' }, { label: 'お店', value: 'musubo - 和食 -' }, { label: '状態', value: '確定' }] } },
          dashboard: { kpis: restaurantKpis(9, 3, 62, 3), rows: restaurantRows({ label: '予約確定', tone: 'info' }), side: [NEW_BOOKING] },
          board: { kind: 'reservation-board', data: { entries: [...BOOKED, SAKURA], resources: TABLES }, selectedId: 'r-sakura' },
        },
        {
          step: 'remind', ms: 3500, line: '前日に LINE で案内が届きます',
          phone: { part: 'line-talk', data: { caption: '前日', messages: [RESTAURANT_TALK_REMIND], richMenu: true } },
          dashboard: { kpis: restaurantKpis(9, 3, 62, 3), rows: restaurantRows({ label: '予約確定', tone: 'info' }), side: [NEW_BOOKING] },
          board: { kind: 'reservation-board', data: { entries: [...BOOKED, SAKURA], resources: TABLES }, selectedId: 'r-sakura' },
        },
        {
          step: 'visit', ms: 3500, line: '来店を記録すると、席と数がその場で変わります',
          phone: { part: 'line-talk', data: { caption: '前日', messages: [RESTAURANT_TALK_REMIND], richMenu: true } },
          dashboard: { kpis: restaurantKpis(9, 2, 75, 3), rows: restaurantRows({ label: '来店', tone: 'success' }), side: [NEW_BOOKING] },
          board: { kind: 'floor-map', data: { floor: FLOOR, resources: TABLES } },
        },
        {
          step: 'thanks', ms: 4000, line: '帰ったあとにお礼が届きます（初期セットでは止めた状態で入ります）',
          phone: { part: 'line-talk', data: { caption: '当日', messages: [{ from: 'shop', starter: 'reminder-thanks', text: 'ご来店ありがとうございました。またのお越しをお待ちしています。', time: '20:10' }], richMenu: true } },
          dashboard: { kpis: restaurantKpis(9, 2, 75, 3), rows: restaurantRows({ label: '来店', tone: 'success' }), side: [NEW_BOOKING] },
          board: { kind: 'floor-map', data: { floor: FLOOR, resources: TABLES } },
        },
      ],
      richMenu: menuButtons('restaurant'),
    },
    salon: {
      label: 'サロン',
      account: 'Hair Salon musubo',
      can: [
        { text: '担当者とメニューを選んで、LINE から予約を受けられます', basis: 'apps/liff/src/components/menu-list・staff-list' },
        { text: '担当ごとの盤で予定を見て、次回予約率を数えます', basis: 'STYLE_DEFAULT_METRIC_IDS.salon.nextBookingRate・StaffBoard' },
        { text: '前日のリマインドと来店のお礼を送れます（初期セットでは止めた状態で入ります）', basis: "standardStarter('salon').reminder-day-before・reminder-thanks" },
      ],
      steps: [{ key: 'reserve', label: '予約' }, { key: 'accept', label: '受付' }, { key: 'remind', label: 'リマインド' }, { key: 'visit', label: '来店' }, { key: 'thanks', label: 'お礼' }],
      scenes: [
        {
          step: 'reserve', ms: 3500, line: '担当者とメニューを選んで予約します',
          phone: { part: 'booking-staff', data: { menu: SALON_MENUS[0], staff: SALON_STAFF, designationFree: true } },
          dashboard: { kpis: salonKpis(6, 48, 1) },
          board: { kind: 'staff-board', data: salonBoard('booked', false) },
        },
        {
          step: 'accept', ms: 3500, line: '担当の予定に入ります',
          phone: { part: 'booking-facts', title: 'ご予約', step: 4, steps: ['メニュー', '担当', '日時', '確認'], data: { heading: 'ご予約を受け付けました', done: true, facts: [{ label: 'メニュー', value: 'カット' }, { label: '担当', value: '見本 あおい' }, { label: '日時', at: { day: 1, time: '11:30' } }, { label: 'お店', value: 'Hair Salon musubo' }] } },
          dashboard: { kpis: salonKpis(7, 48, 2), side: [{ id: 'new-bookings', title: '新着予約', rows: [{ label: '見本 みお さま', value: 'カット・11:30' }] }] },
          board: { kind: 'staff-board', data: salonBoard('booked', true) },
        },
        {
          step: 'remind', ms: 3500, line: '前日 18:00 に LINE で知らせます',
          phone: { part: 'line-talk', data: { caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日のご予約についてご案内します。お会いできるのを楽しみにしています。', time: '18:00' }], richMenu: true } },
          dashboard: { kpis: salonKpis(7, 48, 2), rows: [salonRow({ label: '予約', tone: 'info' })] },
          board: { kind: 'staff-board', data: salonBoard('booked', true) },
        },
        {
          step: 'visit', ms: 3500, line: '来店を記録します',
          phone: { part: 'line-talk', data: { caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日のご予約についてご案内します。お会いできるのを楽しみにしています。', time: '18:00' }], richMenu: true } },
          dashboard: { kpis: salonKpis(7, 50, 2), rows: [salonRow({ label: '来店', tone: 'success' })] },
          board: { kind: 'staff-board', data: salonBoard('active', true) },
        },
        {
          step: 'thanks', ms: 4000, line: '翌日のお昼にお礼が届きます（初期セットでは止めた状態で入ります）',
          phone: { part: 'line-talk', data: { caption: '翌日 12:00', messages: [{ from: 'shop', starter: 'reminder-thanks', text: '昨日はありがとうございました。またのお越しをお待ちしています。', time: '12:00' }], richMenu: true } },
          dashboard: { kpis: salonKpis(7, 50, 2), rows: [salonRow({ label: '来店', tone: 'success' })] },
          board: { kind: 'staff-board', data: salonBoard('done', true) },
        },
      ],
      richMenu: menuButtons('salon'),
    },
    consult: {
      label: '面談・相談',
      account: 'musubo 相談窓口',
      can: [
        { text: 'LINE から面談の予約を受け、オンラインか対面を選べます', basis: 'apps/liff/src/components/online-meeting-card・MeetingModeChoices' },
        { text: '担当ごとの予定と、結果待ちの数を見られます', basis: 'STYLE_DEFAULT_METRIC_IDS.consult.resultPending・StaffBoard' },
        { text: '前日・当日の案内と面談のお礼を送れます（初期セットでは止めた状態で入ります）', basis: "standardStarter('consult').reminder-*" },
      ],
      steps: [{ key: 'reserve', label: '予約' }, { key: 'accept', label: '受付' }, { key: 'remind', label: 'リマインド' }, { key: 'visit', label: '実施' }, { key: 'thanks', label: 'お礼' }],
      scenes: [
        {
          step: 'reserve', ms: 3500, line: '面談の日時を選んで予約します',
          phone: { part: 'booking-datetime', data: { menu: CONSULT_MENU, staffName: null, closedDates: [], closedWeekdays: [], view: 'list', slots: [slot(1, '10:00'), slot(1, '11:00'), slot(1, '13:00', 0), slot(1, '14:00'), slot(2, '10:00'), slot(3, '13:00'), slot(5, '11:00')] } },
          dashboard: { kpis: consultKpis(1, 5, 1) },
          board: { kind: 'staff-board', data: consultBoard('booked', false) },
        },
        {
          step: 'accept', ms: 3500, line: '担当が決まり、予定に入ります',
          phone: { part: 'booking-facts', title: 'ご予約', step: 4, steps: ['メニュー', '担当', '日時', '確認'], data: { heading: 'ご予約を受け付けました', done: true, facts: [{ label: 'メニュー', value: '初めてのご相談' }, { label: '会い方', value: 'オンライン（Google Meet）' }, { label: '日時', at: { day: 1, time: '10:00' } }, { label: '所要時間', value: '45分' }] } },
          dashboard: { kpis: consultKpis(1, 6, 2), side: [{ id: 'new-bookings', title: '新着予約', rows: [{ label: '見本 ひな さま', value: 'オンライン・10:00' }] }] },
          board: { kind: 'staff-board', data: consultBoard('booked', true) },
        },
        {
          step: 'remind', ms: 3500, line: '前日に LINE で案内が届きます',
          phone: { part: 'line-talk', data: { caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日の面談についてご案内します。会い方・場所は予約の内容をご確認ください。', time: '18:00' }], richMenu: true } },
          dashboard: { kpis: consultKpis(1, 6, 2), rows: [consultRow({ label: '予約', tone: 'info' })] },
          board: { kind: 'staff-board', data: consultBoard('booked', true) },
        },
        {
          step: 'visit', ms: 3500, line: '面談のあと結果を残します',
          phone: { part: 'line-talk', data: { caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日の面談についてご案内します。会い方・場所は予約の内容をご確認ください。', time: '18:00' }], richMenu: true } },
          dashboard: { kpis: consultKpis(2, 6, 2), rows: [consultRow({ label: '結果待ち', tone: 'warning' })] },
          board: { kind: 'staff-board', data: consultBoard('pending', true) },
        },
        {
          step: 'thanks', ms: 4000, line: '翌日にお礼が届きます（初期セットでは止めた状態で入ります）',
          phone: { part: 'line-talk', data: { caption: '翌日 12:00', messages: [{ from: 'shop', starter: 'reminder-thanks', text: '昨日はご参加ありがとうございました。ご質問がありましたら、このトークでお知らせください。', time: '12:00' }], richMenu: true } },
          dashboard: { kpis: consultKpis(1, 6, 2), rows: [consultRow({ label: '実施済み', tone: 'success' })] },
          board: { kind: 'staff-board', data: consultBoard('done', true) },
        },
      ],
      richMenu: menuButtons('consult'),
    },
    lesson: {
      label: '教室・レッスン',
      account: 'musubo ヨガスタジオ',
      can: [
        { text: 'LINE からクラスの予約を受け、回数券を自動で使えます', basis: 'apps/liff/src/pages/event・worker event-entitlements' },
        { text: 'クラスの埋まりと出欠待ちを数え、名簿で出席をつけられます', basis: 'STYLE_DEFAULT_METRIC_IDS.lesson.classroomOccupancy・attendancePending・LessonRoster' },
        { text: 'クラスの前日の案内と参加のお礼を送れます（初期セットでは止めた状態で入ります）', basis: "standardStarter('lesson').reminder-*" },
      ],
      steps: [{ key: 'reserve', label: '予約' }, { key: 'accept', label: '受付' }, { key: 'remind', label: 'リマインド' }, { key: 'visit', label: '出席' }, { key: 'thanks', label: 'お礼' }],
      scenes: [
        { step: 'reserve', ms: 3500, line: 'クラスを選んで予約します', phone: { part: 'line-talk', data: { richMenu: true, caption: '今日', messages: [{ from: 'shop', starter: 'welcome', text: 'こんにちは。レッスンへのお問い合わせありがとうございます。ご希望をお知らせください。', time: '10:00' }] } }, dashboard: { kpis: lessonKpis(2, 70, 1) } },
        { step: 'accept', ms: 3500, line: '回数券が自動で 1 回使われます', phone: { part: 'line-talk', data: { richMenu: true, caption: '今日', messages: [{ from: 'shop', starter: 'welcome', text: 'こんにちは。レッスンへのお問い合わせありがとうございます。ご希望をお知らせください。', time: '10:00' }] } }, dashboard: { kpis: lessonKpis(2, 80, 2) } },
        { step: 'remind', ms: 3500, line: '前日に案内が届きます', phone: { part: 'line-talk', data: { richMenu: true, caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日のクラスについてご案内します。参加方法は申込内容をご確認ください。', time: '18:00' }] } }, dashboard: { kpis: lessonKpis(2, 80, 2) } },
        { step: 'visit', ms: 3500, line: '出席をつけます', phone: { part: 'line-talk', data: { richMenu: true, caption: '前日 18:00', messages: [{ from: 'shop', starter: 'reminder-day-before', text: '明日のクラスについてご案内します。参加方法は申込内容をご確認ください。', time: '18:00' }] } }, dashboard: { kpis: lessonKpis(1, 80, 2) } },
        { step: 'thanks', ms: 4000, line: '翌日にお礼が届きます（初期セットでは止めた状態で入ります）', phone: { part: 'line-talk', data: { richMenu: true, caption: '翌日 12:00', messages: [{ from: 'shop', starter: 'reminder-thanks', text: '昨日はご参加ありがとうございました。ご質問がありましたら、このトークでお知らせください。', time: '12:00' }] } }, dashboard: { kpis: lessonKpis(0, 80, 2) } },
      ],
      richMenu: menuButtons('lesson'),
    },
    standard: {
      label: '標準',
      account: 'ご案内',
      can: [
        { text: '友だち追加で、あいさつとリッチメニューが届きます（初期セット）', basis: "standardStarter('standard').welcome・menu" },
        { text: 'お問い合わせは受信箱でまとめて返せます', basis: "defaultCards('standard').inbox" },
        { text: 'お知らせを友だちへ一斉に配信できます', basis: "defaultCards('standard').deliveries" },
      ],
      steps: [{ key: 'follow', label: '友だち追加' }, { key: 'inbox', label: 'お問い合わせ' }, { key: 'reply', label: '返事' }, { key: 'broadcast', label: 'お知らせ' }, { key: 'form', label: 'お申し込み' }],
      scenes: [
        { step: 'follow', ms: 3500, line: '友だち追加であいさつが届きます', phone: { part: 'line-talk', data: { caption: '今日', richMenu: true, messages: [{ from: 'shop', starter: 'welcome', text: '友だち追加ありがとうございます。お知らせ・お申し込み・お問い合わせは、下のメニューからご確認いただけます。', time: '10:00' }] } }, dashboard: standardDashboard(121, 0, 4), board: { kind: 'cards', data: [card('friends', '友だち', [{ label: '今日増えた', value: '1人' }])] } },
        { step: 'inbox', ms: 3500, line: 'お問い合わせは受信箱でまとめて返します', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'customer', text: '土曜日も開いていますか？', time: '10:05' }] } }, dashboard: standardDashboard(121, 1, 4), board: { kind: 'cards', data: [card('inbox-row', '受信箱', [{ label: '見本 ゆうた', value: '返していない' }])] } },
        { step: 'reply', ms: 3500, line: '担当者がトークで返事します', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'customer', text: '土曜日も開いていますか？', time: '10:05' }, { from: 'shop', text: 'はい、土曜日は 10 時から 17 時まで開いています。', time: '10:12' }] } }, dashboard: standardDashboard(121, 0, 4), board: { kind: 'cards', data: [card('inbox-row', '受信箱', [{ label: '見本 ゆうた', value: '返事済み' }])] } },
        { step: 'broadcast', ms: 3500, line: 'お知らせをまとめて送ります', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'shop', text: '新しいメニュー・商品をご用意しました。詳しくは下のメニューからご覧ください。', time: '12:00' }], richMenu: true } }, dashboard: standardDashboard(121, 0, 5), board: { kind: 'cards', data: [card('delivery-row', '配信', [{ label: '新メニュー・新商品', value: '送信済み' }])] } },
        { step: 'form', ms: 4000, line: 'フォームで申し込みを受けます', phone: { part: 'form', data: { layout: STANDARD_FORM, pageIndex: 0, accountName: 'ご案内', bookingMenus: [], caption: null, title: 'お申し込み' } }, dashboard: standardDashboard(121, 0, 5), board: { kind: 'cards', data: [card('answer-row', '回答', [{ label: '見本 ゆうた', value: '新しい回答' }])] } },
      ],
      richMenu: menuButtons('standard'),
    },
    ec: {
      label: 'EC',
      account: 'オンラインストア',
      can: [
        { text: '友だち追加で、あいさつとリッチメニューが届きます（初期セット）', basis: "standardStarter('ec').welcome・menu" },
        { text: 'お店の EC サイトの注文をつなぐと、注文の数がダッシュボードに出ます', basis: "defaultCards('ec').ec-orders・EcStyleSummary" },
        { text: '購入のお礼や再入荷のお知らせを LINE で送れます', basis: "templateSamples('ec').purchase-thanks・restock" },
      ],
      steps: [{ key: 'follow', label: '友だち追加' }, { key: 'buy', label: '購入' }, { key: 'thanks', label: 'お礼' }, { key: 'broadcast', label: 'お知らせ' }, { key: 'inbox', label: 'お問い合わせ' }],
      scenes: [
        { step: 'follow', ms: 3500, line: '友だち追加であいさつが届きます', phone: { part: 'line-talk', data: { caption: '今日', richMenu: true, messages: [{ from: 'shop', starter: 'welcome', text: '友だち追加ありがとうございます。商品やご利用ガイドは、下のメニューからご覧いただけます。', time: '10:00' }] } }, dashboard: ecDashboard(342, 7, 3), board: { kind: 'cards', data: [card('friends', '友だち', [{ label: '今日増えた', value: '1人' }])] } },
        { step: 'buy', ms: 3500, line: 'お店の EC サイトの注文がつながります', phone: { part: 'line-talk', data: { caption: '今日', richMenu: true, messages: [{ from: 'shop', starter: 'welcome', text: '友だち追加ありがとうございます。商品やご利用ガイドは、下のメニューからご覧いただけます。', time: '10:00' }] } }, dashboard: ecDashboard(342, 8, 3), board: { kind: 'cards', data: [card('order-row', '注文', [{ label: '見本 さくら', value: '1点' }])] } },
        { step: 'thanks', ms: 3500, line: '購入のあとにお礼を送ります', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'shop', text: 'ご購入ありがとうございます。ご注文の内容は、下のメニューのマイページからご確認いただけます。', time: '10:30' }], richMenu: true } }, dashboard: ecDashboard(342, 8, 3), board: { kind: 'cards', data: [card('order-row', '注文', [{ label: '見本 さくら', value: '1点' }])] } },
        { step: 'broadcast', ms: 3500, line: '再入荷を LINE で知らせます', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'shop', text: '入荷のお知らせを希望された商品が再入荷しました。数に限りがあります。', time: '12:00' }], richMenu: true } }, dashboard: ecDashboard(342, 8, 4), board: { kind: 'cards', data: [card('delivery-row', '配信', [{ label: '再入荷のお知らせ', value: '送信済み' }])] } },
        { step: 'inbox', ms: 4000, line: 'お問い合わせは受信箱でまとめて返します', phone: { part: 'line-talk', data: { caption: '今日', messages: [{ from: 'customer', text: '届く日を教えてください。', time: '15:00' }, { from: 'shop', text: 'お問い合わせありがとうございます。内容を確認して、担当からご連絡します。', time: '15:00' }] } }, dashboard: ecDashboard(342, 8, 4), board: { kind: 'cards', data: [card('inbox-row', '受信箱', [{ label: '見本 さくら', value: '返していない' }])] } },
      ],
      richMenu: menuButtons('ec'),
    },
  },
}
