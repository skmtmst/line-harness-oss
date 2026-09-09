import { expect, test, type Page, type Route } from '@playwright/test'

const WEB_URL = process.env.TEST_WEB_URL ?? 'http://127.0.0.1:3108'
const PAGE_PATH = process.env.TEST_WEB_PATH ?? '/contents/vars/new'

type PostedCommonVar = Record<string, unknown>

async function preparePage(page: Page, posted: PostedCommonVar[]) {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'account-1')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })

  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = {
      'access-control-allow-origin': new URL(WEB_URL).origin,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': '*',
      'content-type': 'application/json',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers, body: '' })
      return
    }
    if (url.pathname === '/api/auth/session') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        success: true,
        data: { id: 'staff-1', name: 'テスト担当', role: 'owner', permissionKeys: [] },
        csrfToken: 'test-csrf',
      }) })
      return
    }
    if (url.pathname === '/api/line-accounts') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        success: true,
        data: [{
          id: 'account-1', channelId: 'channel-1', name: 'テスト店舗', isActive: true,
          country: 'JP', role: 'owner', displayOrder: 1,
        }],
      }) })
      return
    }
    if (url.pathname === '/api/folders') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: [] }) })
      return
    }
    if (url.pathname === '/api/settings/features') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({
        success: true,
        data: {
          features: {}, sidebarOrder: null, sidebarItemOrder: null,
          parentChildMode: false, specializedFeatureKeys: [], version: 1,
        },
      }) })
      return
    }
    if (url.pathname === '/api/common-vars' && request.method() === 'POST') {
      const body = request.postDataJSON() as PostedCommonVar
      posted.push(body)
      await route.fulfill({ status: 201, headers, body: JSON.stringify({
        success: true,
        data: { id: 'var-1', ...body },
      }) })
      return
    }
    if (url.pathname === '/api/common-vars') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: [] }) })
      return
    }
    await route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: {} }) })
  })

  await page.goto(`${WEB_URL}${PAGE_PATH}`)
  try {
    await expect(page.getByLabel('共通情報名 *')).toBeVisible()
  } catch (error) {
    throw new Error(`${String(error)}\nBrowser errors:\n${browserErrors.join('\n')}`)
  }
}

test('社内メモと通常値を登録内容へ含める', async ({ page }) => {
  const posted: PostedCommonVar[] = []
  await preparePage(page, posted)

  await page.getByLabel('共通情報名 *').fill('shop hours')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('平日 10:00〜18:00')
  await page.getByLabel('社内メモ 任意').fill('祝日の前日に更新する')
  await page.getByRole('button', { name: '登録', exact: true }).click()

  await expect.poll(() => posted.length).toBe(1)
  expect(posted[0]).toMatchObject({
    accountId: 'account-1',
    name: 'shop hours',
    varKey: 'shop_hours',
    value: '平日 10:00〜18:00',
    memo: '祝日の前日に更新する',
  })
})

test('秘密値らしい内容は送信せず、入力へ戻って修正できる', async ({ page }) => {
  const posted: PostedCommonVar[] = []
  await preparePage(page, posted)

  await page.getByLabel('共通情報名 *').fill('shop secret check')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('password: hunter2')
  await page.getByRole('button', { name: '登録', exact: true }).click()

  const warning = page.getByRole('alertdialog')
  await expect(warning).toContainText('秘密値の可能性がある内容を確認してください')
  expect(posted).toHaveLength(0)

  await warning.getByRole('button', { name: '入力に戻って修正する' }).click()
  await expect(warning).toBeHidden()
  await expect(page.getByRole('textbox', { name: '値', exact: true })).toBeFocused()

  await page.getByRole('textbox', { name: '値', exact: true }).fill('通常の案内文')
  await page.getByRole('button', { name: '登録', exact: true }).click()
  await expect.poll(() => posted.length).toBe(1)
  expect(posted[0]).toMatchObject({ value: '通常の案内文' })
})
