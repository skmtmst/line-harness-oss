// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const net = vi.hoisted(() => ({ templates: vi.fn() }))
vi.mock('./scenario-reference-data', () => ({ scenarioReferenceData: net }))
import CarouselPicker from './carousel-picker'
afterEach(cleanup)
it('WEB263: 取得失敗を空一覧とせず、読み込みを終えて再試行できる', async () => {
  net.templates.mockResolvedValueOnce({ success: false, error: '取得失敗' }).mockResolvedValue({ success: true, data: [] })
  render(<CarouselPicker value="" accountId="a" onChange={() => {}} />)
  await act(async () => {})
  expect(screen.queryByText('カルーセルがまだありません')).toBeNull()
  const retry = screen.getByRole('button', { name: 'もう一度読み込む' })
  await act(async () => retry.click())
  expect(screen.getByText('カルーセルがまだありません')).toBeTruthy()
})
