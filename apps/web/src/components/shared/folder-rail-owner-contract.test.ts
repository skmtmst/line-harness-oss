import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = resolve(import.meta.dirname, '../../app')
const GRID_PAGES = [
  'rich-menus/page.tsx',
]
/* 完全切り替え：管理画面 page は捨て、V8 の list-v8 を見る（幅は CSS の `.split` で付ける）。 */
const V8_FOLDER_PAGES = [
  '../v8/reminders/list.tsx',
]
/*
 * シナリオ・回答フォームの入口は src/v8 の新しい一覧（2026-10-06〜。古い list-v8.tsx はもう描かれない）。
 * 新しい一覧はフォルダの列を型（ListPage の folders）に渡し、幅は型の CSS（--tpl-folder-width）が持つ。
 */
const SRC_V8 = resolve(import.meta.dirname, '../../v8')
const NEW_V8_FOLDER_PAGES = [
  'templates/list.tsx',
  'scenarios/list.tsx',
  'auto-replies/list.tsx',
  'broadcasts/list.tsx',
  'friend-add/list.tsx',
  'forms/list.tsx',
  'webinars/list.tsx',
]
const SWITCHED_GRID_PAGES = ['contents/list.tsx', 'common-vars/list.tsx']

describe('オーナー指示 #582 のフォルダ欄', () => {
  it.each(SWITCHED_GRID_PAGES)('src/v8/%s は型の共通の列幅を使う', (relativePath) => {
    const page = readFileSync(resolve(SRC_V8, relativePath), 'utf8')
    expect(page).toMatch(/<ListPage[\s\S]*?folders=\{/)
    const templateCss = readFileSync(resolve(import.meta.dirname, '../templates/page-templates.module.css'), 'utf8')
    expect(templateCss).toMatch(/\.folders \{[^}]*width: var\(--tpl-folder-width\)/)
  })

  it.each(SWITCHED_GRID_PAGES)('src/v8/%s は追加の権限を共通のフォルダ欄へ渡す', (relativePath) => {
    const page = readFileSync(resolve(SRC_V8, relativePath), 'utf8')
    expect(page).toMatch(/<ManagedFolderPanel[\s\S]*?canManage=/)
  })
  it.each(GRID_PAGES)('%s は共通幅を使う', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toMatch(/<ListPage[\s\S]*?folders=\{/)
    const css = readFileSync(resolve(import.meta.dirname, '../templates/page-templates.module.css'), 'utf8')
    expect(css).toContain('width: var(--tpl-folder-width)')
    expect(page).not.toContain('lg:grid-cols-[16rem_minmax(0,1fr)]')
  })

  it.each(GRID_PAGES)('%s は追加操作をフォルダ欄へ渡す', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toMatch(/<ManagedFolderPanel[\s\S]*?canManage=\{canEdit\}/)
  })

  it.each(V8_FOLDER_PAGES)('%s は共通の FolderPanel（ManagedFolderPanel）と追加操作を使う', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    const css = readFileSync(resolve(APP, 'reminders/list-v8.module.css'), 'utf8')
    expect(page).toMatch(/<FolderPanel[\s\S]*?(onAddFolder|addFolderDisabled)|<ManagedFolderPanel[\s\S]*?canManage=/)
    expect(css).toMatch(/grid-template-columns:\s*200px minmax\(0, 1fr\)/)
    expect(css).toMatch(/@container[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s)
  })

  it.each(NEW_V8_FOLDER_PAGES)('src/v8/%s は共通の FolderPanel（ManagedFolderPanel）と追加操作を型のフォルダの列へ渡す', (relativePath) => {
    const page = readFileSync(resolve(SRC_V8, relativePath), 'utf8')
    expect(page).toMatch(/<FolderPanel[\s\S]*?(onAddFolder|addFolderDisabled)|<ManagedFolderPanel[\s\S]*?canManage=/)
    expect(page).toMatch(/<ListPage[\s\S]*?folders=\{/)
    const templateCss = readFileSync(resolve(import.meta.dirname, '../templates/page-templates.module.css'), 'utf8')
    expect(templateCss).toMatch(/\.folders \{[^}]*width: var\(--tpl-folder-width\)/)
  })

  it('テンプレートも同じ幅と欄内追加操作を使う', () => {
    const page = readFileSync(resolve(SRC_V8, 'templates/list.tsx'), 'utf8')
    const styles = readFileSync(resolve(import.meta.dirname, '../templates/page-templates.module.css'), 'utf8')
    expect(page).toContain('folders={folderPanel}')
    expect(page).toContain('onAddFolder={canMutateTemplates ? () => setFolderDialogOpen(true) : undefined}')
    expect(styles).toContain('width: var(--tpl-folder-width)')
    expect(styles).toContain('flex-shrink: 0')
  })

  it('流入経路はCSSで共通幅を使い、追加操作には閲覧権限を適用する', () => {
    const page = readFileSync(resolve(SRC_V8, 'inflow-links/list.tsx'), 'utf8')
    const css = readFileSync(resolve(import.meta.dirname, '../templates/page-templates.module.css'), 'utf8')
    expect(page).toContain('folders={<>')
    expect(css).toContain('width: var(--tpl-folder-width)')
    expect(page).toContain("onAddFolder={canManageFolders ? () => setEditingGenre('new') : undefined}")
  })

  it('V8のイベント一覧はイベント専用のフォルダを取得・作成する', () => {
    const events = readFileSync(resolve(SRC_V8, 'events/list.tsx'), 'utf8')
    // フォルダの列・追加の窓・「…」は共通の ManagedFolderPanel（kind="event"）が持ち、変えたら読み直す。
    expect(events).toContain("api.folders.list('event', selectedAccountId)")
    expect(events).toMatch(/<ManagedFolderPanel[\s\S]*?kind="event"[\s\S]*?onChanged=\{loadFolders\}[\s\S]*?canManage=/)
  })
})
