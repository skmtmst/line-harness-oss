// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ReservationBoard from '@/components/shared/reservation-board'

afterEach(cleanup)

it.each([false, true])('空き枠の追加操作に＋を出し、卓と時刻を渡す（枠の指定：%s）', explicit => {
  const onSlot = vi.fn()
  const startsAt = '2026-10-01T08:00:00.000Z'
  render(<ReservationBoard entries={[]} resources={[{id:'t1',label:'T1',capacity:2,active:true}]} dates={['2026-10-01']} canWrite onOpen={()=>{}} onSlot={onSlot} slots={explicit ? [{resourceId:'t1',startsAt}] : undefined} />)
  const slot = screen.getByRole('button',{name:'T1 17:00に予約を入れる'})
  expect(slot.textContent).toBe(explicit ? '＋ 空き' : '＋ 予約追加')
  fireEvent.click(slot)
  expect(onSlot).toHaveBeenCalledWith('t1',startsAt)
})
