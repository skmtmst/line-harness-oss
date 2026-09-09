import { expect, test } from '@playwright/test'

const BASE = process.env.LINE_NOTIFICATION_TEST_BASE ?? 'http://127.0.0.1:3108'
const PAGE_PATH = process.env.LINE_NOTIFICATION_TEST_PATH ?? '/line-notifications'

function run(id, overrides = {}) {
  return {
    id,
    recipientType: 'customer',
    notificationName: '発送のお知らせ',
    source: 'EC連携',
    sourceEventId: `event-${id}`,
    friendId: `friend-${id}`,
    friendName: `顧客 ${id}`,
    orderNumber: `NEN-${id}`,
    channel: 'line',
    status: 'failed',
    reason: 'LINE APIが一時的に受け付けませんでした',
    receivedAt: '2026-09-09T11:00:00+09:00',
    acceptedAt: null,
    attemptCount: 1,
    nextRetryAt: null,
    clickedAt: null,
    version: 1,
    executionMode: 'automatic',
    retryAvailable: false,
    recordVersion: 1,
    providerStatus: null,
    ...overrides,
  }
}

const RUNS = [
  run('顧客失敗・直近'),
  run('運用者失敗・7日', {
    recipientType: 'operator',
    friendName: '運用担当 佐藤',
    receivedAt: '2026-09-04T12:00:00+09:00',
  }),
  run('顧客対象外・過去', {
    status: 'excluded',
    reason: 'LINEでつながっていないため対象外',
    receivedAt: '2026-07-01T12:00:00+09:00',
  }),
  run('運用者対象外・直近', {
    recipientType: 'operator',
    friendName: '運用担当 鈴木',
    status: 'excluded',
    reason: '受け取るスタッフがいないため停止',
  }),
]

function response(items, summary = { accepted: 0, failed: 0, excluded: 0, pending: 0 }) {
  return {
    success: true,
    data: {
      items,
      summary,
      coverage: {
        source: 'notification_delivery_ledger',
        unassignedHistoricalRowsExcluded: true,
        attemptHistoryAvailable: true,
        retryAvailable: true,
      },
    },
    pagination: { total: items.length, limit: 20, offset: 0 },
  }
}

async function choose(page, label, option) {
  await page.getByRole('button', { name: label }).click()
  await page.getByRole('option', { name: option }).getByRole('button').click()
}

async function preparePage(page) {
  await page.clock.setFixedTime(new Date('2026-09-09T12:00:00+09:00'))
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
}

test('失敗一覧を操作でき、取得失敗・実値0・アカウント切替を混ぜない', async ({ page }) => {
  await preparePage(page)
  await page.route('**/api/line-notifications/deliveries?*', async (route) => {
    const accountId = new URL(route.request().url()).searchParams.get('lineAccountId')
    if (accountId === 'visual-qa-account-prod') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'test failure' }) })
      return
    }
    const body = accountId === 'visual-qa-account-store'
      ? response([], { accepted: 0, failed: 0, excluded: 0, pending: 0 })
      : response(RUNS, { accepted: 0, failed: 2, excluded: 2, pending: 0 })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })

  await page.goto(`${BASE}${PAGE_PATH}?tab=failures`, { waitUntil: 'networkidle' })
  const list = page.getByRole('region', { name: '送れなかったもの' })
  await expect(list.getByText('顧客 顧客失敗・直近')).toBeVisible()
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('2通')
  await expect(list.getByText('メールで届いた')).toHaveCount(0)
  await expect(list.getByText('まだ連絡できていない')).toHaveCount(0)

  await list.getByRole('button', { name: '送信対象外' }).click()
  await expect(list.getByText('顧客 顧客失敗・直近')).toHaveCount(0)
  await expect(list.getByText('顧客 顧客対象外・過去')).toBeVisible()

  await list.getByRole('button', { name: 'すべて', exact: true }).click()
  await choose(list, '対象を絞り込み', '運用者')
  await expect(list.getByText('運用担当 佐藤')).toBeVisible()
  await expect(list.getByText('顧客 顧客失敗・直近')).toHaveCount(0)

  await choose(list, '期間を絞り込み', '24時間以内')
  await expect(list.getByText('運用担当 佐藤')).toHaveCount(0)
  await expect(list.getByText('運用担当 鈴木')).toBeVisible()

  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
  await expect(list.getByText('運用担当 鈴木')).toHaveCount(0)
  await expect(list.getByText('送れなかったものを表示できませんでした')).toBeVisible()
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('取得できませんでした')

  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-store')
  await expect(list.getByText('送れなかったお知らせはありません')).toBeVisible()
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('0通')
})

test('React: Aのready後にB応答を保留してもAの行とKPIを再表示しない', async ({ page }) => {
  await preparePage(page)
  let releaseB
  const bPending = new Promise((resolve) => { releaseB = resolve })
  await page.route('**/api/line-notifications/deliveries?*', async (route) => {
    const accountId = new URL(route.request().url()).searchParams.get('lineAccountId')
    if (accountId === 'visual-qa-account-store') {
      await bPending
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response([run('Bの通知')], { accepted: 0, failed: 1, excluded: 0, pending: 0 })),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response([run('Aの通知')], { accepted: 0, failed: 7, excluded: 0, pending: 0 })),
    })
  })

  await page.goto(`${BASE}${PAGE_PATH}?tab=failures`, { waitUntil: 'networkidle' })
  const list = page.getByRole('region', { name: '送れなかったもの' })
  await expect(list.getByText('顧客 Aの通知')).toBeVisible()
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('7通')

  await page.evaluate(() => {
    const list = document.querySelector('[aria-label="送れなかったもの"]')
    if (!list) throw new Error('通知一覧が見つかりません')
    window.__oldNotificationResultSeen = false
    window.__watchOldNotificationResult = true
    const check = () => {
      if (!window.__watchOldNotificationResult) return
      const text = list.textContent ?? ''
      if (text.includes('顧客 Aの通知') || text.includes('7通')) {
        window.__oldNotificationResultSeen = true
      }
    }
    new MutationObserver(check).observe(list, { childList: true, subtree: true, characterData: true })
  })

  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-store')
  await expect(list).toHaveAttribute('data-list-state', 'loading')
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
  await expect(list.getByText('顧客 Aの通知')).toHaveCount(0)
  await expect(list.getByText('7通')).toHaveCount(0)
  expect(await page.evaluate(() => window.__oldNotificationResultSeen)).toBe(false)

  await page.evaluate(() => { window.__watchOldNotificationResult = false })
  releaseB()
  await expect(list.getByText('顧客 Bの通知')).toBeVisible()
})

test('React: Aの遅延応答がB成功後の行とKPIを上書きしない', async ({ page }) => {
  await preparePage(page)
  let releaseA
  const aPending = new Promise((resolve) => { releaseA = resolve })
  await page.route('**/api/line-notifications/deliveries?*', async (route) => {
    const accountId = new URL(route.request().url()).searchParams.get('lineAccountId')
    if (accountId === 'visual-qa-account') {
      await aPending
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response([run('A遅延通知')], { accepted: 0, failed: 9, excluded: 0, pending: 0 })),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(response([run('B成功通知')], { accepted: 0, failed: 2, excluded: 0, pending: 0 })),
    })
  })

  await page.goto(`${BASE}${PAGE_PATH}?tab=failures`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-store')
  const list = page.getByRole('region', { name: '送れなかったもの' })
  await expect(list.getByText('顧客 B成功通知')).toBeVisible()
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('2通')

  const delayedAResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/line-notifications/deliveries'
      && url.searchParams.get('lineAccountId') === 'visual-qa-account'
  })
  releaseA()
  await delayedAResponse
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  }))
  await expect(list.getByText('顧客 B成功通知')).toBeVisible()
  await expect(list.getByText('顧客 A遅延通知')).toHaveCount(0)
  await expect(list.locator('[data-design-version="v6"]').filter({ hasText: '届かなかった' })).toContainText('2通')
  await expect(list.getByText('9通')).toHaveCount(0)
})
