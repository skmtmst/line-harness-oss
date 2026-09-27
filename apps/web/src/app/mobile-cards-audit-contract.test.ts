import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * ★V7 監査の直し（m18c：スマホの一覧・はみ出し・隠れる×）。
 * 外部の監査（2026-09-27・検証環境）が指した4件の見張り。
 * 見た目の一致は司令塔の撮影で確かめるので、ここでは「部品・並び・
 * 重なり順」の約束だけを見る。直しを戻すと赤くなる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

const TEMPLATES = read('templates/page.tsx')
const TEMPLATES_CSS = read('templates/templates-v6.module.css')
const CONVERSIONS = read('conversions/page.tsx')
const HEALTH_TAB = read('nen/health/health-tab.tsx')
const SHARED_CARD = read('../components/shared/mobile-table-cards.tsx')
const SIDEBAR_CSS = read('../components/layout/sidebar.module.css')

function zIndexOf(css: string, selector: string): number {
  const block = css.slice(css.indexOf(selector))
  const match = block.match(/z-index:\s*(\d+)/)
  if (!match) throw new Error(`z-index not found for ${selector}`)
  return Number(match[1])
}

describe('1: 共通の表に「スマホではカード」の形がある', () => {
  it('共有部品は767px以下だけ出す（md:hidden）', () => {
    expect(SHARED_CARD).toContain('md:hidden')
  })

  it('1行目は名前（2行まで）＋状態の札、2行目は要点、3行目は主な数字＋操作', () => {
    expect(SHARED_CARD).toContain('line-clamp-2')
    // class の中だけ見る（説明の注に語が出てもよい）。
    expect(SHARED_CARD).not.toMatch(/className="[^"]*truncate/)
    expect(SHARED_CARD).not.toMatch(/className="[^"]*break-all/)
  })
})

describe('2: テンプレート・成果地点の一覧はこの形になる', () => {
  it('テンプレート一覧は表（768px以上）とカード（767px以下）を出し分ける', () => {
    expect(TEMPLATES).toContain('MobileTableCards')
    expect(TEMPLATES).toContain("import MobileTableCards from '@/components/shared/mobile-table-cards'")
    expect(TEMPLATES).toContain('hidden md:block')
    // 名前欄の max-w-0 を残したCSS畳み込みは名前が消える原因。戻したら赤くなる。
    expect(TEMPLATES).not.toContain('data-template-list')
    expect(TEMPLATES_CSS).not.toContain('[data-template-list]')
  })

  it('テンプレートのカードは名前・種別・要点・主な数字・編集・「…」を持つ', () => {
    expect(TEMPLATES).toContain('summary: `${t.messageContent.slice(0, 60)}')
    expect(TEMPLATES).toContain('件で使用')
    expect(TEMPLATES).toContain('onSelect: () => setDrawerId(t.id)')
  })

  it('成果地点の一覧は表（768px以上）とカード（767px以下）を出し分ける', () => {
    expect(CONVERSIONS).toContain('MobileTableCards')
    expect(CONVERSIONS).toContain('hidden md:block')
    expect(CONVERSIONS).toContain('この30日 ${point.metrics.netCount')
    expect(CONVERSIONS).toContain('使う場所を足す')
  })
})

describe('3: 健康日記は390pxではみ出さない', () => {
  it('8列の表は768px以上だけ出し、767px以下は絞ったカードにする', () => {
    expect(HEALTH_TAB).toContain('MobileTableCards')
    expect(HEALTH_TAB).toContain('hidden md:block')
  })

  it('カードは日付・ペット・状態・主な記録に絞る', () => {
    expect(HEALTH_TAB).toContain('最終記録 ${row.lastLoggedLabel}')
    expect(HEALTH_TAB).toContain('30日 ${row.count30d}件')
    expect(HEALTH_TAB).toContain('30日のまとめ')
  })

  it('カード側に横はみ出しの種（固定の最小幅・横スクロール容器）を持ち込まない', () => {
    const start = HEALTH_TAB.indexOf('<MobileTableCards')
    const cardBlock = HEALTH_TAB.slice(start, HEALTH_TAB.indexOf('/>', start))
    expect(cardBlock).not.toContain('min-w-')
    expect(cardBlock).not.toContain('overflow-x-auto')
  })
})

describe('4: テンプレート詳細の×は固定の上の帯に隠れない', () => {
  it('詳細面の重なり順は固定のモバイル帯より上（共通の最上層の器にそろえる）', () => {
    const headerZ = zIndexOf(SIDEBAR_CSS, '.mobileHeader')
    expect(headerZ).toBe(50)
    expect(TEMPLATES).toContain('zIndex: 80')
    expect(TEMPLATES).not.toContain('bg-black/30 z-30')
    expect(TEMPLATES).not.toContain('border-hairline z-40 overflow-y-auto')
    expect(80).toBeGreaterThan(headerZ)
  })
})
