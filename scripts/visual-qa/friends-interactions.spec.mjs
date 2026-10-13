import { test, expect } from '@playwright/test'
import { routeLocalApi } from './local-api.mjs'
test.beforeEach(routeLocalApi)
const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'
async function openFriends(page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
    localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
  await page.goto(`${BASE}/friends`, { waitUntil: 'networkidle' })
  await expect(page.getByRole('main').getByRole('heading', { name: '友だち', exact: true })).toBeVisible()
}
test('未対応の選択を絞り込み要求と表示で確認し、外すと戻る', async ({ page }) => {
  await openFriends(page)
  const state = page.getByRole('group', { name: 'すばやく絞り込む' }).getByRole('button', { name: '状態', exact: true })
  await expect(state).toHaveText('状態：すべて')
  const filtered = page.waitForRequest(request => new URL(request.url()).pathname === '/api/friends' && new URL(request.url()).searchParams.get('handled') === 'unhandled')
  await state.click()
  await page.getByRole('option', { name: '未対応', exact: true }).getByRole('button').click()
  await filtered
  await expect(state).toHaveText('状態：未対応')
  const all = page.waitForRequest(request => new URL(request.url()).pathname === '/api/friends' && !new URL(request.url()).searchParams.has('handled'))
  await state.click()
  await page.getByRole('option', { name: 'すべて', exact: true }).getByRole('button').click()
  await all
  await expect(state).toHaveText('状態：すべて')
})
test('保存した検索のAPI候補を選び、画面から離れず適用する', async ({ page }) => {
  await page.route('**/api/friends/saved-views*', route => route.fulfill({ json: { success: true, data: {
    items: [{ id: 'saved-following', name: '友だちだけ', conditions: { all: [], any: [], visibility: 'visible_only' }, revision: 1, isShared: false, match: { total: 1 }, lineAccountId: 'visual-qa-account' }], total: 1,
  } } }))
  await openFriends(page)
  await page.getByRole('button', { name: '保存した検索', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '保存した検索', exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /友だちだけ/ }).check()
  const request = page.waitForRequest(request => new URL(request.url()).pathname === '/api/friends' && new URL(request.url()).searchParams.get('savedSearchId') === 'saved-following')
  await dialog.getByRole('button', { name: 'この条件で表示', exact: true }).click(); await request
  await expect(dialog).not.toBeVisible()
  await expect(page).toHaveURL(/\/friends(?:\?|$)/)
  await expect(page.getByText('絞り込み中', { exact: true })).toBeVisible()
})
test('表示項目は確定前に変わらず、保存と再読み込みで維持する', async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem('train34-columns-seeded')) {
      localStorage.setItem('friends.visibleColumns', JSON.stringify(['scenario']))
      sessionStorage.setItem('train34-columns-seeded', '1')
    }
  })
  await openFriends(page)
  const column = page.getByRole('columnheader', { name: 'シナリオ', exact: true })
  await expect(column).toBeVisible()
  await page.getByRole('button', { name: '表示項目を編集', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '表示項目を編集', exact: true })
  await dialog.getByRole('checkbox', { name: 'シナリオ', exact: true }).uncheck()
  await expect(column).toBeVisible()
  await dialog.getByRole('button', { name: '保存する', exact: true }).click()
  await expect(column).toHaveCount(0)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByRole('main').getByRole('heading', { name: '友だち', exact: true })).toBeVisible()
  await expect(column).toHaveCount(0)
  await page.getByRole('button', { name: '表示項目を編集', exact: true }).click()
  await page.getByRole('dialog', { name: '表示項目を編集', exact: true }).getByRole('checkbox', { name: 'シナリオ', exact: true }).check()
  await page.getByRole('dialog', { name: '表示項目を編集', exact: true }).getByRole('button', { name: '保存する', exact: true }).click()
  await expect(column).toBeVisible()
})
