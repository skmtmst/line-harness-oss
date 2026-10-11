import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'
import { chromium } from '@playwright/test'

test('V8 controls keep their appearance when component CSS arrives before Tailwind reset', async () => {
  const globalsPath = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
  const globals = (await postcss([tailwind()]).process(readFileSync(globalsPath, 'utf8'), { from: globalsPath })).css
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    for (const [name, markup] of [
      ['button', '<button class="button standard primary">Save</button>'],
      ['select', '<button class="trigger closedTrigger">Choose</button>'],
    ]) {
      const css = readFileSync(new URL(`../../src/components/shared/${name}.module.css`, import.meta.url), 'utf8')
      const measure = async (first, second) => {
        await page.setContent(`<style>${first}</style><style>${second}</style>${markup}`)
        return page.locator('button').evaluate(el => {
          const style = getComputedStyle(el)
          return Object.fromEntries(['color', 'background-color', 'border-radius', 'padding', 'height', 'font-size', 'box-shadow']
            .map(key => [key, style.getPropertyValue(key)]))
        })
      }
      const globalsFirst = await measure(globals, css)
      assert.equal(globalsFirst['border-radius'] === '0px', false, name)
      if (name === 'button') assert.equal(globalsFirst.color, 'rgb(255, 255, 255)')
      assert.deepEqual(await measure(css, globals), globalsFirst, `${name}: component-first load`)
      const broken = css.replace(/^@layer properties, theme, base, components, utilities;\s*/, '')
      assert.notDeepEqual(await measure(broken, globals), globalsFirst, `${name}: missing layer order must reproduce the regression`)
    }
  } finally {
    await browser.close()
  }
})

test('folder addition keeps the common button line height in either module order', async () => {
  const globalsPath = fileURLToPath(new URL('../../src/app/globals.css', import.meta.url))
  const globals = (await postcss([tailwind()]).process(readFileSync(globalsPath, 'utf8'), { from: globalsPath })).css
  const button = readFileSync(new URL('../../src/components/shared/button.module.css', import.meta.url), 'utf8')
  const folder = readFileSync(new URL('../../src/components/shared/folder-panel.module.css', import.meta.url), 'utf8')
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const measure = async (first, second) => {
      await page.setContent(`<style>${globals}</style><style>${first}</style><style>${second}</style>
        <aside class="panel"><button class="button standard secondary add">Add folder</button></aside>`)
      return page.locator('button').evaluate(el => getComputedStyle(el).lineHeight)
    }
    assert.equal(await measure(button, folder), '20px')
    assert.equal(await measure(folder, button), '20px')
    assert.notEqual(await measure(button, folder.replace('.add {', '.add { line-height: normal;')), '20px',
      'the removed override must reproduce the production difference')
  } finally {
    await browser.close()
  }
})
