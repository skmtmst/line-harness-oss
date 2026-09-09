import { expect, test } from '@playwright/test'

const BASE = process.env.EC_685_BASE ?? 'http://127.0.0.1:3151'

const summary = {
  pending: 0,
  processing: 0,
  succeeded: 21,
  skipped: 0,
  retryable_failed: 0,
  permanent_failed: 0,
}

function record(index, eventType = 'ec.order.confirmed') {
  const suffix = String(index).padStart(2, '0')
  return {
    id: `action-${suffix}`,
    eventId: `event-${suffix}`,
    eventType,
    eventLabel: eventType === 'ec.order.confirmed' ? '注文完了' : eventType,
    actionType: 'line_notification',
    ruleVersion: 'v1',
    status: 'succeeded',
    attemptCount: 1,
    maxAttempts: 3,
    errorCode: null,
    errorMessage: null,
    lastAttemptedAt: '2026-09-09T00:00:30.000Z',
    nextRetryAt: null,
    version: 1,
    receivedAt: '2026-09-09T00:00:30.000Z',
    orderNumber: `NEN-${suffix}`,
    customerName: '田中 花子',
    friendId: 'friend-a',
    retryAvailable: false,
    order: {
      id: `order-${suffix}`,
      lineAccountId: 'visual-qa-account',
      externalOrderId: `NEN-${suffix}`,
      orderNumber: `NEN-${suffix}`,
      customerId: `customer-${suffix}`,
      friendId: 'friend-a',
      customerName: '田中 花子',
      status: 'current',
      providerStatus: 'paid',
      currency: 'JPY',
      totalAmount: index * 100,
      refundedAmount: null,
      orderedAt: '2026-09-09T00:00:00.000Z',
      detailUrl: null,
      version: 1,
      orderLines: [{
        id: `line-${suffix}`,
        productId: `product-${suffix}`,
        productName: `商品${index}`,
        quantity: 1,
        unitAmount: index * 100,
        lineAmount: index * 100,
        productUrl: null,
      }],
    },
  }
}

const overview = {
  success: true,
  data: {
    total: 21,
    processed: 21,
    identityPending: 0,
    failed: 0,
    skipped: 0,
    last24h: 21,
    lastReceivedAt: '2026-09-09T00:00:30.000Z',
    averageDeliverySeconds: 30,
    latencySampleCount: 21,
    byType: [{ eventType: 'ec.order.confirmed', label: '注文完了', count: 20 }],
  },
}

async function openEc(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
  await page.goto(`${BASE}/ec-commerce.html`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(/\/ec-commerce\.html/)
}

test('21件目の商品、未知種別、サーバ検索を実際の画面操作で確認する', async ({ page }) => {
  const requestUrls = []
  await page.route('**/api/ec-commerce/overview*', (route) => route.fulfill({ json: overview }))
  await page.route('**/api/ec-commerce/events*', (route) => {
    const url = new URL(route.request().url())
    requestUrls.push(url.toString())
    const searched = url.searchParams.get('query') === '商品21'
    const secondPage = url.searchParams.get('offset') === '20'
    const item = searched || secondPage ? record(21, 'ec.partner.custom_event') : record(1)
    return route.fulfill({
      json: { success: true, data: { items: [item], total: searched ? 1 : 21, summary } },
    })
  })

  await openEc(page)
  await expect(page.getByText('商品1 × 1')).toBeVisible()
  await page.getByRole('button', { name: '次のページ' }).click()
  await expect(page.getByText('商品21 × 1')).toBeVisible()
  await expect(page.getByText('ec.partner.custom_event', { exact: false }).first()).toBeVisible()
  await expect(page.getByText('ECの出来事', { exact: true })).toHaveCount(0)

  await page.getByRole('searchbox', { name: '取り込みの記録を検索' }).fill('商品21')
  await expect.poll(() => requestUrls.some((url) => new URL(url).searchParams.get('query') === '商品21')).toBe(true)
  await expect(page.getByText('商品21 × 1')).toBeVisible()
})

test('集計だけ失敗しても一覧を残し、画面の再読み込み操作で集計を戻す', async ({ page }) => {
  let overviewRequests = 0
  await page.route('**/api/ec-commerce/overview*', (route) => {
    overviewRequests += 1
    if (overviewRequests <= 2) {
      return route.fulfill({ status: 500, json: { success: false, error: '集計に失敗' } })
    }
    return route.fulfill({ json: overview })
  })
  await page.route('**/api/ec-commerce/events*', (route) => route.fulfill({
    json: { success: true, data: { items: [record(1)], total: 1, summary } },
  }))

  await openEc(page)
  await expect(page.getByText('商品1 × 1')).toBeVisible()
  await expect(page.getByText('集計だけを読み込めませんでした。一覧は取得できた範囲で表示しています。')).toBeVisible()
  await page.getByRole('button', { name: '集計をもう一度読む' }).click()
  await expect(page.getByText('直近24時間の平均 30秒（21件）')).toBeVisible()
})
