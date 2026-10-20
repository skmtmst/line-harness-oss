// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import BalanceRowMenu from './balance-row-menu'

afterEach(cleanup)
it.each([false, true])('明細の行き先と増減の権限を保持する（readonly=%s）', async readonly => {
  render(<BalanceRowMenu friendId="friend&one" friendName="お客さま" readonly={readonly} />)
  expect(screen.queryByRole('menuitem')).toBeNull()
  const trigger = screen.getByRole('button', { name: 'お客さまのマイルの操作' })
  fireEvent.click(trigger)
  const detail = await screen.findByRole('menuitem', { name: '明細を見る' })
  expect(detail.getAttribute('href')).toBe('/mileage/friends/detail?id=friend%26one')
  const adjust = screen.queryByRole('menuitem', { name: '増減' })
  if (readonly) expect(adjust).toBeNull()
  else expect(adjust?.getAttribute('href')).toBe('/mileage/friends/detail?id=friend%26one&adjust=1')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('menuitem')).toBeNull()
})
