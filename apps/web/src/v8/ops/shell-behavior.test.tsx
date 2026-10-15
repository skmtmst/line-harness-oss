// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { OpsMe } from '@/lib/api'
vi.mock('next/navigation', async () => (await import('@/test-utils/navigation-mock')).navigationMock())
const logout = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('@/lib/logout', () => ({ logoutAndGoToLogin: logout }))
import OpsShellV8, { OpsHead } from './shell'
const me = { id: 'ops-1', name: '運営担当', email: null, readOnly: false, totpEnabled: true, lineLinked: false, legacy: false, impersonation: null } as OpsMe
const props = { me, meError: '', onRetryMe: () => {}, pathname: '/ops/members', children: <p>中身</p> }
afterEach(() => { cleanup(); logout.mockClear() })
describe('運営の自分の操作とメニューを閉じる動き', () => {
  it('本人の入口は左下だけに置き、上の帯と2要素認証の入口を重複させない', async () => {
    const { container } = render(<OpsShellV8 {...props} />)
    const self = screen.getByRole('button', { name: '自分のメニュー', exact: true })
    expect(self.closest('aside')).not.toBeNull()
    expect(container.querySelector('header')?.textContent).not.toContain(me.name)
    expect(screen.queryByRole('button', { name: 'ログアウト', exact: true })).toBeNull()
    expect(screen.queryByRole('link', { name: '2要素認証', exact: true })).toBeNull()
    fireEvent.keyDown(self, { key: 'ArrowUp' })
    expect(await screen.findByRole('menuitem', { name: '2要素認証（設定済み）' })).not.toBeNull()
  })
  it('注意を残し、環境の札は版の表示へまとめる', () => {
    render(<OpsHead title="監査ログ" environment="staging" />)
    expect(screen.getByRole('note').textContent).toContain('操作はすべて記録されます')
    expect(screen.getByRole('note').textContent).not.toContain('検証環境')
  })
  it('プロフィール・メンバー・認証の行き先とログアウトを自分のメニューから使える', async () => {
    render(<OpsShellV8 {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '自分のメニュー', exact: true }))
    const menu = await screen.findByRole('menu', { name: '自分の操作', exact: true })
    for (const [name, href] of [['プロフィールを編集', '/staff'], ['メンバー管理', '/ops/members'], ['2要素認証（設定済み）', '/ops/two-factor']]) {
      expect(within(menu).getByRole('menuitem', { name, exact: true }).getAttribute('href')).toBe(href)
    }
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'ログアウト', exact: true }))
    await waitFor(() => expect(logout).toHaveBeenCalledWith('/ops/login'))
  })
  it('矢印で自分の操作を選び、Escapeで閉じて名前へ戻る', async () => {
    render(<OpsShellV8 {...props} />)
    const trigger = screen.getByRole('button', { name: '自分のメニュー', exact: true })
    trigger.focus(); fireEvent.click(trigger)
    const menu = await screen.findByRole('menu', { name: '自分の操作', exact: true })
    const items = within(menu).getAllByRole('menuitem')
    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    fireEvent.keyDown(items[1], { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu', { name: '自分の操作' })).toBeNull())
    expect(document.activeElement).toBe(trigger)
  })
  it('開いた運営メニューは背景を止め、Escape・閉じる・画面移動で戻す', async () => {
    const { rerender } = render(<OpsShellV8 {...props} />)
    const open = screen.getByRole('button', { name: 'メニュー', exact: true })
    open.focus(); fireEvent.click(open)
    let drawer = await screen.findByRole('complementary', { name: '運営メニュー（開いた形）' })
    expect(document.body.style.overflow).toBe('hidden')
    fireEvent.keyDown(drawer, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '運営メニュー（開いた形）' })).toBeNull())
    expect(document.body.style.overflow).not.toBe('hidden')
    expect(document.activeElement).toBe(open)
    fireEvent.click(open)
    drawer = await screen.findByRole('complementary', { name: '運営メニュー（開いた形）' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'メニューを閉じる', exact: true }))
    expect(screen.queryByRole('complementary', { name: '運営メニュー（開いた形）' })).toBeNull()
    fireEvent.click(open)
    rerender(<OpsShellV8 {...props} pathname="/ops/audit" />)
    await waitFor(() => expect(screen.queryByRole('complementary', { name: '運営メニュー（開いた形）' })).toBeNull())
    expect(document.body.style.overflow).not.toBe('hidden')
  })
})
