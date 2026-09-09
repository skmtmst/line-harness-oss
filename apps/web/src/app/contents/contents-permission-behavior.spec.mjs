/*
  N-197（機能15メディア）の権限契約試験。

  **実build（`apps/web/out`）を実ルーティングで開き、実ブラウザで動かす。**
  文字列検査ではないので、`disabled` が本当に押せないか・APIを本当に呼ばないかを
  ブラウザの側から見る。

  APIは1か所で受けて必ず `fulfill` する。**外へは1本も出さない。**
  `NEXT_PUBLIC_API_URL` は build 時に焼き込まれるため（検証環境のURL）、
  ここで受け止めないと `AuthGuard` の `/api/auth/session` が落ちて
  `/login` へ飛び、権限の検証まで届かない。前回の差し戻しはこれと
  `/contents` 完全一致の2点だった。
*/
import { expect, test } from '@playwright/test'

const BASE = process.env.MEDIA_PERMISSION_BASE ?? 'http://127.0.0.1:3109'
const ORIGIN = new URL(BASE).origin
const MEDIA_NAME = '夏の定番セット.jpg'

/** 静的書き出しは `/contents` でも `/contents/` でも同じ画面を出す。どちらでも通す。 */
const CONTENTS_URL = /\/contents\/?(?:[?#].*)?$/

const ACCOUNTS = [
  {
    id: 'visual-qa-account', name: '画面確認アカウント', displayName: '画面確認アカウント',
    channelId: '0000000000', basicId: '@visual-qa', pictureUrl: null, isActive: true,
    parentAccountId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'visual-qa-account-prod', name: '画面確認アカウント（本番）', displayName: '画面確認アカウント（本番）',
    channelId: '0000000001', basicId: '@visual-qa-prod', pictureUrl: null, isActive: true,
    parentAccountId: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

const FOLDERS = [
  { id: 'media-product', kind: 'media', name: '商品', createdAt: '2026-01-01T00:00:00.000Z' },
]

const MEDIA_QUOTA = {
  usageBytes: 2576980378, reservedBytes: 0, limitBytes: 10737418240,
  remainingBytes: 8160437862, usageRate: 0.24, state: 'normal',
}

function mediaItems(accountId) {
  return [
    {
      id: 'media-delete-target', lineAccountId: accountId, folderId: 'media-product',
      kind: 'image', filename: MEDIA_NAME, mimeType: 'image/jpeg',
      sizeBytes: 348160, width: 1024, height: 678, durationMs: null,
      url: '', uploadedBy: '川野 健太', createdAt: '2026-08-18T09:00:00.000Z', usageCount: 3,
    },
    {
      id: 'media-delete-safe', lineAccountId: accountId, folderId: null,
      kind: 'file', filename: 'メニュー表.pdf', mimeType: 'application/pdf',
      sizeBytes: 1258291, width: null, height: null, durationMs: null,
      url: '', uploadedBy: '田中', createdAt: '2026-08-15T09:00:00.000Z', usageCount: 0,
    },
  ]
}

const DELETE_IMPACT = {
  media: { id: 'media-delete-target', filename: MEDIA_NAME, kind: 'image' },
  usageCount: 3,
  references: [
    { kind: 'template', name: '夏の定番5点', href: '/templates', state: 'available', scannedAt: '2026-08-31T10:00:00.000Z' },
  ],
  checkedAt: '2026-08-31T10:00:00.000Z', lastScannedAt: '2026-08-31T10:00:00.000Z',
  canDelete: false, recommendedAction: 'review_references',
}

/**
 * 管理画面とAPIは別サイト扱いなので、返すときに CORS を付ける。
 * `credentials: 'include'` で来るため `*` は使えない。開いている元をそのまま返す。
 */
function corsHeaders() {
  return {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-credentials': 'true',
    'content-type': 'application/json; charset=utf-8',
  }
}

function preflightHeaders(request) {
  return {
    'access-control-allow-origin': ORIGIN,
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? 'content-type,authorization,x-csrf-token',
    'access-control-max-age': '0',
  }
}

function ok(data, extra = {}) {
  return { status: 200, body: { success: true, data, ...extra } }
}

/**
 * APIの応答を1か所で決める。
 * `staffMe` だけは試験ごとに差し替える（待たせる・失敗させる）。
 */
async function respond(url, staffMe, role) {
  const path = url.pathname
  if (path === '/api/auth/session') {
    return ok(
      { id: 'staff-me', name: '権限確認テスト', role, email: null, permissionKeys: [] },
      { csrfToken: 'media-permission-csrf' },
    )
  }
  if (path === '/api/staff/me') return staffMe()
  if (path === '/api/line-accounts') return ok(ACCOUNTS)
  if (path === '/api/folders') return ok(FOLDERS)
  if (path === '/api/media') {
    const accountId = url.searchParams.get('accountId') ?? ACCOUNTS[0].id
    const items = mediaItems(accountId)
    return ok({ items, total: items.length })
  }
  if (path === '/api/media/quota') return ok(MEDIA_QUOTA)
  if (/^\/api\/media\/[^/]+\/delete-impact$/.test(path)) return ok(DELETE_IMPACT)
  /*
    ここに無い口は「用意していない」と返す。空配列などを一律に返すと、
    形が合わないまま画面が描けてしまい、落ちる理由が分からなくなる。
  */
  return { status: 200, body: { success: false, error: 'この契約試験では用意していない応答です' } }
}

/**
 * 画面が使う口をすべて受け止める。**1本も外へ出さない。**
 * `onRequest` で「本当に呼んだか」を数える。
 */
async function stubApi(page, { role = 'owner', staffMe, onRequest = () => {} } = {}) {
  const respondStaffMe = staffMe ?? (async () => ok({ id: `${role}-1`, name: `${role} test`, role, email: null }))
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request()
      if (request.method() === 'OPTIONS') {
        await route.fulfill({ status: 204, headers: preflightHeaders(request), body: '' })
        return
      }
      const url = new URL(request.url())
      onRequest(url, request)
      const result = await respond(url, respondStaffMe, role)
      await route.fulfill({
        status: result.status,
        headers: corsHeaders(),
        body: JSON.stringify(result.body),
      })
    },
  )
}

/** 店舗の選択は認証セッションごとに一度捨てられる。捨て済みの印を先に置く。 */
async function signIn(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
    window.localStorage.setItem('lh_staff_name', '権限確認テスト')
  })
}

async function openContents(page, waitUntil = 'networkidle') {
  await page.goto(`${BASE}/contents`, { waitUntil })
  await expect(page).toHaveURL(CONTENTS_URL)
  await expect(page.getByText(MEDIA_NAME, { exact: true }).first()).toBeVisible()
}

function usageButton(page) {
  return page.getByRole('button', { name: `${MEDIA_NAME}の使用箇所` })
}

test.describe('Issue #667 メディア管理権限の実挙動', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1080 })
    await signIn(page)
  })

  test('権限取得中は管理操作を止め、ownerの応答後に詳細を開いてAPIを読む', async ({ page }) => {
    let releaseRole
    const roleReady = new Promise((resolve) => { releaseRole = resolve })
    let impactRequests = 0

    await stubApi(page, {
      role: 'owner',
      staffMe: async () => {
        await roleReady
        return ok({ id: 'owner-1', name: 'Owner', role: 'owner', email: null })
      },
      onRequest: (url) => {
        if (/^\/api\/media\/[^/]+\/delete-impact$/.test(url.pathname)) impactRequests += 1
      },
    })

    await openContents(page, 'domcontentloaded')
    await expect(page.getByText('操作権限を確認しています。').first()).toBeVisible()
    await expect(usageButton(page).first()).toBeDisabled()

    releaseRole()
    await expect(usageButton(page).first()).toBeEnabled()
    await usageButton(page).first().click()
    await expect.poll(() => impactRequests).toBe(1)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()
  })

  test('adminは使用箇所を開ける', async ({ page }) => {
    let impactRequests = 0
    await stubApi(page, {
      role: 'admin',
      onRequest: (url) => {
        if (/^\/api\/media\/[^/]+\/delete-impact$/.test(url.pathname)) impactRequests += 1
      },
    })

    await openContents(page)
    await expect(usageButton(page).first()).toBeEnabled()
    await usageButton(page).first().click()
    await expect.poll(() => impactRequests).toBe(1)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()
  })

  test('staffは理由付きで使用箇所を開けず、編集・削除APIも呼ばない', async ({ page }) => {
    let impactRequests = 0
    await stubApi(page, {
      role: 'staff',
      onRequest: (url) => {
        if (/^\/api\/media\/[^/]+\/delete-impact$/.test(url.pathname)) impactRequests += 1
      },
    })

    await openContents(page)
    const button = usageButton(page).first()
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('title', /管理者だけ/)
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}の名前を変える` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}を削除` })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: `${MEDIA_NAME}を選ぶ` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /選択したメディアを削除/ })).toHaveCount(0)
    await expect(page.getByText('すべてのメディアを選択', { exact: true })).toHaveCount(0)
    /* 読める・持ち出せる操作は取り上げない。読取権限と編集権限を混同しないこと。 */
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}をダウンロード` }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'ファイルを入れる' })).toBeVisible()

    /* 無効なボタンは通常clickが届かない。DOM側から直接叩いても呼ばないことまで見る。 */
    await button.evaluate((element) => element.click())
    await expect.poll(() => impactRequests).toBe(0)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toHaveCount(0)
  })

  /*
    役割が読めない壊れ方は2通りある。**どちらもfail-closedでなければならない。**
    500 は `fetchApi` が投げるので catch 側、200 + `success:false` は返り値側へ
    落ちる。片方だけを見ていると、もう片方をfail-openへ戻しても気づけない。
  */
  const ROLE_FAILURES = [
    { name: 'HTTP 500', reply: { status: 500, body: { success: false, error: 'role unavailable' } } },
    { name: '200だが success:false', reply: { status: 200, body: { success: false, error: 'role unavailable' } } },
  ]

  for (const failure of ROLE_FAILURES) {
    test(`役割取得失敗（${failure.name}）はfail-closedにして理由を表示する`, async ({ page }) => {
      let impactRequests = 0
      await stubApi(page, {
        role: 'owner',
        staffMe: async () => failure.reply,
        onRequest: (url) => {
          if (/^\/api\/media\/[^/]+\/delete-impact$/.test(url.pathname)) impactRequests += 1
        },
      })

      await openContents(page)
      const button = usageButton(page).first()
      await expect(button).toBeDisabled()
      await expect(page.getByText(/操作権限を確認できないため、安全のため管理操作を止めています/).first()).toBeVisible()
      await expect(page.getByRole('button', { name: `${MEDIA_NAME}を削除` })).toHaveCount(0)
      await expect(page.getByRole('button', { name: `${MEDIA_NAME}の名前を変える` })).toHaveCount(0)

      await button.evaluate((element) => element.click())
      await expect.poll(() => impactRequests).toBe(0)
      await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toHaveCount(0)
    })
  }

  test('アカウント切替で開いていた詳細を閉じ、新しいアカウントの一覧を読む', async ({ page }) => {
    const listedAccounts = []
    await stubApi(page, {
      role: 'owner',
      onRequest: (url) => {
        if (url.pathname === '/api/media') listedAccounts.push(url.searchParams.get('accountId'))
      },
    })

    await openContents(page)
    await usageButton(page).first().click()
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()

    await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
    await expect.poll(() => listedAccounts.at(-1)).toBe('visual-qa-account-prod')
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toHaveCount(0)
    await expect(page.getByText(MEDIA_NAME, { exact: true }).first()).toBeVisible()
  })
})
