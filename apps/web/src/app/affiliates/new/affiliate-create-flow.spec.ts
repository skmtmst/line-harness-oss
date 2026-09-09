import { expect, test, type Page, type Route } from '@playwright/test'

const BASE_URL = process.env.AFFILIATE_FLOW_BASE_URL ?? 'http://127.0.0.1:3108'

type ApiHandler = (route: Route, url: URL) => Promise<boolean>

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installApi(page: Page, handler: ApiHandler) {
  await page.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'account-1')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url())
    if (await handler(route, url)) return
    if (url.pathname === '/api/auth/session') {
      await json(route, {
        success: true,
        data: { id: 'staff-1', name: '操作試験', role: 'owner', permissionKeys: [] },
        csrfToken: 'test-csrf',
      })
      return
    }
    if (url.pathname === '/api/tags') {
      await json(route, { success: true, data: [] })
      return
    }
    if (url.pathname === '/api/scenarios') {
      await json(route, { success: true, data: { items: [], total: 0, limit: 200, sort: [] } })
      return
    }
    if (url.pathname === '/api/line-accounts') {
      await json(route, { success: true, data: [{ id: 'account-1', name: 'メインLINE' }] })
      return
    }
    if (url.pathname === '/api/client-errors') {
      await json(route, { success: true, data: null })
      return
    }
    await json(route, { success: false, error: 'この操作試験では使わないAPIです' }, 404)
  })
}

test.describe('Issue #686 アフィリエイト登録のReact操作', () => {
  test('20件超の友だち検索、0%、後半失敗からの再開を操作できる', async ({ page }) => {
    const allFriends = Array.from({ length: 45 }, (_, index) => ({
      id: `friend-${index + 1}`,
      lineUserId: `U${index + 1}`,
      displayName: `友だち${index + 1}`,
      pictureUrl: null,
      statusMessage: null,
      isFollowing: true,
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
    }))
    let createCount = 0
    let updateCount = 0
    let createdBody: Record<string, unknown> | null = null

    await installApi(page, async (route, url) => {
      if (url.pathname === '/api/friends') {
        const search = url.searchParams.get('search') ?? ''
        const offset = Number(url.searchParams.get('offset') ?? 0)
        const limit = Number(url.searchParams.get('limit') ?? 20)
        const matches = search
          ? allFriends.filter((friend) => friend.displayName.includes(search))
          : allFriends
        await json(route, {
          success: true,
          data: {
            items: matches.slice(offset, offset + limit),
            total: matches.length,
            page: Math.floor(offset / limit) + 1,
            limit,
            hasNextPage: offset + limit < matches.length,
          },
        })
        return true
      }
      if (url.pathname === '/api/affiliates' && route.request().method() === 'POST') {
        createCount += 1
        createdBody = route.request().postDataJSON() as Record<string, unknown>
        await json(route, { success: true, data: { id: 'affiliate-partial' } })
        return true
      }
      if (url.pathname === '/api/affiliates/affiliate-partial') {
        updateCount += 1
        if (updateCount === 1) {
          await json(route, { success: false, error: '一時的に保存できません' }, 500)
        } else {
          await json(route, { success: true, data: { id: 'affiliate-partial' } })
        }
        return true
      }
      return false
    })

    await page.goto(`${BASE_URL}/affiliates/new.html`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#af-friend option')).toHaveCount(21)

    await page.getByRole('combobox', { name: '友だち候補のページ' }).selectOption('2')
    await expect(page.locator('#af-friend')).toContainText('友だち21')

    await page.getByRole('textbox', { name: '友だちの名前で検索' }).fill('友だち25')
    await page.getByRole('button', { name: '検索', exact: true }).click()
    await expect(page.locator('#af-friend option')).toHaveCount(2)
    await page.locator('#af-friend').selectOption('friend-25')

    await page.locator('#af-name').fill('紹介パートナー')
    await page.getByRole('button', { name: /売上に対する割合/ }).click()
    await page.locator('#af-rate').fill('0')
    await page.getByRole('button', { name: '登録して、紹介リンクを発行する' }).click()

    await expect(page.getByText('基本情報は保存済みです')).toBeVisible()
    await expect(page.getByRole('button', { name: '追加情報の保存を再開する' })).toBeVisible()
    await expect(page.getByRole('link', { name: '未保存の追加情報を破棄して一覧へ戻る' })).toBeVisible()
    expect(createCount).toBe(1)
    expect(createdBody).toMatchObject({ commissionRate: 0, friendId: 'friend-25' })

    await page.getByRole('button', { name: '追加情報の保存を再開する' }).click()
    await expect(page).toHaveURL(/\/conversions\?tab=affiliates&highlight=affiliate-partial$/)
    expect(createCount).toBe(1)
    expect(updateCount).toBe(2)
  })

  test('小数報酬を日本語で止め、下書き失敗を重複作成せず再開できる', async ({ page }) => {
    let createCount = 0
    let updateCount = 0

    await installApi(page, async (route, url) => {
      if (url.pathname === '/api/affiliate-offers' && route.request().method() === 'POST') {
        createCount += 1
        await json(route, { success: true, data: { id: 'offer-partial' } })
        return true
      }
      if (url.pathname === '/api/affiliate-offers/offer-partial') {
        updateCount += 1
        if (updateCount === 1) {
          await json(route, { success: false, error: '一時的に保存できません' }, 500)
        } else {
          await json(route, { success: true, data: { id: 'offer-partial' } })
        }
        return true
      }
      return false
    })

    await page.goto(`${BASE_URL}/affiliate-offers/new.html`)
    await page.waitForLoadState('networkidle')
    await expect(page.locator('#of-name')).toBeVisible()
    await page.locator('#of-name').fill('秋の紹介キャンペーン')
    await page.locator('#of-amount').fill('1.5')
    await page.getByRole('button', { name: '公開する' }).click()
    await expect(page.getByText('報酬額は小数ではなく、1円単位の整数で入力してください')).toBeVisible()
    expect(createCount).toBe(0)

    await page.locator('#of-amount').fill('100')
    await page.getByRole('checkbox', { name: /作成したらすぐ公開する/ }).uncheck()
    await page.getByRole('button', { name: '下書きに保存' }).click()

    await expect(page.getByText('案件は公開済みです')).toBeVisible()
    await expect(page.getByRole('button', { name: '下書きへの変更を再開する' })).toBeVisible()
    await expect(page.getByRole('link', { name: '下書きへの変更を破棄し、公開のまま一覧へ戻る' })).toBeVisible()

    await page.getByRole('button', { name: '下書きへの変更を再開する' }).click()
    await expect(page).toHaveURL(/\/conversions\?tab=offers&highlight=offer-partial$/)
    expect(createCount).toBe(1)
    expect(updateCount).toBe(2)
  })
})
