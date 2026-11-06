// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { FriendsTabs } from './head'

afterEach(cleanup)

vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())

describe('FriendsTabs', () => {
  it('CSVの画面ではCSVを今いるタブに出す（B9）', () => {
    render(<FriendsTabs current="csv" />)
    const current = screen.getByText('CSVで書き出す・取り込む')
    expect(current.getAttribute('aria-current')).toBe('page')
  })
  it('ほかの画面ではCSVのタブを出さず今いる所だけを示す', () => {
    render(<FriendsTabs current="list" />)
    expect(screen.queryByText('CSVで書き出す・取り込む')).toBeNull()
    expect(screen.getByText('友だち一覧').getAttribute('aria-current')).toBe('page')
  })
})
