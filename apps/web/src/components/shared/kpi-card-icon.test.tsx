// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { Users } from 'lucide-react'
import KpiCard from './kpi-card'

afterEach(cleanup)

it('指標に図柄を渡さないときは空のアイコン枠を出さず、名前と実測0は残す', () => {
  const { container } = render(<KpiCard title="友だち" value={0} unit="人" detail="今日追加された人数" />)
  expect(container.querySelector('[data-kpi-icon]')).toBeNull()
  expect(screen.getByText('友だち')).toBeTruthy()
  expect(screen.getByText('0')).toBeTruthy()
})

it('明示した図柄は装飾として残し、指標の読み上げは名前で伝える', () => {
  const { container, rerender } = render(<KpiCard title="友だち" icon={<Users />} value={4} unit="人" detail="登録済み" />)
  const icon = container.querySelector('[data-kpi-icon]')
  expect(icon?.getAttribute('aria-hidden')).toBe('true')
  expect(icon?.querySelector('svg')).toBeTruthy()
  rerender(<KpiCard title="友だち" icon={null} value={4} unit="人" detail="登録済み" />)
  expect(container.querySelector('[data-kpi-icon]')).toBeNull()
})
