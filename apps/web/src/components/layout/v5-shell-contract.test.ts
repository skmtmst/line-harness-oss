import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = dirname(fileURLToPath(import.meta.url))
const WEB = join(ROOT, '..', '..', '..')
const read = (...parts: string[]) => readFileSync(join(WEB, ...parts), 'utf8')

describe('Pen.dev V6の共通画面枠', () => {
  const shell = read('src', 'components', 'app-shell.tsx')
  const shellCss = read('src', 'components', 'app-shell.module.css')
  const sidebar = read('src', 'components', 'layout', 'sidebar.tsx')
  const sidebarCss = read('src', 'components', 'layout', 'sidebar.module.css')

  it('J33xqを正本にし、古い画面枠名を残さない', () => {
    expect(shell).toContain('data-design-shell="v6-1920"')
    expect(shell).not.toContain('data-design-shell="v5-1920"')
    expect(shell).toContain('data-design-node="J33xq"')
    expect(shell).not.toContain('data-design-shell="v4-1920"')
    expect(sidebar).toContain('data-design-node="J33xq"')
  })

  it('1920pxでサイドバー256px、本体左右40pxにする', () => {
    expect(sidebarCss).toContain('width: 256px')
    expect(sidebarCss).toContain('flex: 0 0 256px')
    expect(shellCss).toContain('max-width: var(--container-shell)')
    // 上14px は ★V6 260枚すべてで例外がなかった値（docs/v6-common-rules.md §1）。
    expect(shellCss).toContain('padding: 14px 40px 32px')
  })

  it('画面の高さを固定しない', () => {
    // ★V6 の画面の高さは12種類ある。1080px 固定にすると、縦の短いPCで
    // 中身が無いのに縦スクロールが出る（同 §5）。
    expect(shellCss).toContain('min-height: 100vh')
    expect(shellCss).not.toMatch(/height:\s*1080px/)
  })

  it('トップバーを枠から出し、画面ごとに置かせない', () => {
    expect(shell).toContain('AppTopBar')
    expect(shell).toContain('PageChromeProvider')
  })

  it('全幅はページが明示したときだけ効く', () => {
    // ルート名で自動判定しない（同 §11-3）。
    expect(shell).toContain('fullWidth')
    expect(shell).not.toContain("'/chats'")
    expect(shellCss).toContain('.contentFull')
  })

  it('メニューの通常・選択・フォーカス状態を共通CSSで持つ', () => {
    for (const value of [
      'height: 40px',
      'gap: 11px',
      'border-radius: var(--radius-card)',
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

describe('共通部品への移管実証', () => {
  const dashboard = read('src', 'app', 'page.tsx')
  const chats = read('src', 'app', 'chats', 'page.tsx')
  const friends = read('src', 'app', 'friends', 'page.tsx')
  /*
    友だち属性は `app/tags/page.tsx` ではなく V4 本体を見る。
    入口の page は V4 を1つ置くだけで、見出しもタブも持たない。
    2026-09-02 にこの枝を消すまで、ここは page に残っていた
    **描かれない旧V5コード**を見て合格していた。
    画面ではなく死んだコードを見張っていたことになる。
  */
  const tags = read('src', 'components', 'friend-fields', 'tags-page-v4.tsx')
  const tagEntry = read('src', 'app', 'tags', 'page.tsx')
  const tagEdit = read('src', 'app', 'tags', 'edit', 'page.tsx')

  it.each([
    ['ダッシュボード', dashboard],
    ['受信箱', chats],
    ['友だち', friends],
    // 2026-09-02: 友だち属性もこちら側。V4 はタイトルと説明を共通トップバーへ
    // 預けている（docs/v6-common-rules.md §1）。旧V5だけが本文にHeaderを
    // 置いていて、その死んだコードがここを「共通Headerを使う」側に見せていた。
    ['友だち属性', tags],
    ['友だち属性の入口', tagEntry],
  ])('%sは共通トップバーと重なる本文Headerを置かない', (_name, source) => {
    expect(source).not.toContain("import Header from '@/components/layout/header'")
    expect(source).not.toContain('<Header')
  })

  it('友だちと友だち属性が共通タブを使う', () => {
    expect(friends).toContain('<MergedTabs')
    // 友だち属性のV4は画面内タブ（`shared/tabs` の `VPn1F`）。
    // 自前で組んでいないことを見る。
    expect(tags).toContain("import { Tabs } from '@/components/shared/tabs'")
    expect(tags).toContain('<Tabs')
  })

  it('タグ編集が共通パンくずを使う', () => {
    expect(tagEdit).toContain("import Breadcrumb from '@/components/layout/breadcrumb'")
    expect(tagEdit).toContain('<Breadcrumb')
  })
})
