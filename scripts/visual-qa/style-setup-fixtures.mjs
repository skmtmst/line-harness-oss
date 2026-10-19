/*
 * （はじめの質問・スタイルの初期セット・対応が要るもの）の見本。形の正本は apps/web/src/lib/api-styles.ts。
 * 絵：VHp7p の Bdfxm（7 / 11 済み・警告 1・あとで 2・止めている自動の送信 3）・oKSsG・cAaGY・J6647・Kyf8U。
 */
export const STYLE_SETUP_STATE = {
  style: 'restaurant', styleSelected: true, styleMode: 'configured', version: 3,
  answers: {
    image: { mode: 'configured', value: 'keep' }, booking: { mode: 'configured', value: true }, approval: { mode: 'configured', value: 'automatic' },
    payment: { mode: 'later' }, reminders: { mode: 'configured', value: true }, stamps: { mode: 'later' }, coupons: { mode: 'configured', value: true }, content: { mode: 'configured', value: true },
  },
}
export const STYLE_QUESTION_KEYS = ['image', 'booking', 'approval', 'payment', 'reminders', 'stamps', 'coupons', 'tickets', 'outcome', 'content']
const STYLE_SETUP_ITEMS = [
  { key: 'menu', kind: 'rich_menu', name: '飲食店の見本', buttons: [{ label: '予約する', feature: 'booking' }, { label: '予約の確認', feature: 'booking' }, { label: 'クーポン', feature: 'coupons' }, { label: 'メニュー', feature: 'contact' }, { label: 'スタンプ', feature: 'stamps' }, { label: 'お問い合わせ', feature: 'contact' }] },
  { key: 'sample-reservation-confirm', kind: 'template', name: '【見本】予約の確認' }, { key: 'sample-thanks', kind: 'template', name: '【見本】来店のお礼' }, { key: 'sample-day', kind: 'template', name: '【見本】当日のご案内' },
  { key: 'sample-review', kind: 'template', name: '【見本】口コミのお願い' }, { key: 'sample-closed', kind: 'template', name: '【見本】臨時休業のお知らせ' },
  { key: 'booking-lunch', kind: 'booking_menu', feature: 'booking', name: 'ランチコース' }, { key: 'booking-dinner', kind: 'booking_menu', feature: 'booking', name: 'ディナーコース' }, { key: 'booking-seat', kind: 'booking_menu', feature: 'booking', name: '席のみ' },
  { key: 'reminder', kind: 'automation', feature: 'reminders', name: '予約確定のご案内', text: 'ご予約ありがとうございます。日時をご確認ください。' },
  { key: 'reminder-day-before', kind: 'automation', feature: 'reminders', name: '前日のお知らせ', text: '予約の前日 18:00 に LINE で送る' },
  { key: 'reminder-day', kind: 'automation', feature: 'reminders', name: '当日のお知らせ', text: '来店の 2 時間前に送る' },
  { key: 'dashboard', kind: 'dashboard', name: '今日のお店' },
]
/* 公開APIが返す初期セットの由来・更新候補・開始可否を持つ。 */
const STYLE_SETUP_STATES = STYLE_SETUP_ITEMS.map((item, i) => ({
  target_id: `starter-${i}`, key: item.key, name: item.name,
  isSample: true, setId: 'starter-set-restaurant', setVersion: 2,
  pendingUpdate: null, currentSnapshot: null, definition: null,
  activationAllowed: item.kind === 'automation' || item.kind === 'booking_menu',
  requiresActivation: item.kind === 'automation' || item.kind === 'booking_menu',
  kind: item.kind, is_sample: 1,
  status: item.kind === 'automation' ? 'draft' : item.kind === 'booking_menu' ? 'inactive' : 'active',
  draftRevision: item.kind === 'automation' ? `draft-${i}` : null,
}))
const STYLE_SETUP_WARNINGS = { count: 1, items: [{ feature: 'stamps', areaId: 'area-e', groupId: 'rm-sample-restaurant', href: '/visit-stamps', customerState: 'preparing' }], pending: [{ key: 'payment', href: '/booking/settings?tab=payment', mode: 'later' }, { key: 'stamps', href: '/visit-stamps', mode: 'later' }], manual: [] }
const HQ_STARTER_SETS = [
  { id: 'starter-set-restaurant', style: 'restaurant', name: '飲食店向けの初期セット', version: 2, accountCount: 12, updatedAt: '2026-10-14T03:00:00.000Z', updatedBy: 'stf-1', autoInsert: true, definition: { items: STYLE_SETUP_ITEMS } },
  ...[['salon', 8], ['consult', 3], ['lesson', 5], ['ec', 2], ['standard', 4]].map(([style, accountCount]) => ({ id: `starter-set-${style}`, style, name: `${style}の初期セット`, version: 1, accountCount, updatedAt: '2026-10-10T03:00:00.000Z', updatedBy: 'stf-2', autoInsert: true, definition: { items: STYLE_SETUP_ITEMS.filter((item) => item.kind !== 'booking_menu') } })),
]
const STYLE_TEMPLATE_SAMPLES = [
  ['sample-reservation-confirm', '予約の確認', 'common'], ['sample-reminder', '前日のリマインド', 'common'], ['sample-day', '当日の案内', 'common'], ['sample-thanks', '来店のお礼', 'common'],
  ['sample-review', '口コミのお願い', 'common'], ['sample-closed', '臨時休業のお知らせ', 'common'], ['sample-course', 'コースの予約確認', 'restaurant'], ['sample-seat-ready', '席の準備ができました', 'restaurant'], ['sample-banquet', '宴会の事前確認', 'restaurant'],
].map(([key, name, category]) => ({ key, name, category, text: `{{name}} 様\n${name}のご案内です。{{account.name}}`, placeholders: [{ token: '{{name}}', label: 'お名前', requiresConfiguration: false }, { token: '{{account.name}}', label: '店名', requiresConfiguration: false }], preparation: '日時・場所などは送る前に共通情報へ入れてください。', starterItem: { key, kind: 'template', name: `【見本】${name}`, text: name }, hqDefinition: { schemaVersion: 1, template: { id: key, name, category, messageType: 'text', messageContent: name, carouselActionsJson: null, carouselTapLimitMode: 'none', carouselTapLimitText: null, questionJson: null, questionStatus: 'draft' }, media: [] } }))
const HQ_STYLE_ATTENTION = {
  asOf: '2026-10-15T08:30:00.000Z',
  items: [
    { accountId: 'visual-qa-account', name: '然 渋谷店', style: 'restaurant', counts: { unhandledChats: 9, pendingBookings: 3, unpaid: 2, connections: 1, stoppedDeliveries: 0 } },
    { accountId: 'visual-qa-account-2', name: '然 新宿店', style: 'restaurant', counts: { unhandledChats: 6, pendingBookings: 2, unpaid: 0, connections: 0, stoppedDeliveries: 1 } },
    { accountId: 'visual-qa-account-3', name: 'Hair Salon 然 表参道', style: 'salon', counts: { unhandledChats: 4, pendingBookings: 0, unpaid: 2, connections: 0, stoppedDeliveries: 0 } },
    { accountId: 'visual-qa-account-4', name: '然 相談窓口', style: 'consult', counts: { unhandledChats: 3, pendingBookings: 2, unpaid: 0, connections: 0, stoppedDeliveries: 0 } },
    { accountId: 'visual-qa-account-5', name: '然 ヨガスタジオ', style: 'lesson', counts: { unhandledChats: 1, pendingBookings: 0, unpaid: 0, connections: 0, stoppedDeliveries: 1 } },
  ].map((item) => ({ ...item, details: { unhandledChats: [{ id: 'c', href: '/chats' }], pendingBookings: [{ id: 'b', href: '/booking/bookings' }], unpaid: [{ id: 'p', href: '/booking/settings?tab=payment' }], connections: [{ id: 'l', href: '/line-accounts' }], stoppedDeliveries: [{ id: 'd', href: '/broadcasts' }] } })),
}
export function styleSetupRead(method, pathname, query) {
  if (method !== 'GET') return null
  if (pathname === '/api/dashboard/style/resources') return { success: true, data: { items: [{ id: 'rm-1', name: '秋のメニュー', kind: 'rich_menu' }, { id: 'page-1', name: '秋のメニューの画像', kind: 'image' }] } }
  if (/^\/api\/dashboard\/style\/menus\/[^/]+$/.test(pathname)) return { success: true, data: { id: pathname.split('/').pop(), name: 'ランチコース', version: 1, meetingMode: 'in_person', location: null } }
  if (pathname === '/api/dashboard/style/warnings') return { success: true, data: STYLE_SETUP_WARNINGS }
  if (pathname === '/api/dashboard/style/starter-set') return { success: true, data: { id: `starter-set-${query.get('style') ?? 'restaurant'}`, version: 2, autoInsert: true, definition: { items: STYLE_SETUP_ITEMS } } }
  if (pathname === '/api/dashboard/style/starter-items') return { success: true, data: { items: STYLE_SETUP_STATES } }
  if (pathname === '/api/hq/style-starter-sets') return { success: true, data: HQ_STARTER_SETS }
  if (pathname === '/api/hq/style-attention') return { success: true, data: HQ_STYLE_ATTENTION }
  if (pathname === '/api/hq/style-template-samples' || pathname === '/api/dashboard/style/template-samples') return { success: true, data: { style: query.get('style') ?? 'restaurant', items: STYLE_TEMPLATE_SAMPLES } }
  return null
}
export function styleSetupWrite(method, pathname) {
  if (method === 'POST' && pathname === '/api/dashboard/style/activate') return { complete: true, items: [] }
  if (method === 'PUT' && /^\/api\/hq\/style-starter-sets\/[^/]+$/.test(pathname)) return { id: 'starter-set-restaurant', version: 3, autoInsert: true }
  return null
}
