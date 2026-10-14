// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { DetailFrame } from './detail'
vi.mock('next/navigation', () => ({ useRouter: () => ({ push() {}, replace() {} }), usePathname: () => '/templates/detail', useSearchParams: () => new URLSearchParams() }))
afterEach(cleanup)

test('狭い板の入口から同じテンプレート情報と届き方を開き、本文を保持する', () => {
  render(<DetailFrame title="ご案内" identity={null} description="テキスト" preview={<p>今月の送信数と届き方</p>}><input aria-label="本文" defaultValue="予約のご案内" /></DetailFrame>)
  fireEvent.click(screen.getByRole('button', { name: 'テンプレートの情報と届き方を見る' }))
  const dialog = screen.getByRole('dialog', { name: 'テンプレートの情報と届き方' })
  expect(within(dialog).getByText('今月の送信数と届き方')).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '閉じる' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect((screen.getByRole('textbox', { name: '本文' }) as HTMLInputElement).value).toBe('予約のご案内')
})
