// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import LastChecked from './last-checked'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-29T00:00:00Z'))
})
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('最後に確かめた時刻', () => {
  it('API の成功時刻を共通の日本時間で表示し、画面内の時刻とは呼ばない', () => {
    render(<LastChecked at="2026-10-28T20:15:00Z" />)
    expect(screen.getByRole('status').textContent).toBe('最後に確かめた時刻：10月29日 05:15')
    expect(screen.queryByText('（この画面での確認）')).toBeNull()
  })

  it('SQL の UTC 時刻と古い年の表示も共通の書式に合わせる', () => {
    const view = render(<LastChecked at="2026-10-28 20:15:00" />)
    expect(screen.getByRole('status').textContent).toContain('10月29日 05:15')
    view.rerender(<LastChecked at="2024-12-31T16:00:00+09:00" />)
    expect(screen.getByRole('status').textContent).toContain('2024年12月31日 16:00')
  })

  it.each([undefined, null, '', 'not-a-date'])('時刻 %s は薄い灰の空値とし、現在時刻を作らない', at => {
    const view = render(<LastChecked at={at} />)
    expect(screen.getByRole('status').textContent).toBe('最後に確かめた時刻：—')
    expect(view.container.querySelector('[data-empty-value]')?.textContent).toBe('—')
    expect(screen.queryByText('確認中…')).toBeNull()
  })

  it('確認中は前回成功の時刻を残して別に知らせ、失敗後も呼ぶ側から渡した成功時刻を表示する', () => {
    const at = '2026-10-29T01:20:00Z'
    const view = render(<LastChecked at={at} />)
    view.rerender(<LastChecked at={at} busy />)
    expect(screen.getByText('確認中…').parentElement).toBe(screen.getByRole('status'))
    expect(screen.getByText('確認中…').previousElementSibling?.textContent).toBe('最後に確かめた時刻：10月29日 10:20')
    view.rerender(<LastChecked at={at} />)
    expect(screen.queryByText('確認中…')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('最後に確かめた時刻：10月29日 10:20')
    view.rerender(<LastChecked at="2026-10-29T01:23:00Z" />)
    expect(screen.getByRole('status').textContent).toContain('10月29日 10:23')
  })

  it('API に時刻がない時の画面内確認は、未確認・確認中・成功を区別する', () => {
    const view = render(<LastChecked inSession />)
    expect(screen.getByRole('status').textContent).toBe('最後に確かめた時刻：—（この画面ではまだ確認していません）')
    view.rerender(<LastChecked inSession busy />)
    expect(screen.getByRole('status').textContent).toContain('まだ確認していません）確認中…')
    view.rerender(<LastChecked inSession at="2026-10-29T02:00:00Z" />)
    expect(screen.getByRole('status').textContent).toBe('最後に確かめた時刻：10月29日 11:00（この画面での確認）')
    expect(screen.queryByText('確認中…')).toBeNull()
  })
})
