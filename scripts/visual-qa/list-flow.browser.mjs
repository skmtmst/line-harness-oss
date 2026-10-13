/** 固定APIで一覧→パネル→編集→保存→キャンセルを撮影する。実データへは書かない。 */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, expect } from '@playwright/test'

const [base = 'http://127.0.0.1:3197', out = '/tmp/lh-list-flow'] = process.argv.slice(2)
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(base).hostname))
mkdirSync(out, { recursive: true })
const browser = await chromium.launch()
const results = []
try {
  for (const width of [1440, 1152, 1920]) {
    for (const [path, key, q] of [['/tags', 'tag', 'EC顧客'], ['/templates', 'row', '初回'], ['/form-submissions', 'form', '来店']]) {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' })
      const page = await context.newPage()
      page.setDefaultTimeout(20000)
      await context.addInitScript(() => {
        sessionStorage.setItem('lh_auth_selection_cleared', '1')
        sessionStorage.setItem('lh_visual_qa_capture', '1')
        localStorage.setItem('lh_selected_account', 'visual-qa-account')
      })
      const writes = []
      let published = 0
      page.on('request', request => { if (request.method() !== 'GET' && request.method() !== 'OPTIONS') {
        writes.push({ path: new URL(request.url()).pathname, method: request.method() })
        if (/\/publish(?:\?|$)/.test(request.url())) published += 1
      } })
      // 固定APIが読取り専用のタグ・テンプレートだけ、保存成功の応答を固定する。
      let tagSaved = null
      await page.route('**/api/tags/*', async route => {
        if (route.request().method() === 'PATCH') {
          tagSaved = route.request().postDataJSON()
          await route.fulfill({ json: { success: true, data: { queued: 0, replayed: false } } })
        } else if (tagSaved && /^\/api\/tags\/[^/]+$/.test(new URL(route.request().url()).pathname)) {
          const response = await route.fetch()
          const json = await response.json()
          if (json.data?.tag) json.data.tag = { ...json.data.tag, name: tagSaved.name, version: (json.data.tag.version ?? 1) + 1 }
          await route.fulfill({ response, json })
        } else await route.continue()
      })
      await page.route('**/api/templates/*', async route => {
        if (route.request().method() === 'PUT') await route.fulfill({ json: { success: true, data: { id: new URL(route.request().url()).pathname.split('/').at(-1) } } })
        else await route.continue()
      })
      const stages = []
      const shot = async stage => {
        await page.waitForTimeout(250)
        const geometry = await page.evaluate(() => {
          const main = document.querySelector('main')
          const tables = [...main.querySelectorAll('table')].filter(table => table.getBoundingClientRect().width > 0)
          return { pageX: document.documentElement.scrollWidth > document.documentElement.clientWidth,
            tableX: tables.some(table => table.scrollWidth > table.clientWidth + 1),
            outside: tables.filter(table => table.getBoundingClientRect().right > main.getBoundingClientRect().right + 1).length }
        })
        const file = `${width}-${key}-${stage}.png`
        await page.screenshot({ path: join(out, file) })
        stages.push({ stage, file, url: page.url(), ...geometry })
        assert.equal(geometry.pageX, false, file)
        assert.equal(geometry.tableX, false, file)
        assert.equal(geometry.outside, 0, file)
      }
      await page.goto(`${base}${path}?q=${encodeURIComponent(q)}&page=1&sort=name`, { waitUntil: 'networkidle' })
      const row = page.locator('tbody tr[data-row-id]').first()
      await row.waitFor()
      await shot('list')
      const id = await row.getAttribute('data-row-id')
      await row.focus(); await row.press('Enter')
      await expect(page.getByRole('dialog')).toBeVisible()
      assert.equal(new URL(page.url()).searchParams.get(key), id)
      const source = new URL(page.url()).pathname + new URL(page.url()).search
      await shot('panel')
      await row.focus(); await row.press('Space')
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await row.click({ position: { x: 2, y: 2 } })
      await expect(page.getByRole('dialog')).toBeVisible()
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByRole('dialog')).toBeVisible()
      const href = await row.locator('a[data-row-link]').first().getAttribute('href')
      assert.equal(new URL(href, base).searchParams.get('returnTo'), source)
      const tab = await context.newPage()
      await tab.goto(`${base}${href}`, { waitUntil: 'networkidle' })
      assert.equal(new URL(tab.url()).searchParams.get('id'), id)
      await tab.close()
      await row.locator('a[data-row-link]').first().click()
      await page.waitForURL(url => url.pathname === (path === '/templates' ? '/templates/detail' : `${path}/edit`))
      if (path === '/templates') {
        await page.getByRole('link', { name: '編集する', exact: true }).click()
        await page.waitForURL(url => url.pathname === '/templates/edit')
      }
      const editUrl = page.url()
      await expect(page.getByRole('button', { name: path === '/tags' ? 'タグを保存する' : '下書きを保存', exact: true })).toBeVisible()
      await shot('edit')
      if (path === '/tags') await page.locator('#tag-edit-name').fill('EC顧客連携済み（確認）')
      if (path === '/templates') await page.getByLabel('テンプレート名', { exact: true }).fill('初回お問い合わせへの返信（確認）')
      if (path === '/form-submissions') await page.locator('#fe-q-form-purpose').fill('今日のご来店の目的は？（確認）')
      await page.getByRole('button', { name: path === '/tags' ? 'タグを保存する' : '下書きを保存', exact: true }).click()
      await expect(page.locator('[data-toast]')).toHaveCount(1)
      assert.equal(page.url(), editUrl, '保存は編集に残る')
      assert.equal(published, 0, '下書き保存は公開しない')
      await shot('saved')
      const cancel = page.getByRole('link', { name: 'キャンセル', exact: true })
      if (await cancel.count()) await cancel.click()
      else await page.getByRole('button', { name: 'キャンセル', exact: true }).click()
      await page.waitForURL(url => url.pathname === path)
      assert.equal(new URL(page.url()).pathname + new URL(page.url()).search, source)
      await expect(page.getByRole('dialog')).toBeVisible()
      await shot('cancelled')
      results.push({ width, path, id, savedInPlace: true, toastOnce: true, published, writes, returnConditions: true, stages })
      console.log(`${width} ${path}: 合格`)
      await context.close()
    }
  }
} finally {
  await browser.close()
  writeFileSync(join(out, 'results.json'), `${JSON.stringify(results, null, 2)}\n`)
}
