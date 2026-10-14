import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import scanPreviewLayout from './create-preview-layout-browser.mjs'
import scanPendec2Rules from './pendec2-rules-browser.mjs'
import { measurePage } from './layout-defects.mjs'

const css = name => readFileSync(new URL('../../src/'+name, import.meta.url), 'utf8').replace(/:global\(([^()]*)\)/g, '$1')
const globals = css('app/globals.css').replace(/@theme\s*\{/g, ':root {')
const shell = (styles, body) => `<html data-theme="v8"><style>${globals}${styles}*{box-sizing:border-box}body{margin:0;font:13px/20px sans-serif}</style><body><main>${body}</main></body></html>`

test('作成型の右カードは中身によらず全幅。縮む故障を検出し、端末幅と狭幅の畳みは保つ', async () => {
  const styles = css('components/templates/page-templates.module.css') + css('components/shared/card.module.css')
  const cards = ['短い題', '中くらいの説明を持つカード', '長い説明と設定の値を持つカード'].map(title => `<section class="card aside" data-card-variant="aside"><h3>${title}</h3><p>内容</p></section>`).join('')
  const body = `<section class="frame" data-standalone data-page-template="create" style="width:1188px"><aside class="preview" data-template-region="preview" data-preview-narrow="hidden"><div class="previewContent">${cards}<div data-phone style="width:300px;height:200px">LINE</div></div></aside></section>`
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1440,1920]) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(shell(styles,body))
      const normal = await page.evaluate(scanPreviewLayout)
      assert.equal(normal.rails[0].cards.length,3)
      assert.deepEqual(normal.findings,[])
      assert.equal(await page.locator('[data-phone]').evaluate(el=>el.getBoundingClientRect().width),300)
      await page.addStyleTag({content:'.previewContent > [data-card-variant="aside"]{width:auto!important;align-self:center!important}'})
      assert.equal((await page.evaluate(scanPreviewLayout)).findings.filter(f=>f.kind==='preview-card-width').length,3)
      assert.ok((await measurePage(page)).some(f=>f.kind==='preview-card-width'))
    }
    await page.setViewportSize({width:1152,height:1128})
    await page.setContent(shell(styles,body.replace('width:1188px','width:900px')))
    assert.equal(await page.locator('[data-template-region="preview"]').isVisible(),false)
    assert.deepEqual((await page.evaluate(scanPreviewLayout)).rails,[])
  } finally { await browser.close() }
})

test('7面のタイルは1段・選択枠と印。2段・丸・印欠け・色の故障は落ち、messageの丸は保つ', async () => {
  const styles = css('components/shared/radio-card.module.css') + css('components/shared/layout-picker.module.css')
  const labels=['1面','上下2面','左右2面','上1・下2','4面','上2・下1','6面']
  const tiles = labels.map((label,index)=>`<label class="card compact tile ${index===6?'checked':''}" data-choice-card data-choice-indicator="check"><input class="radio" type="radio" name="shape" ${index===6?'checked':''}><span class="body"><strong class="title">${index===6?'<svg class="check" data-choice-check></svg>':''}${label}</strong></span><span class="sample">A</span></label>`).join('')
  const body = preview => `<div style="width:712px"><div class="list" role="radiogroup" data-preview="${preview}">${tiles}</div></div>`
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const width of [1152,1440,1920]) for (const preview of ['menu','compact-menu']) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(shell(styles,body(preview)))
      const normal=await page.evaluate(scanPreviewLayout)
      assert.deepEqual(normal.findings,[],JSON.stringify(normal))
      assert.equal(normal.groups[0].tiles.length,7)
      const choices=(await page.evaluate(scanPendec2Rules)).filter(f=>f.kind.startsWith('choice-'))
      assert.deepEqual(choices,[],JSON.stringify(await page.locator('[data-choice-check]').evaluate(el=>({color:getComputedStyle(el).color,parent:getComputedStyle(el.parentElement).color,token:getComputedStyle(el).getPropertyValue('--color-accent-deep')}))))
      await page.addStyleTag({content:'.list{display:flex!important;flex-wrap:wrap!important}.list .tile{width:120px!important}'})
      assert.ok((await page.evaluate(scanPreviewLayout)).findings.some(f=>f.kind==='layout-tile-rows'))
      await page.setContent(shell(styles,body(preview)))
      await page.addStyleTag({content:'.card > .radio{width:18px!important;height:18px!important;opacity:1!important}'})
      await page.waitForFunction(()=>[...document.querySelectorAll('input[type="radio"]')].every(el=>getComputedStyle(el).opacity==='1'))
      assert.ok((await page.evaluate(scanPreviewLayout)).findings.some(f=>f.kind==='layout-tile-radio'),JSON.stringify(await page.locator('input').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height,opacity:getComputedStyle(el).opacity,visibility:getComputedStyle(el).visibility})))))
      assert.ok((await page.evaluate(scanPendec2Rules)).some(f=>f.kind==='choice-check'))
      await page.setContent(shell(styles,body(preview)))
      await page.locator('[data-choice-check]').evaluate(el=>el.remove())
      assert.ok((await page.evaluate(scanPreviewLayout)).findings.some(f=>f.kind==='layout-tile-check'))
      assert.ok((await page.evaluate(scanPendec2Rules)).some(f=>f.kind==='choice-check'))
      await page.setContent(shell(styles,body(preview)))
      await page.addStyleTag({content:'.check{color:black!important}'})
      assert.ok((await page.evaluate(scanPendec2Rules)).some(f=>f.kind==='choice-check-color'))
    }
    await page.setContent(shell(styles,body('message').replaceAll('data-choice-indicator="check"','').replaceAll('data-choice-check','')))
    const radios=await page.locator('input').evaluateAll(els=>els.map(el=>({width:el.getBoundingClientRect().width,opacity:getComputedStyle(el).opacity})))
    assert.ok(radios.every(r=>r.width>1 && r.opacity==='1'))
    assert.deepEqual((await page.evaluate(scanPreviewLayout)).groups,[])
  } finally { await browser.close() }
})
