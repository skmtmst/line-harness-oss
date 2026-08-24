import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { countDebt, totals } from '../../../scripts/design-debt.mjs'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const WEB = join(SRC, '..')
const targets = [
  'app/tags/page.tsx',
  'app/reminders/page.tsx',
  'app/templates/page.tsx',
  'app/affiliates/tabs.tsx',
  'app/conversions/page.tsx',
  'app/inflow-links/page.tsx',
  'app/analytics/page.tsx',
]
const sources = Object.fromEntries(
  targets.map((path) => [path, readFileSync(join(SRC, path), 'utf8')]),
)

function buttonOpenings(path: string, source: string): string[] {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const openings: string[] = []
  const walk = (node: ts.Node) => {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(file) === 'Button'
    ) {
      openings.push(node.getText(file))
    }
    ts.forEachChild(node, walk)
  }
  walk(file)
  return openings
}

describe('標準ボタンの第1段階移行', () => {
  it('7ルートの標準操作33個を共通Buttonへ移行する', () => {
    const openings = Object.entries(sources).flatMap(([path, source]) => {
      expect(source, `${path} が共通Buttonを直接importしていない`).toContain(
        "import Button from '@/components/shared/button'",
      )
      return buttonOpenings(path, source)
    })

    expect(openings).toHaveLength(33)
    expect(openings.filter((opening) => opening.includes('variant="primary"'))).toHaveLength(10)
  })

  it('共通部品が持つ見た目を画面側で重ねない', () => {
    const handledByPart =
      /(?:bg-accent|border-hairline|text-on-accent|rounded-|px-|py-|text-(?:xs|sm)|font-(?:medium|semibold|bold)|hover:bg-|min-h-)/

    for (const [path, source] of Object.entries(sources)) {
      for (const opening of buttonOpenings(path, source)) {
        expect(opening, `${path} が共通Buttonへ旧指定を重ねている`).not.toMatch(handledByPart)
      }
    }
  })

  it('リンク先と主要な操作ハンドラを維持する', () => {
    const all = Object.values(sources).join('\n')
    for (const href of [
      '/tags/new',
      '/tags/fields/new',
      '/reminders/new',
      '/affiliate-offers/new',
      '/conversions?tab=affiliates',
      '/conversions/new',
      '/inflow-links/new',
    ]) {
      expect(all).toContain(`href="${href}"`)
    }
    for (const handler of [
      'onClick={exportCsv}',
      'onClick={handleCreate}',
      "onClick={() => setEditingGenre('new')}",
      'onClick={save}',
      'onClick={onCancel}',
    ]) {
      expect(all).toContain(handler)
    }
  })

  it('標準ボタン移行後の基準を、D-3の旧画面転送後も締める', () => {
    const debt = totals(countDebt().counts) as Record<string, number>
    expect(debt['direct-primary-button']).toBe(142)
    expect(debt['direct-secondary-button']).toBe(290)
    expect(debt['arbitrary-value']).toBe(1410)
  })

  it('V5基準・V6画面優先と画像比較の未検証を契約へ残す', () => {
    const contract = JSON.parse(readFileSync(join(WEB, 'design', 'design-parts.json'), 'utf8'))
    const part = contract.parts.button

    expect(part.status).toBe('active')
    expect(part.routes.v5).toEqual({ '/tags': 'PbCvb' })
    expect(part.routes.v6).toEqual({
      '/reminders': 'kAnOQ',
      '/templates': 'FH74x',
      '/affiliates': 'BaLte',
      '/conversions': 'Bw4fy',
      '/inflow-links': 'EQS0v',
      '/analytics': 'XkajG',
    })
    expect(part.migration).toEqual({
      controlsMigratedInThisPr: 33,
      directPrimaryBefore: 168,
      directPrimaryMigrated: 10,
      directPrimaryRemaining: 158,
      directSecondaryBefore: 335,
      directSecondaryMigrated: 20,
      directSecondaryRemaining: 315,
    })
    expect(part.visualVerification.status).toBe('unverified')
  })
})
