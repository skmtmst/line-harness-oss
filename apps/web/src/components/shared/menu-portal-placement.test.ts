import { expect, it } from 'vitest'
import { resolveMenuPlacement } from './menu-portal'

/**
 * E21：開く向きの固定。指定が無いときは今までどおりの自動判定
 * （下に中身が入るか・下の余地が広いときに下へ開く）。
 */
it('指定が無ければ下に入るときは下へ開く', () => {
  expect(resolveMenuPlacement(undefined, 100, 200, 500)).toBe('down')
})

it('指定が無ければ下に入らなくても下の余地が広いときは下へ開く', () => {
  expect(resolveMenuPlacement(undefined, 300, 200, 100)).toBe('down')
})

it('指定が無ければ下に入らず上の余地が広いときは上へ開く', () => {
  expect(resolveMenuPlacement(undefined, 300, 100, 500)).toBe('up')
})

it('上・下の指定があれば余地によらずそれに従う', () => {
  expect(resolveMenuPlacement('up', 100, 900, 0)).toBe('up')
  expect(resolveMenuPlacement('down', 900, 0, 900)).toBe('down')
})
