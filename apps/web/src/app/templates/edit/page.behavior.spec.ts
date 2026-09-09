import { expect, test } from '@playwright/test'

const BASE = process.env.TEMPLATE_EDIT_BASE ?? 'http://localhost:3108'
const PAGE_PATH = process.env.TEMPLATE_EDIT_PATH ?? '/templates/edit'

const account = (id: string, name: string) => ({
  id,
  channelId: `channel-${id}`,
  name,
  displayName: name,
  isActive: true,
  country: 'JP',
  role: 'admin',
  displayOrder: 0,
})

const field = (accountId: string) => ({
  id: `${accountId}-field`,
  folderId: null,
  name: `${accountId}のペット名`,
  fieldKey: `${accountId.replace('-', '_')}_pet`,
  type: 'text',
  options: null,
  defaultValue: `${accountId}ココ`,
  source: 'manual',
  ecFieldPath: null,
  ecIsMaster: false,
  isPersonal: false,
  isStarred: false,
  displayOrder: 0,
  canInsertText: true,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
})

const commonVar = (accountId: string) => ({
  id: `${accountId}-var`,
  lineAccountId: accountId,
  folderId: null,
  name: `${accountId}の営業時間`,
  varKey: `${accountId.replace('-', '_')}_hours`,
  type: 'text',
  value: `${accountId} 10時〜18時`,
  createdAt: '2026-09-09T00:00:00.000Z',
  updatedAt: '2026-09-09T00:00:00.000Z',
})

test('新規・既存・取得失敗・アカウント切替・未解決差し込みを実画面で扱う', async ({ context, page }) => {
  test.setTimeout(90_000)
  await context.addInitScript(() => {
    localStorage.setItem('lh_selected_account', 'account-a')
    sessionStorage.setItem('lh_auth_selection_cleared', '1')
  })

  let failReferences = false
  await page.route('http://127.0.0.1:8788/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const cors = {
      'access-control-allow-origin': BASE,
      'access-control-allow-credentials': 'true',
      'access-control-allow-headers': 'Content-Type, X-CSRF-Token',
      'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'content-type': 'application/json; charset=utf-8',
    }
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' })
      return
    }
    const json = async (body: unknown, status = 200) => route.fulfill({
      status,
      headers: cors,
      body: JSON.stringify(body),
    })

    if (url.pathname === '/api/line-accounts') {
      await json({ success: true, data: [account('account-a', '店舗A'), account('account-b', '店舗B')] })
      return
    }
    if (url.pathname === '/api/friend-fields') {
      if (failReferences) {
        await json({ success: false, error: 'failed' }, 500)
        return
      }
      const accountId = url.searchParams.get('lineAccountId') ?? ''
      await json({ success: true, data: [field(accountId)] })
      return
    }
    if (url.pathname === '/api/common-vars') {
      const accountId = url.searchParams.get('accountId') ?? ''
      await json({ success: true, data: [commonVar(accountId)] })
      return
    }
    if (url.pathname === '/api/folders' && url.searchParams.get('kind') === 'template') {
      await json({
        success: true,
        data: [{
          id: 'folder-1', kind: 'template', name: '定期便', parentId: null,
          displayOrder: 0, color: null, createdAt: '', updatedAt: '',
        }],
      })
      return
    }
    if (url.pathname === '/api/templates/existing') {
      await json({ success: true, data: {
        id: 'existing', accountId: 'account-a', name: '既存テンプレート', category: 'legacy',
        messageType: 'text', messageContent: '{{field.account_a_pet}} / {{var.account_a_hours}}',
        folderId: 'folder-1', question: null, questionStatus: 'draft', carouselActions: null,
        carouselTapLimitMode: 'none', carouselTapLimitText: null,
        usedBy: { autoReplies: [], automations: [], scenarioSteps: [], reminderSteps: [], richMenuAreas: [], trackedLinks: [] },
        createdAt: '', updatedAt: '',
      } })
      return
    }
    if (url.pathname === '/api/templates/missing') {
      await json({ success: false, error: 'not found' }, 404)
      return
    }
    await route.continue()
  })

  await page.goto(`${BASE}${PAGE_PATH}`, { waitUntil: 'networkidle' })
  await expect(page.getByLabel('友だち情報を差し込む')).toContainText('account-aのペット名')
  await page.getByLabel('友だち情報を差し込む').selectOption('{{field.account_a_pet}}')
  await page.getByLabel('共通情報を差し込む').selectOption('{{var.account_a_hours}}')
  await page.getByLabel('日数を数える目標日').fill('2026-09-30')
  await page.getByRole('button', { name: '目標日までの日数' }).click()
  await expect(page.locator('#tp-content')).toHaveValue(/\{\{field\.account_a_pet\}\}.*\{\{var\.account_a_hours\}\}.*\{\{days_until:2026-09-30\}\}/)

  await page.locator('#tp-content').fill('{{field.account_a_pet}} / {{var.account_a_hours}}')
  await expect(page.getByText('account-aココ / account-a 10時〜18時', { exact: true })).toBeVisible()
  await expect(page.getByText('本文にURLはありません。', { exact: true })).toBeVisible()
  await expect(page.locator('#tp-category')).toHaveCount(0)

  await page.locator('#tp-content').fill('{{field.ghost}} https://nen.example/guide')
  await expect(page.getByText('値を確認できない差し込みがあります', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').getByText('{{field.ghost}}', { exact: true })).toBeVisible()
  await expect(page.getByText('https://nen.example/guide', { exact: true })).toBeVisible()

  await page.getByLabel('LINEアカウント').selectOption('account-b')
  await expect(page.getByLabel('友だち情報を差し込む')).toContainText('account-bのペット名')
  await expect(page.getByLabel('友だち情報を差し込む')).not.toContainText('account-aのペット名')

  await page.goto(`${BASE}${PAGE_PATH}?id=existing`, { waitUntil: 'networkidle' })
  await expect(page.locator('#tp-name')).toHaveValue('既存テンプレート')
  await expect(page.locator('#tp-folder')).toHaveValue('folder-1')

  await page.goto(`${BASE}${PAGE_PATH}?id=missing`, { waitUntil: 'networkidle' })
  await expect(page.getByText('読み込めませんでした。開き直してください。', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存' })).toBeDisabled()

  failReferences = true
  await page.getByLabel('LINEアカウント').selectOption('account-b')
  await expect(page.getByText('差し込み項目を読み込めませんでした。画面を再読み込みしてください。', { exact: true })).toBeVisible()
})
