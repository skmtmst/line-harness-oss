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
    expect(project).toMatch(/<ListToolbar search=\{\{/)
    expect(project).toContain('プロジェクト名・説明で探す')
    expect(TOOLBAR).toContain('export function ListToolbarSearchSlot')
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot > \*\s*\{[^}]*min-width:\s*0/s)
  })
  it('プロジェクトの並び順は検索スロットの外に置く', () => {
    expect(project).toMatch(/trailing=\{<Select aria-label="プロジェクトの並び順"/)
    expect(project).toContain('size="content"')
  })
  it('画像検索も共通の検索スロットへ置き、並びはその外へ置く', () => {
    expect(library).toMatch(/<ListToolbar search=\{\{/)
    expect(library).toContain('テキスト・指示で探す')
    expect(library).toContain('trailing={<span>並び：作成が新しい順</span>}')
  })
})
describe('バナー生成のタブ行（U032）', () => {
  it('共通の道具の段は狭い幅で折り返せる', () => {
    expect(TOOLBAR_CSS).toMatch(/\.row[12]\s*\{[^}]*flex-wrap:\s*wrap/s)
    expect(TOOLBAR_CSS).toMatch(/\.searchSlot\s*\{[^}]*max-width:\s*100%/s)
  })
  it('作成は型が配置できる口へ渡し、タブ切替は共通部品へ残す', () => {
    expect(project).toContain('createAction={createProject}')
    expect(library).toContain('createAction={uploadImage}')
    expect(LIST).toContain('<Tabs')
  })
})
