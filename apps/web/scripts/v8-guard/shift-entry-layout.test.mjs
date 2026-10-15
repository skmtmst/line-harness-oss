import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'
import scanShiftEntrySpacing from './shift-entry-layout-browser.mjs'
import { measurePage } from './layout-defects.mjs'
const css = path => readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8').replace(/:global\(([^()]*)\)/g,'$1')
const styles = css('app/globals.css').replace(/@theme\s*\{/g,':root {') + css('v8/booking-staff/shifts.module.css') + css('components/shared/text-field.module.css')

test('日ごとの休みの入力は共通の間隔。CSSが効かない故障と復旧を実寸で測る', async () => {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const [width, contentWidth] of [[1152,804],[1440,664],[1920,1144]]) {
      await page.setViewportSize({width,height:1128})
      await page.setContent(`<style>${styles}*{box-sizing:border-box}main{width:${contentWidth}px}.kindBox button,.dateBox button{width:100%;height:36px}.kindBox button{height:32px}.dayAdd>button{height:32px;flex-shrink:0}</style><main><div class="dayAdd" data-shift-day-entry="closed"><span class="kindBox"><button>この日だけの休み</button></span><span class="dateBox"><button aria-haspopup="dialog" aria-label="この日の日付">日付を選ぶ</button></span><span style="display:contents"><input class="field single memo" aria-label="休みの理由" value="入力を残す"></span><button>足す</button></div></main>`)
      assert.ok(await page.locator('[data-shift-day-entry]').evaluate(el=>el.getBoundingClientRect().height>0))
      assert.deepEqual(await page.evaluate(scanShiftEntrySpacing),[])
      const broken=await page.addStyleTag({content:'.dayAdd{display:block!important}'})
      assert.ok((await page.evaluate(scanShiftEntrySpacing)).length>0)
      assert.ok((await measurePage(page)).some(f=>f.kind==='form-shift-entry-spacing'))
      await broken.evaluate(el=>el.remove())
      assert.deepEqual(await page.evaluate(scanShiftEntrySpacing),[])
      assert.equal(await page.getByRole('textbox',{name:'休みの理由'}).inputValue(),'入力を残す')
    }
  } finally { await browser.close() }
})
