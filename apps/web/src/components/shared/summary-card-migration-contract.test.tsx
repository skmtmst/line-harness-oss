import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import KpiCard from '../dashboard/kpi-card'
import SummaryCard from './summary-card'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(SRC, '..')
const readSource = (path: string) => readFileSync(join(SRC, path), 'utf8')

describe('SummaryCardへの移行契約', () => {
  it('既存KpiCardの呼び出し方を保ち、V6へ転送する', () => {
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
    expect(html).toContain('1,234件')
    expect(html).toContain('href="/conversions"')
  })

  it('配信告知をbroadcast variantとして明示する', () => {
    const html = renderToStaticMarkup(
      <SummaryCard title="今週の配信" value={3} unit="通" detail="過去7日" variant="broadcast" />,
    )

    expect(html).toContain('data-design-version="broadcast"')
    expect(html).toContain('3通')
  })

  it('3系統の実装元が共通SummaryCardだけを描画する', () => {
    const files = [
      'components/dashboard/kpi-card.tsx',
      'components/friends/friend-kpis.tsx',
      'components/shared/list-kpis.tsx',
    ]

    for (const file of files) {
      const source = readSource(file)
      expect(source, `${file} がSummaryCardを使っていない`).toMatch(/import SummaryCard/)
      expect(source, `${file} に旧カードの影が残っている`).not.toContain('shadow-[')
      expect(source, `${file} に旧カードの任意角丸が残っている`).not.toContain('rounded-[')
    }
  })

  it('V5基準・V6優先と9ルートの影響範囲を契約へ残す', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const part = contract.parts['summary-card']

    expect(part.status).toBe('active')
    expect(part.pencilNodes).toEqual(expect.arrayContaining(['XywGr', 'mNUQ3']))
    expect(part.routes.v5).toEqual(['/friends', '/tags'])
    expect(part.routes.broadcast).toEqual(['/scenarios'])
    expect(part.routes.v6).toEqual(
      expect.arrayContaining(['/analytics', '/conversions', '/inflow-links', '/affiliates', '/reminders', '/templates']),
    )
    expect(Object.values(part.routes).flat()).toHaveLength(9)
    expect(part.visualVerification.status).toBe('unverified')
    expect(part.visualVerification.requiredViewports).toEqual([1440, 1920])
  })
})
