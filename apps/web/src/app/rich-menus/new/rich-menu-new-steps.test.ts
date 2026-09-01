import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const page = readFileSync(join(here, 'page.tsx'), 'utf8')

describe('V6 リッチメニュー作成 XtfO3', () => {
  it('実Nodeと3段の現在地を画面から共通部品へ渡す', () => {
    expect(page).toContain('data-design-node="XtfO3"')
    expect(page).toContain("import StepTrail from '@/components/shared/step-trail'")
    expect(page).toContain('label="リッチメニュー作成の進み方"')
    expect(page).toContain("{ label: '形を決める', state: 'current' }")
    expect(page).toContain("{ label: 'ボタンと出し分け', state: 'todo' }")
    expect(page).toContain("{ label: '公開のしかた', state: 'todo' }")
  })
})
