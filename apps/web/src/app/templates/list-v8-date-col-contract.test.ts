import { readUiSource as readFileSync } from '../../../scripts/test-ui-source.mjs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST = readFileSync(join(HERE, 'list-v8.tsx'), 'utf8')
const CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')

/*
 * parity 1003-2106（L7zA7C・hEDTK・v19Ivv・susGP）:
 * 更新列の中身（`10月2日（木）`で約95px）が 84px の列からはみ出し、
 * 隣の操作列へこぼれていた。列幅を戻したら落とす。
 */
describe('テンプレート一覧の更新列', () => {
  it('更新列は日付1行が収まる幅を持つ', () => {
    expect(LIST).toContain('<col className={styles.colUpdated} />')
    const currentCss = readFileSync(join(HERE, '../../v8/templates/list.module.css'), 'utf8')
    expect(currentCss).toMatch(/\.colUpdated\s*\{[^}]*width: var\(--tpl-tl-col-updated\)/s)
  })

  it('更新の日付は1行のまま（縦割れさせない）', () => {
    expect(CSS).toMatch(/\.dateCell \{[^}]*white-space: nowrap/)
  })
})
