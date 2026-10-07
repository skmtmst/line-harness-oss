import fs from 'node:fs'
import path from 'node:path'

import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { MENU_SECTIONS } from '@/lib/menu'
import PageHeaderH2 from '@/components/layout/page-header-h2'

vi.mock('next/navigation', () => ({
  usePathname: () => '/nen-campaigns',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

const SRC = path.join(__dirname, '..')

function read(rel: string): string {
  return fs.readFileSync(path.join(SRC, rel), 'utf8')
}

function menuLabel(href: string): string | undefined {
  for (const section of MENU_SECTIONS) {
    const item = section.items.find((candidate) => candidate.href === href)
    if (item) return item.label
  }
  return undefined
}

/*
 * Issue #637「アクセシビリティ一括（h1重複・h1/ルート不一致・無名ボタン）」
 * の契約固定。
 *
 * h1重複: トップバー（shared/TopBar）が画面名の h1 を1つ持つので、
 * 本文のページ見出しを二重に h1 で出してはいけない。共有 PageHeader は
 * h1 を描く設計（別用途で h1 が要る画面のため）なので、本文見出しだけを
 * h2 に落とす PageHeaderH2 を画面側で使う。視覚は page-header.module.css
 * そのまま。
 */
describe('Issue #637 h1は1画面に1つ', () => {
  it('PageHeaderH2 は h2 を描き、h1 を描かない', () => {
    const html = renderToStaticMarkup(
      <PageHeaderH2
        breadcrumb={[{ label: '専用機能' }, { label: 'NEN配信' }]}
        title="NEN配信"
        description=""
      />,
    )
    expect(html).toContain('<h2')
    expect(html).not.toContain('<h1')
  })

  it('本文見出しをh1に戻さない（重複が直った画面はh2版を使う）', () => {
    for (const rel of ['app/nen-campaigns/nen-overview.tsx', 'app/ec-commerce/page.tsx']) {
      const src = read(rel)
      expect(src, rel + ' が共有PageHeader（h1）へ戻っている').toContain(
        "@/components/layout/page-header-h2",
      )
      expect(src, rel + ' が共有PageHeader（h1）へ戻っている').not.toContain(
        "@/components/shared/page-header",
      )
    }
  })

  it('/nen-members の深い画面（掲載管理・1枚表示）もh1を置かない', () => {
    // トップバーの「投稿」（h1）と並ぶと1画面に h1 が2つになるため h2 へ。
    // 掲載管理の古い photo-publications.tsx はどこからも描かれないので 2026-10-07 に消した。
    for (const rel of ['app/nen-members/photo-review-detail.tsx']) {
      const src = read(rel)
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
      expect(src, rel + ' に h1 が戻っている').not.toMatch(/<h1[\s>]/)
    }
  })
})

/*
 * h1とルート名の不一致: ナビの項目名（apps/web/src/lib/menu.ts が正本）と
 * 画面に出る名前を一致させる。
 *
 * - /nen-members … 監査は「h1:投稿」を不一致と記録したが、現行ナビも
 *   「投稿」。V6-22 は写真審査（投稿）画面であり、監査時点の
 *   「会員」想定は旧定義。現行ナビ名を正として固定する。
 * - /affiliates … V8では独立した「成果とアフィリエイト」の画面。
 *   旧 /conversions?tab=affiliates から移動しても画面名を一致させる。
 */
describe('Issue #637 画面名とナビ名の一致', () => {
  it('ナビ項目名が監査対象ルートに対して正しい', () => {
    expect(menuLabel('/conversions?tab=affiliates')).toBe('成果とアフィリエイト')
    expect(menuLabel('/conversions')).toBe('コンバージョン')
    expect(menuLabel('/nen-members')).toBe('投稿')
    expect(menuLabel('/nen-campaigns')).toBe('NEN配信')
    expect(menuLabel('/ec-commerce')).toBe('EC連携')
  })

  it('独立したコンバージョンと成果・アフィリエイトが上部バーへ画面名を渡す', () => {
    // タブ名を引く古い関数（conversions/conversions-tab-title.ts）はどの画面も使っていないので 2026-10-07 に消した。
    // 画面名を渡すのは下の page.tsx と affiliates-v8.tsx（今の画面）。
    const src = read('app/conversions/page.tsx')
    expect(src).toContain("usePageTitle('コンバージョン')")
    expect(src).toContain('router.replace(target)')
    expect(src).toContain('`/affiliates?${params.toString()}`')
    const affiliates = read('app/affiliates/affiliates-v8.tsx')
    expect(affiliates).toContain('usePageTitle(TITLE_BY_TAB[tab])')
    expect(affiliates).toContain("affiliates: '成果とアフィリエイト'")
  })
})
