import { expect, test } from '@playwright/test'

const BASE = process.env.FORM_SUBMISSIONS_TEST_BASE ?? 'http://127.0.0.1:3112'

const LAYOUT = {
  version: 2,
  header: [],
  sections: [{ id: 'section-1', name: '質問', blocks: [] }],
  options: {
    thanksUrl: null,
    thanksText: 'ありがとうございました。',
    restorePrevious: false,
    pageTitle: null,
    submitLabel: '送信',
    prevLabel: '前へ',
    nextLabel: '次へ',
    sectionHeader: 'pageNumber',
    confirmDialog: { enabled: false },
    deadline: { enabled: false },
    oncePerFriend: { enabled: false },
    totalLimit: { enabled: false },
    afterActions: [],
  },
}

function form(index, overrides = {}) {
  const day = String(Math.min(index, 28)).padStart(2, '0')
  return {
    id: `form-${index}`,
    name: `フォーム${String(index).padStart(2, '0')}`,
    description: `${index}番目のフォーム`,
    fields: [],
    layout: LAYOUT,
    onSubmitTagId: null,
    isActive: index % 2 === 0,
    status: 'active',
    revision: 1,
    submitCount: index,
    weeklySubmitCount: 0,
    folderId: index % 3 === 0 ? 'folder-sales' : index % 3 === 1 ? 'folder-support' : null,
    destinationSummary: { friendFieldCount: 0, tagCount: 0 },
    createdAt: `2025-01-${day}T00:00:00.000Z`,
    updatedAt: `2026-09-${day}T00:00:00.000Z`,
    lastSubmittedAt: `2026-08-${day}T00:00:00.000Z`,
    usedByAccounts: [],
    ...overrides,
  }
}

const FOLDERS = [
  { id: 'folder-sales', name: '営業', color: '#2563EB' },
  { id: 'folder-support', name: 'サポート', color: '#10B981' },
]

async function prepare(page, { formsByAccount, fail = false }) {
  const folders = [...FOLDERS]
  await page.addInitScript(() => {
    window.sessionStorage.setItem('lh_auth_selection_cleared', '1')
    window.localStorage.setItem('lh_selected_account', 'visual-qa-account')
  })
  await page.route('**/api/auth/session', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { id: 'staff-1', name: 'テスト担当', role: 'admin', permissionKeys: [] },
        csrfToken: 'browser-test-csrf',
      }),
    })
  })
  await page.route('**/api/line-accounts', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: [
          { id: 'visual-qa-account', channelId: 'channel-1', name: 'テスト店', isActive: true, country: 'JP', role: 'admin', displayOrder: 1 },
          { id: 'visual-qa-account-prod', channelId: 'channel-2', name: '本店', isActive: true, country: 'JP', role: 'admin', displayOrder: 2 },
        ],
      }),
    })
  })
  await page.route('**/api/forms?**', async (route) => {
    if (fail) {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'failed' }) })
      return
    }
    const accountId = new URL(route.request().url()).searchParams.get('account_id')
    const items = formsByAccount[accountId] ?? []
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { items, total: items.length, page: 1, limit: items.length } }),
    })
  })
  await page.route('**/api/folders**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      const created = { id: 'folder-created', name: body.name, color: body.color ?? null }
      folders.push(created)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: created }),
      })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: folders }),
    })
  })
}

async function openList(page, search = '') {
  await page.goto(`${BASE}/form-submissions${search}`, { waitUntil: 'networkidle' })
  await expect(page).toHaveURL(new RegExp(`/form-submissions${search ? '\\?' : '(?:\\?|$)'}`))
}

test('並び順・表示件数・ページを操作し、URLと再読み込み後にも保つ', async ({ page }) => {
  const forms = Array.from({ length: 23 }, (_, index) => form(index + 1))
  await prepare(page, { formsByAccount: { 'visual-qa-account': forms } })
  await openList(page)

  await expect(page.locator('tbody tr')).toHaveCount(20)
  await page.getByRole('button', { name: '並び順' }).click()
  await page.getByRole('button', { name: '回答が多い順', exact: true }).click()
  await expect(page.locator('tbody tr').first()).toContainText('フォーム23')
  await expect(page).toHaveURL(/sort=answers/)

  await page.getByRole('button', { name: '次のページ' }).click()
  await expect(page).toHaveURL(/page=2/)
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(page.locator('tbody tr').first()).toContainText('フォーム03')

  await page.getByRole('button', { name: '表示件数' }).click()
  await page.getByRole('button', { name: '50件表示', exact: true }).click()
  await expect(page).toHaveURL(/limit=50/)
  await expect(page).not.toHaveURL(/page=2/)
  await expect(page.locator('tbody tr')).toHaveCount(23)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('tbody tr')).toHaveCount(23)
  await expect(page.getByRole('button', { name: '表示件数' })).toContainText('50件表示')
})

test('フォルダ・回答先・更新日時を対象フォームの実データで描く', async ({ page }) => {
  const forms = [
    form(1, { id: 'sales-new', name: '営業フォーム', folderId: 'folder-sales', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }),
    form(2, { id: 'sales-old', name: '古い営業フォーム', folderId: 'folder-sales', updatedAt: null }),
    form(3, { id: 'support', name: 'サポートフォーム', folderId: 'folder-support' }),
    form(4, { id: 'unfiled', name: '未分類フォーム', folderId: null }),
  ]
  await prepare(page, { formsByAccount: { 'visual-qa-account': forms } })
  await openList(page)

  await page.getByRole('button', { name: /営業\s*2/ }).click()
  await expect(page).toHaveURL(/folder=folder-sales/)
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByText('サポートフォーム', { exact: true })).toHaveCount(0)
  const responseLink = page.getByRole('link', { name: '営業フォームの回答を見る', exact: true })
  await expect(responseLink).toHaveAttribute('href', '/form-submissions/responses?id=sales-new')
  await expect(page.locator('tbody tr').filter({ has: responseLink })).toContainText('09/08')
  await expect(page.locator('tbody tr').filter({ hasText: '古い営業フォーム' }).getByTitle('更新日時を取得できません')).toHaveText('—')

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('tbody tr')).toHaveCount(2)
  await expect(page.getByRole('button', { name: /営業\s*2/ })).toHaveClass(/bg-accent-soft/)

  await page.getByRole('button', { name: 'フォルダを追加', exact: true }).click()
  await page.getByRole('textbox', { name: 'フォルダ名' }).fill('新規問合せ')
  await page.getByRole('button', { name: '追加する', exact: true }).click()
  await expect(page.getByRole('button', { name: /新規問合せ\s*0/ })).toBeVisible()
})

test('0件・取得失敗・アカウント切替をそれぞれ実画面で言い分ける', async ({ page }) => {
  await prepare(page, {
    formsByAccount: {
      'visual-qa-account': [],
      'visual-qa-account-prod': [form(7, { id: 'prod-form', name: '本店フォーム' })],
    },
  })
  await openList(page)
  await expect(page.getByText('まだフォームがありません', { exact: true })).toBeVisible()
  await expect(page.getByText('最初の1つを作ると、集まった回答もここから見られます。')).toBeVisible()
  await expect(page.getByText(/見え方です/)).toHaveCount(0)

  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
  await expect(page.getByText('本店フォーム', { exact: true })).toBeVisible()
  await expect(page.getByText('まだフォームがありません', { exact: true })).toHaveCount(0)
})

test('取得失敗では0件扱いにせず再読み込みを出す', async ({ page }) => {
  await prepare(page, { formsByAccount: {}, fail: true })
  await openList(page)
  await expect(page.getByText('表示できませんでした', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible()
  await expect(page.getByText('まだフォームがありません', { exact: true })).toHaveCount(0)
})
