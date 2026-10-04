import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const CSS = readFileSync(join(HERE, 'list-v8.module.css'), 'utf8')

/*
 * V8 シナリオ一覧の数字合わせ（wjfLe・X0QrW0・axFrW）。
 * 数の帯は区切り線で並べる1本の帯（見本 `wjfLe.html`）。
 * 狭い板でも2段にしない。数は API の実データを出す。
 */
describe('シナリオ一覧の数字合わせ', () => {
  it('数の帯は1本の帯で4マスが伸び縮みする', () => {
    expect(CSS).toMatch(/\.kpis \{[^}]*display: flex/)
    expect(CSS).toMatch(/\.kpi \{[^}]*flex: 1 1 0/)
    expect(CSS).toMatch(/\.kpi:first-child \{\s*border-left: 0/)
  })

  it('狭い板でも2段・1列に畳まない', () => {
    expect(CSS).not.toMatch(/\.kpis \{\s*grid-template-columns: repeat\(2/)
    expect(CSS).not.toMatch(/\.kpis \{\s*grid-template-columns: minmax\(0, 1fr\)/)
  })

  it('帯の数は22・600、題は500', () => {
    expect(CSS).toMatch(/\.kpiValue \{[^}]*font-size: 22px/)
    expect(CSS).toMatch(/\.kpiValue \{[^}]*font-weight: 600/)
    expect(CSS).toMatch(/\.kpiLabel \{[^}]*font-weight: 500/)
  })
})
