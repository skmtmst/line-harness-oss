// @vitest-environment happy-dom
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListPage, ListPageBody } from './index'

afterEach(cleanup)

const rows = [
  { id: '', label: 'すべて' },
  { id: 'f1', label: '春の案内' },
]
const collapsedRegion = (container: HTMLElement) => container.querySelector('[data-template-region="collapsed-folders"]')
const toolbarRegion = (container: HTMLElement) => container.querySelector('[data-template-region="toolbar"]')

describe('一覧の型：板が狭いときに畳む左の列（folderNav）', () => {
  it('folderNav を渡すと、作るボタンと「フォルダ：今のフォルダ」の選ぶ欄を畳んだ段に出し、選ぶと渡した処理を呼ぶ', () => {
    const onSelect = vi.fn()
    const { container } = render(
      <ListPage title="一覧" folders={<nav>列</nav>} folderNav={{ rows, activeId: '', onSelect, createAction: <a href="/new">＋ 作る</a> }}>本文</ListPage>,
    )
    const collapsed = collapsedRegion(container)!
    expect(collapsed).toBeTruthy()
    expect(collapsed.querySelector('a[href="/new"]')?.textContent).toBe('＋ 作る')
    const trigger = screen.getByRole('button', { name: 'フォルダ' })
    expect(collapsed.contains(trigger)).toBe(true)
    expect(trigger.textContent).toContain('フォルダ：すべて')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'フォルダ：春の案内' }))
    expect(onSelect).toHaveBeenCalledWith('f1')
  })

  it('呼び名を渡すとその名で出す（統括のアカウントは「タグ：すべて」）。作るボタンを渡さない（閲覧のみ）ときは作るを出さない', () => {
    const { container } = render(
      <ListPage title="一覧" folders={<nav>列</nav>} folderNav={{ rows, activeId: 'f1', onSelect: () => {}, label: 'タグ' }}>本文</ListPage>,
    )
    expect(screen.getByRole('button', { name: 'タグ' }).textContent).toContain('タグ：春の案内')
    expect(collapsedRegion(container)!.querySelectorAll('a').length).toBe(0)
  })

  it('選ぶものが2つある画面は配列で渡し、2つとも出す', () => {
    render(
      <ListPage
        title="一覧"
        folders={<nav>列</nav>}
        folderNav={[
          { rows, activeId: '', onSelect: () => {}, label: '種類' },
          { rows, activeId: 'f1', onSelect: () => {}, label: '分類' },
        ]}
      >本文</ListPage>,
    )
    expect(screen.getByRole('button', { name: '種類' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '分類' })).toBeTruthy()
  })

  it('画面が collapsedFolders を渡したときはそれを優先し、型は組まない', () => {
    render(
      <ListPageBody folders={<nav>列</nav>} collapsedFolders={<span>画面の畳んだ段</span>} folderNav={{ rows, activeId: '', onSelect: () => {} }}>本文</ListPageBody>,
    )
    expect(screen.getByText('画面の畳んだ段')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'フォルダ' })).toBeNull()
  })

  it('左の列が無い（画面が狭い幅で列を外した）ときは出さない。1152 用の道具の段と二重にしない', () => {
    const { container } = render(<ListPageBody folderNav={{ rows, activeId: '', onSelect: () => {} }}>本文</ListPageBody>)
    expect(collapsedRegion(container)).toBeNull()
    expect(toolbarRegion(container)).toBeNull()
  })

  it('道具を渡さない画面では、畳んだ段だけの道具の段に印を付ける（広い板では CSS が隠す）', () => {
    const { container, rerender } = render(<ListPageBody folders={<nav>列</nav>} folderNav={{ rows, activeId: '', onSelect: () => {} }}>本文</ListPageBody>)
    expect(toolbarRegion(container)!.hasAttribute('data-collapsed-only')).toBe(true)
    rerender(<ListPageBody folders={<nav>列</nav>} folderNav={{ rows, activeId: '', onSelect: () => {} }} toolbar={<span>探す</span>}>本文</ListPageBody>)
    expect(toolbarRegion(container)!.hasAttribute('data-collapsed-only')).toBe(false)
  })
})

describe('一覧の型の CSS：畳んだ段は板が 1100 未満のときだけ', () => {
  const css = readFileSync(resolve(import.meta.dirname, 'page-templates.module.css'), 'utf8')
  const narrowBlock = css.slice(css.indexOf('@container v8-page (max-width: 1099px)'))
  it('広い板では畳んだ段も、畳んだ段だけの道具の段も隠す', () => {
    expect(css).toMatch(/\.collapsedFolders \{ display: none; \}/)
    expect(css).toMatch(/\.toolbar\[data-collapsed-only\] \{ display: none; \}/)
  })
  it('狭い板では左の列を隠し、畳んだ段と道具の段を出す', () => {
    expect(narrowBlock).toMatch(/\.folders \{ display: none; \}/)
    expect(narrowBlock).toMatch(/\.collapsedFolders \{ display: flex;/)
    expect(narrowBlock).toMatch(/\.toolbar\[data-collapsed-only\] \{ display: flex; \}/)
  })
  it('選ぶ欄の幅は 1152 の板の値（変数）を使う', () => {
    expect(css).toMatch(/\.collapsedSelect \{[^}]*width: var\(--tpl-narrow-folder-w\)/)
  })
})

describe('左の列を持つ一覧は、畳んだときの行き先も持つ', () => {
  const SRC = resolve(import.meta.dirname, '../..')
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); continue }
      if (full.endsWith('.tsx') && !/\.test\.tsx$/.test(full)) files.push(full)
    }
  }
  walk(join(SRC, 'v8'))
  walk(join(SRC, 'app'))
  const LIST_USERS = /<(ListPage|ListPageBody|AffiliateFrame|MileageFrame)\b/
  const listFiles = files.filter((file) => {
    const source = readFileSync(file, 'utf8')
    return LIST_USERS.test(source) && /\bfolders=\{/.test(source)
  })
  it('一覧の型を使う画面を拾えている（見張りが空振りしない）', () => {
    expect(listFiles.length).toBeGreaterThan(20)
  })
  it.each(listFiles.map((file) => [relative(SRC, file), file]))('%s は collapsedFolders か folderNav を渡す', (_name, file) => {
    const source = readFileSync(file, 'utf8')
    expect(/\b(collapsedFolders=\{(?!undefined\})|folderNav=\{)/.test(source)).toBe(true)
  })
})
