import { readUiSource as readFileSync } from '../../scripts/test-ui-source.mjs'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  allFiles,
  createImportIndex,
  directImporters,
  routeEntryFiles,
} from '../../scripts/design-impact.mjs'
import {
  parseDesignImpactBaseline,
} from '../../scripts/design-impact-baseline.mjs'
import { SRC } from '../../scripts/design-debt.mjs'

describe('共通部品の影響範囲', () => {
  it('並行PRが足した2画面を行として同時に保持できる', () => {
    const parsed = parseDesignImpactBaseline([
      'shared-button-importer app/example-a/page.tsx',
      'shared-button-importer app/example-b/page.tsx',
    ].join('\n'))
    expect(parsed.sharedButtonImporters).toEqual([
      'app/example-a/page.tsx',
      'app/example-b/page.tsx',
    ])

    const attributes = readFileSync(join(SRC, '..', '..', '..', '.gitattributes'), 'utf8')
    expect(attributes).toContain('apps/web/design/design-impact-baseline.txt merge=union')
  })

  it('名前が同じでもimport先の実ファイルで参照元を区別する', () => {
    const dir = mkdtempSync(join(tmpdir(), 'g01-import-index-'))
    try {
      const first = join(dir, 'first.module.css')
      const second = join(dir, 'second.module.css')
      const owner = join(dir, 'owner.tsx')
      const other = join(dir, 'other.tsx')
      writeFileSync(first, '.first {}')
      writeFileSync(second, '.second {}')
      writeFileSync(owner, "import styles from './first.module.css'; export const Button = styles")
      writeFileSync(other, "import styles from './second.module.css'; export const Button = styles")
      const files = allFiles(dir)
      const index = createImportIndex(files)
      expect(directImporters(files, first, index)).toEqual([owner])
      expect(directImporters(files, second, index)).toEqual([other])
      expect(directImporters(files, join(dir, 'missing.css'), index)).toEqual([])
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('全画面共通枠はpageだけでなく親layoutからの到達も調べる', () => {
    const page = join(SRC, 'app', 'example', 'page.tsx')
    expect(routeEntryFiles(page).map((file) => relative(SRC, file))).toContain('app/layout.tsx')
  })
})
