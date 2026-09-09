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

/**
 * 一覧が読む形は Worker の `serializeForm` に合わせる。
 *
 * **`folderId` は入れない。** forms 表に列が無く、API も返さないため、
 * ここで足すと画面が実在しない値で絞り込めているように見えてしまう。
 * フォルダへの所属は #688（migration 372）が入ってから試す。
 */
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
    destinationSummary: { friendFieldCount: 0, tagCount: 0 },
    createdAt: `2025-01-${day}T00:00:00.000Z`,
    updatedAt: `2026-09-${day}T00:00:00.000Z`,
    lastSubmittedAt: `2026-08-${day}T00:00:00.000Z`,
    usedByAccounts: [],
    ...overrides,
  }
}

/**
 * `GET /api/folders?kind=form` が実際に返す中身。
 *
 * forms 表に `folder_id` が無いので、どのフォームもフォルダへ入れられない。
 * 検証環境も空で返る。**架空の分類を足して「絞り込めている」ように見せない。**
 */
const FOLDERS = []

async function prepare(page, { formsByAccount, fail = false, role = 'admin', formsDelayByAccount = {}, onFolderPost }) {
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
        data: { id: 'staff-1', name: 'テスト担当', role, permissionKeys: [] },
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
          { id: 'visual-qa-account', channelId: 'channel-1', name: 'テスト店', isActive: true, country: 'JP', role, displayOrder: 1 },
          { id: 'visual-qa-account-prod', channelId: 'channel-2', name: '本店', isActive: true, country: 'JP', role, displayOrder: 2 },
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
    const delay = formsDelayByAccount[accountId] ?? 0
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: { items, total: items.length, page: 1, limit: items.length } }),
    })
  })
  await page.route('**/api/folders**', async (route) => {
    if (route.request().method() !== 'GET') {
      onFolderPost?.(route.request().method())
      await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Forbidden' }) })
      return
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: FOLDERS }),
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

test('回答先と更新日時を、その行のフォームの実データで描く', async ({ page }) => {
  const forms = [
    form(1, { id: 'sales-new', name: '営業フォーム', createdAt: '2020-01-01T00:00:00.000Z', updatedAt: '2026-09-08T00:00:00.000Z' }),
    form(2, { id: 'sales-old', name: '古い営業フォーム', updatedAt: null }),
  ]
  await prepare(page, { formsByAccount: { 'visual-qa-account': forms } })
  await openList(page)

  // #676 N-173：先頭フォーム固定の一括導線を置かず、行ごとに宛先を持つ。
  const responseLink = page.getByRole('link', { name: '営業フォームの集まった回答を見る', exact: true })
  await expect(responseLink).toHaveAttribute('href', '/form-submissions/responses?id=sales-new')
  await expect(page.getByRole('link', { name: '古い営業フォームの集まった回答を見る', exact: true }))
    .toHaveAttribute('href', '/form-submissions/responses?id=sales-old')

  // #676 N-180：更新列は created_at ではなく updated_at を出し、無い状態と区別する。
  await expect(page.locator('tbody tr').filter({ has: responseLink })).toContainText('09/08')
  await expect(page.locator('tbody tr').filter({ has: responseLink })).not.toContainText('01/01')
  await expect(page.locator('tbody tr').filter({ hasText: '古い営業フォーム' }).getByTitle('更新日時を取得できません')).toHaveText('—')
})

for (const role of ['staff', 'admin']) {
  test(`押しても効かないフォルダ追加を${role}へ出さない`, async ({ page }) => {
    let folderWrites = 0
    await prepare(page, {
      role,
      formsByAccount: { 'visual-qa-account': [form(1)] },
      onFolderPost: () => { folderWrites += 1 },
    })
    await openList(page)

    // フォルダの保存先が無いので、追加口は押せない状態のまま理由を添えて置く。
    const addFolder = page.getByRole('button', { name: 'フォルダを追加' })
    await expect(addFolder).toBeDisabled()
    await expect(addFolder).toHaveAttribute('title', 'フォームのフォルダ保存先は未接続です')
    await expect(page.getByRole('button', { name: /すべて/ })).toBeVisible()

    // 押しても、この画面からフォルダを作る要求は出ない。
    await addFolder.click({ force: true })
    await page.waitForTimeout(500)
    await expect(page.getByRole('textbox', { name: 'フォルダ名' })).toHaveCount(0)
    expect(folderWrites).toBe(0)
  })
}

test('0件・取得失敗・アカウント切替をそれぞれ実画面で言い分ける', async ({ page }) => {
  const requested = []
  await prepare(page, {
    formsByAccount: {
      'visual-qa-account': [],
      'visual-qa-account-prod': [form(7, { id: 'prod-form', name: '本店フォーム' })],
    },
  })
  page.on('request', (request) => {
    if (request.url().includes('/api/forms?')) requested.push(new URL(request.url()).searchParams.get('account_id'))
  })
  await openList(page)
  await expect(page.getByText('まだフォームがありません', { exact: true })).toBeVisible()
  await expect(page.getByText('最初の1つを作ると、集まった回答もここから見られます。')).toBeVisible()
  await expect(page.getByText(/見え方です/)).toHaveCount(0)

  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
  await expect(page.getByText('本店フォーム', { exact: true })).toBeVisible()
  await expect(page.getByText('まだフォームがありません', { exact: true })).toHaveCount(0)
  // account境界：選んでいるアカウント以外の account_id では読まない。
  expect([...new Set(requested)].sort()).toEqual(['visual-qa-account', 'visual-qa-account-prod'])
})

test('遅れて返った前のアカウントの応答で一覧を書き換えない', async ({ page }) => {
  await prepare(page, {
    formsByAccount: {
      'visual-qa-account': [form(1, { id: 'slow-form', name: '前のアカウントのフォーム' })],
      'visual-qa-account-prod': [form(2, { id: 'fast-form', name: '本店フォーム' })],
    },
    // 先に出した要求を後から返し、逆順の応答を作る。
    formsDelayByAccount: { 'visual-qa-account': 2500 },
  })
  await page.goto(`${BASE}/form-submissions`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('combobox', { name: 'LINEアカウント' }).selectOption('visual-qa-account-prod')
  await expect(page.getByText('本店フォーム', { exact: true })).toBeVisible()

  await page.waitForTimeout(3000)
  await expect(page.getByText('本店フォーム', { exact: true })).toBeVisible()
  await expect(page.getByText('前のアカウントのフォーム', { exact: true })).toHaveCount(0)
})

test('取得失敗では0件扱いにせず再読み込みを出す', async ({ page }) => {
  await prepare(page, { formsByAccount: {}, fail: true })
  await openList(page)
  await expect(page.getByText('表示できませんでした', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '再読み込み' })).toBeVisible()
  await expect(page.getByText('まだフォームがありません', { exact: true })).toHaveCount(0)
})
