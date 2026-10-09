// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const fx=vi.hoisted(()=>({ get:vi.fn() }))
vi.mock('@/lib/api',()=>({ bookingApi:{ getFriendNoshow:fx.get } }))
import PrepayBadge from './prepay-badge-v8'
afterEach(cleanup)
it('前払い情報の取得失敗を制限なしと同じ空白にせず、再試行する（PKG-108）', async()=>{
  fx.get.mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce({ data:{ prepayOnly:false } })
  render(<PrepayBadge accountId="a" friendId="f" />)
  await screen.findByText('前払い情報を読み込めませんでした')
  fireEvent.click(screen.getByRole('button',{ name:'もう一度読み込む' }))
  await waitFor(() => expect(fx.get).toHaveBeenCalledTimes(2))
  expect(screen.queryByText('前払い情報を読み込めませんでした')).toBeNull()
})
