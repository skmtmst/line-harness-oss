import { expect, test } from '@playwright/test'

const BASE = process.env.MEDIA_PERMISSION_BASE ?? 'http://127.0.0.1:3109'
const MEDIA_NAME = '夏の定番セット.jpg'

async function signIn(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
    localStorage.setItem('lh_staff_name', '権限確認テスト')
    localStorage.setItem('lh_staff_role', 'owner')
  })
}

async function mockRole(page, role) {
  await page.route('**/api/staff/me', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json; charset=utf-8',
    body: JSON.stringify({
      success: true,
      data: { id: `${role}-1`, name: `${role} test`, role, email: null },
    }),
  }))
}

async function openContents(page, waitUntil = 'networkidle') {
  await page.goto(`${BASE}/contents`, { waitUntil })
  await expect(page).toHaveURL(`${BASE}/contents`)
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

    await page.route('**/api/media/*/delete-impact*', async (route) => {
      impactRequests += 1
      await route.continue()
    })
    await page.route('**/api/staff/me', async (route) => {
      await roleReady
      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({ success: true, data: { id: 'owner-1', name: 'Owner', role: 'owner', email: null } }),
      })
    })

    await openContents(page, 'domcontentloaded')
    await expect(page.getByText('操作権限を確認しています。').first()).toBeVisible()
    await expect(usageButton(page)).toBeDisabled()

    releaseRole()
    await expect(usageButton(page)).toBeEnabled()
    await usageButton(page).click()
    await expect.poll(() => impactRequests).toBe(1)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()
  })

  test('adminは使用箇所を開ける', async ({ page }) => {
    let impactRequests = 0
    await page.route('**/api/media/*/delete-impact*', async (route) => {
      impactRequests += 1
      await route.continue()
    })
    await mockRole(page, 'admin')

    await openContents(page)
    await expect(usageButton(page)).toBeEnabled()
    await usageButton(page).click()
    await expect.poll(() => impactRequests).toBe(1)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()
  })

  test('staffは理由付きで使用箇所を開けず、編集・削除APIも呼ばない', async ({ page }) => {
    let impactRequests = 0
    await page.route('**/api/media/*/delete-impact*', async (route) => {
      impactRequests += 1
      await route.continue()
    })
    await mockRole(page, 'staff')

    await openContents(page)
    const button = usageButton(page)
    await expect(button).toBeDisabled()
    await expect(button).toHaveAttribute('title', /管理者だけ/)
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}の名前を変える` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}を削除` })).toHaveCount(0)
    await expect(page.getByRole('checkbox', { name: `${MEDIA_NAME}を選ぶ` })).toHaveCount(0)
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}をダウンロード` })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ファイルを入れる' })).toBeVisible()

    await button.evaluate((element) => element.click())
    await expect.poll(() => impactRequests).toBe(0)
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toHaveCount(0)
  })

  test('役割取得失敗はfail-closedにして理由を表示する', async ({ page }) => {
    await page.route('**/api/staff/me', (route) => route.fulfill({
      status: 500,
      contentType: 'application/json; charset=utf-8',
      body: JSON.stringify({ success: false, error: 'role unavailable' }),
    }))

    await openContents(page)
    await expect(usageButton(page)).toBeDisabled()
    await expect(page.getByText(/操作権限を確認できないため、安全のため管理操作を止めています/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: `${MEDIA_NAME}を削除` })).toHaveCount(0)
  })

  test('アカウント切替で開いていた詳細を閉じ、新しいアカウントの一覧を読む', async ({ page }) => {
    const listedAccounts = []
    await page.route('**/api/media?*', async (route) => {
      listedAccounts.push(new URL(route.request().url()).searchParams.get('accountId'))
      await route.continue()
    })
    await mockRole(page, 'owner')

    await openContents(page)
    await usageButton(page).click()
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toBeVisible()

    await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
    await expect.poll(() => listedAccounts.at(-1)).toBe('visual-qa-account-prod')
    await expect(page.getByRole('heading', { name: MEDIA_NAME, exact: true })).toHaveCount(0)
    await expect(page.getByText(MEDIA_NAME, { exact: true }).first()).toBeVisible()
  })
})
