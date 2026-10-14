import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { scanDialogContent } from './dialog-content-browser.mjs'

test('dialog content catches missing verbs, required definitions, picker, history, insertion and colors', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>:root{--color-accent-deep:rgb(8,122,62)}.card{width:100%}</style><div data-m1-scope>
      <h2>「応答」を削除しますか？</h2><button>削除する</button><button>変更を保存する</button>
      <div data-form-requirement="required"><textarea id="quick-create-reply"></textarea></div>
      <button>担当アカウントを選ぶ</button><div style="width:500px"><section class="card"><h3>予約中の版</h3><strong>v2</strong><button aria-haspopup="menu">操作</button></section></div>
      <div data-dialog-actions><button>新しい版を作る</button></div>
      <div data-message-body><div data-message-insert-row><span data-message-character-count>5 / 5000</span></div></div>
      <div><p>変更量</p><p><span style="color:var(--color-accent-deep)">+100</span></p></div>
    </div>`)
    const options = { verbActions: true, deleteQuestion: true, requiredReply: true, accountPicker: true, history: true, insertion: true, changedValues: true }
    assert.equal((await page.evaluate(scanDialogContent, options)).findings.length, 0)
    await page.getByRole('button', { name: '削除する', exact: true }).evaluate(el => el.textContent = '削除')
    await page.locator('h2').evaluate(el => el.textContent = '「応答」を削除する')
    await page.locator('[data-form-requirement]').evaluate(el => el.dataset.formRequirement = 'optional')
    await page.locator('[data-m1-scope]').evaluate(el => el.insertAdjacentHTML('beforeend', '<input type="checkbox">'))
    await page.locator('.card').evaluate(el => { el.style.width = '250px'; el.querySelector('button').remove() })
    await page.getByRole('button', { name: '新しい版を作る' }).evaluate(el => el.parentElement.parentElement.append(el))
    await page.locator('[data-message-insert-row]').evaluate(el => el.parentElement.parentElement.append(el))
    await page.locator('p span').evaluate(el => el.style.color = 'black')
    assert.deepEqual((await page.evaluate(scanDialogContent, options)).findings.map(x => x.kind).sort(), [
      'dialog-account-inline-list', 'dialog-action-verb', 'dialog-changed-value-color', 'dialog-delete-question',
      'dialog-history-card-width', 'dialog-history-create-slot', 'dialog-history-reserved-menu', 'dialog-message-insertion-outside', 'dialog-reply-required',
    ].sort())
  } finally { await browser.close() }
})
