// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SettingsPage } from './settings-page'
import { readFileSync } from 'node:fs'
afterEach(cleanup)
it('B-40: 設定の絵の違いを型の口から指定し、画面CSSから上書きしない', () => {
  const view = render(<SettingsPage {...{ layout: 'narrow-nav' }} title="設定" navigation="目次">内容</SettingsPage>)
  expect(view.container.querySelector('[data-page-template="settings"]')?.getAttribute('data-template-layout')).toBe('narrow-nav')
  const screenCss = readFileSync('src/v8/settings/sb-frame/settings-screen.module.css', 'utf8')
  expect(screenCss).not.toContain(':global(')
})
