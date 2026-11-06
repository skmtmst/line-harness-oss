// @vitest-environment happy-dom
import React, { act } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StaffMember } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import { forgetStaffIdentity, rememberStaffIdentity } from '@/lib/staff-identity-state'
import { loadFailureCopy, loadFailureNotice } from './api-error-message'
import ListState, { UNKNOWN_COUNT_TEXT } from './list-state'
import TargetMissing from './target-missing'

const config = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_API_URL ||= 'http://worker.test'
  return { contact: 'https://musubo.jp/contact/' as string | null }
})
vi.mock('@/lib/auth-email', async original => ({
  ...await original<typeof import('@/lib/auth-email')>(),
  get CONFIGURED_CONTACT_URL() { return config.contact },
}))
vi.mock('next/link', () => ({ default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a> }))

beforeEach(() => { config.contact = 'https://musubo.jp/contact/'; forgetStaffIdentity() })
afterEach(() => { cleanup(); forgetStaffIdentity(); vi.restoreAllMocks() })

const signIn = (scope: string, role = 'staff') => rememberStaffIdentity({ id: 'reader', role, accountScope: scope } as StaffMember)

describe('標準の失敗案内の問い合わせ先', () => {
  it.each([
    { scope: 'all', role: 'owner', configured: null, href: '/hq/support' },
    { scope: 'all', role: 'staff', configured: 'https://musubo.jp/contact/', href: '/hq/support' },
    { scope: 'all', role: 'viewer', configured: 'https://musubo.jp/contact/', href: '/hq/support' },
    { scope: 'accounts', role: 'staff', configured: 'https://musubo.jp/contact/', href: 'https://musubo.jp/contact/' },
    { scope: 'accounts', role: 'viewer', configured: 'https://musubo.jp/contact/', href: 'https://musubo.jp/contact/' },
    { scope: null, role: 'staff', configured: 'https://musubo.jp/contact/', href: 'https://musubo.jp/contact/' },
    { scope: 'accounts', role: 'viewer', configured: null, href: null },
    { scope: null, role: 'staff', configured: null, href: null },
  ])('$scope/$role/窓口=$configured', ({ scope, role, configured, href }) => {
    config.contact = configured
    if (scope) signIn(scope, role)
    const retry = vi.fn()
    const view = render(<ListState kind="error" error={new ApiError(503, 'unavailable')} onRetry={retry} />)
    if (href) {
      const link = screen.getByRole('link', { name: 'お問い合わせ' })
      expect(link.getAttribute('href')).toBe(href)
      expect(link.hasAttribute('aria-disabled')).toBe(false)
      expect(screen.getAllByRole('link')).toHaveLength(1)
      if (href.startsWith('https://')) {
        expect(link.getAttribute('target')).toBe('_blank')
        expect(link.getAttribute('rel')).toContain('noopener')
      } else expect(link.getAttribute('target')).toBeNull()
    } else {
      expect(screen.queryByRole('link')).toBeNull()
      expect(view.container.querySelector('[data-target-missing] p:last-of-type')?.textContent).toBe('管理者にお問い合わせください。')
    }
    expect(view.container.textContent).not.toContain('エラー報告へ')
    fireEvent.click(screen.getByRole('button', { name: 'もう一度読み込む' }))
    expect(retry).toHaveBeenCalledTimes(1)
  })

  it.each([
    loadFailureCopy(undefined, 'この画面').description,
    UNKNOWN_COUNT_TEXT + loadFailureCopy(undefined, 'この画面').description,
    loadFailureNotice(undefined, 'この画面'),
  ])('既存の標準文だけを置き換え、件数や失敗の補足は残す：%s', description => {
    signIn('all')
    const view = render(<TargetMissing kind="error" title="一覧を読み込めませんでした" description={description} onRetry={vi.fn()} />)
    expect(screen.getByRole('link', { name: 'お問い合わせ' }).getAttribute('href')).toBe('/hq/support')
    if (description.includes(UNKNOWN_COUNT_TEXT)) expect(view.container.textContent).toContain(UNKNOWN_COUNT_TEXT)
    if (description.startsWith('表示できませんでした。')) expect(view.container.textContent).toContain('表示できませんでした。')
  })

  it.each([
    '通信が切れました。保存済みの内容は消えていません。',
    '独自の説明。' + loadFailureCopy(undefined, 'この画面').description,
    loadFailureCopy(undefined, 'この画面').description + '別の窓口を指定しています。',
    '',
  ])('独自の文は部分一致で変えない：%s', description => {
    signIn('all')
    const view = render(<TargetMissing kind="error" title="読めません" description={description} />)
    expect(screen.queryByRole('link')).toBeNull()
    expect(view.container.querySelector('[data-target-missing] p:last-of-type')?.textContent).toBe(description)
  })

  it('403・429の案内と再読込中の状態を保つ', () => {
    signIn('all')
    const retry = vi.fn()
    const view = render(<ListState kind="error" error={new ApiError(403, 'forbidden')} onRetry={retry} />)
    expect(view.container.textContent).toContain('権限')
    expect(screen.queryByRole('link')).toBeNull()
    view.rerender(<ListState kind="error" error={new ApiError(429, 'busy', undefined, undefined, undefined, 30)} onRetry={retry} retrying />)
    expect(view.container.textContent).toContain('30秒')
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true)
    expect(retry).not.toHaveBeenCalled()
  })

  it('本人が確定した後は既存の本人情報に追随し、読み直しは始めない', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected request'))
    const retry = vi.fn()
    const view = render(<ListState kind="error" onRetry={retry} />)
    expect(screen.getByRole('link', { name: 'お問い合わせ' }).getAttribute('href')).toBe('https://musubo.jp/contact/')
    act(() => signIn('all'))
    expect(screen.getByRole('link', { name: 'お問い合わせ' }).getAttribute('href')).toBe('/hq/support')
    expect(view.container.textContent).toContain(UNKNOWN_COUNT_TEXT)
    expect(retry).not.toHaveBeenCalled()
    expect(network).not.toHaveBeenCalled()
  })
})
