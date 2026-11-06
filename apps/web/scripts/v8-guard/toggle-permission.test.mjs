import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from '@playwright/test'
import { connectGuardBrowser } from './browser-session.mjs'
import { compileUiStyles } from './compile-ui-styles.mjs'

const require = createRequire(import.meta.url)
const fromVitest = createRequire(require.resolve('vitest/package.json'))
const { build } = createRequire(fromVitest.resolve('vite'))('esbuild')
const webRoot = fileURLToPath(new URL('../..', import.meta.url))
const bundle = await build({
  stdin: { resolveDir: webRoot, loader: 'tsx', contents: `
    import React from 'react';
    import {createRoot} from 'react-dom/client';
    import Toggle from './src/components/shared/toggle';
    import {PERMISSION_LOCK_REASON} from './src/components/shared/permission-lock';
    createRoot(document.getElementById('root')).render(
      <form onSubmit={event=>{event.preventDefault();globalThis.toggleSubmitCalls++}}>
        <div onClick={()=>globalThis.toggleParentCalls++}>
          <button type="button">スイッチの前</button>
          <Toggle label="通知を使う" checked={globalThis.toggleChecked}
            lockedReason={globalThis.toggleReasonFault?undefined:PERMISSION_LOCK_REASON.manager}
            onChange={next=>globalThis.toggleChanges.push(next)} />
        </div>
      </form>
    );
  ` },
  absWorkingDir: webRoot, tsconfig: join(webRoot, 'tsconfig.json'),
  bundle: true, write: false, outfile: 'toggle-permission-fixture.js',
  platform: 'browser', format: 'iife', jsx: 'automatic',
  loader: { '.module.css': 'local-css' },
  // フォームの試験では使わないリンクの接続だけを、単純なanchorにする。
  plugins: [{ name: 'fixture-navigation', setup(builder) {
    builder.onResolve({ filter: /^@\/components\/shared\/list-navigation$/ }, () => ({ path: 'link', namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
      contents: 'import React from "react";export default function Link(props){return React.createElement("a",props)}',
      resolveDir: webRoot,
    }))
  } }],
})
const globals = await compileUiStyles(join(webRoot, 'src/app/globals.css'), ['fixed', 'min-w-0'])
const css = globals + '\n' + bundle.outputFiles.find(file => file.path.endsWith('.css')).text
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text
const reason = 'この操作はオーナーか管理者だけができます。'

async function mount(page, width, checked, fault = false) {
  await page.setViewportSize({ width, height: 500 })
  await page.setContent(`<html lang="ja" data-theme="v8"><style>${css}main{padding:24px}form{margin:80px 24px}form>div{display:flex;gap:24px;align-items:center}</style><div id="root"></div></html>`)
  await page.addScriptTag({ content: `globalThis.toggleChecked=${checked};globalThis.toggleReasonFault=${fault};globalThis.toggleChanges=[];globalThis.toggleParentCalls=0;globalThis.toggleSubmitCalls=0;` + script })
  await page.getByRole('switch', { name: '通知を使う' }).waitFor()
}

async function inspect(page) {
  return page.getByRole('switch', { name: '通知を使う' }).evaluate(element => {
    const css = getComputedStyle(element), sample = document.createElement('span')
    sample.style.background = 'var(--color-toggle-locked)'
    document.body.appendChild(sample)
    const gray = getComputedStyle(sample).backgroundColor
    sample.remove()
    return {
      disabled: element.disabled, ariaDisabled: element.getAttribute('aria-disabled'),
      checked: element.getAttribute('aria-checked'), background: css.backgroundColor,
      image: css.backgroundImage, gray,
      reason: element.getAttribute('aria-describedby')?.split(/\s+/).map(id => document.getElementById(id)?.textContent).join(' '),
      changes: globalThis.toggleChanges, parentCalls: globalThis.toggleParentCalls, submitCalls: globalThis.toggleSubmitCalls,
    }
  })
}

const conforms = (row, checked) => !row.disabled && row.ariaDisabled === 'true' && row.checked === String(checked)
  && row.background === row.gray && row.gray !== 'rgba(0, 0, 0, 0)' && row.image === 'none' && row.reason === reason
  && row.changes.length === 0 && row.parentCalls === 0 && row.submitCalls === 0

async function clickCenter(page, control) {
  const box = await control.boundingBox()
  assert.ok(box)
  assert.equal(await control.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
  }), true)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

for (const width of [1024, 1152, 1440]) for (const checked of [false, true]) {
  test(`権限スイッチの灰色・Tab・実click/Enter/Space/tapと理由欠落の故障・復元 ${width} ${checked}`, async () => {
    const browser = await connectGuardBrowser()
    try {
      const page = await browser.newPage({ reducedMotion: 'reduce' }), errors = []
      page.on('pageerror', error => errors.push(error.message))
      await mount(page, width, checked)
      const toggle = page.getByRole('switch', { name: '通知を使う' })
      await page.getByRole('button', { name: 'スイッチの前' }).focus()
      await page.keyboard.press('Tab')
      await expect(toggle).toBeFocused()
      await expect(page.getByRole('tooltip')).toHaveText(reason)
      await page.keyboard.press('Enter')
      await page.keyboard.press('Space')
      await clickCenter(page, toggle)
      assert.equal(conforms(await inspect(page), checked), true)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('tooltip')).toHaveCount(0)
      await page.getByRole('button', { name: 'スイッチの前' }).hover()
      await toggle.hover()
      await expect(page.getByRole('tooltip')).toHaveText(reason)
      if (process.env.V8_GUARD_ARTIFACT_DIR) {
        mkdirSync(process.env.V8_GUARD_ARTIFACT_DIR, { recursive: true })
        await page.screenshot({ path: join(process.env.V8_GUARD_ARTIFACT_DIR, `permission-toggle-${width}-${checked}.png`) })
      }
      await mount(page, width, checked, true)
      assert.equal(conforms(await inspect(page), checked), false)
      await clickCenter(page, page.getByRole('switch', { name: '通知を使う' }))
      assert.deepEqual((await inspect(page)).changes, [!checked])
      await mount(page, width, checked)
      assert.equal(conforms(await inspect(page), checked), true)
      await clickCenter(page, page.getByRole('switch', { name: '通知を使う' }))
      assert.equal(conforms(await inspect(page), checked), true)
      const touch = await browser.newPage({ hasTouch: true, reducedMotion: 'reduce' })
      touch.on('pageerror', error => errors.push(error.message))
      await mount(touch, width, checked)
      const box = await touch.getByRole('switch', { name: '通知を使う' }).boundingBox()
      assert.ok(box)
      await touch.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
      await expect(touch.getByRole('tooltip')).toHaveText(reason)
      assert.equal(conforms(await inspect(touch), checked), true)
      assert.deepEqual(errors, [])
    } finally { await browser.close() }
  })
}
