// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { RestaurantFollowupDemo } from './demo'
afterEach(cleanup)
it('8枚から編集窓、送信停止中の保存結果まで見本を切り替える', () => {
  const { container, rerender } = render(<RestaurantFollowupDemo phase={0} />)
  expect(container.querySelectorAll('article')).toHaveLength(8)
  expect(screen.getByText('8枚のカードから送り方を選びます。 見本のため実際の設定は変わりません。')).toBeTruthy()
  rerender(<RestaurantFollowupDemo phase={2} />)
  expect(screen.getByText('前日の確認を変える')).toBeTruthy()
  rerender(<RestaurantFollowupDemo phase={4} />)
  expect(screen.getByText('リマインダに下書きを作りました')).toBeTruthy()
  expect(screen.getByText('保存の結果を確認します。まだ送信されていません。 見本のため実際の設定は変わりません。')).toBeTruthy()
})
