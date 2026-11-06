import { expect, it } from 'vitest'
import { comparisonSourceLabels } from './differences-filter'
it('名前と出所が一致する候補も、表示名だけで区別できる', () => {
  expect(comparisonSourceLabels([
    { id: 'f1', name: '花子', source: '支店' }, { id: 'f2', name: '花子', source: '支店' },
  ])).toEqual({ f1: '支店・花子（1件目）', f2: '支店・花子（2件目）' })
  expect(comparisonSourceLabels([{ id: 'f1', name: '', source: '' }])).toEqual({ f1: '名前は未取得' })
})
