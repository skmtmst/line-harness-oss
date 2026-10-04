import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = resolve(import.meta.dirname, '../../app')
const GRID_PAGES = [
  'auto-replies/page.tsx',
  'broadcasts/page.tsx',
  'contents/page.tsx',
  'contents/vars/page.tsx',
  'friend-add-settings/page.tsx',
  'rich-menus/page.tsx',
]
/* 完全切り替え：v7 page は捨て、V8 の list-v8 を見る（幅は CSS の `.split` で付ける）。 */
const V8_FOLDER_PAGES = [
  'reminders/list-v8.tsx',
  'scenarios/list-v8.tsx',
  'form-submissions/list-v8.tsx',
  'webinars/list-v8.tsx',
  'templates/list-v8.tsx',
]

describe('オーナー指示 #582 のフォルダ欄', () => {
  it.each(GRID_PAGES)('%s は共通幅を使う', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toContain('lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]')
    expect(page).toContain('style={FOLDER_RAIL_STYLE}')
    expect(page).not.toContain('lg:grid-cols-[16rem_minmax(0,1fr)]')
  })

  it.each(GRID_PAGES)('%s は追加操作をフォルダ欄へ渡す', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toMatch(/<FolderPanel[\s\S]*?(onAddFolder|addFolderDisabled)/)
  })

  it.each(V8_FOLDER_PAGES)('%s は共通の FolderPanel と追加操作を使う', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    const css = readFileSync(resolve(APP, relativePath.replace(/\.tsx$/, '.module.css')), 'utf8')
    expect(page).toMatch(/<FolderPanel[\s\S]*?(onAddFolder|addFolderDisabled)/)
    expect(css).toMatch(/grid-template-columns:\s*200px minmax\(0, 1fr\)/)
    expect(css).toMatch(/@container[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  })

  it('テンプレートも同じ幅と欄内追加操作を使う', () => {
    const page = readFileSync(resolve(APP, 'templates/page.tsx'), 'utf8')
    const styles = readFileSync(resolve(APP, 'templates/templates-v6.module.css'), 'utf8')
    expect(page).toContain('style={FOLDER_RAIL_STYLE}')
    expect(page).toContain('onAddFolder={canMutateTemplates ? () => setFolderDialogOpen(true) : undefined}')
    expect(styles).toContain('width: var(--folder-rail-width)')
    expect(styles).toContain('flex: 0 0 var(--folder-rail-width)')
  })

  it('流入経路はCSSで共通幅を使い、追加操作には閲覧権限を適用する', () => {
    const page = readFileSync(resolve(APP, 'inflow-links/page.tsx'), 'utf8')
    const css = readFileSync(resolve(APP, 'inflow-links/inflow-list-v8.module.css'), 'utf8')
    expect(page).toContain('style={FOLDER_RAIL_STYLE}')
    expect(css).toContain('grid-template-columns: var(--folder-rail-width) minmax(0, 1fr)')
    expect(page).toContain("onAddFolder={readonly ? undefined : () => setEditingGenre('new')}")
  })

  it('V8のイベント一覧はイベント専用のフォルダを取得・作成する', () => {
    const events = readFileSync(resolve(APP, 'events/events-list-v8.tsx'), 'utf8')
    expect(events).toContain('<FolderPanel')
    expect(events).toContain("api.folders.list('event', selectedAccountId)")
    expect(events).toContain("api.folders.create({ kind: 'event'")
    expect(events).toContain('onAddFolder=')
  })
})
