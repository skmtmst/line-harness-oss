// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement, act } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { shortDateTime } from '@/lib/hq-banners'

const calls = vi.hoisted(() => ({ accounts: vi.fn(), health: vi.fn(), migrations: vi.fn() }))
vi.mock('@/lib/api', async (original) => ({ ...await original<typeof import('@/lib/api')>(), api: { health: { accounts: calls.accounts, getHealth: calls.health, migrations: calls.migrations } } }))
vi.mock('@/lib/staff-role', () => ({ useStaffRole: () => 'owner' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {} }))
import HealthPage from './page'

const account = (id: string) => ({ id, name: `アカウント${id}`, channelId: id, isActive: true })
const log = (riskLevel = 'normal', createdAt = new Date().toISOString()) => ({
  id: 'log-a', lineAccountId: 'a', errorCode: 429, errorCount: 2, checkPeriod: '5分', riskLevel, createdAt,
})
const accountButton = (id = 'a') => screen.getByRole('button', { name: new RegExp(`アカウント${id}`) })
beforeEach(() => {
  calls.accounts.mockResolvedValue({ success: true, data: [account('a')] })
  calls.health.mockResolvedValue({ success: true, data: {} })
  calls.migrations.mockResolvedValue({ success: true, data: [] })
})
afterEach(() => cleanup())

describe('監視の状態と個別の読み直し', () => {
  it.each([
    [{ success: true, data: { riskLevel: 'normal' } }, '正常'],
    [{ success: true, data: { riskLevel: 'warning' } }, '警告'],
    [{ success: true, data: { riskLevel: 'danger' } }, '危険'],
    [{ success: true, data: { logs: [log('warning')] } }, '警告'],
    [{ success: true, data: { riskLevel: 'invalid', logs: [log('danger')] } }, '危険'],
    [{ success: true, data: { riskLevel: 'normal', logs: [log('danger')] } }, '正常'],
    [{ success: true, data: { riskLevel: 'invalid' } }, '未確認'],
    [{ success: true, data: null }, '未確認'],
    [{ success: false, data: { riskLevel: 'normal' } }, '取得失敗'],
  ])('%jを%sとして表示する', async (response, label) => {
    calls.health.mockResolvedValue(response)
    render(createElement(HealthPage))
    await screen.findByRole('button', { name: /アカウントa/ })
    expect(within(accountButton()).getByText(label, { exact: true })).toBeTruthy()
    expect(calls.health).toHaveBeenCalledWith('a')
  })

  it('成功と失敗をアカウントごとに保ち、失敗した1件だけを再取得する', async () => {
    calls.accounts.mockResolvedValue({ success: true, data: [account('a'), account('b')] })
    calls.health.mockImplementation(async (id: string) => {
      if (id === 'a') throw new Error('offline')
      return { success: true, data: { riskLevel: 'warning' } }
    })
    render(createElement(HealthPage))
    await screen.findByRole('button', { name: /アカウントa/ })
    expect(within(accountButton('a')).getByText('取得失敗')).toBeTruthy()
    expect(within(accountButton('b')).getByText('警告')).toBeTruthy()
    fireEvent.click(accountButton())
    expect(screen.getByText('ヘルス情報を取得できませんでした。')).toBeTruthy()
    let resolve!: (value: unknown) => void
    calls.health.mockImplementationOnce(() => new Promise((done) => { resolve = done }))
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    expect((screen.getByRole('button', { name: '再取得中...' }) as HTMLButtonElement).disabled).toBe(true)
    expect(within(accountButton('b')).getByText('警告')).toBeTruthy()
    await act(async () => resolve({ success: true, data: { riskLevel: 'normal' } }))
    await waitFor(() => expect(within(accountButton()).getByText('正常')).toBeTruthy())
    expect(calls.health.mock.calls.map(([id]) => id)).toEqual(['a', 'b', 'a'])
    expect(screen.queryByText('ヘルス情報を取得できませんでした。')).toBeNull()
  })

  it.each(['normal', 'danger'])('古い%sの記録を現在の結果とせず、最後の日時と確認停止を示す', async (riskLevel) => {
    const last = log(riskLevel, new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())
    calls.health.mockResolvedValue({ success: true, data: { riskLevel, logs: [last] } })
    render(createElement(HealthPage))
    await screen.findByRole('button', { name: /アカウントa/ })
    expect(within(accountButton()).getByText('確認停止中')).toBeTruthy()
    expect(within(accountButton()).getByText(`最終確認 ${shortDateTime(last.createdAt)}`)).toBeTruthy()
    fireEvent.click(accountButton())
    expect(screen.getByText(/確認が止まっているため、現在の状態は分かりません/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '再試行' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '友だちを移行する' }) !== null).toBe(riskLevel === 'danger')
  })

  it('未確認のときは日時を捏造せず、確認結果がない案内から再試行できる', async () => {
    render(createElement(HealthPage))
    await screen.findByRole('button', { name: /アカウントa/ })
    expect(within(accountButton()).getByText('最終確認 —')).toBeTruthy()
    fireEvent.click(accountButton())
    expect(screen.getByText('まだ確認結果がありません。')).toBeTruthy()
    calls.health.mockResolvedValue({ success: true, data: { riskLevel: 'normal' } })
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))
    await waitFor(() => expect(within(accountButton()).getByText('正常')).toBeTruthy())
  })

  it('取得していない状態を正常で穴埋めしない', () => {
    const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'page.tsx'), 'utf8')
    expect(PAGE).not.toContain("risks[account.id] = 'normal'")
    expect(PAGE).not.toContain("latestRisk[account.id] || 'normal'")
  })
})
