import { test, expect } from '@playwright/test'

const BASE = process.env.VISUAL_QA_BASE ?? 'http://localhost:3101'

async function openFriends(page) {
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
  await page.goto(`${BASE}/friends`, { waitUntil: 'networkidle' })
  await expect(page.getByText('友だち一覧', { exact: true }).first()).toBeVisible()
}

test('未対応の選択状態を見た目とariaの両方で示す', async ({ page }) => {
  await openFriends(page)
  const chip = page.getByRole('button', { name: '未対応', exact: true })
  await expect(chip).toHaveAttribute('aria-pressed', 'false')
  await chip.click()
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await expect(chip).toHaveClass(/ring-2/)
})

test('保存した検索を画面から離れずに呼び出す', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      'friends.savedSearch',
      JSON.stringify({ params: { visibility: 'following' }, summary: ['表示：友だち'] }),
    )
  })
  await openFriends(page)
  await page.getByRole('button', { name: '保存した検索' }).click()
  await expect(page.getByRole('dialog', { name: '保存した検索' })).toBeVisible()
  await page.getByRole('button', { name: 'この条件で表示' }).click()
  await expect(page).toHaveURL(/\/friends(?:\?|$)/)
  await expect(page.getByText('絞り込み中')).toBeVisible()
  await expect(page.getByText('表示：友だち')).toBeVisible()
})

test('表示項目の選択を再読み込み後も保つ', async ({ page }) => {
  await openFriends(page)
  await page.getByText('表示項目を編集', { exact: true }).click()
  await page.getByLabel('シナリオ', { exact: true }).uncheck()
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.getByText('友だち一覧', { exact: true }).first()).toBeVisible()
  await expect(page.locator('[data-design="V6FriendTable"] [data-column="scenario"]')).toHaveCount(0)
})
