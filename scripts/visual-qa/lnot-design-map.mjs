/**
 * lnot の板に描かれた件数・行数を撮るための状態。
 * 本番と同じ返事の形で、失敗3件・運用者5件・宛先と一致するスタッフ一覧を用意する。
 * 操作・権限・保存の条件は変えない。きっかけは実際に登録されているものだけ。
 * node scripts/visual-qa/lnot-design-map.mjs <共通の対応表.json> <出力.json>
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { LINE_NOTIFICATION_DELIVERIES, OPERATOR_NOTIFICATION_RULES, OPERATOR_NOTIFICATION_RECIPIENTS, STAFF_MEMBERS } from './fixtures.mjs'

const [source, output] = process.argv.slice(2)
if (!source || !output) throw new Error('共通の対応表と出力先を指定してください。')
const map = JSON.parse(readFileSync(source, 'utf8'))
const failed = LINE_NOTIFICATION_DELIVERIES.items.filter(item => item.status === 'failed')
map.boards.DrwMm.state = {
  ...map.boards.DrwMm.state,
  api: { match: 'GET /api/line-notifications/deliveries', body: {
    success: true,
    data: { ...LINE_NOTIFICATION_DELIVERIES, items: failed, summary: { accepted: 0, pending: 0, excluded: 0, failed: failed.length } },
    pagination: { total: failed.length, limit: 20, offset: 0 },
  } },
}
const samples = [
  { name: '新しい予約が入りました', eventType: 'booking_created', occurredToday: 18, importance: 'important', schedule: 'business_hours', scheduleLabel: '営業時間だけ', recipientLabel: 'スタッフ（3人）' },
  { name: 'フォームに回答がありました', eventType: 'form_submitted', occurredToday: 4, importance: 'normal', schedule: 'anytime', scheduleLabel: 'いつでも', recipientLabel: 'スタッフ（2人）' },
  { name: '配信の完了', eventType: 'broadcast_completed', occurredToday: 3, importance: 'urgent', schedule: 'anytime', scheduleLabel: 'いつでも', recipientLabel: '店長（1人）' },
  { name: 'リンクが開けなくなりました', eventType: 'manual_link_broken', occurredToday: 2, importance: 'normal', schedule: 'morning_digest', scheduleLabel: '翌朝にまとめる', recipientLabel: 'スタッフ（3人）' },
  { name: '情報の期限', eventType: 'common_var_expiry', occurredToday: 0, importance: 'normal', schedule: 'business_hours', scheduleLabel: '営業時間だけ', recipientLabel: '店長（1人）' },
]
const recipientGroups = [
  ['staff-owner', 'staff-support', 'staff-store'], ['staff-owner', 'staff-support'],
  ['staff-owner'], ['staff-owner', 'staff-support', 'staff-part'], ['staff-owner'],
]
const rules = samples.map((sample, index) => {
  const original = OPERATOR_NOTIFICATION_RULES[index]
  const recipientIds = recipientGroups[index]
  const lineRecipientCount = recipientIds.filter(id => id !== 'staff-store').length
  return { ...original, name: sample.name, eventType: sample.eventType, occurredToday: sample.occurredToday, recipientCount: recipientIds.length, lineRecipientCount, acceptedToday: sample.occurredToday * lineRecipientCount,
    status: index === 4 ? 'stopped' : 'published', isActive: index !== 4,
    conditions: { ...original.conditions, recipientIds, importance: sample.importance, schedule: sample.schedule, scheduleLabel: sample.scheduleLabel, recipientLabel: sample.recipientLabel },
  }
})
map.boards.u8xibp.state = {
  ...map.boards.u8xibp.state,
  api: { match: 'GET /api/line-notifications/operator-rules', body: { success: true, data: {
    items: rules, summary: { total: 5, published: 4, stopped: 1, missingRecipients: 0, recipients: 3, acceptedToday: rules.reduce((total, rule) => total + rule.acceptedToday, 0), excludedToday: 0 },
  } } },
}
// 確認窓の役割はスタッフ一覧から引くので、宛先とスタッフのIDを一致させる。
map.boards.sDXNy.state = {
  ...map.boards.sDXNy.state,
  api: { match: 'GET /api/staff', body: { success: true, data: OPERATOR_NOTIFICATION_RECIPIENTS.items.map((recipient, index) => ({
    ...STAFF_MEMBERS[index % STAFF_MEMBERS.length], id: recipient.id, name: recipient.name,
    role: index === 0 ? 'owner' : 'staff',
  })) } },
}
writeFileSync(output, `${JSON.stringify(map, null, 2)}\n`)
