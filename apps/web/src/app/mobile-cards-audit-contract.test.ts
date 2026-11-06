import { readUiSource } from '../../scripts/test-ui-source.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/*
 * ★管理画面 監査の直し（m18c：スマホの一覧・はみ出し・隠れる×）。
 * 外部の監査（2026-09-27・検証環境）が指した4件の見張り。
 * 見た目の一致は司令塔の撮影で確かめるので、ここでは「部品・並び・
 * 重なり順」の約束だけを見る。直しを戻すと赤くなる。
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const read = (path: string) => readFileSync(join(HERE, path), 'utf8')

const TEMPLATES = readUiSource(join(HERE, '../v8/templates/list.tsx'), 'utf8')
const TEMPLATES_CSS = read('../v8/templates/list.module.css')
const CONVERSIONS = read('../v8/conversions/list.tsx')
const HEALTH_TAB = read('../v8/nen-health/health.tsx')
const HEALTH_CSS = read('../v8/nen-health/health.module.css')
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
  it('テンプレート一覧は狭いV8の板でも名前と操作を残す', () => {
    expect(TEMPLATES).toContain('useNarrowViewport()')
    expect(TEMPLATES).toMatch(/<DataTable\b[^>]*presentation="template-list"/)
    expect(TEMPLATES).toMatch(/<DataTable\b[^>]*columnSizing="content"/)
    expect(TEMPLATES).toContain('{!narrow && <Th className={styles.headCell}>使っている所</Th>}')
    // 名前欄の max-w-0 を残したCSS畳み込みは名前が消える原因。戻したら赤くなる。
    expect(TEMPLATES).not.toContain('data-template-list')
    expect(TEMPLATES_CSS).not.toContain('[data-template-list]')
  })

  it('テンプレートの表と詳細パネルは名前・種別・本文・使用数・編集・操作を持つ', () => {
    expect(TEMPLATES).toContain('latestContentOf(activeTemplate).slice(0, 120)')
    expect(TEMPLATES).toContain('activeTemplate.usageCount}か所')
    expect(TEMPLATES).toContain('onOpen={() => setActiveId(activeId === t.id ? null : t.id)}')
  })

  it('成果地点の現役一覧は共通の表と省略した全文を使う', () => {
    expect(CONVERSIONS).toContain('<DataTable columnLayout={{')
    expect(CONVERSIONS).toContain('title={point.name}')
    expect(CONVERSIONS).toContain('title={usageLabel(point)}')
    expect(CONVERSIONS).toContain('<ListPage')
  })
})

describe('3: 健康日記は390pxではみ出さない', () => {
  it('V8の狭い板では補足の列を見出しと行の両方で畳む', () => {
    expect(HEALTH_CSS).toContain('@container v8-page (max-width: 1099px)')
    expect(HEALTH_CSS).toMatch(/> th.colStool,[\s\S]*?> td.colStool \{\s*display: none/)
  })

  it('V8の一覧は日付・ペット・変化・主な記録を保持する', () => {
    expect(HEALTH_TAB).toContain('row.lastLoggedLabel')
    expect(HEALTH_TAB).toContain('row.count30d')
    expect(HEALTH_TAB).toContain('30日のまとめ')
  })

  it('V8の名前と補足は省略表示し、全文も読める', () => {
    expect(HEALTH_CSS).toMatch(/\.cell \{[^}]*overflow: hidden;[^}]*text-overflow: ellipsis/)
    expect(HEALTH_TAB).toContain('title={row.pet.callName || name}')
  })
})

describe('4: テンプレート詳細の×は固定の上の帯に隠れない', () => {
  it('詳細面の重なり順は固定のモバイル帯より上（共通の最上層の器にそろえる）', () => {
    const headerZ = zIndexOf(SIDEBAR_CSS, '.mobileHeader')
    expect(headerZ).toBe(50)
    expect(TEMPLATES).toContain('<DetailPanel')
    expect(read('../components/shared/detail-panel.module.css')).toContain('z-index: var(--tpl-detail-panel-z, 70)')
    expect(TEMPLATES).not.toContain('bg-black/30 z-30')
    expect(TEMPLATES).not.toContain('border-hairline z-40 overflow-y-auto')
    expect(70).toBeGreaterThan(headerZ)
  })
})
