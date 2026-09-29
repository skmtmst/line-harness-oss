import { expect, test, type Page, type Route } from '@playwright/test'

const WEB_URL = process.env.TEST_WEB_URL ?? 'http://127.0.0.1:3108'
const PAGE_PATH = process.env.TEST_WEB_PATH ?? '/contents/vars/new'

type PostedCommonVar = Record<string, unknown>

const ONE_ACCOUNT = [{
  id: 'account-1', channelId: 'channel-1', name: 'テスト店舗', isActive: true,
  country: 'JP', role: 'owner', displayOrder: 1,
}]

const TWO_ACCOUNTS = [
  ...ONE_ACCOUNT,
  { id: 'account-2', channelId: 'channel-2', name: '別の店舗', isActive: true, country: 'JP', role: 'owner', displayOrder: 2 },
]

async function preparePage(page: Page, posted: PostedCommonVar[], accounts: PostedCommonVar[] = ONE_ACCOUNT) {
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
        data: accounts,
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

test('警告表示中にアカウントを切り替えると、前アカウントの入力は別アカウントへ登録されない', async ({ page }) => {
  const posted: PostedCommonVar[] = []
  await preparePage(page, posted, TWO_ACCOUNTS)

  // account-1 で秘密値らしい内容を入力し、送信前警告を出す。
  await page.getByLabel('共通情報名 *').fill('account-1 の下書き')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('通常値')
  await page.getByLabel('社内メモ 任意').fill('password: hunter2')
  await page.getByRole('button', { name: '登録', exact: true }).click()

  const warning = page.getByRole('alertdialog')
  await expect(warning).toBeVisible()

  // 警告を閉じずに、ヘッダーの LINE アカウント選択で account-2 へ切り替える。
  await page.getByLabel('LINEアカウント').selectOption('account-2')

  // 切替後は前アカウント向けの警告・入力を引き継がない。
  await expect(warning).toBeHidden()
  await expect(page.getByLabel('共通情報名 *')).toHaveValue('')
  await expect(page.getByLabel('社内メモ 任意')).toHaveValue('')
  await expect(page.getByText('LINEアカウントが切り替わったため、入力をやり直してください')).toBeVisible()

  // account-2 用に改めて入力し、account-2 として正しく登録できる。
  await page.getByLabel('共通情報名 *').fill('account-2 の値')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('account-2 の通常値')
  await page.getByRole('button', { name: '登録', exact: true }).click()

  await expect.poll(() => posted.length).toBe(1)
  expect(posted[0]).toMatchObject({
    accountId: 'account-2',
    name: 'account-2 の値',
    value: 'account-2 の通常値',
  })
  // account-1 で入力していた秘密値らしい社内メモは、どのアカウントへも送信されない。
  expect(posted.some((body) => body.memo === 'password: hunter2')).toBe(false)
})

test('日本語の秘密値ラベルを社内メモに書くと、送信前に警告して止める', async ({ page }) => {
  const posted: PostedCommonVar[] = []
  await preparePage(page, posted)

  await page.getByLabel('共通情報名 *').fill('日本語ラベル確認')
  // 日本語名からは差し込み名を自動生成できないため、明示的に入れる。
  await page.getByLabel('差し込み名 *').fill('ja_label_check')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('通常値')
  await page.getByLabel('社内メモ 任意').fill('パスワード: hunter2')
  await page.getByRole('button', { name: '登録', exact: true }).click()

  const warning = page.getByRole('alertdialog')
  await expect(warning).toContainText('秘密値の可能性がある内容を確認してください')
  await expect(warning).toContainText('社内メモ')
  expect(posted).toHaveLength(0)
})

test('保存した社内メモは、編集画面を開き直すと再表示される', async ({ page }) => {
  const posted: PostedCommonVar[] = []
  await preparePage(page, posted)

  await page.getByLabel('共通情報名 *').fill('再表示確認用')
  // 日本語名からは差し込み名を自動生成できないため、明示的に入れる。
  await page.getByLabel('差し込み名 *').fill('redisplay_check')
  await page.getByRole('textbox', { name: '値', exact: true }).fill('平日 10:00〜18:00')
  await page.getByLabel('社内メモ 任意').fill('更新は毎月1日に確認する')
  await page.getByRole('button', { name: '登録', exact: true }).click()
  await expect.poll(() => posted.length).toBe(1)
  const created = posted[0]

  // 保存した内容を、編集画面を開き直したときの詳細・予約一覧として返す。
  await page.route('**/api/common-vars/**', async (route: Route) => {
    const request = route.request()
    const url = new URL(request.url())
    const headers = {
      'access-control-allow-origin': new URL(WEB_URL).origin,
      'access-control-allow-credentials': 'true',
      'content-type': 'application/json',
    }
    if (request.method() === 'GET' && url.pathname === '/api/common-vars/var-1') {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          success: true,
          data: {
            id: 'var-1',
            name: created.name,
            varKey: created.varKey,
            type: created.type,
            value: created.value,
            memo: created.memo,
            folderId: null,
            version: 1,
            history: [],
          },
        }),
      })
      return
    }
    if (request.method() === 'GET' && url.pathname === '/api/common-vars/var-1/schedules') {
      await route.fulfill({ status: 200, headers, body: JSON.stringify({ success: true, data: [] }) })
      return
    }
    await route.fallback()
  })

  await page.goto(`${WEB_URL}/contents/vars/edit?id=var-1`)
  await expect(page.getByPlaceholder('運用上の注意や、この値の使い方を書きます')).toHaveValue(String(created.memo))
})
