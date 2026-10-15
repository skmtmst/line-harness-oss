import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
const kpi = read('../../components/shared/kpi-card.module.css')
const view = read('../../v8/webhooks/outgoing.tsx')
const table = read('../../components/shared/data-table.module.css')
describe('外部連携の一覧は現在のV8の型と数の帯を使う', () => {
  it('数の帯は共通の余白と間隔で描く', () => {
    expect(kpi).toContain('gap: var(--tpl-band-cell-gap)')
    expect(kpi).toContain('padding: var(--tpl-band-cell-pad-block) var(--tpl-band-cell-pad-side)')
    expect(view).toContain('<WebhookBand')
  })
  it('数の帯の題は共通の文字と色を使う', () => {
    expect(kpi).toMatch(/:root \.label \{[^}]*font-size: var\(--text-caption\)/s)
    expect(kpi).toContain('var(--color-ink)')
    expect(read('../../v8/webhooks/shell.tsx')).toContain('presentation="band"')
  })
  it('表の見出しは共通のV8の地と寸法を使う', () => {
    expect(view).toContain('<TableHeadRow data-table-layout="columns">')
    expect(table).toContain('var(--color-table-head)')
    expect(table).toContain('var(--table-head-height)')
  })
  it('狭い板の探す欄の幅は240を保つ', () => {
    expect(view).toContain("label: 'つなぎ先で探す', width: 240")
  })
})
