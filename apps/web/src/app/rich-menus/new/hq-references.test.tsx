// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { Area } from '../../../components/rich-menus/area-types'
import HqMenuReferences from './hq-references'

afterEach(cleanup)
const area: Area = { id: 'a', boundsX: 0, boundsY: 0, boundsWidth: 1, boundsHeight: 1, actionType: 'uri', actionData: {}, formId: 'f1', tagIds: ['t1'] }
const references = { forms: [{ id: 'f1', name: '実際の回答フォーム' }], tags: [{ id: 't1', name: '実際のタグ' }], templates: [] }

it('使う参照を重複なく読み、変更後の参照と未取得を反映する', () => {
  const { container, rerender } = render(<HqMenuReferences areas={[area, { ...area, id: 'b' }]} references={references} />)
  expect(screen.getByRole('heading', { name: '各アカウントで使うもの' })).toBeTruthy()
  expect(screen.getAllByText('実際の回答フォーム')).toHaveLength(1)
  expect(screen.getAllByText('実際のタグ')).toHaveLength(1)
  expect(screen.queryByText('押された回数（今月）')).toBeNull()
  rerender(<HqMenuReferences areas={[{ ...area, formId: null, tagIds: ['missing'] }]} references={references} />)
  expect(screen.queryByText('実際の回答フォーム')).toBeNull()
  expect(container.querySelector('dd')?.textContent).toBe('—')
  rerender(<HqMenuReferences areas={[]} references={references} />)
  expect(screen.getByText('未設定')).toBeTruthy()
  expect(container.querySelectorAll('dd')).toHaveLength(0)
})
