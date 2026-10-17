import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const css = path => readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8')
const style = css('app/globals.css').replace(/@theme\s*\{/g, ':root {') + css('components/shared/text-field.module.css')
const field = (label, extra = '') => `<span class="field single affixed" data-affixed-layout="field"><span>¥</span><input class="field single affixedControl" aria-label="${label}" value="8400" ${extra}></span>`

test('接頭辞付きの欄は入力でき、読取専用と無効な欄の値・状態を保つ', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1152,1440,1920]) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(`<style>${style}*{box-sizing:border-box}.column{display:flex;flex-direction:column;width:220px;gap:6px}.inline{display:flex;width:320px}</style><main><div class="column"><label>金額</label>${field('金額')}${field('読取','readonly')}${field('無効','disabled')}</div><div class="inline"><span>接頭辞</span>${field('横の欄').replace('data-affixed-layout="field"','')}</div></main>`)
      for (const label of ['金額','読取','無効','横の欄']) assert.equal(await page.getByLabel(label,{exact:true}).inputValue(),'8400')
      assert.equal(await page.getByLabel('読取').getAttribute('readonly'),'')
      assert.equal(await page.getByLabel('無効').isDisabled(),true)
      await page.getByLabel('金額',{exact:true}).fill('12000')
      assert.equal(await page.getByLabel('金額',{exact:true}).inputValue(),'12000')

    }
  } finally { await browser.close() }
})
