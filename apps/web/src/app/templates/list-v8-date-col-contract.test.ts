import { readFileSync } from 'node:fs'
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
    expect(LIST).toContain('<col style={{ width: 120 }} />')
  })

  it('更新の日付は1行のまま（縦割れさせない）', () => {
    expect(CSS).toMatch(/\.dateCell \{[^}]*white-space: nowrap/)
  })
})
