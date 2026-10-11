import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const read = (rel: string) => readFileSync(join(HERE, rel), 'utf8')
const LIST = read('../../../v8/hq-banners/list.tsx')
const TOOLBAR = read('../../../components/shared/list-toolbar.tsx')
const TOOLBAR_CSS = read('../../../components/shared/list-toolbar.module.css')
const project = LIST.slice(LIST.indexOf('function ProjectsView'), LIST.indexOf('function LibraryView'))
const library = LIST.slice(LIST.indexOf('function LibraryView'))

describe('バナー生成の検索行（U017）', () => {
  it('プロジェクト検索は共通の幅を持つ検索スロットへ置く', () => {
    expect(project).toMatch(/<ListToolbarSearchSlot>[\s\S]*?<SearchField/)
    expect(project).toContain('プロジェクト名・説明で探す')
    expect(TOOLBAR).toContain('export function ListToolbarSearchSlot')
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot > \*\s*\{[^}]*min-width:\s*0/s)
  })
  it('プロジェクトの並び順は検索スロットの外に置く', () => {
    expect(project.indexOf('aria-label="プロジェクトの並び順"')).toBeGreaterThan(project.indexOf('</ListToolbarSearchSlot>'))
    expect(project).toContain('className={styles.projectSort}')
  })
  it('画像検索も共通の検索スロットへ置き、並びはその外へ置く', () => {
    expect(library).toMatch(/<ListToolbarSearchSlot>[\s\S]*?<SearchField/)
    expect(library).toContain('テキスト・指示で探す')
    expect(library.indexOf('並び：作成が新しい順')).toBeGreaterThan(library.indexOf('</ListToolbarSearchSlot>'))
  })
})
describe('バナー生成のタブ行（U032）', () => {
  it('共通の道具の段は狭い幅で折り返せる', () => {
    expect(TOOLBAR_CSS).toMatch(/\.row[12]\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot\s*\{[^}]*max-width:\s*100%/s)
  })
  it('V8の操作はフォルダの列に置き、タブ行と分ける', () => {
    expect(project).toContain('createAction={createProject}')
    expect(library).toContain('createAction={uploadImage}')
    expect(LIST).toContain('<Tabs')
  })
})
