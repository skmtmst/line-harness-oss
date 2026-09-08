import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const APP = resolve(import.meta.dirname, '../../app')
const GRID_PAGES = [
  'auto-replies/page.tsx',
  'broadcasts/page.tsx',
  'contents/page.tsx',
  'contents/vars/page.tsx',
  'form-submissions/page.tsx',
  'friend-add-settings/page.tsx',
  'inflow-links/page.tsx',
  'reminders/page.tsx',
  'rich-menus/page.tsx',
  'scenarios/page.tsx',
  'webinars/page.tsx',
]

describe('オーナー指示 #582 のフォルダ欄', () => {
  it.each(GRID_PAGES)('%s は共通幅を使う', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toContain('FOLDER_RAIL_GRID_CLASS')
    expect(page).toContain('style={FOLDER_RAIL_STYLE}')
    expect(page).not.toContain('lg:grid-cols-[16rem_minmax(0,1fr)]')
  })

  it.each(GRID_PAGES)('%s は追加操作をフォルダ欄へ渡す', (relativePath) => {
    const page = readFileSync(resolve(APP, relativePath), 'utf8')
    expect(page).toMatch(/<FolderPanel[\s\S]*?(onAddFolder|addFolderDisabled)/)
  })

  it('テンプレートも同じ幅と欄内追加操作を使う', () => {
    const page = readFileSync(resolve(APP, 'templates/page.tsx'), 'utf8')
    const styles = readFileSync(resolve(APP, 'templates/templates-v6.module.css'), 'utf8')
    expect(page).toContain('style={FOLDER_RAIL_STYLE}')
    expect(page).toContain('onAddFolder={() => setFolderDialogOpen(true)}')
    expect(styles).toContain('width: var(--folder-rail-width)')
    expect(styles).toContain('flex: 0 0 var(--folder-rail-width)')
  })

  it('イベント一覧にはフォルダ欄を新設しない', () => {
    const events = readFileSync(resolve(APP, 'events/page.tsx'), 'utf8')
    expect(events).not.toContain('<FolderPanel')
  })
})
