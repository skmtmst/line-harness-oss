// @vitest-environment happy-dom
import { fireEvent, render, cleanup, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import CheckCard from './check-card'

afterEach(cleanup)

test('選択不足の理由をチェック欄へつなぎ、選択を妨げず、解消後は誤りを外せる', () => {
  const change = vi.fn()
  const view = render(<>
    <CheckCard title="店頭QR" checked={false} onChange={change} invalid describedBy="route-error" />
    <p id="route-error">リンクを選んでください</p>
  </>)
  const checkbox = screen.getByRole('checkbox')
  expect(checkbox.getAttribute('aria-invalid')).toBe('true')
  expect(document.getElementById(checkbox.getAttribute('aria-describedby')!)?.textContent).toBe('リンクを選んでください')
  checkbox.focus()
  expect(checkbox.getAttribute('aria-invalid')).toBe('true')
  fireEvent.click(checkbox)
  expect(change).toHaveBeenCalledWith(true)
  view.rerender(<CheckCard title="店頭QR" checked onChange={change} />)
  expect(screen.getByRole('checkbox').getAttribute('aria-invalid')).toBeNull()
  expect(screen.getByRole('checkbox').getAttribute('aria-describedby')).toBeNull()
})
