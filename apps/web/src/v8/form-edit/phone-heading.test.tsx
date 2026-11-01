// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest'
import { cleanup, render, within } from '@testing-library/react'
import { emptyLayout } from '@line-crm/shared'
import { FormPhone } from './phone'

afterEach(cleanup)

const props = { pageIndex: 0, accountName: 'テスト店', bookingMenus: [] }

test('ページの題を決めていないフォームは名前の変更を見本の上へ反映する', () => {
  const layout = emptyLayout()
  const view = render(<FormPhone {...props} layout={layout} formName="来店アンケート" />)
  expect(within(view.container).getByText('来店アンケート')).toBeTruthy()
  view.rerender(<FormPhone {...props} layout={layout} formName="秋の来店アンケート" />)
  expect(within(view.container).getByText('秋の来店アンケート')).toBeTruthy()
  expect(within(view.container).queryByText('来店アンケート')).toBeNull()
})

test('ページの題を決めたフォームはお客さま画面と同じ題を優先する', () => {
  const layout = emptyLayout()
  layout.options.pageTitle = 'ご来店の感想'
  const view = render(<FormPhone {...props} layout={layout} formName="店内用の管理名" />)
  expect(within(view.container).getByText('ご来店の感想')).toBeTruthy()
  expect(within(view.container).queryByText('店内用の管理名')).toBeNull()
})

test('リサーチなどで呼び出し元が指定した題は保つ', () => {
  const layout = emptyLayout()
  layout.options.pageTitle = 'フォームの題'
  const view = render(<FormPhone {...props} layout={layout} formName="管理名" title="季節のリサーチ" />)
  expect(within(view.container).getByText('季節のリサーチ')).toBeTruthy()
})

test('名前もページの題もない見本は既定の題を表示する', () => {
  const view = render(<FormPhone {...props} layout={emptyLayout()} formName="" />)
  expect(within(view.container).getByText('回答フォーム')).toBeTruthy()
})
