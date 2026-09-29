import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const KPI = readFileSync(new URL('./kpi-collapse.tsx', import.meta.url), 'utf8')

/**
 * #975 U060: 390pxで4枚以上の集計カードが日常作業を画面外へ
 * 押し出さない。先頭2件だけを出し、残りは「集計を見る」で開く。
 */
describe('KPIの折りたたみ部品（#975 U060）', () => {
  it('狭い幅では先頭2件だけを出し、残りは開いて見る', () => {
    expect(KPI).toContain('mobileVisible = 2')
    expect(KPI).toContain('max-sm:hidden')
    expect(KPI).toContain('aria-expanded={open}')
    expect(KPI).toContain('件の集計を見る')
  })

  it('640px以上では全件を並べる（開閉ボタンは狭い幅だけ）', () => {
    expect(KPI).toContain('sm:hidden')
  })
})

/** 対象ページがこの部品を使っていることを見張る。 */
describe('KPI折りたたみの適用（#975 U060）', () => {
  const targets: Array<[string, string]> = [
    ['app/page.tsx', 'KpiCollapse'],
    ['app/auto-replies/page.tsx', 'KpiCollapse'],
    ['app/webinars/page.tsx', 'KpiCollapse'],
    ['app/conversions/page.tsx', 'KpiCollapse'],
    ['app/nen-members/page.tsx', 'KpiCollapse'],
    ['app/line-notifications/page.tsx', 'KpiCollapse'],
    ['app/automations/page.tsx', 'KpiCollapse'],
    ['app/automations/runs/page.tsx', 'KpiCollapse'],
    ['app/hq/page.tsx', 'KpiCollapse'],
    ['app/hq/members/page.tsx', 'KpiCollapse'],
    ['app/nen-campaigns/nen-overview.tsx', 'KpiCollapse'],
    ['app/ec-commerce/page.tsx', 'KpiCollapse'],
    ['app/emergency/page.tsx', 'KpiCollapse'],
    ['app/nen/members/members-tab.tsx', 'KpiCollapse'],
    ['app/nen/members/lifetime-tab.tsx', 'KpiCollapse'],
    ['app/nen/pets/pets-tab.tsx', 'KpiCollapse'],
    ['app/nen/health/health-tab.tsx', 'KpiCollapse'],
    ['components/hq/banners/banner-shell.tsx', 'KpiCollapse'],
  ]

  for (const [path, marker] of targets) {
    it(`${path} が KpiCollapse を使う`, () => {
      const source = readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
      expect(source).toContain(`from '@/components/ui/kpi-collapse'`)
      expect(source).toContain(`<${marker}`)
    })
  }
})
