/*
 * 業種ダッシュボード（B-294・B-304・B-309・B-318。絵 XBkC2）の撮影の見本。
 * 本物の口は API 組4 が作り中。形は apps/web/src/lib/api-style-dashboard.ts と同じ。
 * 使い方のスタイルは PUT /api/account-style { style } で変えられる（撮影で 4 業種を順に撮るため）。
 */

let accountStyle = 'standard'

const b = (label, tone) => ({ label, tone })
const PAY = { store: b('店舗払い', 'neutral'), paid: b('支払い済み', 'success'), unpaid: b('未払い', 'danger'), refunded: b('返金済み', 'neutral'), expired: b('期限切れ', 'warning'), free: b('無料', 'neutral'), pre: b('先払い', 'success') }
const kpi = (id, title, value, unit, delta, detail, link, help, valueText) => ({ id, title, value, unit, delta, detail, link, help, ...(valueText ? { valueText } : {}) })
const up = (text) => ({ text, tone: 'up' })
const down = (text) => ({ text, tone: 'down' })
const side = (id, title, rows, extra = {}) => ({ id, title, rows: rows.map(([label, value, tone]) => ({ label, value, ...(tone ? { tone } : {}) })), ...extra })
const link = (label, href) => ({ label, href })

const NEW_HELP = '予約が入った日で数えます。来店日で数えるほかの数とは別です。'
const PAY_HELP = '今日の入金はオンライン（Stripe）で受け取った額です。売上（料金×確定数）とは別の数です。'

const RESTAURANT = {
  style: 'restaurant', asOf: '2026-10-15T09:42:00.000Z', hoursLabel: '17:00〜22:00',
  staff: [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }, { id: 't3', name: 'T3' }, { id: 'c1', name: 'C1' }, { id: 'c2', name: 'C2' }, { id: 'tr1', name: 'TR1' }, { id: 'pa', name: '個室A' }],
  kpis: [
    kpi('today', '今日の予約', 7, '組・23人', up('+2組'), 'LINE 4・電話 2・他 1', link('一覧', '/restaurant-test/reservations'), '取消・無断・押さえを除く今日の予約です。来店日で数えます。'),
    kpi('waiting', '対応待ち', 3, '件', null, '承認 1・未配席 1 ほか', link('内訳', '/restaurant-test/reservations'), '承認待ち・卓が決まっていない予約など、お店が何かする必要がある数です。'),
    kpi('free', '空席（いま）', 5, '卓', null, '全 9 卓', link('座席表', '/restaurant-test/tables'), '動いている卓のうち、いま予約が重なっていない卓の数です。'),
    kpi('noshow', '無断キャンセル率', 1.2, '%', up('−0.6pt'), '過去30日', link('人・LINE', '/friends'), '無断キャンセル ÷（予約 − 取消 − 押さえ）。過去30日に始まった予約で数えます。'),
    kpi('new', '新着予約', 4, '件', up('+1'), '今日入った予約', link('一覧', '/restaurant-test/reservations'), NEW_HELP),
  ],
  alert: { id: 'close-tasks', title: '他の予約サイトの枠を閉じてください（未対応 2件）', detail: '10/15（木）19:00 の枠が残り 2席 → ホットペッパー・食べログの枠を閉じてください', actions: [{ id: 'open-admin', label: '媒体の管理画面を開く', icon: 'external', href: 'https://example.com/hotpepper' }, { id: 'close', label: '閉じた', icon: 'check', taskId: 'close-task-1' }] },
  rows: [
    { id: 'r1', reservationId: 'r1', time: '17:30', name: '佐藤 健二', sub: '常連・LINE', people: 2, seat: 'T3', course: '席のみ', courseNote: '—', pay: PAY.store, state: b('着席中', 'success'), action: 'undo' },
    { id: 'r2', reservationId: 'r2', time: '18:00', name: '鈴木 美咲', sub: '2回目・LINE', people: 4, seat: 'T5', course: '季節のおまかせ', courseNote: '1人 ¥8,800', pay: PAY.paid, state: b('予約中', 'info'), action: 'visit' },
    { id: 'r3', reservationId: 'r3', time: '18:30', name: '高橋 さくら', sub: '初めて・電話', people: 2, seat: 'C1-2', course: '記念日コース', courseNote: '1人 ¥6,000', pay: PAY.unpaid, state: b('予約中', 'info'), action: 'visit', highlight: true },
    { id: 'r4', reservationId: 'r4', time: '19:00', name: '田中 大輔', sub: '常連・予約サイト', people: 4, seat: 'T7', course: '席のみ', courseNote: '—', pay: PAY.store, state: b('予約中', 'info'), action: 'visit' },
    { id: 'r5', reservationId: 'r5', time: '19:00', name: '伊藤 由紀', sub: '初めて・LINE', people: 6, seat: '個室A', course: '宴会コース', courseNote: '1人 ¥6,500', pay: PAY.paid, state: b('承認待ち', 'warning'), action: 'visit' },
    { id: 'r6', reservationId: 'r6', time: '19:30', name: '渡辺 翔', sub: '3回目・LINE', people: 3, seat: 'T2', course: '季節のおまかせ', courseNote: '1人 ¥8,800', pay: PAY.refunded, state: b('取消', 'neutral'), action: null },
    { id: 'r7', reservationId: 'r7', time: '20:00', name: '山本 彩', sub: '2回目・電話', people: 2, seat: 'C3-4', course: '記念日コース', courseNote: '1人 ¥6,000', pay: PAY.expired, state: b('予約中', 'info'), action: 'visit' },
  ],
  rowsNote: '7件中 1〜7件',
  board: {
    from: '17:00', to: '22:00', now: '18:42', next: '19:30 T1',
    columns: [
      { id: 't1', name: 'T1', initial: 'T1', tone: 'green', count: 1, next: '次の空き 19:30' },
      { id: 't3', name: 'T3', initial: 'T3', tone: 'purple', count: 2, next: '次の空き 20:30' },
      { id: 'c1', name: 'C1-2', initial: 'C', tone: 'blue', count: 1, next: '次の空き 20:30' },
      { id: 'pa', name: '個室A', initial: '個', tone: 'amber', count: 1, next: '19:00〜 貸切' },
    ],
    entries: [
      { id: 'b1', columnId: 't3', start: '17:30', end: '19:00', name: '佐藤 健二', menu: '席のみ', state: 'active', stateLabel: '着席中' },
      { id: 'b2', columnId: 'c1', start: '18:30', end: '20:30', name: '高橋 さくら', menu: '記念日コース', state: 'booked', stateLabel: '予約中', unpaid: true },
      { id: 'b3', columnId: 'pa', start: '19:00', end: '21:30', name: '伊藤 由紀', menu: '宴会コース', state: 'pending', stateLabel: '承認待ち' },
      { id: 'b4', columnId: 't1', start: '17:00', end: '18:30', name: '中村 聡', menu: '席のみ', state: 'done', stateLabel: '来店済み' },
    ],
    free: [{ columnId: 't1', start: '19:30' }],
  },
  week: null,
  month: {
    title: '2026年10月',
    days: (() => {
      const out = []
      const data = { 1: [null, '予約なし'], 2: [9, 25], 3: [14, 40, 'few'], 4: [16, 46, 'few'], 6: [7, 19], 7: [10, 28], 8: [null, '予約なし'], 9: [12, 34], 10: [15, 43, 'few'], 11: [18, 52, 'full'], 13: [9, 25], 14: [null, '予約なし'], 15: [15, 43], 16: [13, 37], 17: [17, 49, 'full'], 18: [18, 52, 'full'], 20: [6, 16], 21: [null, '予約なし'], 22: [9, 25], 23: [12, 34], 24: [16, 46, 'few'], 25: [15, 43, 'few'], 27: [8, 22], 28: [null, '予約なし'], 29: [12, 34], 30: [13, 37], 31: [18, 52, 'full'] }
      out.push({ date: '2026-09-28', day: '28', inMonth: false, closed: true }, { date: '2026-09-29', day: '29', inMonth: false }, { date: '2026-09-30', day: '30', inMonth: false })
      for (let d = 1; d <= 31; d += 1) {
        const date = `2026-10-${String(d).padStart(2, '0')}`
        const monday = [5, 12, 19, 26].includes(d)
        const v = data[d]
        const mark = v?.[2] === 'few' ? b('残りわずか', 'warning') : v?.[2] === 'full' ? b('満席', 'danger') : null
        out.push({ date, day: d === 1 ? '10/1' : String(d), inMonth: true, ...(monday ? { closed: true } : v && v[0] === null ? { empty: true } : v ? { groups: v[0], people: v[1] } : {}), mark, ...(d === 15 ? { today: true } : {}) })
      }
      out.push({ date: '2026-11-01', day: '11/1', inMonth: false })
      return out
    })(),
    selected: { title: '10月15日（木）の予約', total: '15組・43人', moreLabel: 'この日の一覧を開く（15組）', rows: [
      { time: '17:00', name: '高橋 美咲', sub: '3名', state: b('来店', 'success') },
      { time: '17:30', name: '伊藤 さくら', sub: '2名', state: b('予約', 'info') },
      { time: '18:00', name: '佐藤 健', sub: '4名・個室', state: b('予約', 'info') },
      { time: '18:30', name: '山田 花子', sub: '2名', state: b('前日の返事まだ', 'warning') },
      { time: '19:00', name: '鈴木 一郎', sub: '6名・コース', state: b('予約', 'info') },
      { time: '19:30', name: '中村 愛', sub: '2名', state: b('予約', 'info') },
    ] },
  },
  side: [
    side('new', '新着予約（今日入った）', [['10/18（日）19:00', '佐々木さま 2名'], ['10/24（土）18:30', '中村さま 4名'], ['11/02（月）19:30', '小林さま 2名']], { help: NEW_HELP, link: link('一覧', '/restaurant-test/reservations') }),
    side('pay', 'お支払い（今日）', [['今日の入金（オンライン）', '¥42,600'], ['未払い（先払いで未払い）', '2件 ¥24,000', 'danger'], ['返金', '1件 ¥26,400']], { help: PAY_HELP, link: link('一覧', '/restaurant-test/reservations') }),
    side('care', '今日気をつけること', [['アレルギー', '2組（えび・そば）'], ['記念日', '1組（18:30）'], ['無断歴あり', '1人（20:00）']]),
    side('waitlist', '席のキャンセル待ち', [['19:00〜 2名', '佐々木さま'], ['19:30〜 4名', '中村さま']], { action: { label: '空きを知らせる', icon: 'send' } }),
  ],
}

const SALON_BOARD = {
  from: '10:00', to: '20:00', now: '14:05', next: '15:00 高田',
  columns: [
    { id: 's1', name: '高田 誠', initial: '高', tone: 'green', count: 3, next: '次の空き 15:00' },
    { id: 's2', name: '中川 由美', initial: '中', tone: 'purple', count: 3, next: '次の空き 15:30' },
    { id: 's3', name: '森 涼太', initial: '森', tone: 'blue', count: 4, next: '次の空き 16:00' },
    { id: 's4', name: '佐野 直人', initial: '佐', tone: 'amber', count: 2, next: '16:00〜 休み', off: true },
  ],
  entries: [
    { id: 'e1', columnId: 's1', start: '10:00', end: '11:30', name: '青木 真理', menu: 'カット＋カラー', state: 'done', stateLabel: '来店済み', nominated: true },
    { id: 'e2', columnId: 's1', start: '13:00', end: '15:00', name: '加藤 美穂', menu: '縮毛矯正', state: 'active', stateLabel: '施術中', nominated: true },
    { id: 'e3', columnId: 's1', start: '17:00', end: '18:00', name: '山口 恵', menu: 'カット', state: 'booked', stateLabel: '予約中' },
    { id: 'e4', columnId: 's2', start: '11:30', end: '12:30', name: '井上 結衣', menu: 'ネイル', state: 'done', stateLabel: '来店済み' },
    { id: 'e5', columnId: 's2', start: '14:00', end: '15:30', name: '西村 葵', menu: 'ジェルネイル', state: 'active', stateLabel: '施術中' },
    { id: 'e6', columnId: 's2', start: '18:00', end: '19:00', name: '岡田 舞', menu: 'カット', state: 'booked', stateLabel: '予約中', nominated: true },
    { id: 'e7', columnId: 's3', start: '11:00', end: '12:00', name: '原田 恵子', menu: 'カット', state: 'done', stateLabel: '来店済み' },
    { id: 'e8', columnId: 's3', start: '12:30', end: '14:30', name: '佐藤 由佳', menu: 'パーマ', state: 'active', stateLabel: '施術中', nominated: true },
    { id: 'e9', columnId: 's3', start: '15:00', end: '16:00', name: '小松 奈央', menu: 'ヘッドスパ', state: 'pending', stateLabel: '承認待ち' },
    { id: 'e10', columnId: 's3', start: '18:00', end: '19:30', name: '藤田 恵', menu: 'カット＋ケア', state: 'booked', stateLabel: '予約中', nominated: true, unpaid: true },
    { id: 'e11', columnId: 's4', start: '11:00', end: '12:00', name: '吉田 真央', menu: 'カット', state: 'done', stateLabel: '来店済み' },
    { id: 'e12', columnId: 's4', start: '14:30', end: '15:30', name: '木村 彩花', menu: 'カット', state: 'booked', stateLabel: '予約中', unpaid: true, selected: true },
    { id: 'e13', columnId: 's4', start: '16:00', end: '20:00', name: '休み（急な休み）', menu: '予約は止めています', state: 'off', stateLabel: '' },
  ],
  free: [{ columnId: 's1', start: '15:00' }, { columnId: 's2', start: '15:30' }, { columnId: 's3', start: '16:00' }, { columnId: 's4', start: '15:30' }],
}

const SALON = {
  style: 'salon', asOf: '2026-10-15T05:05:00.000Z', hoursLabel: '10:00〜20:00',
  staff: [{ id: 's1', name: '高田 誠' }, { id: 's2', name: '中川 由美' }, { id: 's3', name: '森 涼太' }, { id: 's4', name: '佐野 直人' }],
  kpis: [
    kpi('today', '今日の予約', 12, '件', up('+3件'), '見込み ¥96,800', link('一覧', '/booking/bookings'), '取消を除く今日の予約です。来店日で数えます。見込みは料金×確定数です。'),
    kpi('waiting', '対応待ち', 2, '件', null, '承認 1・印なし 1', link('内訳', '/booking/bookings'), '承認待ち・来店の印が付いていない予約など、お店が何かする必要がある数です。'),
    kpi('rebook', '次回予約率', 38, '%', up('+5pt'), '過去30日', link('人・LINE', '/friends'), '施術のあと24時間以内に次の予約を入れた人の割合です。'),
    kpi('income', '今日の入金', null, '', up('+¥6,200'), '未払い 1件 ¥5,500', link('一覧', '/booking/bookings'), PAY_HELP, '¥32,400'),
    kpi('new', '新着予約', 6, '件', up('+2'), '今日入った予約', link('一覧', '/booking/bookings'), NEW_HELP),
  ],
  alert: { id: 'gcal', title: 'Google カレンダーの同期が止まっています（佐野さん）', detail: '13:10 から読めていません。佐野さんの外の予定が空きとして出ています', actions: [{ id: 'reconnect', label: 'つなぎ直す', icon: 'refresh', href: '/settings' }] },
  rows: [
    { id: 'e1', time: '10:00', name: '青木 真理', sub: '指名・LINE', course: 'カット＋カラー', courseNote: '¥12,000', staff: '高田', pay: PAY.store, state: b('来店済み', 'neutral'), action: 'done' },
    { id: 'e2', time: '13:00', name: '加藤 美穂', sub: '指名・LINE', course: '縮毛矯正', courseNote: '¥18,000', staff: '高田', pay: PAY.paid, state: b('施術中', 'success'), action: null },
    { id: 'e12', time: '14:30', name: '木村 彩花', sub: '初めて・電話', course: 'カット', courseNote: '¥5,500', staff: '佐野', pay: PAY.unpaid, state: b('予約中', 'info'), action: 'visit', highlight: true },
    { id: 'e9', time: '15:00', name: '小松 奈央', sub: '2回目・LINE', course: 'ヘッドスパ', courseNote: '¥6,600', staff: '森', pay: PAY.store, state: b('承認待ち', 'warning'), action: 'visit' },
  ],
  rowsNote: '12件中 1〜4件',
  board: SALON_BOARD,
  week: {
    title: '10月12日（月）〜 10月18日（日）', from: '2026-10-12', to: '2026-10-18',
    days: [
      { date: '2026-10-12', label: '10/12（月）', sub: '空き 3' }, { date: '2026-10-13', label: '10/13（火）', sub: '定休日', closed: true },
      { date: '2026-10-14', label: '10/14（水）', sub: '空き 1' }, { date: '2026-10-15', label: '10/15（木）', sub: '空き 4', today: true },
      { date: '2026-10-16', label: '10/16（金）', sub: '満' }, { date: '2026-10-17', label: '10/17（土）', sub: '満' }, { date: '2026-10-18', label: '10/18（日）', sub: '空き 5' },
    ],
    entries: [
      { id: 'w1', day: '2026-10-12', start: '10:00', end: '11:30', title: 'カット', name: '山田 花子' },
      { id: 'w2', day: '2026-10-12', start: '13:00', end: '15:00', title: 'カラー', name: '高橋 美咲' },
      { id: 'w3', day: '2026-10-14', start: '11:00', end: '12:00', title: 'カット', name: '伊藤 さくら' },
      { id: 'w4', day: '2026-10-14', start: '14:30', end: '17:00', title: 'カット＋カラー', name: '佐藤 健' },
      { id: 'w5', day: '2026-10-15', start: '10:00', end: '11:00', title: 'ヘッドスパ', name: '鈴木 一郎' },
      { id: 'w6', day: '2026-10-15', start: '15:00', end: '16:30', title: 'カット', name: '田中 優' },
      { id: 'w7', day: '2026-10-16', start: '10:00', end: '12:00', title: '縮毛矯正', name: '中村 愛' },
      { id: 'w8', day: '2026-10-16', start: '12:00', end: '13:00', title: 'カット', name: '小林 茜' },
      { id: 'w9', day: '2026-10-16', start: '13:00', end: '16:00', title: 'カラー', name: '木村 彩' },
      { id: 'w10', day: '2026-10-16', start: '16:00', end: '19:00', title: 'パーマ', name: '林 さやか' },
      { id: 'w11', day: '2026-10-17', start: '10:00', end: '11:30', title: 'カット', name: '山口 翔' },
      { id: 'w12', day: '2026-10-17', start: '11:30', end: '13:30', title: 'カラー', name: '松本 結衣' },
      { id: 'w13', day: '2026-10-17', start: '14:00', end: '16:00', title: 'パーマ', name: '井上 葵' },
      { id: 'w14', day: '2026-10-17', start: '16:00', end: '18:00', title: 'カット', name: '清水 蓮' },
      { id: 'w15', day: '2026-10-18', start: '13:00', end: '14:30', title: 'カット', name: '森 健太' },
    ],
    free: [{ day: '2026-10-12', start: '16:00', end: '17:00' }, { day: '2026-10-14', start: '12:00', end: '13:00' }, { day: '2026-10-15', start: '12:00', end: '13:00' }, { day: '2026-10-18', start: '11:00', end: '12:00' }],
  },
  month: null,
  side: [
    side('new', '新着予約（今日入った）', [['10/18（土）11:00', '大野さま カット'], ['10/19（日）14:00', '石井さま カラー'], ['10/22（水）10:30', '森田さま ネイル']], { help: NEW_HELP, link: link('一覧', '/booking/bookings') }),
    side('pay', 'お支払い（今日）', [['今日の入金（オンライン）', '¥32,400'], ['未払い（先払いで未払い）', '1件 ¥5,500', 'danger'], ['返金', '0件']], { help: PAY_HELP, link: link('一覧', '/booking/bookings') }),
    side('rebook', '次回予約がまだ', [['青木 真理さま', 'カット＋カラー'], ['井上 結衣さま', 'ネイル'], ['原田 恵子さま', 'カット']], { help: '今日来た人のうち、次の予約がまだの人です。', link: link('人・LINE', '/friends'), action: { label: 'LINE で次回を案内する', icon: 'line' } }),
  ],
}

const CONSULT = {
  style: 'consult', asOf: '2026-10-15T02:20:00.000Z', hoursLabel: null,
  staff: [{ id: 'yamaguchi', name: '山口' }, { id: 'ishii', name: '石井' }],
  kpis: [
    kpi('meetings', '今日の面談', 6, '件', up('+1件'), 'オンライン 4・対面 2', link('一覧', '/booking/bookings'), '取消を除く今日の面談です。面談日で数えます。'),
    kpi('results', '結果待ち', 3, '件', null, 'いちばん古い 2日前', link('付ける', '/booking/bookings'), '面談が終わって、結果（検討中・成約・見送り）をまだ付けていない数です。'),
    kpi('week', '今週の面談', 18, '件', up('+4件'), '面談日 10/12〜18', link('一覧', '/booking/bookings'), '今週（月〜日）の面談です。面談日で数えます。'),
    kpi('noshow', '無断欠席率', 4.2, '%', up('−1.1pt'), '過去30日', link('人・LINE', '/friends'), '無断欠席 ÷（予約 − 取消）。過去30日の面談で数えます。'),
    kpi('new', '新着予約', 5, '件', down('−2'), '今日入った予約', link('一覧', '/booking/bookings'), NEW_HELP),
  ],
  alert: { id: 'meet-url', title: 'Meet の URL が無い面談があります（1件）', detail: '15:00 小野さま：オンラインなのに Meet の URL が入っていません', actions: [{ id: 'url', label: 'URL を入れる', icon: 'link', href: '/booking/bookings' }] },
  rows: [
    { id: 'm1', time: '10:00', endTime: '〜11:00', name: '原田 修', sub: '転職の初回面談', meet: b('オンライン', 'info'), staff: '山口', pay: PAY.free, state: b('実施', 'success'), action: 'done' },
    { id: 'm2', time: '11:30', endTime: '〜12:30', name: '西村 舞', sub: 'キャリア相談 60分', meet: b('オンライン', 'info'), staff: '山口', pay: PAY.paid, state: b('確定', 'info'), action: 'meet', actionHref: 'https://meet.google.com/' },
    { id: 'm3', time: '13:00', endTime: '〜13:30', name: '大野 健', sub: '保険の見直し', meet: b('対面', 'neutral'), staff: '石井', pay: PAY.free, state: b('確定', 'info'), action: 'place', actionHref: 'https://maps.google.com/' },
    { id: 'm4', time: '14:00', endTime: '〜15:00', name: '小林 綾', sub: '有料相談 60分 ¥5,500', meet: b('オンライン', 'info'), staff: '石井', pay: PAY.unpaid, state: b('確定', 'info'), action: 'meet', actionHref: 'https://meet.google.com/', highlight: true },
    { id: 'm5', time: '15:00', endTime: '〜16:00', name: '小野 拓也', sub: 'キャリア相談 60分', meet: b('オンライン', 'info'), staff: '山口', pay: PAY.expired, state: b('確定', 'info'), action: 'meet' },
    { id: 'm6', time: '16:30', endTime: '〜17:00', name: '松本 葵', sub: '内見の相談', meet: b('対面', 'neutral'), staff: '石井', pay: PAY.refunded, state: b('取消', 'neutral'), action: null },
  ],
  rowsNote: '6件中 1〜6件・前日と1時間前の LINE のリマインドは自動で送ります',
  board: { from: '10:00', to: '18:00', now: '11:20', next: '13:30 山口', columns: [{ id: 'yamaguchi', name: '山口', initial: '山', tone: 'green', count: 3, next: '次の空き 13:30' }, { id: 'ishii', name: '石井', initial: '石', tone: 'blue', count: 3, next: '次の空き 15:00' }], entries: [
    { id: 'm1', columnId: 'yamaguchi', start: '10:00', end: '11:00', name: '原田 修', menu: '転職の初回面談', state: 'done', stateLabel: '実施' },
    { id: 'm2', columnId: 'yamaguchi', start: '11:30', end: '12:30', name: '西村 舞', menu: 'キャリア相談', state: 'booked', stateLabel: '確定' },
    { id: 'm5', columnId: 'yamaguchi', start: '15:00', end: '16:00', name: '小野 拓也', menu: 'キャリア相談', state: 'booked', stateLabel: '確定' },
    { id: 'm3', columnId: 'ishii', start: '13:00', end: '13:30', name: '大野 健', menu: '保険の見直し', state: 'booked', stateLabel: '確定' },
    { id: 'm4', columnId: 'ishii', start: '14:00', end: '15:00', name: '小林 綾', menu: '有料相談', state: 'booked', stateLabel: '確定', unpaid: true },
  ], free: [{ columnId: 'yamaguchi', start: '13:30' }, { columnId: 'ishii', start: '15:00' }] },
  week: null, month: null,
  side: [
    side('prep', '次の面談の準備（11:30 西村さま）', [['過去の面談', '1回（9/28 初回）'], ['回答フォーム', '転職の時期：3か月以内'], ['流入', 'Instagram の広告']], { more: link('詳細を開く', '/booking/bookings') }),
    side('pay', 'お支払い（今日）', [['今日の入金（オンライン）', '¥11,000'], ['未払い（先払いで未払い）', '2件 ¥11,000', 'danger'], ['返金', '1件 ¥5,500']], { help: PAY_HELP, link: link('一覧', '/booking/bookings') }),
    side('free', '今日の空き', [['山口', '16:00〜18:00'], ['石井', '15:00〜16:30']]),
  ],
}

const LESSON = {
  style: 'lesson', asOf: '2026-10-15T08:40:00.000Z', hoursLabel: null,
  staff: [{ id: 'sato', name: '佐藤' }, { id: 'tamura', name: '田村' }, { id: 'inoue', name: '井上' }],
  kpis: [
    kpi('classes', '今日のクラス', 6, '回', up('+1回'), '予約 48・定員 64', link('一覧', '/events'), '今日のクラスの回数です。予約と定員は今日の回の合計です。'),
    kpi('attendance', '出欠待ち', 2, '回', null, '直近7日', link('名簿', '/events'), '終わった回のうち、出席の印をまだ付けていない回の数です。'),
    kpi('fill', '今週の埋まり', 72, '%', up('+6pt'), 'オンラインは 61%', link('一覧', '/events'), '今週の回の予約 ÷ 定員です。教室とオンラインの定員は別に数えます。'),
    kpi('income', '今日の入金', null, '', up('+¥4,400'), '未払い 2人 ¥6,600', link('一覧', '/events'), PAY_HELP, '¥38,500'),
    kpi('new', '新着予約', 9, '件', up('+3'), '今日入った予約', link('一覧', '/events'), NEW_HELP),
  ],
  alert: { id: 'remind', title: '前日のリマインドが届かなかった人がいます（2人）', detail: 'LINE をブロックしているため届きません。電話かメールで連絡してください', actions: [{ id: 'people', label: '人を見る', icon: 'people', href: '/friends' }] },
  rows: [
    { id: 'c1', time: '10:00', endTime: '〜11:00', name: '朝ヨガ（初級）', sub: '教室A・佐藤・教室', booked: 12, capacity: 12, waiting: 3, vacancy: '×', pay: PAY.pre },
    { id: 'c2', time: '12:00', endTime: '〜12:45', name: 'ピラティス', sub: '教室B・田村・オンライン', booked: 6, capacity: 20, waiting: 0, vacancy: '○', pay: PAY.pre },
    { id: 'c3', time: '15:00', endTime: '〜16:00', name: 'キッズダンス', sub: '教室A・井上・教室', booked: 9, capacity: 10, waiting: 1, vacancy: '△', pay: PAY.store },
    { id: 'c4', time: '18:00', endTime: '〜19:00', name: 'リフレッシュヨガ', sub: '教室A・佐藤・教室', booked: 10, capacity: 12, waiting: 0, vacancy: '△', pay: PAY.pre },
    { id: 'c5', time: '19:30', endTime: '〜20:30', name: 'ボディメイク', sub: '教室B・田村・教室＋オンライン', booked: 18, capacity: 30, waiting: 5, vacancy: '△', pay: PAY.pre },
    { id: 'c6', time: '20:45', endTime: '〜21:30', name: '体験ヨガ', sub: '教室A・佐藤・教室', booked: 3, capacity: 6, waiting: 0, vacancy: '○', pay: PAY.store },
  ],
  rowsNote: '6回中 1〜6回・払い方はクラスごとに決めます（先払い＝予約の時に Stripe で支払い／店舗払い＝当日お店で）',
  board: { from: '10:00', to: '22:00', now: '17:40', next: '18:00 佐藤', columns: [{ id: 'sato', name: '佐藤', initial: '佐', tone: 'green', count: 3, next: '次 18:00' }, { id: 'tamura', name: '田村', initial: '田', tone: 'purple', count: 2, next: '次 19:30' }, { id: 'inoue', name: '井上', initial: '井', tone: 'blue', count: 1, next: '今日は終わり' }], entries: [
    { id: 'c1', columnId: 'sato', start: '10:00', end: '11:00', name: '朝ヨガ（初級）', menu: '12／12', state: 'done', stateLabel: '済み' },
    { id: 'c4', columnId: 'sato', start: '18:00', end: '19:00', name: 'リフレッシュヨガ', menu: '10／12', state: 'booked', stateLabel: '予約中' },
    { id: 'c6', columnId: 'sato', start: '20:45', end: '21:30', name: '体験ヨガ', menu: '3／6', state: 'booked', stateLabel: '予約中' },
    { id: 'c2', columnId: 'tamura', start: '12:00', end: '12:45', name: 'ピラティス', menu: '6／20', state: 'done', stateLabel: '済み' },
    { id: 'c5', columnId: 'tamura', start: '19:30', end: '20:30', name: 'ボディメイク', menu: '18／30', state: 'booked', stateLabel: '予約中' },
    { id: 'c3', columnId: 'inoue', start: '15:00', end: '16:00', name: 'キッズダンス', menu: '9／10', state: 'done', stateLabel: '済み' },
  ], free: [] },
  week: null, month: null,
  roster: {
    rowId: 'c4', head: '18:00〜19:00・教室A・講師 佐藤', title: 'リフレッシュヨガ', pay: PAY.pre, meta: '予約 10／定員 12・待ち 0', payLinkCount: 2, more: 'ほか 3人',
    members: [
      { name: '山田 花子', sub: '会員・32回目', pay: PAY.paid, attend: 'done' },
      { name: '鈴木 恵', sub: '会員・8回目', pay: PAY.paid, attend: 'done' },
      { name: '高橋 由美', sub: '体験・初めて', pay: PAY.unpaid, attend: 'button' },
      { name: '伊藤 真央', sub: '会員・15回目', pay: PAY.paid, attend: 'button' },
      { name: '渡辺 さき', sub: '回数券 残り3', pay: PAY.paid, attend: 'button' },
      { name: '中村 葵', sub: '会員・取消', pay: PAY.refunded, attend: 'cancel' },
      { name: '小林 みき', sub: '会員・4回目', pay: PAY.expired, attend: 'button' },
    ],
  },
  side: [
    side('new', '新着予約（今日入った）', [['10/18（日）10:00', '朝ヨガ 大野さま'], ['10/19（月）19:30', 'ボディメイク 石井さま'], ['10/22（木）18:00', 'リフレッシュヨガ 森田さま']], { help: NEW_HELP, link: link('一覧', '/events') }),
    side('pay', 'お支払い（今日）', [['今日の入金（オンライン）', '¥38,500'], ['未払い（先払いで未払い）', '2人 ¥6,600', 'danger'], ['返金', '1件 ¥2,200']], { help: PAY_HELP, link: link('一覧', '/events') }),
  ],
}

const TODAY = { restaurant: RESTAURANT, salon: SALON, consult: CONSULT, lesson: LESSON }

const series = (seed, max) => Array.from({ length: 15 }, (_, i) => {
  const now = Math.round(((Math.sin((i + seed) * 1.7) + 1.2) / 2.4) * max * 0.9 + max * 0.08)
  const prev = Math.round(((Math.cos((i + seed) * 1.3) + 1.2) / 2.4) * max * 0.85 + max * 0.05)
  return { label: `${i * 2 + 1}`, now, prev }
})
const AXIS = ['9/16', '9/23', '9/30', '10/7', '10/15']
const card = (id, title, valueText, unit, delta, help) => ({ id, title, valueText, unit, delta, help })
const cells = (...v) => v.map((x) => (typeof x === 'string' ? { text: x } : x))

const ANALYTICS = {
  restaurant: {
    tabs: [['reservations', '予約'], ['seats', '来店と席'], ['lost', '取りこぼし'], ['customers', 'お客さま'], ['line', 'LINE の効果'], ['payments', 'お支払い']],
    cards: [card('sales', '売上（料金×確定数）', '¥1,284,000', '', up('+8.2%'), '料金×確定した予約の数です。会計の額ではありません。'), card('income', '入金額（オンライン）', '¥612,400', '', up('+12.5%'), 'Stripe で受け取った額です。'), card('ratio', '先払いの割合', '48', '%', up('+4pt'), '確定した予約のうち先払いの割合です。'), card('store', '店舗払い（予定の額）', '¥671,600', '', down('−2.1%'), '当日お店で払う予定の額です。'), card('refund', '返金', '¥36,800', '4件', down('+1件'), '返した額と件数です。'), card('lost', '未払いで流れた枠', '6', '枠', up('−3枠'), '先払いの期限が切れて流れた枠です。')],
    chart: { title: '日ごとの入金（オンライン）・前の30日と比べる', help: '日は来店日で数えます。', ticks: ['¥6万', '¥3万', '0'], axis: AXIS, points: series(1, 60), max: 60 },
    table: { title: 'コースごとのお支払い', help: 'コースごとの払い方と額です。', columns: [{ label: 'コース' }, { label: '払い方' }, { label: '確定', align: 'right' }, { label: '売上（料金×確定数）', align: 'right' }, { label: '入金（オンライン）', align: 'right' }, { label: '返金', align: 'right' }, { label: '未払いで流れた枠', align: 'right' }], rows: [
      { id: 'a', name: '季節のおまかせ', sub: '1人 ¥8,800', cells: cells({ text: '', badge: PAY.pre }, '62', '¥545,600', '¥545,600', '¥26,400', '2') },
      { id: 'b', name: '記念日コース', sub: '1人 ¥6,000', cells: cells({ text: '', badge: PAY.pre }, '18', '¥108,000', '¥66,800', '¥10,400', '4') },
      { id: 'c', name: '宴会コース', sub: '1人 ¥6,500', cells: cells({ text: '', badge: PAY.store }, '40', '¥260,000', '—', '—', '—') },
      { id: 'd', name: '席のみ', sub: '—', cells: cells({ text: '', badge: PAY.store }, '124', '—', '—', '—', '—') },
      { id: 'e', name: '貸切プラン', sub: '1組 ¥120,000', cells: cells({ text: '', badge: PAY.pre }, '2', { text: '—', note: '出せない（5件未満）' }, { text: '—', note: '出せない' }, '—', '0') },
    ] },
    side: [
      { ...side('mix', '払い方の内訳（この30日）', [['オンライン先払い', '48%・82件'], ['店舗払い', '52%・164件']], { help: '確定した予約の払い方です。' }), split: { ratio: 0.48 } },
      side('lost', '未払いで流れた枠', [['10/03（土）19:00', '記念日コース 2名'], ['10/10（土）18:30', '記念日コース 2名'], ['10/12（月）20:00', '季節のおまかせ 4名'], ['ほか 3枠', '']], { help: '先払いの期限が切れて流れた枠です。', link: link('人・LINE', '/friends') }),
      { ...side('how', '数え方', []), note: '日は来店日で数えます。売上は料金×確定数で、会計の額ではありません。入金は Stripe で受け取った額です。' },
    ],
  },
  salon: {
    tabs: [['overview', '概要'], ['customers', 'お客さま'], ['staff', 'スタッフ'], ['menu', 'メニュー'], ['route', '経路と LINE'], ['cancel', 'キャンセル'], ['payments', 'お支払い']],
    cards: [card('bookings', '予約数', '312', '件', up('+6.1%'), '来店日で数えた予約の数です。'), card('visits', '来店数', '284', '件', up('+4.8%'), '来店の印が付いた数です。'), card('sales', '見込み売上', '¥2,486,000', '', up('+7.4%'), '料金×確定数です（見込み）。'), card('income', '入金額（オンライン）', '¥1,102,300', '', up('+11.0%'), 'Stripe で受け取った額です。'), card('rebook', '次回予約率', '38', '%', up('+5pt'), '施術後24時間以内に次の予約を入れた割合です。'), card('noshow', '無断キャンセル率', '1.9', '%', down('+0.3pt'), '無断 ÷（予約 − 取消）です。')],
    chart: { title: '日ごとの来店（2日ずつ）・前の30日と比べる', help: '来店日で数えます。', ticks: ['30', '15', '0'], axis: AXIS, points: series(2, 30), max: 30 },
    table: { title: 'スタッフ', help: 'スタッフごとの数です。', columns: [{ label: 'スタッフ' }, { label: '予約', align: 'right' }, { label: '稼働率', align: 'right' }, { label: '指名率', align: 'right' }, { label: '次回予約率', align: 'right' }, { label: '再来率（90日）', align: 'right' }, { label: '見込み売上', align: 'right' }], note: '「出せない」：その人の新規が 10 人未満のときは率を出しません（0% とは違います）。', rows: [
      { id: 's1', name: '高田 誠', sub: '店長', cells: cells('98', '84%', '62%', '45%', '71%', '¥842,000') },
      { id: 's2', name: '中川 由美', sub: 'スタイリスト', cells: cells('86', '78%', '48%', '39%', '66%', '¥701,500') },
      { id: 's3', name: '森 涼太', sub: 'スタイリスト', cells: cells('74', '69%', '31%', '33%', '58%', '¥552,300') },
      { id: 's4', name: '佐野 直人', sub: '4月から', cells: cells('48', '52%', '12%', '28%', { text: '—', note: '出せない' }, '¥390,200') },
    ] },
    side: [
      { ...side('pay', 'お支払い（この30日）', [['入金額（オンライン）', '¥1,102,300'], ['先払いの割合', '44%'], ['店舗払い（予定の額）', '¥1,383,700'], ['返金', '3件 ¥26,400'], ['未払いで流れた枠', '4枠', 'danger']], { help: PAY_HELP, link: link('一覧', '/booking/bookings') }), note: '見込み売上（料金×確定数）と入金額は別の数です。' },
      { ...side('newcomers', '新規の段（90日）', [], { help: '初めて来た人が何回目まで来たかです。', link: link('人・LINE', '/friends') }), bars: [{ label: '初めて来た', value: '64人', ratio: 1 }, { label: '2回目に来た', value: '29人・45%', ratio: 0.45 }, { label: '3回目に来た', value: '17人・27%', ratio: 0.27 }] },
      side('winback', '呼び戻し待ち', [['いつもの間隔×1.5 を過ぎた', '23人'], ['送った人の 30日の再来', '9人・39%']], { help: 'いつもの来店の間隔を過ぎた人です。', link: link('人・LINE', '/friends') }),
    ],
  },
  consult: {
    tabs: [['overview', '概要'], ['staff', '担当者'], ['kinds', '面談の種類'], ['funnel', '流入と成果'], ['time', '時間帯'], ['cancel', '取消と無断'], ['payments', 'お支払い']],
    cards: [card('bookings', '予約', '96', '件', up('+9.1%'), '面談日で数えた予約です。'), card('done', '実施', '81', '件', up('+6.6%'), '実施した面談です。'), card('won', '成約率（90日）', '18', '%', up('+2pt'), '実施した面談のうち成約の割合です。'), card('noshow', '無断欠席率', '4.2', '%', up('−1.1pt'), '無断 ÷（予約 − 取消）です。'), card('sales', '有料相談の売上', '¥181,500', '', up('+¥22,000'), '料金×確定数です。'), card('income', '入金額（オンライン）', '¥143,000', '', up('+¥16,500'), 'Stripe で受け取った額です。')],
    chart: { title: '実施した面談（2日ずつ・面談日で数える）・前の30日と比べる', help: '面談日で数えます。', ticks: ['10', '5', '0'], axis: AXIS, points: series(3, 10), max: 10 },
    table: { title: '流入と成果（友だち→予約→実施→成約）', help: '流入経路ごとの数です。', link: link('人・LINE', '/friends'), columns: [{ label: '流入経路' }, { label: '友だち', align: 'right' }, { label: '予約', align: 'right' }, { label: '実施', align: 'right' }, { label: '成約', align: 'right' }, { label: '成約率', align: 'right' }, { label: '予約→実施', align: 'right' }], note: '「出せない」：実施が 10 件未満のときは率を出しません（0% とは違います）。', rows: [
      { id: 'a', name: 'Instagram の広告', sub: '広告', cells: cells('412', '38', '33', '7', '21%', '87%') },
      { id: 'b', name: 'LINE の友だち紹介', sub: '紹介コード', cells: cells('126', '24', '22', '5', '23%', '92%') },
      { id: 'c', name: 'Google 検索', sub: 'Web の予約ページ', cells: cells('88', '21', '17', '2', '12%', '81%') },
      { id: 'd', name: '士業の先生から', sub: '紹介', cells: cells('14', '6', '6', '1', { text: '—', note: '出せない' }, { text: '—', note: '出せない' }) },
    ] },
    side: [
      { ...side('pay', 'お支払い（この30日）', [['入金額（オンライン）', '¥143,000'], ['先払いの割合', '79%'], ['店舗払い・無料', '無料 58件・対面払い 4件'], ['返金', '2件 ¥11,000'], ['未払いで流れた枠', '3枠', 'danger']], { help: PAY_HELP, link: link('一覧', '/booking/bookings') }), note: '有料相談の売上（料金×確定数）と入金額は別の数です。' },
      side('staff', '担当者（この30日）', [['山口', '実施 44・無断 3%・成約 21%'], ['石井', '実施 37・無断 5%・成約 14%']], { help: '担当者ごとの数です。' }),
      { ...side('how', '数える日', []), note: '面談日で数えます。予約が入った日で数えるのは「新着予約」だけです。' },
    ],
  },
  lesson: {
    tabs: [['overview', '概要'], ['classes', '出席とクラス'], ['retention', '継続と退会'], ['trial', '体験と入会'], ['teachers', '講師'], ['line', 'LINE の効果'], ['payments', 'お支払い']],
    cards: [card('sales', '売上（料金×確定数）', '¥684,000', '', up('+5.4%'), '料金×確定数です。'), card('income', '入金額（オンライン）', '¥452,100', '', up('+9.8%'), 'Stripe で受け取った額です。'), card('ratio', '先払いの割合', '66', '%', up('+3pt'), '確定した予約のうち先払いの割合です。'), card('store', '店舗払い（予定の額）', '¥231,900', '', down('−1.2%'), '月謝・体験など当日払う予定の額です。'), card('refund', '返金', '¥18,700', '6件', down('+2件'), '返した額と件数です。'), card('lost', '未払いで流れた枠', '9', '枠', up('−4枠'), '先払いの期限が切れて流れた枠です。')],
    chart: { title: '日ごとの入金（オンライン・2日ずつ）・前の30日と比べる', help: 'クラスの日で数えます。', ticks: ['¥4万', '¥2万', '0'], axis: AXIS, points: series(4, 40), max: 40 },
    table: { title: 'クラスごとのお支払い', help: 'クラスごとの払い方と額です。', columns: [{ label: 'クラス' }, { label: '払い方' }, { label: '確定', align: 'right' }, { label: '売上（料金×確定数）', align: 'right' }, { label: '入金（オンライン）', align: 'right' }, { label: '返金', align: 'right' }, { label: '未払いで流れた枠', align: 'right' }], note: '「出せない」：確定が 5 件未満のときは数を出しません（0 とは違います）。', rows: [
      { id: 'a', name: 'リフレッシュヨガ', sub: '1回 ¥2,200', cells: cells({ text: '', badge: PAY.pre }, '118', '¥259,600', '¥251,200', '¥8,800', '3') },
      { id: 'b', name: 'ボディメイク', sub: '1回 ¥2,750', cells: cells({ text: '', badge: PAY.pre }, '64', '¥176,000', '¥165,000', '¥5,500', '4') },
      { id: 'c', name: '朝ヨガ（初級）', sub: '1回 ¥1,650', cells: cells({ text: '', badge: PAY.pre }, '22', '¥36,300', '¥35,900', '¥4,400', '2') },
      { id: 'd', name: 'キッズダンス', sub: '月謝 ¥8,800', cells: cells({ text: '', badge: PAY.store }, '24', '¥211,200', '—', '—', '—') },
      { id: 'e', name: '体験ヨガ', sub: '1回 ¥500', cells: cells({ text: '', badge: PAY.store }, '3', { text: '—', note: '出せない' }, '—', '—', '—') },
    ] },
    side: [
      { ...side('mix', '払い方の内訳（この30日）', [['オンライン先払い', '66%・204件'], ['店舗払い（月謝・体験）', '34%・27件']], { help: '確定した予約の払い方です。' }), split: { ratio: 0.66 } },
      { ...side('trial', '体験→入会（今月）', [], { help: '体験の申し込みから入会までです。', link: link('人・LINE', '/friends') }), bars: [{ label: '体験の申込', value: '24人', ratio: 1 }, { label: '体験に来た', value: '19人・79%', ratio: 0.79 }, { label: '入会した', value: '7人・37%', ratio: 0.37 }] },
      side('lost', '未払いで流れた枠', [['10/12（月）19:30', 'ボディメイク 2人'], ['10/10（土）18:00', 'リフレッシュヨガ 1人'], ['ほか 6枠', '']], { help: '先払いの期限が切れて流れた枠です。', link: link('人・LINE', '/friends') }),
    ],
  },
}

const LAYOUT = {
  restaurant: { base: '飲食店', kpis: ['今日の予約', '対応待ち', '空席（いま）', '無断キャンセル率', '新着予約', '来店予定（人）'], cards: ['新着予約（今日入った）', 'お支払い（今日）', '今日気をつけること', '席のキャンセル待ち', 'Google の口コミ'] },
  salon: { base: 'サロン', kpis: ['今日の予約', '対応待ち', '次回予約率', '今日の入金', '新着予約', '指名率'], cards: ['新着予約（今日入った）', 'お支払い（今日）', '次回予約がまだ', '今日気をつけること'] },
  consult: { base: '面談・相談', kpis: ['今日の面談', '結果待ち', '今週の面談', '無断欠席率', '新着予約', '成約率'], cards: ['次の面談の準備', 'お支払い（今日）', '今日の空き', '結果待ちの一覧'] },
  lesson: { base: '教室・レッスン', kpis: ['今日のクラス', '出欠待ち', '今週の埋まり', '今日の入金', '新着予約', '最近来ていない人'], cards: ['新着予約（今日入った）', 'お支払い（今日）', '体験の人', '最近来ていない人'] },
}

function layoutFor(style) {
  const l = LAYOUT[style] ?? LAYOUT.salon
  return {
    base: l.base, changed: 2, maxKpis: 5,
    kpis: l.kpis.map((label, i) => ({ id: `k${i}`, label, on: i < 5 })),
    cards: l.cards.map((label, i) => ({ id: `c${i}`, label, on: i < l.cards.length - 1 })),
  }
}

/** 業種ダッシュボードの口の見本。当たらなければ null。 */
export function styleDashboardMock(method, pathname, query, body) {
  if (pathname === '/api/account-style') {
    if (method === 'PUT') { if (body?.style) accountStyle = body.style; return { success: true, data: { style: accountStyle } } }
    if (method === 'GET') return { success: true, data: { style: accountStyle } }
  }
  if (!pathname.startsWith('/api/style-dashboard/')) return null
  const style = query.get('style') || 'restaurant'
  if (method === 'GET' && pathname === '/api/style-dashboard/today') {
    const data = TODAY[style]
    return data ? { success: true, data } : null
  }
  if (method === 'GET' && pathname === '/api/style-dashboard/analytics') {
    const a = ANALYTICS[style]
    if (!a) return null
    const tab = query.get('tab') || a.tabs.at(-1)[0]
    return { success: true, data: { ...a, tab, tabs: a.tabs.map(([id, label]) => ({ id, label })) } }
  }
  if (pathname === '/api/style-dashboard/layout') return { success: true, data: layoutFor(style) }
  if (method === 'POST' && pathname === '/api/style-dashboard/closures') return { success: true, data: { id: 'closure-qa', affected: 1 } }
  return null
}
