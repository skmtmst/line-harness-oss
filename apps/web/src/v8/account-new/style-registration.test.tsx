// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { ACCOUNT_STYLES } from '@line-crm/shared'
import { STYLE_EXPERIENCE_SCRIPT } from '@/v8/onboarding/style-experience-player'
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

it.each(ACCOUNT_STYLES)('%sをポップアップで選び、同じアカウントへ保存して登録をやり直さない', async style => {
  sessionStorage.setItem(REGISTRATION_STYLE_KEY, 'created-account')
  render(<ResumeRegistrationStyle accountId="created-account" />)
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  const next = within(dialog).getByRole('button', { name: '次へ' }) as HTMLButtonElement
  expect(next.disabled).toBe(true)
  fireEvent.click(within(dialog).getByRole('button', { name: STYLE_EXPERIENCE_SCRIPT.styles[style].label }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'このスタイルにする' }))
  await waitFor(() => expect(next.disabled).toBe(false))
  fireEvent.click(next)
  await screen.findByText('使い方を保存しました')
  expect(net.save).toHaveBeenCalledExactlyOnceWith('created-account', { expectedVersion: 0, style, answers: {} })
  expect(sessionStorage.getItem(REGISTRATION_STYLE_KEY)).toBeNull()
  expect(screen.getByRole('link', { name: '次へ' }).getAttribute('href')).toBe(style === 'restaurant' ? '/restaurant-test/stores/new' : '/hq')
})

it('保存失敗では完了にせず、同じ選択と作成済みIDで再試行する', async () => {
  net.save.mockRejectedValueOnce(new Error('offline'))
  render(<ResumeRegistrationStyle accountId="created-account" />)
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  fireEvent.click(within(dialog).getByRole('button', { name: '面談・相談' }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'このスタイルにする' }))
  const save = within(dialog).getByRole('button', { name: '次へ' })
  await waitFor(() => expect((save as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(save)
  await screen.findByText('使い方を確認・保存できませんでした')
  expect(screen.queryByText('使い方を保存しました')).toBeNull()
  expect(within(dialog).getByRole('button', { name: '面談・相談（選んでいます）' })).toBeTruthy()
  fireEvent.click(save)
  await screen.findByText('使い方を保存しました')
  expect(net.save.mock.calls.map(call => call[0])).toEqual(['created-account', 'created-account'])
})

it('取得失敗を標準へ戻さず、再読込後も保存済みの業種を選ぶ', async () => {
  net.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ success: true, data: { style: 'lesson', styleSelected: true, version: 4 } })
  render(<ResumeRegistrationStyle accountId="created-account" />)
  await screen.findByText('使い方を確認・保存できませんでした')
  expect((within(screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })).getByRole('button', { name: 'あとで設定する' }) as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: '教室・レッスン（選んでいます）' })).toBeTruthy())
  expect(net.save).not.toHaveBeenCalled()
})

it('「あとで設定する」は保留を保存して次へ進み、次回の登録再開を止める', async () => {
  sessionStorage.setItem(REGISTRATION_STYLE_KEY, 'created-account')
  render(<ResumeRegistrationStyle accountId="created-account" />)
  const dialog = screen.getByRole('dialog', { name: '使い方のスタイルを選ぶ' })
  fireEvent.click(within(dialog).getByRole('button', { name: 'このスタイルにする' }))
  await waitFor(() => expect((within(dialog).getByRole('button', { name: 'あとで設定する' }) as HTMLButtonElement).disabled).toBe(false))
  fireEvent.click(within(dialog).getByRole('button', { name: 'あとで設定する' }))
  await screen.findByText('登録が完了しました')
  expect(net.save).toHaveBeenCalledExactlyOnceWith('created-account', { expectedVersion: 0, styleMode: 'later' })
  expect(sessionStorage.getItem(REGISTRATION_STYLE_KEY)).toBeNull()
  expect(screen.getByRole('link', { name: '次へ' }).getAttribute('href')).toBe('/hq')
})
