/*
 * 件数の多い見本（速さの測定用）。
 *
 * `VISUAL_QA_LARGE=1` のときだけ mock-api.mjs が先にここを見る。既定の撮影
 * （絵との照合）は何も変わらない。
 *
 * 件数は環境変数で変えられる：
 *   VISUAL_QA_LARGE_CHATS     会話（友だち）の数     既定 10000
 *   VISUAL_QA_LARGE_MESSAGES  1会話の吹き出しの数   既定 3000
 *   VISUAL_QA_LARGE_FRIENDS   友だち一覧の数         既定 10000
 *   VISUAL_QA_LARGE_TAGS      タグの数               既定 2000
 *   VISUAL_QA_LARGE_LOGS      動いた記録・監査の数   既定 5000
 *
 * 画像・スタンプの URL は https の架空の先（large.invalid と LINE のスタンプ
 * 配信元）。測る側（perf-large.mjs）が Playwright で横取りして、遅れて返す。
 *
 * 新着の再現：`POST /__large/push?chat=<会話ID>&n=<件数>` で、その会話の
 * 最新に受信の吹き出しを足す。
 */
import { FRIEND_DETAILS, FRIENDS, TAGS } from './fixtures.mjs'

const num = (name, fallback) => {
  const value = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

export const LARGE_ENABLED = process.env.VISUAL_QA_LARGE === '1'
const CHAT_COUNT = num('VISUAL_QA_LARGE_CHATS', 10000)
const MESSAGE_COUNT = num('VISUAL_QA_LARGE_MESSAGES', 3000)
const FRIEND_COUNT = num('VISUAL_QA_LARGE_FRIENDS', 10000)
const TAG_COUNT = num('VISUAL_QA_LARGE_TAGS', 2000)
const LOG_COUNT = num('VISUAL_QA_LARGE_LOGS', 5000)

const BASE = Date.parse('2026-10-07T03:00:00.000Z')
const iso = (ms) => new Date(ms).toISOString()
const pad = (n, w = 6) => String(n).padStart(w, '0')
const STATUSES = ['unread', 'in_progress', 'resolved', 'resolved']
const OPERATORS = ['operator-kenta', 'operator-masato', null]
const FAMILY = ['山田', '佐藤', '鈴木', '高橋', '田中', '伊藤', '渡辺', '中村', '小林', '加藤']
const GIVEN = ['花子', '太郎', '美咲', '亮', '健太', '結衣', '大輔', 'さくら', '翔', '真央']
const TEXTS = [
  'ありがとうございます。',
  '予約の変更をお願いできますか？来週の火曜日の午後に変えたいです。',
  '商品が届きました！とても良かったです。また注文します。',
  'お世話になっております。先日注文した定期便について、次回のお届け日を一週間ほど後ろにずらすことはできますでしょうか。旅行で家を空けるため、受け取りができません。お手数ですがご確認をお願いします。',
  '了解です',
  'こんにちは😊',
  '支払い方法を変えたいのですが、どこから変更できますか？',
]

const nameOf = (i) => `${FAMILY[i % FAMILY.length]} ${GIVEN[Math.floor(i / FAMILY.length) % GIVEN.length]} ${i}`

/* 会話の一覧。並びは本物と同じ「未読が先 → 新しい順 → ID の降順」。 */
const pushed = new Map() // chatId -> 足した吹き出し
const CHATS = Array.from({ length: CHAT_COUNT }, (_, i) => {
  const at = iso(BASE - i * 61_000)
  const status = STATUSES[i % STATUSES.length]
  return {
    id: `lchat-${pad(i)}`,
    friendId: `lfriend-${pad(i)}`,
    friendName: nameOf(i),
    friendPictureUrl: null,
    operatorId: OPERATORS[i % OPERATORS.length],
    status,
    notes: null,
    revision: 1,
    isUnread: i % 3 === 0,
    lastMessageAt: at,
    lastMessageContent: TEXTS[i % TEXTS.length],
    lastMessageDirection: 'incoming',
    lastMessageType: 'text',
    sendMode: 'line',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: at,
  }
})
const chatOrder = (a, b) => (Number(b.isUnread) - Number(a.isUnread))
  || b.lastMessageAt.localeCompare(a.lastMessageAt)
  || b.id.localeCompare(a.id)
CHATS.sort(chatOrder)
const CHAT_BY_ID = new Map(CHATS.map((c) => [c.id, c]))

function listChats(query) {
  const status = query.get('status')
  const operatorId = query.get('operatorId')
  const unreadOnly = query.get('unreadOnly') === 'true' || query.get('unreadOnly') === '1'
  const q = (query.get('q') ?? '').trim()
  const limit = Math.min(200, Math.max(1, Number.parseInt(query.get('limit') ?? '200', 10) || 200))
  const beforeAt = query.get('beforeAt')
  const beforeId = query.get('beforeId')
  const beforeUnreadRaw = query.get('beforeUnread')
  let rows = CHATS
  if (status) rows = rows.filter((c) => c.status === status)
  if (operatorId) rows = rows.filter((c) => (operatorId === 'unassigned' ? c.operatorId === null : c.operatorId === operatorId))
  if (unreadOnly) rows = rows.filter((c) => c.isUnread)
  if (q) rows = rows.filter((c) => c.friendName.includes(q) || c.lastMessageContent.includes(q))
  if (beforeAt && beforeId) {
    const cursor = { isUnread: beforeUnreadRaw === '1', lastMessageAt: beforeAt, id: beforeId }
    rows = rows.filter((c) => chatOrder(cursor, c) < 0)
  }
  return rows.slice(0, limit)
}

/* 吹き出し。k=0 がいちばん古い。種類を混ぜる（画像・スタンプ・カード型）。 */
function messageAt(chatIndex, k) {
  const id = `lmsg-${pad(chatIndex)}-${pad(k, 5)}`
  const createdAt = iso(BASE - chatIndex * 61_000 - (MESSAGE_COUNT - k) * 17 * 60_000)
  const direction = (k * 7 + chatIndex) % 5 < 2 ? 'outgoing' : 'incoming'
  const base = {
    id, friendId: `lfriend-${pad(chatIndex)}`, direction, createdAt, eventAt: createdAt,
    source: direction === 'outgoing' ? 'manual' : null, scenarioName: null,
    sentByStaffName: direction === 'outgoing' ? 'Kenta' : null, isUnsent: false, quoted: null,
  }
  if (k % 10 === 3) {
    return { ...base, messageType: 'image', content: JSON.stringify({ originalContentUrl: `https://large.invalid/img/${k % 40}.png`, previewImageUrl: `https://large.invalid/img/${k % 40}.png` }) }
  }
  if (k % 15 === 7) {
    return { ...base, messageType: 'sticker', content: JSON.stringify({ type: 'sticker', packageId: '446', stickerId: String(1988 + (k % 20)), stickerUrl: `https://stickershop.line-scdn.net/stickershop/v1/sticker/${1988 + (k % 20)}/iPhone/sticker@2x.png`, fallback: '[スタンプ]' }) }
  }
  if (k % 25 === 11) {
    return {
      ...base,
      direction: 'outgoing',
      messageType: 'flex',
      content: JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [
        { type: 'text', text: `ご予約の確認 #${k}`, weight: 'bold', size: 'md' },
        { type: 'text', text: '10月12日（日）14:00〜 カット＋カラー', wrap: true, size: 'sm' },
      ] }, footer: { type: 'box', layout: 'vertical', contents: [{ type: 'button', style: 'primary', action: { type: 'uri', label: '予約を確認する', uri: 'https://example.com/r' } }] } }),
    }
  }
  if (k % 40 === 19) return { ...base, source: 'scenario', direction: 'outgoing', scenarioName: '友だち挨拶', messageType: 'text', content: 'シナリオ開始' }
  return { ...base, messageType: 'text', content: `${TEXTS[(k + chatIndex) % TEXTS.length]}（${k}）` }
}

function chatDetail(chatId, query) {
  const row = CHAT_BY_ID.get(chatId)
  if (!row) return null
  const chatIndex = Number.parseInt(chatId.slice('lchat-'.length), 10)
  const limit = Math.min(1000, Math.max(1, Number.parseInt(query.get('limit') ?? '100', 10) || 100))
  const beforeAt = query.get('beforeAt')
  const beforeId = query.get('beforeId')
  const extra = pushed.get(chatId) ?? []
  // 新しい方から数えて、カーソルより古いものを limit+1 件。
  const total = MESSAGE_COUNT + extra.length
  const at = (n) => (n < MESSAGE_COUNT ? messageAt(chatIndex, n) : extra[n - MESSAGE_COUNT])
  let end = total // 排他
  if (beforeAt && beforeId) {
    // 吹き出しは時刻順・ID 順にそろえて作っているので、位置で探せる。
    let lo = 0; let hi = total
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const m = at(mid)
      const before = m.createdAt < beforeAt || (m.createdAt === beforeAt && m.id < beforeId)
      if (before) lo = mid + 1
      else hi = mid
    }
    end = lo
  }
  const start = Math.max(0, end - limit)
  const messages = []
  for (let n = start; n < end; n += 1) messages.push(at(n))
  return {
    ...row,
    friendRealName: null,
    isAttention: false,
    hasMoreMessages: start > 0,
    messages,
  }
}

function pushMessages(query) {
  const chatId = query.get('chat') ?? CHATS[0].id
  const n = Math.min(500, Math.max(1, Number.parseInt(query.get('n') ?? '1', 10) || 1))
  const row = CHAT_BY_ID.get(chatId)
  if (!row) return { success: false, error: 'not found' }
  const list = pushed.get(chatId) ?? []
  for (let i = 0; i < n; i += 1) {
    const now = iso(Math.max(Date.now(), BASE + 1000 + list.length * 1000))
    list.push({
      id: `lpush-${pad(list.length, 6)}`, friendId: row.friendId, direction: 'incoming', messageType: 'text',
      content: `新しく届いたメッセージ ${list.length + 1}`, createdAt: now, eventAt: now,
      source: null, scenarioName: null, sentByStaffName: null, isUnsent: false, quoted: null,
    })
  }
  pushed.set(chatId, list)
  row.lastMessageAt = list[list.length - 1].createdAt
  row.lastMessageContent = list[list.length - 1].content
  return { success: true, data: { chatId, total: MESSAGE_COUNT + list.length } }
}

/* 友だち・タグ・記録 */
const FRIEND_ROWS = Array.from({ length: FRIEND_COUNT }, (_, i) => {
  const src = FRIENDS[i % FRIENDS.length]
  return { ...src, id: `lfriend-${pad(i)}`, lineUserId: `U-large-${i}`, displayName: nameOf(i) }
})
const TAG_ROWS = Array.from({ length: TAG_COUNT }, (_, i) => {
  const src = TAGS[i % TAGS.length]
  return { ...src, id: `ltag-${pad(i, 5)}`, name: `${src.name.replace(/\s*\d+$/, '')} ${i + 1}` }
})
const AUDIT_ROWS = Array.from({ length: LOG_COUNT }, (_, i) => ({
  id: `laudit-${pad(i)}`,
  occurredAt: iso(BASE - i * 300_000),
  category: ['message', 'settings', 'friend', 'staff'][i % 4],
  action: ['send', 'update', 'tag_add', 'login'][i % 4],
  result: i % 17 === 0 ? 'failure' : 'success',
  actorId: 'operator-kenta',
  actorName: 'Kenta',
  targetLabel: nameOf(i),
  summary: `記録 ${i + 1}`,
  attention: i % 17 === 0,
}))

const FRIEND_DETAIL_TEMPLATE = FRIEND_DETAILS['friend-1']

export function largeBody(method, pathname, query) {
  if (!LARGE_ENABLED) return undefined
  if (pathname === '/__large/push' && method === 'POST') return pushMessages(query)
  if (pathname === '/__large/info') {
    return { success: true, data: { chats: CHAT_COUNT, messages: MESSAGE_COUNT, friends: FRIEND_COUNT, tags: TAG_COUNT, logs: LOG_COUNT } }
  }
  if (method === 'GET' && pathname === '/api/chats') return { success: true, data: listChats(query) }
  const chat = pathname.match(/^\/api\/chats\/(lchat-\d+)$/)
  if (chat && method === 'GET') {
    const data = chatDetail(chat[1], query)
    return data ? { success: true, data } : undefined
  }
  if (method === 'POST' && /^\/api\/chats\/lchat-\d+\/read$/.test(pathname)) return { success: true, data: null }
  if (method === 'GET' && /^\/api\/chats\/lchat-\d+\/scheduled$/.test(pathname)) return { success: true, data: [] }
  const friend = pathname.match(/^\/api\/friends\/(lfriend-\d+)$/)
  if (friend && method === 'GET') {
    const i = Number.parseInt(friend[1].slice('lfriend-'.length), 10)
    return { success: true, data: { ...FRIEND_DETAIL_TEMPLATE, id: friend[1], displayName: nameOf(i), systemDisplayName: nameOf(i), realName: null } }
  }
  if (method === 'GET' && pathname === '/api/friends') {
    const search = (query.get('search') ?? '').trim()
    const limit = Math.max(1, Number.parseInt(query.get('limit') ?? '20', 10) || 20)
    const offset = Math.max(0, Number.parseInt(query.get('offset') ?? '0', 10) || 0)
    const items = search ? FRIEND_ROWS.filter((f) => f.displayName.includes(search)) : FRIEND_ROWS
    return { success: true, data: { items: items.slice(offset, offset + limit), total: items.length, page: Math.floor(offset / limit) + 1, limit } }
  }
  if (method === 'GET' && pathname === '/api/tags') return { success: true, data: TAG_ROWS }
  if (method === 'GET' && pathname === '/api/audit/events') {
    const limit = Math.max(1, Number.parseInt(query.get('limit') ?? '20', 10) || 20)
    const offset = Math.max(0, Number.parseInt(query.get('offset') ?? '0', 10) || 0)
    return {
      success: true,
      data: {
        items: AUDIT_ROWS.slice(offset, offset + limit),
        summary: { total: AUDIT_ROWS.length, attention: AUDIT_ROWS.filter((r) => r.attention).length, failures: AUDIT_ROWS.filter((r) => r.result === 'failure').length },
        pagination: { total: AUDIT_ROWS.length, limit, offset },
      },
    }
  }
  return undefined
}
