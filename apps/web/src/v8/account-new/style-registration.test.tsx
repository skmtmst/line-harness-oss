// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { styleTerm } from '@/lib/terms'
import ResumeRegistrationStyle from './resume-style'
import { REGISTRATION_STYLE_KEY } from './use-registration-style'
const net = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn() }))
vi.mock('@/lib/api/helpers/styles', () => ({ styleApi: net }))
beforeEach(() => {
  sessionStorage.clear()
  net.get.mockReset().mockResolvedValue({ success: true, data: { style: 'standard', styleSelected: false, version: 0 } })
  net.save.mockReset().mockResolvedValue({ success: true, data: { version: 1 } })
})
afterEach(cleanup)

it.each(ACCOUNT_STYLES)('%sを正式キーで同じアカウントへ保存し、登録をやり直さない', async style => {
  sessionStorage.setItem(REGISTRATION_STYLE_KEY, 'created-account')
  render(<ResumeRegistrationStyle accountId="created-account" />)
  expect(screen.getAllByRole('radio')).toHaveLength(6)
  fireEvent.click(screen.getByRole('radio', { name: styleTerm(style, 'V01') }))
  await waitFor(() => expect((screen.getByRole('button', { name: '使い方を保存する' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '使い方を保存する' }))
  await screen.findByText('使い方を保存しました')
  expect(net.save).toHaveBeenCalledExactlyOnceWith('created-account', { expectedVersion: 0, style, answers: {} })
  expect(sessionStorage.getItem(REGISTRATION_STYLE_KEY)).toBeNull()
  expect(screen.getByRole('link', { name: '次へ' }).getAttribute('href')).toBe(style === 'restaurant' ? '/restaurant-test/stores/new' : '/hq')
})

it('保存失敗では完了にせず、同じ選択と作成済みIDで再試行する', async () => {
  net.save.mockRejectedValueOnce(new Error('offline'))
  render(<ResumeRegistrationStyle accountId="created-account" />)
  fireEvent.click(screen.getByRole('radio', { name: '面談・相談' }))
  const save = screen.getByRole('button', { name: '使い方を保存する' })
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByText('使い方を確認・保存できませんでした')
  expect(screen.queryByText('使い方を保存しました')).toBeNull()
  expect((screen.getByRole('radio', { name: '面談・相談' }) as HTMLInputElement).checked).toBe(true)
  fireEvent.click(save)
  await screen.findByText('使い方を保存しました')
  expect(net.save.mock.calls.map(call => call[0])).toEqual(['created-account', 'created-account'])
})

it('取得失敗を標準へ戻さず、再読込後も保存済みの業種を選ぶ', async () => {
  net.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true, data: { style: 'lesson', styleSelected: true, version: 4 } })
  render(<ResumeRegistrationStyle accountId="created-account" />)
  await screen.findByText('使い方を確認・保存できませんでした')
  expect((screen.getByRole('button', { name: '使い方を保存する' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
  await waitFor(() => expect((screen.getByRole('radio', { name: '教室・レッスン' }) as HTMLInputElement).checked).toBe(true))
  expect(net.save).not.toHaveBeenCalled()
})
