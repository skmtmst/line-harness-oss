import { expect, type Locator, type Page, type Route, test } from '@playwright/test'

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

/*
  行の中でのボタンの箱(#707)。

  上下は行を基準にする。2回目の押下に返す案内が一覧の上へ増えると、表ごと
  下がるので絶対座標では比べられない。**押下位置の見張りで見たいのは
  「行の中でボタンが動いたか」**で、表ごと下がったかどうかではない。
*/
async function boxInRow(row: Locator, target: Locator) {
  const rowBox = await row.boundingBox()
  const box = await target.boundingBox()
  if (!rowBox || !box) throw new Error('ボタンの箱を取れませんでした')
  return { x: box.x, y: box.y - rowBox.y, width: box.width, height: box.height }
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
  const toggle = row.getByRole('button', { name: '止める', exact: true })
  /*
    押す前の箱を控える(#707)。`dblclick` は2発とも**同じ座標**へ落ちるので、
    1発目のあとにボタンが動くのは危ない。動きをゼロにしてあるかを下で見る。

    いまの吹き出しは `right-full` で右端が固定なので、仮に伸びても押した点は
    箱の中に残り、2発目は当たる（幅の固定を外した逆変異で確認済み）。
    **当たっているのは向きに助けられているだけ**なので、向きや並び順を変えた
    ときに黙って外れないよう、箱が動かないこと自体をここで固定する。
  */
  const boxBeforePress = await boxInRow(row, toggle)
  await toggle.dblclick()

  await expect.poll(() => pending.length).toBe(1)
  await page.waitForTimeout(100)
  expect(pending).toHaveLength(1)

  /*
    ここから下は、上の「1回だけ」が**正しい理由で**緑になっていることの見張り(#707)。

    送信中に `止める` を押せなくしたり、押した瞬間に吹き出しを閉じたりすると、
    二重押しが起こせなくなる。そうなると二重押し防止(page.tsx の togglingIdsRef)を
    外しても上の表明は緑のままになる。当て先を残すために、
    「送信中でも押せる」「箱が動かない」「2回目の押下に返事が出る」を固定する。
  */
  const pendingToggle = row.locator('[data-webhook-toggle-pending="outgoing:owh-sheets"]')
  await expect(pendingToggle).toHaveText('止めています…')
  await expect(pendingToggle).toHaveAttribute('aria-busy', 'true')
  await expect(pendingToggle).toBeEnabled()
  expect(await boxInRow(row, pendingToggle)).toEqual(boxBeforePress)
  await expect(page.locator('[data-webhook-toggle-busy="outgoing:owh-sheets"]'))
    .toContainText('返事が来るまでお待ちください')

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
