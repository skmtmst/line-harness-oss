import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
/* 作るの v7 本体は 2026-10-05 に撤去。手順と面の編集は `create-v8` が担う。 */
const page = readFileSync(join(here, 'create-v8.tsx'), 'utf8')

describe('リッチメニュー作成の手順と面の編集（V8）', () => {
  it('4つの手順の現在地を画面から共通部品へ渡す', () => {
    expect(page).toContain('steps={<Stepper label="リッチメニューを作る手順"')
    expect(page).toContain('currentKey={step}')
  })

  it('面を選ぶとその面の動きの欄が開く', () => {
    expect(page).toContain('setSelectedAreaId(area.id)')
    expect(page).toContain('selectedArea')
  })

  it('?step= で最初の手順を指定できる（重ねの撮影用）', () => {
    expect(page).toContain("get('step')")
    expect(page).toContain("STEP_KEYS as readonly string[])")
  })
})
