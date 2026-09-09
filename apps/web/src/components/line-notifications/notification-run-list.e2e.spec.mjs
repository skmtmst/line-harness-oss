import { expect, test } from '@playwright/test'

const BASE = process.env.LINE_NOTIFICATION_TEST_BASE ?? 'http://127.0.0.1:3108'

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

test('失敗一覧を操作でき、取得失敗・実値0・アカウント切替を混ぜない', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-09T12:00:00+09:00'))
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
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

  await page.goto(`${BASE}/line-notifications?tab=failures`, { waitUntil: 'networkidle' })
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
