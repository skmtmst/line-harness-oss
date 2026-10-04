import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
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

// V8で数の帯へ作り直した画面は、旧KpiCollapseの採用を強制しない。
// 集計を消さず、狭い幅で帯を2列にする現在の仕組みを確認する。
describe('V8の数の帯とメンバー一覧', () => {
  const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')

  it('ウェビナーは数の帯を狭い幅で2列にする', () => {
    expect(read('app/webinars/list-v8.tsx')).toContain('aria-label="ウェビナーの数の帯"')
    expect(read('app/webinars/list-v8.module.css')).toMatch(/@media \(max-width: 640px\)[^}]*\.kpiBand[^}]*repeat\(2, minmax\(0, 1fr\)\)/s)
  })

  it('写真審査は集計4件を狭い板で2列にする', () => {
    const page = read('app/nen-members/photo-review-v8.tsx')
    expect(page.match(/<KpiCellV8\b/g)).toHaveLength(4)
    expect(read('app/nen-members/photo-review-v8.module.css')).toMatch(/@container \(max-width: 600px\)[^}]*\.kpiBand[^}]*repeat\(2, minmax\(0, 1fr\)\)/s)
  })

  it('LINE通知の数の帯は小さい幅で1列、640px以上で2列にする', () => {
    const page = read('app/line-notifications/page.tsx')
    expect(page).toContain('grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4')
    expect(page).toContain('kpisWithSendCountsState.map(renderKpiCard)')
  })

  it('メンバー管理は集計カードを重ねず一覧と設定の案内を出す', () => {
    const page = read('app/hq/members/page.tsx')
    expect(page).toContain('<HqSettingsNav active="members"')
    expect(page).toContain('data-design="Table"')
    expect(page).not.toContain('<KpiCard')
  })
})

/** 旧来の折りたたみ部品を引き続き使う画面。 */
describe('KPI折りたたみの適用（#975 U060）', () => {
  const targets: Array<[string, string]> = [
    ['app/page.tsx', 'KpiCollapse'],
    ['app/auto-replies/page.tsx', 'KpiCollapse'],
    ['app/conversions/page.tsx', 'KpiCollapse'],
    ['app/automations/page.tsx', 'KpiCollapse'],
    ['app/automations/runs/page.tsx', 'KpiCollapse'],
    ['app/hq/page.tsx', 'KpiCollapse'],
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
