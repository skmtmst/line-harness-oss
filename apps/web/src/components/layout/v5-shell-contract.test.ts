import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WEB = join(ROOT, '..', '..', '..')
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8')

describe('Pen.dev V5の共通画面枠', () => {
  const shell = read('src', 'components', 'app-shell.tsx')
  const shellCss = read('src', 'components', 'app-shell.module.css')
  const sidebar = read('src', 'components', 'layout', 'sidebar.tsx')
  const sidebarCss = read('src', 'components', 'layout', 'sidebar.module.css')

  it('J33xqを正本にし、V4の画面枠名を残さない', () => {
    expect(shell).toContain('data-design-shell="v5-1920"')
    expect(shell).toContain('data-design-node="J33xq"')
    expect(shell).not.toContain('data-design-shell="v4-1920"')
    expect(sidebar).toContain('data-design-node="J33xq"')
  })

  it('1920pxでサイドバー256px、本体左右40pxにする', () => {
    expect(sidebarCss).toContain('width: 256px')
    expect(sidebarCss).toContain('flex: 0 0 256px')
    expect(shellCss).toContain('max-width: var(--container-shell)')
    expect(shellCss).toContain('padding: 32px 40px 40px')
  })

  it('メニューの通常・選択・フォーカス状態を共通CSSで持つ', () => {
    for (const value of [
      'height: 40px',
      'gap: 11px',
      'border-radius: var(--radius-tile)',
      'background: var(--color-accent-soft)',
      'outline: 2px solid var(--color-accent)',
    ]) expect(sidebarCss).toContain(value)
  })
})

describe('V5共通ヘッダー・パンくず・タブ', () => {
  const header = read('src', 'components', 'layout', 'header.tsx')
  const headerCss = read('src', 'components', 'layout', 'header.module.css')
  const breadcrumb = read('src', 'components', 'layout', 'breadcrumb.tsx')
  const tabs = read('src', 'components', 'layout', 'merged-tabs.tsx')
  const tabsCss = read('src', 'components', 'layout', 'merged-tabs.module.css')

  it('共通ヘッダーを高さ76px・見出し30pxで固定する', () => {
    expect(header).toContain('data-design-node="RWNQP"')
    expect(headerCss).toContain('min-height: 76px')
    expect(headerCss).toContain('font-size: 30px')
    expect(headerCss).toContain('font-weight: 600')
  })

  it('R098Zのパンくずをリンク・現在地・省略へ対応させる', () => {
    expect(breadcrumb).toContain('data-design-node="R098Z"')
    expect(breadcrumb).toContain("{ label: '…' }")
    expect(breadcrumb).toContain("aria-current={current ? 'page' : undefined}")
  })

  it('下線タブとz9TQJの分割タブを同じAPIで使う', () => {
    expect(tabs).toContain("variant?: 'underline' | 'segmented'")
    expect(tabs).toContain("'z9TQJ'")
    expect(tabs).toContain("'VPn1F ISA1Q'")
    expect(tabsCss).toContain('height: 44px')
    expect(tabsCss).toContain('height: 50px')
  })
})

describe('4画面の移管実証', () => {
  const dashboard = read('src', 'app', 'page.tsx')
  const chats = read('src', 'app', 'chats', 'page.tsx')
  const friends = read('src', 'app', 'friends', 'page.tsx')
  const tags = read('src', 'app', 'tags', 'page.tsx')
  const tagEdit = read('src', 'app', 'tags', 'edit', 'page.tsx')

  it.each([
    ['ダッシュボード', dashboard],
    ['受信箱', chats],
    ['友だち', friends],
    ['友だち属性', tags],
  ])('%sが共通Headerを使う', (_name, source) => {
    expect(source).toContain("import Header from '@/components/layout/header'")
    expect(source).toContain('<Header')
  })

  it('友だちと友だち属性が共通タブを使う', () => {
    expect(friends).toContain('<MergedTabs')
    expect(tags).toContain('<MergedTabs')
    expect(tags).toContain('variant="segmented"')
  })

  it('タグ編集が共通パンくずを使う', () => {
    expect(tagEdit).toContain("import Breadcrumb from '@/components/layout/breadcrumb'")
    expect(tagEdit).toContain('<Breadcrumb')
  })
})
