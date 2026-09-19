import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const HERE = dirname(fileURLToPath(import.meta.url))
const RAIL = readFileSync(
  join(HERE, '..', '..', '..', 'components', 'broadcasts', 'broadcast-step-rail.tsx'),
  'utf8',
)

/*
 * #973 U048: 一斉配信の作成（/broadcasts/new）で、5段の手順表示を
 * 狭い段へ無理に並べ、「STEP」・番号・段名が折り返し・省略されていた。
 */
describe('配信作成の手順表示（#973 U048）', () => {
  it('狭い幅では現在の段・全体の位置・前後への移動だけを出す', () => {
    expect(RAIL).toContain('sm:hidden')
    expect(RAIL).toContain('STEP {current.order} / {steps.length}')
    expect(RAIL).toContain('前へ')
    expect(RAIL).toContain('次へ')
  })

  it('前後の段は押すとその節へ飛び、端では押せない', () => {
    expect(RAIL).toContain('jumpTo(previous.anchor)')
    expect(RAIL).toContain('jumpTo(next.anchor)')
    expect(RAIL).toContain('disabled={!previous}')
    expect(RAIL).toContain('disabled={!next}')
  })

  it('広い幅ではこれまでどおり5段の帯を共通部品で出す', () => {
    expect(RAIL).toContain('hidden sm:block')
    expect(RAIL).toContain('<StepRail steps={steps} ariaLabel="配信作成の進み" />')
  })
})
