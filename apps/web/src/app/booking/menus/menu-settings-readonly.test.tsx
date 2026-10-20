// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import MenuSettingsPage from '@/v8/booking-menus/menu-settings-page'
import { menuSettingsModel } from '@/v8/booking-menus/menu-settings.fixture'

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

vi.mock('@/components/templates/create-page', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/templates/create-page')>()
  return { ...actual, CreatePage: (props: React.ComponentProps<typeof actual.CreatePage>) =>
    React.createElement(actual.CreatePage, { ...props, readOnly: process.env.L2X_READONLY_FAULT === '1' ? false : props.readOnly }) }
})

afterEach(cleanup)

it('メニュー画面を共通の型とプレビューの入口で描く', () => {
  const { container } = render(<MenuSettingsPage {...menuSettingsModel(true)} />)
  expect(container.querySelector('[data-page-template="create"][data-design-node="P6EdLW"]')).toBeTruthy()
  expect(screen.getByRole('heading', { name: '予約設定' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'LINEでの見え方を見る' })).toBeTruthy()
})

it('閲覧では案内を出し作成操作を描かない', async () => {
  const { container } = render(<MenuSettingsPage {...menuSettingsModel()} />)
  expect(container.querySelector('[data-design-node="C9fv7A"] [data-read-only-notice]')).toBeTruthy()
  await screen.findByText('まだ予約メニューがありません')
  expect(screen.queryByRole('link', { name: /予約メニューを作る/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /予約メニューを作る/ })).toBeNull()
})
