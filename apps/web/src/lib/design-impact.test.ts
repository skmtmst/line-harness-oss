import { describe, expect, it } from 'vitest'
import { parseDesignImpactBaseline } from '../../scripts/design-impact-baseline.mjs'

describe('共通部品の調査行の解析', () => {
  it('並行して追加した行を欠かさず読み取る', () => {
    const parsed = parseDesignImpactBaseline([
      'shared-button-importer app/example-a/page.tsx',
      'shared-button-importer app/example-b/page.tsx',
    ].join('\n'))
    expect(parsed.sharedButtonImporters).toEqual([
      'app/example-a/page.tsx',
      'app/example-b/page.tsx',
    ])
  })

})
