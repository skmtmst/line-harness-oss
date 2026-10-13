import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import scanFormRules from './form-rules-browser.mjs'
import { assessAgainstBase } from './layout-defects.mjs'

test('既存の伸びた必須札も検出し、基準版へ同じ崩れを置いて許可にしない', () => {
  const finding = { kind: 'form-required-badge', target: 'main > span', text: '必須', measure: { excess: 100 } }
  const result = assessAgainstBase([finding], [finding], '/example', 1440)
  assert.deepEqual(result.failures, [finding])
  assert.deepEqual(result.existing, [])
  assert.deepEqual(result.allowed, [])
})

test('必須札は文字幅の面だけを通し、入力の幅へ伸びた帯を3幅で検出する', async () => {
  const css = readFileSync(new URL('../../src/components/shared/form-controls.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440, 1152, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>:root{--tpl-field-badge-lh:17px;--radius-pill:99px;--polish-space-row:8px}.labelRow{gap:8px}${css}</style><main>
        <div class="field"><div class="labelRow"><label class="label">名前</label><span class="required" data-required-badge>必須</span></div><input aria-label="名前"></div>
        <div class="field"><span class="required" data-required-badge>必須</span><input aria-label="探す欄"></div>
        <div hidden><span class="required" data-required-badge>必須</span></div></main>`)
      const findings = await page.evaluate(scanFormRules)
      assert.deepEqual(findings, [], '共通の札は文字幅に収まる')
      await page.addStyleTag({ content: '.field > [data-required-badge]{align-self:stretch}' })
      const stretched = (await page.evaluate(scanFormRules)).filter(f => f.kind === 'form-required-badge')
      assert.equal(stretched.length, 1)
      assert.ok(stretched[0].measure.excess > 100, '伸びた面の実寸を確認する')
      await page.addStyleTag({ content: '.field > [data-required-badge]{align-self:flex-start}' })
      assert.deepEqual(await page.evaluate(scanFormRules), [])
    }
  } finally { await browser.close() }
})

test('本文の外へ開いた窓の札を検出し、本文内の窓は二重に数えない', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    await page.setContent(`<style>[data-field]{display:flex;flex-direction:column;width:300px}[data-required-badge]{display:inline-flex;padding:2px 6px}</style>
      <main><div role="dialog"><div data-field><span data-required-badge>必須</span></div></div></main>
      <div role="dialog"><div data-field><span data-required-badge>必須</span></div></div>
      <div role="dialog" hidden><div data-field><span data-required-badge>必須</span></div></div>`)
    assert.equal((await page.evaluate(scanFormRules)).length, 2)
    await page.addStyleTag({ content: '[data-required-badge]{align-self:flex-start}' })
    assert.deepEqual(await page.evaluate(scanFormRules), [])
  } finally { await browser.close() }
})
