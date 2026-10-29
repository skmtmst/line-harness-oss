// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { SetupWarningBands } from './setup-card'
import type { StyleSetupData } from './use-style-setup'

afterEach(cleanup)
const warning = (feature: string, href: string) => ({ feature, href, areaId: 'E', groupId: 'group', customerState: 'preparing' as const })
const data: StyleSetupData = { state: { style: 'ec', styleSelected: true, version: 1, answers: {} }, warnings: [warning('stamps', '/visit-stamps'), warning('coupons', '/coupons')], items: [] }

it('ECの上の警告帯にも来店スタンプを出さず、ほかの警告は保持する', () => {
  const view = render(<SetupWarningBands data={data} />)
  expect(screen.queryByText(/来店スタンプ/)).toBeNull()
  expect(screen.getByText(/クーポン/)).toBeTruthy()
  expect(screen.getAllByRole('note')).toHaveLength(1)
  expect(screen.queryByRole('link', { name: '決まりを入れる' })).toBeNull()
  expect(screen.getByRole('button', { name: '決まりを入れる' })).toBeTruthy()
  view.rerender(<SetupWarningBands data={{ ...data, state: { ...data.state, style: 'restaurant' } }} />)
  expect(screen.getByText(/来店スタンプ/)).toBeTruthy()
  expect(screen.getAllByRole('note')).toHaveLength(2)
  expect(screen.getByRole('link', { name: '決まりを入れる' }).getAttribute('href')).toBe('/visit-stamps')
})
