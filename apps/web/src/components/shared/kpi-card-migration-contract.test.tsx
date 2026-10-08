import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KpiCard from './kpi-card'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')

describe('KpiCardへの一本化契約', () => {
  it('数のカードはKpiCardだけを使い、V6の見せ方にする', () => {
    const html = renderToStaticMarkup(
      <KpiCard
        title="成果"
        value={1234}
        unit="件"
        detail="過去28日"
        action={{ label: '確認', href: '/conversions' }}
      />,
    )

    expect(html).toContain('data-design-version="v6"')
    expect(html.replace(/<[^>]*>/g, '')).toContain('1,234件')
    expect(html).toContain('href="/conversions"')
  })

  it('配信告知をbroadcast variantとして明示する', () => {
    const html = renderToStaticMarkup(
      <KpiCard title="今週の配信" value={3} unit="通" detail="過去7日" variant="broadcast" />,
    )

    expect(html).toContain('data-design-version="broadcast"')
    expect(html.replace(/<[^>]*>/g, '')).toContain('3通')
  })

  it('3系統の実装元が共通KpiCardだけを描画する', () => {
    const files = [
      'components/friends/friend-kpis.tsx',
      'components/shared/list-kpis.tsx',
      'components/users/summary-bar.tsx',
    ]

    for (const file of files) {
      const source = readSource(file)
      expect(source, `${file} がKpiCardを使っていない`).toMatch(/import KpiCard/)
      expect(source, `${file} に旧カードの影が残っている`).not.toContain('shadow-[')
      expect(source, `${file} に旧カードの任意角丸が残っている`).not.toContain('rounded-[')
    }
    // 旧 import の互換層（components/dashboard/kpi-card.tsx）は使う所が無くなったので 2026-10-07 に消した。
  })

  it('旧SummaryCardの入口が残っていない', () => {
    const files = [
      'components/friends/friend-kpis.tsx',
      'components/shared/list-kpis.tsx',
      'components/users/summary-bar.tsx',
    ]

    for (const file of files) {
      const source = readSource(file)
      expect(source, `${file} に旧名が残っている`).not.toContain('SummaryCard')
    }
    expect(readSource('components/shared/kpi-card.tsx')).not.toMatch(/function SummaryCard/)
  })
})
