// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AccountActionButton } from './button'
import { AttentionCount } from './attention-count'
afterEach(cleanup)
it('共通の操作は文字と印を組にし、詳細は印なしで開ける', () => {
  const open = vi.fn()
  render(<><AccountActionButton action="detail" onClick={open} /><AccountActionButton action="enter" /><AccountActionButton action="settings" /><AccountActionButton action="restore" /></>)
  const detail = screen.getByRole('button', { name: '詳細' })
  expect(detail.querySelector('svg')).toBeNull()
  for (const [name, icon] of [['入る', 'lucide-log-in'], ['設定', 'lucide-settings'], ['戻す', 'lucide-rotate-ccw']]) expect(screen.getByRole('button', { name }).querySelector(`.${icon}`)).not.toBeNull()
  fireEvent.click(detail)
  expect(open).toHaveBeenCalledOnce()
})
it('要対応0件に押し口を置かず、急ぐ件数だけ危険の札で開く', () => {
  const open = vi.fn()
  render(<><AttentionCount value={0} label="未払いなし" onClick={open} /><AttentionCount value={3} label="未対応" onClick={open} /><AttentionCount value={2} urgent label="未払い" onClick={open} /></>)
  expect(screen.queryByRole('button', { name: '未払いなし' })).toBeNull()
  expect(screen.getByRole('button', { name: '未対応' }).querySelector('[data-design-node="xRvDB"]')).toBeNull()
  expect(screen.getByRole('button', { name: '未払い' }).textContent).toBe('2 件')
  fireEvent.click(screen.getByRole('button', { name: '未払い' }))
  expect(open).toHaveBeenCalledOnce()
})
