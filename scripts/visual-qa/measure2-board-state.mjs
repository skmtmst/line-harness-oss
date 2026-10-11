/** 固定した絵の板IDで、撮影時に開く画面を選ぶ。製品の保存・権限は変えない。 */
import { RICH_MENU_GROUPS, RICH_MENU_GROUP_DETAILS, RICH_MENU_FOLDERS, TAGS, TAG_GROUPS, TEMPLATES, TEMPLATE_FOLDERS, FORMS, FORM_FOLDERS, AUTO_REPLIES, NEN_PHOTO_PUBLICATIONS, BROADCASTS, BROADCAST_FOLDERS, BOOKING_REQUESTS, BOOKING_STAFF, EC_NOTIFICATION_SETTINGS, LINE_NOTIFICATION_DEFINITIONS, LINE_NOTIFICATION_SEND_COUNTS } from './fixtures.mjs'

export const REFERENCE_REVISION = '2026-10-11 16:11 JST'

const createTemplate = (kind) => ({
  url: '/hq/templates',
  click: [kind, 'テンプレートを作る'],
})

// 普通の一覧の撮影だけを4行にする。削除確認で使う未使用の下書きは共通見本に残す。
const richMenuItems = RICH_MENU_GROUPS.filter(group => group.id !== 'rich-menu-safe').map(group => ({
  ...group,
  ...(group.id === 'rmg-gold' ? { audienceCount: 182 } : {}),
  // 10/5の予約が撮影日を過ぎても、予約状態の絵を再現する。
  ...(group.id === 'rmg-autumn' ? { publishingAt: `${new Date().getUTCFullYear() + 1}-10-05T00:00:00.000+09:00` } : {}),
})).sort((a, b) => a.targetingPriority - b.targetingPriority)
const richMenuApi = [
  { match: 'GET /api/rich-menu-groups$', body: { success: true, data: {
    items: richMenuItems, total: richMenuItems.length, limit: 20,
    sort: [{ field: 'targetingPriority', direction: 'asc' }, { field: 'createdAt', direction: 'asc' }, { field: 'id', direction: 'asc' }],
    facets: { total: richMenuItems.length, published: richMenuItems.filter(group => group.status === 'published').length, targeting: richMenuItems.filter(group => group.targetingEnabled).length, folderCounts: Object.fromEntries(richMenuItems.reduce((counts, group) => {
      const id = group.folderId ?? '__unfiled__'; counts.set(id, (counts.get(id) ?? 0) + 1); return counts
    }, new Map())) },
  } } },
  { match: 'GET /api/tags$', body: { success: true, data: TAGS.map(tag => tag.id === 'tag-0' ? { ...tag, name: 'ゴールド会員' } : tag) } },
]

// 統括の普通の一覧も、店と同じ既存の見本を配った状態で撮る。
// GET の撮影だけ。共通APIの作成・編集・詳細の見本は上書きしない。
const distribution = (count) => ({
  distributed_account_count: count,
  distributed_account_names: ['本店', '渋谷店', 'イベント'].slice(0, count),
  distributed_account_more: 0, outdated_account_count: 0, current_version: 1,
})
const hqRow = (row, type, count) => ({
  id: `measure2-hq-${type}-${row.id}`, name: row.name, description: row.description ?? null,
  template_type: type, folder_id: row.folderId ?? row.groupId ?? null,
  revision: 1, updated_at: row.updatedAt ?? row.createdAt,
  ...distribution(count),
})
const hqTemplates = TEMPLATES.slice(0, 6).map((row, index) => ({
  ...hqRow(row, 'template', [3, 2, 3, 0, 0, 1][index]), kind: 'message',
  this_month_sent_count: row.monthlySendCount, content_summary: row.messageType,
  outdated_account_count: row.hasDraft && row.publishedAt ? 1 : 0,
}))
const assignmentWords = { ec: 'EC 連携', line_login: 'LINE ログイン', form: '回答フォーム', ec_purchase: 'EC 購入', manual: '手動', birthday: '誕生日のきまり' }
const hqTags = TAGS.slice(0, 6).map((row, index) => ({
  ...hqRow(row, 'tag', index === 5 ? 0 : 3), friend_count: row.friendCount,
  manual_assignment_allowed: row.assignSource === 'manual', assignment_method: assignmentWords[row.assignSource],
}))
const hqForms = FORMS.slice(0, 5).map((row, index) => ({
  ...hqRow(row, 'form', [3, 2, 0, 3, 0][index]),
}))
const hqMenus = richMenuItems.map((row) => ({
  ...hqRow(row, 'rich_menu', row.status === 'published' ? 3 : 0),
  display_order: row.targetingPriority, display_audience: row.targetingEnabled ? 'タグ「ゴールド会員」' : row.isDefaultForAll ? 'すべての友だち' : 'まだ決めていない',
  tap_count: row.monthlyStats?.taps ?? 0,
}))
const hqListProfile = (url, rows, folders) => ({ url, api: [
  { match: 'GET /api/hq/templates$', body: { success: true, data: rows, stats: {
    thisMonthSentCount: rows.every(row => row.this_month_sent_count != null) ? rows.reduce((sum, row) => sum + row.this_month_sent_count, 0) : null,
    outdatedTemplateCount: rows.filter(row => row.outdated_account_count > 0).length,
  } } },
  { match: 'GET /api/hq/templates/folders$', body: { success: true, data: folders.map(folder => ({ id: folder.id, name: folder.name, color: folder.color, revision: 1 })) } },
] })

// 統括にも店と同じ普通の配信を1アカウントへ送った見本を置く。
// 承認待ち・送信枠など口の無い機能はこの見本で作らない。
const hqBroadcasts = BROADCASTS.map(row => {
  const state = row.status === 'draft' ? 'prepared' : row.status === 'failed' ? 'failed' : row.status === 'sent' ? 'sent' : 'scheduled'
  return {
    id: `measure2-hq-${row.id}`, title: row.title, status: state, version: 1, scheduledAt: row.scheduledAt,
    input: { requestId: `measure2-hq-${row.id}`, title: row.title, messageType: 'text', messageContent: `${row.title}の本文です。`,
      accountIds: ['visual-qa-account'], accountTagIds: [], excludedAccountIds: [], audience: { kind: 'all' }, scheduledAt: row.scheduledAt, folderId: row.folderId },
    targets: [{ accountId: 'visual-qa-account', accountName: '本店', audienceCount: row.totalCount, remaining: 20000,
      connected: true, paused: false, blockedReasons: [], excluded: false, broadcastId: state === 'sent' || state === 'failed' ? row.id : null,
      status: state, totalCount: row.totalCount, successCount: row.successCount, version: 1, retryableCount: 0, stopped: false }],
  }
})
const cancellationEvent = event => event === 'ec.subscription.payment_failed' ? 'ec.subscription.cancelled' : event

export const BOARD_STATE_PROFILES = {
  wxIQ7: { url: '/rich-menus/connections?id=rmg-1', api: [
    // 編集中の下書きとは別に、公開した3ページのつながりを撮る。
    { match: 'GET /api/rich-menu-groups/rmg-1$', body: { success: true, data: {
      ...RICH_MENU_GROUP_DETAILS['rmg-1'], status: 'published',
      pages: RICH_MENU_GROUP_DETAILS['rmg-1'].pages.map(page => ({ ...page, lineRichmenuId: page.lineRichmenuId ?? `measure2-line-${page.id}` })),
    } } },
  ] },
  g3iDs: { url: '/line-notifications', api: [
    // 「定期便を止めた」は決済失敗ではなく解約。設定・定義・集計の鍵をそろえる。
    { match: 'GET /api/ec-commerce/settings$', body: { success: true, data: EC_NOTIFICATION_SETTINGS.map(row => ({ ...row, eventType: cancellationEvent(row.eventType) })) } },
    { match: 'GET /api/line-notifications/customer-definitions$', body: { success: true, data: LINE_NOTIFICATION_DEFINITIONS.map(row => ({ ...row, key: cancellationEvent(row.key), sourceEventType: cancellationEvent(row.sourceEventType) })) } },
    { match: 'GET /api/line-notifications/send-counts$', body: { success: true, data: { ...LINE_NOTIFICATION_SEND_COUNTS,
      byEventType: LINE_NOTIFICATION_SEND_COUNTS.byEventType.map(row => ({ ...row, eventType: cancellationEvent(row.eventType) })),
    } } },
  ] },
  GcyTr: { url: '/booking/bookings?view=day&date=2026-09-03&status=all', api: [
    { match: 'GET /api/booking/admin/requests$', body: {
      requests: BOOKING_REQUESTS.filter(row => row.starts_at.startsWith('2026-09-03')).map(row => ({
        ...row, staff_id: BOOKING_STAFF.find(staff => staff.display_name === row.staff_name)?.id ?? null,
      })), total: 5, limit: 100, offset: 0,
    } },
  ] },
  SyQA1: { url: '/nen-members?tab=publications', api: [
    { match: 'GET /api/nen-members/photos/publications$', body: { success: true, data: {
      ...NEN_PHOTO_PUBLICATIONS,
      // 撮る一覧も同じ8枚。掲載順と写真ごとの名前の同意だけを再現する。
      // 累計を30日の回数へ置き換えない。
      items: ['pub-3', 'pub-2', 'pub-1', 'pub-4', 'pub-5', 'pub-6', 'pub-7', 'pub-8'].map(id => {
        const photo = NEN_PHOTO_PUBLICATIONS.items.find(item => item.id === id)
        return { ...photo, hide_owner_name: id === 'pub-2' ? 0 : 1 }
      }),
    } } },
  ] },
  uE9gf: { url: '/auto-replies', api: [
    { match: 'GET /api/auto-replies$', body: { success: true, data: AUTO_REPLIES.map(rule => rule.id === 'ar-2'
      ? { ...rule, actions: [...rule.actions, { actionType: 'notify_staff' }] } : rule) } },
  ] },
  U4Eep0: { url: '/hq/broadcasts', api: [
    { match: 'GET /api/hq/broadcasts$', body: { success: true, data: hqBroadcasts } },
    { match: 'GET /api/hq/broadcasts/folders$', body: { success: true, data: BROADCAST_FOLDERS.map(folder => ({
      id: folder.id, name: folder.name, color: folder.color, revision: 1, item_count: hqBroadcasts.filter(run => run.input.folderId === folder.id).length,
    })) } },
  ] },
  i0Ao0R: hqListProfile('/hq/templates', hqTemplates, TEMPLATE_FOLDERS),
  DzdC3: hqListProfile('/hq/friend-attributes', hqTags, TAG_GROUPS),
  wZPua: hqListProfile('/hq/form-submissions', hqForms, FORM_FOLDERS),
  noVq4: hqListProfile('/hq/rich-menus', hqMenus, RICH_MENU_FOLDERS),
  rZEGN: { url: '/rich-menus', api: richMenuApi },
  HfK0O: createTemplate('メッセージ'),
  SDSsr: createTemplate('カルーセル'),
  IY3nx: createTemplate('質問'),
  C3qMCz: createTemplate('クーポン'),
  Fkv3w: createTemplate('リサーチ'),
  g8d6ai: createTemplate('リッチメッセージ'),
  Ni0V8: createTemplate('リッチビデオ'),
  pQ4fH: { url: '/hq/templates?item=visual-hq-tpl-thanks&mode=detail' },
}

export function applyBoardStateProfiles(map) {
  const result = structuredClone(map)
  if (!result.boards || typeof result.boards !== 'object') throw new Error('boards を持つ対応表を指定してください')
  for (const [id, profile] of Object.entries(BOARD_STATE_PROFILES)) {
    const entry = result.boards[id]
    if (!entry) continue
    // 閲覧のみ・失敗・手動の再現条件がある板を、作成画面の見本で上書きしない。
    if (entry.state?.manual || entry.state?.role === 'viewer' || entry.kind === '閲覧のみ' || entry.state?.click) {
      throw new Error(`${id}: 既存の状態指定と撮影の指定が重なっています`)
    }
    entry.url = profile.url
    if (profile.click) entry.state = { ...entry.state, click: [...profile.click] }
    if (profile.api) entry.state = { ...entry.state, api: [...profile.api, ...(Array.isArray(entry.state?.api) ? entry.state.api : entry.state?.api ? [entry.state.api] : [])] }
  }
  return result
}

export const FORM_STATE_PROFILES = {
  u5MM7: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit' },
  scJcP: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=after' },
  xRPdo: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&tab=appearance' },
  N4T9mO: { url: '/hq/form-submissions?item=visual-hq-tpl-form&mode=edit&page=2' },
}
