import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const LIST_CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')
const CREATE_CSS = readFileSync(join(HERE, 'new', 'create-v8.module.css'), 'utf8')

/*
 * V8 リッチメニューの数字合わせ（Y9ASp・Z0uO6・F4gELj・OxEMM・JeINq）。
 * 数の帯は区切り線で並べる1本の帯。作る画面の右の列は見本どおり380。
 * 件数・金額などの中身は API の実データを出す。
 */
describe('リッチメニューの数字合わせ', () => {
  it('一覧の数の帯は1本の帯で狭い板でも2段にしない', () => {
    expect(LIST_CSS).toMatch(/\.kpis \{[^}]*display: flex/)
    expect(LIST_CSS).toMatch(/\.kpi \{[^}]*flex: 1 1 0/)
    expect(LIST_CSS).not.toMatch(/\.kpis \{\s*grid-template-columns: repeat\(2/)
  })

  it('作る画面の右の列は380', () => {
    expect(CREATE_CSS).toMatch(/\.grid \{[^}]*minmax\(0, 1fr\) 380px/)
  })
})
