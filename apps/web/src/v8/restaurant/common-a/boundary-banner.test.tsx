// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BoundaryBanner as CommonBanner } from './frame'
import { BoundaryBanner as BookingBanner } from '../booking-kit/shell'

const environment = vi.hoisted(() => ({ value: 'staging' as string | null }))
vi.mock('@/lib/admin-version-cache', () => ({
  loadAdminVersionDetail: async () => ({ version: '1', deploy_env: environment.value }),
}))
afterEach(cleanup)

it.each([['共通画面', CommonBanner], ['予約画面', BookingBanner]])('%sの検証環境は案内を1つ表示する', async (_name, Banner) => {
  environment.value = 'staging'
  render(<Banner />)
  expect(await screen.findByText('検証環境です。予約サイトへは送りません')).toBeTruthy()
  expect(screen.queryByText(/要確認|検証環境専用/)).toBeNull()
})

it.each([['共通画面', CommonBanner], ['予約画面', BookingBanner]])('%sの本番・不明環境では帯を出さない', async (_name, Banner) => {
  for (const value of ['production', null]) {
    environment.value = value
    const { unmount, container } = render(<Banner />)
    await waitFor(() => expect(container.textContent).toBe(''))
    unmount()
  }
})
