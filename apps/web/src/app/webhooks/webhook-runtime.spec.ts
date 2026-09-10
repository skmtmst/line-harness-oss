import { expect, type Page, type Route, test } from '@playwright/test'

const BASE = process.env.WEBHOOK_RUNTIME_BASE ?? 'http://127.0.0.1:3101'

type ToggleResponse = { success: true; data: Record<string, never> } | { success: false; error: string }
type PendingUpdate = { id: string; respond: (body: ToggleResponse) => void }

async function prepareSession(page: Page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
}

async function provideSecondAccount(page: Page) {
  await page.route((url) => url.pathname === '/api/line-accounts', async (route) => {
    const response = await route.fetch()
    const body = await response.json() as { success: boolean; data: Array<Record<string, unknown>> }
    const first = body.data[0]
    await route.fulfill({
      response,
      json: {
        ...body,
        data: [
          first,
          { ...first, id: 'visual-qa-account-2', channelId: '0000000001', name: '画面確認アカウント2' },
        ],
      },
    })
  })
}

async function openWebhooks(page: Page, path = '/webhooks?tab=outgoing') {
  await prepareSession(page)
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(`${path.split('?')[0].replace('/', '\\/')}`))
}

async function holdOutgoingUpdates(page: Page): Promise<PendingUpdate[]> {
  const pending: PendingUpdate[] = []
  await page.route('**/api/webhooks/outgoing/*', async (route: Route) => {
    const request = route.request()
    if (request.method() !== 'PUT') {
      await route.continue()
      return
    }
    const id = new URL(request.url()).pathname.split('/').at(-1) ?? ''
    const body = await new Promise<ToggleResponse>((resolve) => {
      pending.push({ id, respond: resolve })
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  return pending
}

async function toggleRow(page: Page, name: string) {
  const row = page.getByRole('row').filter({ hasText: name })
  await row.getByRole('button', { name: '設定', exact: true }).click()
  await row.getByRole('button', { name: '止める', exact: true }).click()
}

function updateById(pending: PendingUpdate[], id: string): PendingUpdate {
  const update = pending.find((item) => item.id === id)
  if (!update) throw new Error(`${id} の更新要求がありません`)
  return update
}

test('見本リンクの選択を初回読込後も保ち、実アカウント切替時だけ閉じる', async ({ page }) => {
  await provideSecondAccount(page)
  await openWebhooks(page, '/webhooks?tab=incoming&source=booking')

  await expect(page.getByRole('heading', { name: '受け取る設定を追加' })).toBeVisible()
  await expect(page.getByLabel('受信元の種類')).toHaveValue('booking')

  await page.getByLabel('LINEアカウント').selectOption('visual-qa-account-2')
  await expect(page.getByLabel('LINEアカウント')).toHaveValue('visual-qa-account-2')
  await expect(page.getByRole('heading', { name: '受け取る設定を追加' })).toHaveCount(0)
})

test('同じ行を素早く二重押ししても更新は1回だけ送る', async ({ page }) => {
  const pending = await holdOutgoingUpdates(page)
  await openWebhooks(page)
  const row = page.getByRole('row').filter({ hasText: 'Googleスプレッドシート ／ 顧客台帳' })
  await row.getByRole('button', { name: '設定', exact: true }).click()
  await row.getByRole('button', { name: '止める', exact: true }).dblclick()

  await expect.poll(() => pending.length).toBe(1)
  await page.waitForTimeout(100)
  expect(pending).toHaveLength(1)

  const reloaded = page.waitForResponse((response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/webhooks/outgoing',
  )
  pending[0].respond({ success: true, data: {} })
  await reloaded
})

for (const order of ['failure-first', 'success-first'] as const) {
  test(`別行の失敗案内を別行の成功で消さない（${order}）`, async ({ page }) => {
    const pending = await holdOutgoingUpdates(page)
    await openWebhooks(page)
    await toggleRow(page, 'Slack ／ #注文チャンネル')
    await toggleRow(page, 'Googleスプレッドシート ／ 顧客台帳')
    await expect.poll(() => pending.length).toBe(2)

    const failed = updateById(pending, 'owh-sheets')
    const succeeded = updateById(pending, 'owh-slack-order')
    const failureAlert = page.locator('[data-webhook-toggle-error="outgoing:owh-sheets"]')

    if (order === 'failure-first') {
      failed.respond({ success: false, error: 'テスト用の失敗' })
      await expect(failureAlert).toContainText('状態は変わっていません')
    }

    const reloaded = page.waitForResponse((response) =>
      response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/webhooks/outgoing',
    )
    succeeded.respond({ success: true, data: {} })
    await reloaded

    if (order === 'success-first') {
      failed.respond({ success: false, error: 'テスト用の失敗' })
    }
    await expect(failureAlert).toContainText('Googleスプレッドシート ／ 顧客台帳')
    await expect(failureAlert).toContainText('もう一度お試しください')
  })
}

test('アカウント切替前の遅い失敗応答を切替後の画面へ出さない', async ({ page }) => {
  await provideSecondAccount(page)
  const pending = await holdOutgoingUpdates(page)
  await openWebhooks(page)
  await toggleRow(page, 'Googleスプレッドシート ／ 顧客台帳')
  await expect.poll(() => pending.length).toBe(1)

  await page.getByLabel('LINEアカウント').selectOption('visual-qa-account-2')
  await expect(page.getByLabel('LINEアカウント')).toHaveValue('visual-qa-account-2')
  pending[0].respond({ success: false, error: '切替前の遅い失敗' })
  await page.waitForTimeout(100)
  await expect(page.locator('[data-webhook-toggle-error]')).toHaveCount(0)
})
