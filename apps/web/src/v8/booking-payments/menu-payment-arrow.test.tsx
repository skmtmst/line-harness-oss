// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { MenuPaymentFields, type MenuPaymentState } from './menu-payment'

afterEach(cleanup)
it('未接続時のお支払いリンクには進む矢印を一つだけ出す', () => {
  const state = { status: 'ready', connected: false } as MenuPaymentState
  render(<MenuPaymentFields state={state} name="course" price={1000} />)
  const link = screen.getByRole('link', { name: 'お支払いをつなぐ' })
  expect(link.querySelectorAll('svg')).toHaveLength(1)
})
