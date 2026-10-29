// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot, rememberSessionSnapshot } from '@/lib/session-snapshot'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import EmptyList from './empty-list'
import { PERMISSION_LOCK_REASON } from './permission-lock'

const base = { icon: <span aria-hidden="true">印</span>, title: 'まだルールはありません', description: '受信した言葉に返事をします。' }
beforeEach(() => { forgetStaffIdentity(); forgetSessionSnapshot() })
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it('本人確認中は理由なしのdisabledを保ち、既知拒否へ変わっても移動先を残さず、許可後だけリンクにする', () => {
  const props = { ...base, create: { label: 'ルールを作る', href: '/auto-replies/edit' } }
  const view = render(<EmptyList {...props} canCreate={false} lockedReason={null} />)
  const pending = screen.getByRole('button', { name: 'ルールを作る' })
  expect(pending).toHaveProperty('disabled', true)
  expect(document.querySelector('[data-permission-locked], a[href]')).toBeNull()
  expect(screen.queryByText(PERMISSION_LOCK_REASON.feature)).toBeNull()
  verifiedStaffRole('viewer')
  view.rerender(<EmptyList {...props} canCreate={false} lockedReason={PERMISSION_LOCK_REASON.viewer} />)
  const locked = screen.getByRole('button', { name: 'ルールを作る' })
  expect(locked).toHaveProperty('disabled', false)
  expect(locked.getAttribute('aria-disabled')).toBe('true')
  expect(locked.hasAttribute('data-permission-locked')).toBe(true)
  expect(document.querySelector('a[href]')).toBeNull()
  const reasonId = locked.getAttribute('aria-describedby')!
  expect(document.getElementById(reasonId)?.textContent).toBe(PERMISSION_LOCK_REASON.viewer)
  verifiedStaffRole('owner')
  view.rerender(<EmptyList {...props} canCreate lockedReason={null} />)
  expect(screen.getByRole('link', { name: 'ルールを作る' }).getAttribute('href')).toBe('/auto-replies/edit')
})

it('未知と既知拒否では保持する作成callbackを呼ばず、編集者へ確定した後だけ1回動く', () => {
  const create = vi.fn(), props = { ...base, create: { label: 'ルールを作る', onClick: create } }
  const view = render(<EmptyList {...props} canCreate={false} lockedReason={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'ルールを作る' }))
  verifiedStaffRole('viewer')
  view.rerender(<EmptyList {...props} canCreate={false} lockedReason={PERMISSION_LOCK_REASON.viewer} />)
  const locked = screen.getByRole('button', { name: 'ルールを作る' })
  fireEvent.click(locked); fireEvent.keyDown(locked, { key: 'Enter' }); fireEvent.keyDown(locked, { key: ' ' })
  expect(create).not.toHaveBeenCalled()
  verifiedStaffRole('owner')
  view.rerender(<EmptyList {...props} canCreate lockedReason={null} />)
  fireEvent.click(screen.getByRole('button', { name: 'ルールを作る' }))
  expect(create).toHaveBeenCalledTimes(1)
})

it('省略した既存callerは従来の権限理由を持ち、read代理のownerにもhrefを出さない', () => {
  verifiedStaffRole('owner')
  const props = { ...base, create: { label: 'ルールを作る', href: '/auto-replies/edit' } }
  const view = render(<EmptyList {...props} canCreate={false} />)
  expect(document.querySelector('[data-permission-locked]')).not.toBeNull()
  rememberSessionSnapshot({ impersonation: { id: 'proxy', tenantId: 'tenant', mode: 'read', piiRevealed: false, startedAt: '' }, unfamiliarAt: null, stepUpMethod: 'none' })
  view.rerender(<EmptyList {...props} canCreate />)
  const locked = screen.getByRole('button', { name: 'ルールを作る' })
  expect(document.getElementById(locked.getAttribute('aria-describedby')!)?.textContent).toBe(PERMISSION_LOCK_REASON.impersonation)
  expect(document.querySelector('a[href]')).toBeNull()
})

it('絞り込み解除は拒否理由があっても使え、作成操作へ化けない', () => {
  const clear = vi.fn(), create = vi.fn()
  render(<EmptyList {...base} filtered canCreate={false} lockedReason={PERMISSION_LOCK_REASON.viewer} create={{ label: 'ルールを作る', onClick: create }} onClearFilters={clear} />)
  fireEvent.click(screen.getByRole('button', { name: '条件を外す' }))
  expect(clear).toHaveBeenCalledTimes(1)
  expect(create).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: 'ルールを作る' })).toBeNull()
  expect(document.querySelector('[data-permission-locked]')).toBeNull()
})

it('独自の作成actionを渡しても未知の拒否を迂回せず、許可後にだけそのactionを出す', () => {
  const create = vi.fn(), props = { ...base, create: { label: 'ルールを作る', onClick: create }, action: <button onClick={create}>見本から作る</button> }
  const view = render(<EmptyList {...props} canCreate={false} lockedReason={null} />)
  expect(screen.queryByRole('button', { name: '見本から作る' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'ルールを作る' }))
  expect(create).not.toHaveBeenCalled()
  verifiedStaffRole('owner')
  view.rerender(<EmptyList {...props} canCreate lockedReason={null} />)
  fireEvent.click(screen.getByRole('button', { name: '見本から作る' }))
  expect(create).toHaveBeenCalledTimes(1)
})
