import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allFiles, directImporters } from '../../scripts/design-impact.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  const files = allFiles()
  const button = join(SRC, 'components', 'shared', 'button.tsx')
  const buttonCss = join(SRC, 'components', 'shared', 'button.module.css')

  it('共通Buttonを直接importする7ファイルだけを利用先に数える', () => {
    expect(directImporters(files, button).map((file) => relative(SRC, file))).toEqual([
      'app/affiliates/tabs.tsx',
      'app/analytics/page.tsx',
      'app/conversions/page.tsx',
      'app/inflow-links/page.tsx',
      'app/reminders/page.tsx',
      'app/tags/page.tsx',
      'app/templates/page.tsx',
    ])
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss)).toEqual([button])
  })
})
