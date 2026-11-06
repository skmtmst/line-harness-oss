import { readUiSource } from '../../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const PAGE = readUiSource(new URL('./page.tsx', import.meta.url), 'utf8')
const CSS = readFileSync(new URL('../../v8/automations/common-actions.module.css', import.meta.url), 'utf8')
describe('共通アクションはV8の共通の型で幅を守る', () => {
  it('見出しは共通の一覧の型へ渡す', () => {
    expect(PAGE).toContain('<ListPage')
    expect(PAGE).not.toContain('data-page-header-wrap')
  })
  it('画面切替は共通のタブへ渡す', () => {
    expect(PAGE).toContain('<AutomationTabs')
    expect(PAGE).not.toContain('data-tabs-row')
  })
  it('表は伸びる名前列を縮めて省略する', () => {
    expect(CSS).toContain('min-width: 0')
    expect(CSS).toContain('text-overflow: ellipsis')
    expect(PAGE).not.toContain('min-width: 800px')
  })
})
