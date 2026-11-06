import { defaultRestaurantReservationForm } from '../../packages/shared/dist/restaurant-reservation-form.js'

export const RESTAURANT_LINE_FLOWS = [
    /* 種別は本物（rt_line_flows の flow_type）と同じ。文は ★V8 LINE来店フォロー（xLpnS）の絵どおり。 */
    { id: 'flow-1', store_id: null, flow_type: 'reservation_24h', title: '明日 19:00 にお待ちしております', body: 'ご予約内容の確認・変更はこちらから。アレルギーがあればお知らせください。', timing_minutes: -1440, is_enabled: 1, delivery_mode: 'preview_only' },
    { id: 'flow-2', store_id: null, flow_type: 'reservation_2h', title: '本日のご来店をお待ちしております', body: 'お店までの道順と、駐車場のご案内です。', timing_minutes: -120, is_enabled: 1, delivery_mode: 'preview_only' },
    { id: 'flow-3', store_id: null, flow_type: 'post_visit', title: '本日はありがとうございました', body: '次回使えるデザートのサービス券をお送りします。', timing_minutes: 180, is_enabled: 0, delivery_mode: 'preview_only' },
    { id: 'flow-4', store_id: null, flow_type: 'review_request', title: 'よろしければご感想をお聞かせください', body: 'Google の口コミに書いていただけるとうれしいです。', timing_minutes: 1440, is_enabled: 0, delivery_mode: 'preview_only' },
    /* 融合の板 n9vvGx の「会員証」「ワンタップ予約」（常設）。 */
    { id: 'flow-5', store_id: null, flow_type: 'member_card', title: 'デジタル会員証', body: 'スタンプカードと来店履歴を見られます。', timing_minutes: null, is_enabled: 0, delivery_mode: 'preview_only' },
    { id: 'flow-6', store_id: null, flow_type: 'one_tap_booking', title: '前回と同じ内容で予約', body: '店舗・人数・コースを前回と同じにして予約できます。', timing_minutes: null, is_enabled: 0, delivery_mode: 'preview_only' },
  ]

const initialRows = [
  ['reservation_created', 0, 'ご予約ありがとうございます。当日のご来店をお待ちしています。'],
  ['reservation_24h', -1440], ['reservation_2h', -120], ['post_visit', 180], ['review_request', 1440],
  ['waitlist_invited', 0, 'お席のご用意ができました。ご案内します。'],
  ['anniversary_before', -10080, 'もうすぐ記念日ですね。お祝いのご用意はいかがですか。'],
]

export function restaurantFollowupRead(method, pathname) {
  if (method !== 'GET') return null
  const match = /^\/api\/restaurant-test\/followups\/([^/]+)(\/(?:engines|reservation-form|review-history))?$/.exec(pathname)
  if (!match) return null
  if (match[2] === '/review-history') return { success: true, data: { invitations: [] } }
  if (match[2] === '/reservation-form') return { success: true, data: { version: 0, definition: defaultRestaurantReservationForm() } }
  const storeId = decodeURIComponent(match[1])
  const rows = initialRows.map(([trigger, offset, sample]) => {
    const flow = RESTAURANT_LINE_FLOWS.find(row => row.flow_type === trigger)
    return { store_id: storeId, trigger, initial_key: trigger, step_id: null, version: 1,
      default_offset_minutes: offset, initial_message: flow ? `${flow.title}\n${flow.body}` : sample }
  })
  if (match[2] === '/engines') return { success: true, data: {
    engines: [], testRecipient: null,
    legacyContents: rows.map(row => ({ trigger: row.trigger, content: {
      timing: { mode: 'countdown', offsetMinutes: row.default_offset_minutes },
      messageParts: [{ messageType: 'text', messageContent: row.initial_message }],
    } })),
  } }
  return { success: true, data: { template: null, rows, bindings: [], jobs: [], editor: 'common_scenario' } }
}
