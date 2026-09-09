/*
 * #673（点検 #617 N-033）の実挙動試験。
 *
 * 実行:
 *   NEXT_PUBLIC_API_URL=http://127.0.0.1:8800 pnpm --filter web build
 *   npx playwright test apps/web/src/app/chats/inbox-673-behavior.spec.mjs
 *
 * 静的出力したReact画面を本物のChromiumで描画し、routerのsearch paramsと
 * ブラウザ上のAPI応答を操作する。page.tsxの文字列は検査しない。
 */
import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../../..', 'out')

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

let server
let baseUrl

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  if (!existsSync(resolve(OUT, 'chats.html'))) {
    throw new Error('apps/web/out/chats.html がありません。先に web build を実行してください。')
  }
  server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    const relative = pathname === '/'
      ? 'index.html'
      : pathname.includes('.')
        ? pathname.slice(1)
        : `${pathname.slice(1)}.html`
    const file = resolve(OUT, relative)
    if (file !== OUT && !file.startsWith(`${OUT}${sep}`)) {
      response.writeHead(400).end('Bad request')
      return
    }
    if (!existsSync(file)) {
      response.writeHead(404).end('Not found')
      return
    }
    response.writeHead(200, {
      'Content-Type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    createReadStream(file).pipe(response)
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('試験用サーバーを起動できませんでした')
  baseUrl = `http://127.0.0.1:${address.port}`
})

test.afterAll(async () => {
  if (!server) return
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
})

function chatDetail(id, name, message = `${name}の会話`) {
  return {
    id,
    friendId: id,
    friendName: name,
    friendRealName: null,
    friendPictureUrl: null,
    operatorId: null,
    status: 'unread',
    notes: null,
    revision: 1,
    lastMessageAt: '2026-09-09T00:00:00.000Z',
    createdAt: '2026-09-01T00:00:00.000Z',
    messages: [{
      id: `message-${id}`,
      direction: 'incoming',
      messageType: 'text',
      content: message,
      source: 'line',
      originKind: null,
      sentByStaffId: null,
      sentByStaffName: null,
      scenarioName: null,
      createdAt: '2026-09-09T00:00:00.000Z',
    }],
    hasMoreMessages: false,
  }
}

function chatListItem(id, name) {
  return {
    id,
    friendId: id,
    friendName: name,
    friendPictureUrl: null,
    operatorId: null,
    status: 'unread',
    notes: null,
    revision: 1,
    lastMessageAt: '2026-09-09T00:00:00.000Z',
    lastMessageContent: `${name}の一覧メッセージ`,
    lastMessageDirection: 'incoming',
    lastMessageType: 'text',
    isUnread: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z',
  }
}

async function fulfillJson(route, body, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function prepareInbox(page, options = {}) {
  const detailCalls = []
  const details = options.details ?? {}
  await page.addInitScript(() => {
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path === '/api/auth/session') {
      await fulfillJson(route, {
        success: true,
        data: { id: 'staff-1', name: '試験担当', email: 'test@example.invalid', role: 'owner' },
        csrfToken: 'test-csrf',
      })
      return
    }
    if (path === '/api/line-accounts') {
      await fulfillJson(route, { success: true, data: [{
        id: 'visual-qa-account', channelId: 'channel-1', name: '試験アカウント',
        isActive: true, country: 'JP', role: 'owner', displayOrder: 1,
      }] })
      return
    }
    if (path === '/api/settings/features') {
      await fulfillJson(route, { success: true, data: {
        features: {}, sidebarOrder: null, sidebarItemOrder: null,
        parentChildMode: false, specializedFeatureKeys: [], version: 1,
      } })
      return
    }
    if (path === '/api/chats') {
      await fulfillJson(route, {
        success: true,
        data: [chatListItem('manual-chat', '手動選択 次郎')],
      })
      return
    }
    if (path === '/api/chats/stats') {
      await fulfillJson(route, { success: true, data: {
        total: 1, unread: 1, inProgress: 0, onHold: 0, resolved: 0,
        oldestUnansweredMinutes: 10, assigneeUnread: [],
      } })
      return
    }
    if (path === '/api/support/inbox') {
      await fulfillJson(route, { success: true, data: { items: [{
        id: 'mail-item', threadId: 'mail-thread', customerName: 'メール 花子',
        customerIdentifier: 'hanako@example.invalid', subject: 'メールの対象', preview: '本文',
        status: 'unread', revision: 1, assignedStaffId: null, assignedStaffName: null,
        lastIncomingAt: '2026-09-09T00:01:00.000Z', isUnread: true,
      }] } })
      return
    }
    if (path === '/api/inbox/saved-views' || path === '/api/operators') {
      await fulfillJson(route, { success: true, data: [] })
      return
    }
    if (path === '/api/support/email/threads/mail-thread') {
      await fulfillJson(route, { success: true, data: {
        thread: {
          id: 'mail-thread', subject: 'メールの対象', customer_name: 'メール 花子',
          customer_email: 'hanako@example.invalid', status: 'unread',
          assigned_staff_id: null, notes: null, revision: 1,
        },
        messages: [{
          id: 'mail-message', direction: 'incoming', body_text: 'メール本文',
          sent_by_staff_name: null, created_at: '2026-09-09T00:01:00.000Z',
        }],
      } })
      return
    }
    if (path.endsWith('/read') && request.method() === 'POST') {
      await fulfillJson(route, { success: true, data: { isUnread: false } })
      return
    }
    const chatMatch = path.match(/^\/api\/chats\/([^/]+)$/)
    if (chatMatch && request.method() === 'GET') {
      const id = decodeURIComponent(chatMatch[1])
      detailCalls.push(id)
      if (options.onChatDetail) {
        await options.onChatDetail({ id, route })
        return
      }
      const configured = details[id]
      if (configured?.status) {
        await fulfillJson(route, { success: false, error: configured.error ?? 'not found' }, configured.status)
        return
      }
      await fulfillJson(route, { success: true, data: configured?.data ?? chatDetail(id, configured?.name ?? id) })
      return
    }
    const friendMatch = path.match(/^\/api\/friends\/([^/]+)$/)
    if (friendMatch) {
      const id = decodeURIComponent(friendMatch[1])
      await fulfillJson(route, { success: true, data: {
        id, displayName: id, pictureUrl: null, isFollowing: true, metadata: {},
        realName: null, systemDisplayName: null, refCode: null,
        createdAt: '2026-09-01T00:00:00.000Z', tags: [], formSubmissions: [],
      } })
      return
    }
    if (/^\/api\/friends\/[^/]+\/mileage$/.test(path)) {
      await fulfillJson(route, { success: true, data: {
        summary: {
          programId: 'mileage-test', programName: '試験マイル',
          available: 0, pending: 0, lifetimeEarned: 0, spent: 0,
        },
        history: [],
      } })
      return
    }
    if (/^\/api\/friends\/[^/]+\/rich-menu$/.test(path)) {
      await fulfillJson(route, { success: true, data: { id: null, name: null, isDefault: false } })
      return
    }
    await fulfillJson(route, { success: true, data: [] })
  })
  return { detailCalls }
}

async function openFriend(page, friendId) {
  await page.goto(`${baseUrl}/chats?friend=${encodeURIComponent(friendId)}`, { waitUntil: 'domcontentloaded' })
}

function talkText(page, text) {
  return page.locator('[data-inbox-v4="talk-pane"]').getByText(text, { exact: true })
}

test('正常なfriend URLで対象会話を選び、再読込でも維持する', async ({ page }) => {
  const { detailCalls } = await prepareInbox(page, {
    details: { target: { data: chatDetail('target', '対象 太郎', '対象の会話です') } },
  })
  await openFriend(page, 'target')
  await expect(talkText(page, '対象の会話です')).toBeVisible()
  expect(detailCalls).toContain('target')

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(talkText(page, '対象の会話です')).toBeVisible()
  expect(detailCalls.filter((id) => id === 'target').length).toBeGreaterThanOrEqual(2)
})

test('戻る・進むでURLの対象会話を選び直す', async ({ page }) => {
  await prepareInbox(page, {
    details: {
      first: { data: chatDetail('first', '一人目', '一人目の会話') },
      second: { data: chatDetail('second', '二人目', '二人目の会話') },
    },
  })
  await openFriend(page, 'first')
  await expect(talkText(page, '一人目の会話')).toBeVisible()
  await page.evaluate(() => window.history.pushState(null, '', '/chats?friend=second'))
  await expect(talkText(page, '二人目の会話')).toBeVisible()

  await page.goBack()
  await expect(talkText(page, '一人目の会話')).toBeVisible()
  await page.goForward()
  await expect(talkText(page, '二人目の会話')).toBeVisible()
})

for (const [label, status] of [['存在しない', 404], ['別アカウント', 403]]) {
  test(`${label}friendでは別人を開かず案内を出す`, async ({ page }) => {
    await prepareInbox(page, { details: { blocked: { status } } })
    await openFriend(page, 'blocked')
    await expect(talkText(page, '会話を開けませんでした')).toBeVisible()
    await expect(page.getByRole('button', { name: '受信箱の一覧へ戻る' })).toBeVisible()
    await expect(page.getByText('手動選択 次郎', { exact: true }).first()).toBeVisible()
    await expect(page.getByText('手動選択 次郎の会話', { exact: true })).toHaveCount(0)
  })
}

test('不正IDでは会話詳細APIを呼ばない', async ({ page }) => {
  const { detailCalls } = await prepareInbox(page)
  await openFriend(page, 'bad/id')
  await expect(talkText(page, '会話を開けませんでした')).toBeVisible()
  expect(detailCalls).toEqual([])
})

test('手動のLINE選択とメール選択で古いdeep-link URLを消す', async ({ page }) => {
  await prepareInbox(page, {
    details: {
      old: { data: chatDetail('old', '古い対象', '古い対象の会話') },
      'manual-chat': { data: chatDetail('manual-chat', '手動選択 次郎', '手動で選んだ会話') },
    },
  })
  await openFriend(page, 'old')
  await expect(talkText(page, '古い対象の会話')).toBeVisible()

  await page.getByText('手動選択 次郎', { exact: true }).first().click()
  await expect(talkText(page, '手動で選んだ会話')).toBeVisible()
  await expect(page).toHaveURL(`${baseUrl}/chats`)

  await page.evaluate(() => window.history.pushState(null, '', '/chats?friend=old'))
  await expect(talkText(page, '古い対象の会話')).toBeVisible()
  await page.getByText('メール 花子', { exact: true }).first().click()
  await expect(talkText(page, 'メール本文')).toBeVisible()
  await expect(page).toHaveURL(`${baseUrl}/chats`)
})

test('遅延した旧requestが新しいURL選択を上書きしない', async ({ page }) => {
  let releaseSlow
  const slowReleased = new Promise((resolveSlow) => { releaseSlow = resolveSlow })
  let slowRequested
  const slowStarted = new Promise((resolveStarted) => { slowRequested = resolveStarted })
  await prepareInbox(page, {
    onChatDetail: async ({ id, route }) => {
      if (id === 'slow') {
        slowRequested()
        await slowReleased
        await fulfillJson(route, { success: true, data: chatDetail('slow', '遅い相手', '遅い旧会話') })
        return
      }
      await fulfillJson(route, { success: true, data: chatDetail('fast', '新しい相手', '新しい会話') })
    },
  })

  await openFriend(page, 'slow')
  await slowStarted
  await page.evaluate(() => window.history.pushState(null, '', '/chats?friend=fast'))
  await expect(talkText(page, '新しい会話')).toBeVisible()
  releaseSlow()
  await page.waitForTimeout(100)
  await expect(talkText(page, '新しい会話')).toBeVisible()
  await expect(talkText(page, '遅い旧会話')).toHaveCount(0)
})
