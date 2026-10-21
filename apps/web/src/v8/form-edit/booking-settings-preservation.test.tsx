// @vitest-environment happy-dom
import { fireEvent, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { mount } from './owner-content-fixture'

it('予約できる期間だけを変えても、保存済みの承認・メニュー選択・分岐を落とさない', () => {
  const booking = {
    menuId: 'menu-a', staffId: 'staff-a', daysAhead: 14,
    allowMenuSelection: true, requireApproval: true,
    kind: 'people' as const,
    routing: { enabled: true, rules: [], fallback: { menuId: 'menu-b' } },
  }
  const { onPatchBlock } = mount([{ id: 'visit', kind: 'input', type: 'booking', name: 'visit', label: '予約', booking }])
  fireEvent.change(screen.getByLabelText('選べる期間'), { target: { value: '30' } })
  expect(onPatchBlock).toHaveBeenLastCalledWith('visit', expect.objectContaining({ booking: { ...booking, daysAhead: 30 } }))
})
