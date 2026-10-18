import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { connectGuardBrowser } from './browser-session.mjs'

const read = file => readFileSync(new URL(`../../src/${file}`, import.meta.url), 'utf8')
const globals = read('app/globals.css').replace(/@theme\s*\{/g, ':root {')

test('手順の右欄は白い板1100未満で畳み、完了の印と題は中央へそろえる', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${globals}${read('components/templates/create-step-columns.module.css')}${read('components/templates/create-parts.module.css')}*{box-sizing:border-box}</style><main style="width:calc(100vw - 264px);container:v8-page / inline-size"><div class="columns"><div class="content">入力</div><aside class="preview">補足</aside><div class="toggle">補足を見る</div></div><section style="width:560px"><div class="completionHeading"><span class="completionMark"><svg></svg></span><h2 class="completionTitle">設定を有効にしました</h2><p class="completionDescription">今後の予約にも自動で予定を作ります。</p></div></section></main>`)
      const measure = () => page.evaluate(() => {
        const rect = name => document.querySelector(name).getBoundingClientRect()
        const box = rect('section'), mark = rect('.completionMark'), title = rect('.completionTitle')
        return { preview: rect('aside').width, toggle: rect('.toggle').width,
          centerMark: Math.abs(mark.x + mark.width / 2 - box.x - box.width / 2),
          centerTitle: Math.abs(title.x + title.width / 2 - box.x - box.width / 2),
          markRound: getComputedStyle(document.querySelector('.completionMark')).borderRadius,
          markWidth: mark.width, markHeight: mark.height,
        }
      })
      const normal = await measure()
      assert.equal(normal.preview === 0, width === 1152)
      assert.equal(normal.toggle > 0, width === 1152)
      assert.ok(normal.centerMark < 1 && normal.centerTitle < 1)
      assert.equal(normal.markWidth, normal.markHeight)
      assert.ok(parseFloat(normal.markRound) >= 999)
      await page.addStyleTag({ content: '.preview{display:block!important}.toggle{display:none!important}.completionHeading{align-items:flex-start}.completionTitle{text-align:left}' })
      const fault = await measure()
      assert.ok(fault.centerMark > 1)
      if (width === 1152) assert.ok(fault.preview > 0 && fault.toggle === 0)
    }
  } finally { await browser.close() }
})

test('取り込みの選択カードは共通の横並びで内側の余白を確保する', async () => {
  const browser = await connectGuardBrowser()
  try {
    const page = await browser.newPage()
    for (const width of [1152, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 })
      await page.setContent(`<style>${globals}${read('components/shared/card.module.css')}*{box-sizing:border-box}</style><section class="card horizontal inset" data-card-surface="inset" data-card-spacing style="width:600px;--card-content-padding:var(--polish-space-card);--card-content-gap:var(--tpl-htn-panel-gap)"><input type="checkbox" aria-label="取り込む"><span style="display:flex;flex-direction:column"><strong>既存の友だちの取り込み</strong><span>登録のあとに取り込みます</span></span></section>`)
      const measure = () => page.locator('section').evaluate(card => {
        const box = card.getBoundingClientRect(), child = card.lastElementChild.getBoundingClientRect()
        return { display: getComputedStyle(card).display, top: child.top - box.top, bottom: box.bottom - child.bottom }
      })
      const normal = await measure()
      assert.equal(normal.display, 'flex')
      assert.ok(normal.top >= 12 && normal.bottom >= 12)
      await page.addStyleTag({ content: 'section{padding:0!important}' })
      const fault = await measure()
      assert.ok(fault.top < 12 && fault.bottom < 12)
    }
  } finally { await browser.close() }
})
