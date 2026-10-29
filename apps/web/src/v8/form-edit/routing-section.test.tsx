// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import RoutingSection from './routing-section'

afterEach(cleanup)

// 決まり2: 行き先の決まりは帯にせず、題の横の「？」へ入れる。
it('行き先の決まりは帯に出さず題の「？」に入れる', async () => {
  render(<RoutingSection blocks={[
    { kind: 'input', type: 'booking' },
    { kind: 'input', type: 'radio', label: '来店の目的', choices: [{ label: '相談' }] },
  ] as never} refs={{}} routing={undefined} onChange={() => {}} />)
  await screen.findByText('答えで予約の行き先を分ける')
  expect(screen.queryByText(/行き先はこの表で決まる/)).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '答えで予約の行き先を分けるの説明' }))
  expect(await screen.findByText(/行き先はこの表で決まる/)).toBeTruthy()
})
