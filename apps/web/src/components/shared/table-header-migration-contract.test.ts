import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { countDebt, totals } from '../../../scripts/design-debt.mjs'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(SRC, '..')
const targets = [
  'app/tags/page.tsx',
  'app/reminders/page.tsx',
  'app/templates/page.tsx',
  'app/conversions/page.tsx',
  'app/inflow-links/page.tsx',
  'app/affiliates/tabs.tsx',
]
const sources = Object.fromEntries(
  targets.map((path) => [path, readFileSync(join(SRC, path), 'utf8')]),
)

describe('表見出しの第1段階移行', () => {
  it('6ルートの標準見出し75セルを共通Thへ移行する', () => {
    const migrated = Object.values(sources).reduce(
      (sum, source) => sum + (source.match(/<Th\b/g)?.length ?? 0),
      0,
    )
    expect(migrated).toBe(75)

    for (const [path, source] of Object.entries(sources)) {
      expect(source, `${path} が共通表部品をimportしていない`).toContain(
        "import { TableHeadRow, Th } from '@/components/shared/table'",
      )
      expect(source, `${path} が見出し行を共通化していない`).toContain('<TableHeadRow>')
    }
  })

  it('移行したセルに旧色・旧余白・大文字化を重ねない', () => {
    const handledByPart =
      /(?:px-[234]|py-3|text-(?:left|right|center|xs|\[11px\]|ink-faint|gray-500)|font-(?:medium|semibold)|uppercase|tracking-wider|whitespace-nowrap)/

    for (const [path, source] of Object.entries(sources)) {
      for (const opening of source.match(/<Th\b[^>]*>/gs) ?? []) {
        expect(opening, `${path} が共通Thへ旧指定を重ねている`).not.toMatch(handledByPart)
      }
    }
  })

  it('今回対象外の詳細内テーブルを残し、D-3の旧一覧転送後も基準を締める', () => {
    for (const path of targets.filter((path) => path !== 'app/affiliates/tabs.tsx')) {
      expect(sources[path]).not.toMatch(/<th\b/)
    }
    expect(sources['app/affiliates/tabs.tsx'].match(/<th\b/g)).toHaveLength(20)

    const debt = totals(countDebt().counts) as Record<string, number>
    // 4-1 の表に「表示」列（★）を足したぶん1つ増えた。
    // 共通の `Th` へ寄せるのは、横展開のときにまとめて行う。
    expect(debt['direct-th']).toBe(290)
  })

  it('V5基準・V6優先と画面画像の未検証を契約へ残す', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const part = contract.parts.table

    expect(part.status).toBe('active')
    expect(part.routes.v5).toEqual({ '/tags': 'PbCvb' })
    expect(part.routes.v6).toEqual({
      '/reminders': 'kAnOQ',
      '/templates': 'FH74x',
      '/affiliates': 'BaLte',
      '/conversions': 'Bw4fy',
      '/inflow-links': 'EQS0v',
    })
    expect(part.migration).toEqual({
      directThBefore: 378,
      migratedInThisPr: 75,
      directThRemaining: 303,
    })
    expect(part.visualVerification.status).toBe('unverified')
  })
})
