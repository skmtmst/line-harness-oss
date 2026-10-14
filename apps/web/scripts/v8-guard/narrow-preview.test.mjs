import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { connectGuardBrowser } from './browser-session.mjs'
import { PARITY_INIT } from '../../../../scripts/visual-qa/v8-parity.mjs'
import { stubApi } from './speed-budget.mjs'
import { mockFetch } from './mock-local.mjs'

const root = resolve(new URL('../../out/', import.meta.url).pathname)
const map = JSON.parse(readFileSync(new URL('../../../../scripts/visual-qa/v8-design-map.json', import.meta.url)))
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

test('狭い作成画面の見え方は1回で開き、二重の入口を出さず閉じても入力を保つ', async () => {
  assert.ok(existsSync(join(root, 'version.json')), '本物の静的出力を先に組み立てる')
  const server = createServer((req, res) => {
    const path = resolve(root, `.${new URL(req.url, 'http://localhost').pathname}`)
    const file = [path, `${path}.html`, join(path, 'index.html')].find(file => file.startsWith(`${root}/`) && existsSync(file) && statSync(file).isFile())
    if (!file) { res.writeHead(404); res.end(); return }
    res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' })
    res.end(readFileSync(file))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const browser = await connectGuardBrowser()
  try {
    const cases = ['K7HWG', 'u5YC6', 'U8Xm3X', 'JeINq', 'V6xAo'].map(board => ({ board, url: map.boards[board].url }))
    cases.find(item => item.board === 'U8Xm3X').url += '?id=rule-shop'
    cases.find(item => item.board === 'V6xAo').url += '?id=scenario-0'
    cases.push(
      { board: 'rich-message', url: '/templates/edit?kind=rich_message' },
      { board: 'rich-video', url: '/templates/edit?kind=rich_video' },
      { board: 'coupon', url: '/templates/edit?kind=coupon' },
      { board: 'research', url: '/templates/edit?kind=research' },
      { board: 'question', url: '/templates/questions/new' },
    )
    const roles = [
      ['Td4TN', 'アフィリエイターの見え方を見る', 'アフィリエイターの見え方'],
      ['RaMf3', '紹介リンクを見る', '紹介リンク'],
      ['H5UoIu', 'レポートの見本を見る', 'レポートの見本'],
      ['M4torY', '設定内容を見る', '設定内容', '/automations/new?draft=automation-v8-new'],
      ['j8p3yj', '試算を見る', '成果の試算'],
      ['d4adD4', '申込ページを見る', '申込ページ'],
      ['ctLwT', '試算を見る', 'マイルの試算'],
      ['L2Bzp', 'お客さまの見え方を見る', 'お客さまの見え方', '/mileage/rewards/edit'],
      ['Qat9s', '使用状況を見る', '使っている所', '/tags/edit?id=tag-ec-customer'],
      ['w9zY5', '種類と設定を見る', '項目の種類と設定', '/tags/fields/new'],
      ['ulq9Y', '表示設定を見る', '対応マークの表示', '/tags/marks/edit?id=mark-in-progress'],
      ['d9xoI', '設定内容を見る', 'タグの設定'],
      ['AqDWN', '検索結果と使用状況を見る', '検索結果と使っている所', '/tags/searches/edit?id=ss-1'],
      ['hsD8e', '送るデータを見る', '送るデータの見本'],
      ['wDzkc', '設定内容を見る', '設定内容', '/friend-add-settings?view=edit&id=rule-autumn&step=basic'],
      ['VE1u5', '設定内容を見る', '設定内容'],
    ]
    Object.assign(cases.find(item => item.board === 'K7HWG'), { label: '設定内容を見る', title: '設定内容', phone: false })
    // 作成・編集の実際の入口と保存済みID。古い一覧URLを板の名前で測らない。
    for (const [board, label, title, url = map.boards[board].url] of roles) cases.push({ board, url, label, title, phone: false })
    cases.push({ board: 'j7PP04', url: '/webinars/new' })
    for (const { board, url, label = 'LINEの見え方を確認', title = 'LINEの見え方', phone = true } of cases) for (const width of [1152, 1440]) {
      const page = await browser.newPage({ viewport: { width, height: 1128 } })
      console.log(`preview ${board} ${width}`)
      const errors = []
      page.on('pageerror', error => errors.push(error.message))
      try {
        await stubApi(page, mockFetch)
        await page.addInitScript(init => { for (const [key, value] of Object.entries(init)) localStorage.setItem(key, value) }, PARITY_INIT)
        const response = await page.goto(base + url)
        assert.ok(response?.ok(), board)
        await page.waitForLoadState('networkidle')
        if (board === 'U8Xm3X') {
          assert.equal(await page.getByRole('button', { name: 'テストの送り先', exact: true }).count(), 0, '自己宛先だけなら選ぶ操作を置かない')
          assert.ok(await page.getByText(/送り先：.*（自分）/).count(), '自己宛先は文字で読める')
        }
        if (board === 'j7PP04') assert.equal(await page.getByRole('button', { name: '案内する相手', exact: true }).count(), 0, '固定の参加者へ選ぶ操作を置かない')
        const trigger = page.locator('main [class*="asideToggle"] button:visible')
        if (width === 1440) {
          assert.equal(await trigger.count(), 0, `${board}: 広い板は右欄をそのまま出す`)
          assert.ok(await page.locator('main [data-template-region="preview"]:visible').count(), `${board}: 右欄を消さない`)
          if (phone) assert.ok(await page.locator('main [data-line-preview-part="phone"]:visible').count(), `${board}: 広い板でも見え方を出す`)
          assert.deepEqual(errors, [], board)
          continue
        }
        await trigger.waitFor()
        assert.equal(await trigger.count(), 1, board)
        assert.equal((await trigger.innerText()).trim(), label, `${board}: 入口は右欄の役目を伝える`)
        const editable = page.locator('main input[type="text"]:visible:not(:disabled):not([readonly]),main textarea:visible:not(:disabled):not([readonly])').first()
        if (await editable.count()) await editable.fill('プレビュー確認中の入力')
        const before = await page.locator('main input:visible,main textarea:visible').evaluateAll(els => els.map(el => [el.id, el.value]))
        await trigger.click()
        const dialogs = page.locator('[role="dialog"]:visible,[role="alertdialog"]:visible')
        assert.equal(await dialogs.count(), 1, board)
        assert.equal(await page.getByRole('dialog', { name: title, exact: true }).count(), 1, `${board}: 窓の題も右欄の役目を伝える`)
        assert.equal(await dialogs.locator('button:visible').filter({ hasText: /LINEで(?:の)?見え方(?:を)?見る/ }).count(), 0, `${board}: 見え方の窓をさらに開かせない`)
        if (board === 'K7HWG') assert.ok(await dialogs.getByText('設定内容', { exact: true }).count())
        else if (phone) assert.ok(await dialogs.locator('[data-line-preview-part="phone"]:visible').count(), `${board}: 見え方そのものを出す`)
        await dialogs.getByRole('button', { name: '閉じる', exact: true }).first().click()
        await page.locator('[role="dialog"],[role="alertdialog"]').waitFor({ state: 'hidden', timeout: 5000 })
        assert.equal(await dialogs.count(), 0, board)
        assert.deepEqual(await page.locator('main input:visible,main textarea:visible').evaluateAll(els => els.map(el => [el.id, el.value])), before, board)
        assert.deepEqual(errors, [], board)
      } finally { await page.close() }
    }
  } finally {
    await browser.close()
    await new Promise(resolve => server.close(resolve))
  }
})
