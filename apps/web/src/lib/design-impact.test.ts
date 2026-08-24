import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { allFiles, directImporters } from '../../scripts/design-impact.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  const files = allFiles()
  const button = join(SRC, 'components', 'shared', 'button.tsx')
  const buttonCss = join(SRC, 'components', 'shared', 'button.module.css')

  it('同名のローカルButtonや一般的なファイル名を共通Buttonの利用先に数えない', () => {
    expect(directImporters(files, button)).toEqual([])
  })

  it('import先が実ファイルと一致する場合は検知する', () => {
    expect(directImporters(files, buttonCss)).toEqual([button])
  })
})
