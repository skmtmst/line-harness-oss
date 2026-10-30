// @vitest-environment happy-dom
/* ID1: 回数券・月謝の行の「…」は枠なし（plain）。 */
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

const list = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api/helpers/booking-entitlements', () => ({ bookingEntitlementsApi: { list } }))

import EntitlementsCard from './entitlements'

afterEach(cleanup)

it('特典の行の「…」は枠なし（ID1・plain）', async () => {
  list.mockResolvedValue({
    data: [{
      id: 'e1', line_account_id: 'a', friend_id: 'f', menu_id: null, kind: 'ticket',
      name: '回数券10回', remaining: 8, monthly_limit: null,
      valid_from: '2026-01-01T00:00:00+09:00', expires_at: '2026-12-31T00:00:00+09:00',
      status: 'active', version: 1, created_at: '2026-01-01T00:00:00+09:00', updated_at: '2026-01-01T00:00:00+09:00',
      monthUsed: 0, monthAllowance: null, monthRemaining: null, periodStart: '2026-10-01', periodEnd: '2026-10-31',
    }],
  })
  render(<EntitlementsCard accountId="a" friendId="f" friendName="山田" canEdit={true} />)
  const menu = await screen.findByRole('button', { name: '回数券10回の操作' })
  /* MoreAction の3点（fill currentColor）。box（IconButton＋lucide）だと fill="none" で落ちる。 */
  expect(menu.querySelector('svg')?.getAttribute('fill')).toBe('currentColor')
  expect(menu.hasAttribute('data-design-node')).toBe(false)
})
