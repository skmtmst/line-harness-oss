import { expect, it } from 'vitest'
import { lineChanges } from './model'
it('WEB-099：順番だけの違いも出す', () => {
  expect(lineChanges('A\nB\nC', 'B\nA\nC')).toEqual([
    { kind: 'removed', text: 'A' }, { kind: 'added', text: 'A' },
  ])
})
it('WEB-099：重複・空行の違いは出さない', () => {
  expect(lineChanges('A\nA\n\nB', '\nA\nB\nB')).toEqual([])
  expect(lineChanges('A\nA', 'B\nB')).toEqual([{ kind: 'removed', text: 'A' }, { kind: 'added', text: 'B' }])
})
