// @vitest-environment happy-dom
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountWithStats } from '@/contexts/account-context'
import AccountBrowser from './account-browser-v8'
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }))
vi.mock('@/lib/api', () => ({
  api: { lineAccountTags: { list: async () => ({ success: true, data: [] }) } },
}))
afterEach(cleanup)
const baseProps = {
  onDetail: vi.fn(),
  onRestore: vi.fn(),
  onRefreshConnection: vi.fn(),
  checkingConnections: false as boolean,
  onChanged: vi.fn(),
}
const accounts = Array.from({ length: 23 }, (_, i): AccountWithStats => ({ id: `a${i}`, name: `店舗${String(i).padStart(2, '0')}`, channelId: `channel${i}`, basicId: `@shop${i}`, isActive: true, country: null, role: i === 11 ? 'viewer' : 'owner', displayOrder: i, connection: { status: i === 11 ? 'warn' : 'ok', checkedAt: null }, stats: { friendCount: i, messagesThisMonth: i * 2, activeScenarios: 0, staffCount: 1 } }))
describe('V8 統括のアカウントを探す', () => {
  it('2ページ目のアカウントへ入る時は表示した行のIDを渡す', () => {
    const select = vi.fn()
    render(<AccountBrowser accounts={accounts} onSelect={select} onSettings={vi.fn()} {...baseProps} />)
    expect(screen.queryByText('店舗00')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '2ページ目へ' }))
    fireEvent.click(screen.getAllByRole('button', { name: 'このアカウントへ入る' })[0])
    expect(select).toHaveBeenCalledWith('a2')
    expect(screen.getByText(/21〜23件/)).toBeTruthy()
  })
  it('LINE ID検索でページを戻し、閲覧者の設定ボタンを無効にする', () => {
    const settings = vi.fn()
    render(<AccountBrowser accounts={accounts} onSelect={vi.fn()} onSettings={settings} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: '2ページ目へ' }))
    fireEvent.change(screen.getByRole('searchbox', { name: 'アカウント名・LINE ID・タグで探す' }), { target: { value: '@shop11' } })
    expect(screen.getByText('店舗11')).toBeTruthy()
    expect(screen.getByRole('button', { name: '店舗11 の設定' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '店舗11 の設定' }))
    expect(settings).not.toHaveBeenCalled()
    fireEvent.change(screen.getByRole('searchbox', { name: 'アカウント名・LINE ID・タグで探す' }), { target: { value: '' } })
    expect(screen.getByText('店舗22')).toBeTruthy()
    expect(screen.getByRole('button', { name: '1ページ目へ' }).getAttribute('aria-current')).toBe('page')
  })
  it('タグを追加する窓が開く', () => {
    render(<AccountBrowser accounts={accounts} onSelect={vi.fn()} onSettings={vi.fn()} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: 'タグを追加' }))
    expect(screen.getByText('タグの名前')).toBeTruthy()
  })
  it('アーカイブは詳細と戻すだけを出す', () => {
    const archived: AccountWithStats = { id: 'old', name: '旧キャンペーン', channelId: 'c-old', basicId: '@nen-old', isActive: false, country: null, role: 'owner', displayOrder: 99, archivedAt: '2026-01-01', stats: { friendCount: 0, messagesThisMonth: 0, activeScenarios: 0, staffCount: 0 } }
    const restore = vi.fn()
    const detail = vi.fn()
    render(<AccountBrowser accounts={[archived]} onSelect={vi.fn()} onSettings={vi.fn()} {...baseProps} onDetail={detail} onRestore={restore} />)
    fireEvent.click(screen.getByRole('button', { name: /^アーカイブ/ }))
    expect(screen.getByRole('button', { name: '詳細' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '戻す' }))
    expect(restore).toHaveBeenCalledWith(archived)
    expect(screen.queryByRole('button', { name: 'このアカウントへ入る' })).toBeNull()
  })
  it('接続状態の絞り込みと表へ切り替えても同じアカウントを表示する', () => {
    render(<AccountBrowser accounts={accounts} onSelect={vi.fn()} onSettings={vi.fn()} {...baseProps} />)
    fireEvent.click(screen.getByRole('button', { name: /^要確認/ }))
    fireEvent.click(screen.getByRole('button', { name: '表で見る' }))
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.getByText('店舗11')).toBeTruthy()
    expect(screen.queryByText('店舗00')).toBeNull()
  })
})
