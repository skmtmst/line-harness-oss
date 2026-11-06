// @vitest-environment happy-dom
/*
 * ★V8 自動応答「かんたんに作る」（板 G4GejG、小窓 560）。
 * 共通の窓で開き、言葉と返す文は欄を離れたときに確かめて、直し方を読み上げにも出す。
 * 下書き→重なりの確認→公開の流れは v8/auto-replies/quick-create.test.tsx が押して見る。
 */
import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verifiedStaffRole } from '@/test-utils/verified-staff-role'
import { forgetStaffIdentity } from '@/lib/staff-identity-state'
import { forgetSessionSnapshot } from '@/lib/session-snapshot'

const apiMock = vi.hoisted(() => ({ createDraft: vi.fn(), saveDraft: vi.fn(), conflicts: vi.fn(), publishDraft: vi.fn() }))
vi.mock('@/lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/api')>()), api: { autoReplies: apiMock } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }))

import QuickCreate from '@/v8/auto-replies/quick-create'

beforeEach(() => {
  verifiedStaffRole('owner'); forgetSessionSnapshot()
  document.documentElement.dataset.theme = 'v8'
  vi.clearAllMocks()
})
afterEach(() => { cleanup(); forgetStaffIdentity(); forgetSessionSnapshot() })

it('共通の窓として板 G4GejG の印で開く', () => {
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={vi.fn()} />)
  const dialog = screen.getByRole('dialog')
  const board = document.querySelector('[data-design-node="G4GejG"]')
  expect(board).not.toBeNull()
  expect(board === dialog || board!.contains(dialog) || dialog.contains(board)).toBe(true)
  expect(dialog.textContent).toContain('言葉に自動で返す')
})

it('空のまま言葉の欄を離れると、直し方を読み上げの帯で出す', async () => {
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={vi.fn()} />)
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
  await act(async () => { fireEvent.blur(screen.getByLabelText('追加する言葉')) })
  expect(screen.getByRole('alert').textContent).toBe('反応する言葉を1つ以上入れてください。')
})

it('空のまま返す文の欄を離れると、直し方を読み上げの帯で出し、入れると消える', async () => {
  render(<QuickCreate accountId="account-1" onClose={vi.fn()} onCreated={vi.fn()} />)
  await act(async () => { fireEvent.blur(screen.getByLabelText('返す文')) })
  expect(screen.getByRole('alert').textContent).toBe('返す文を入れてください。')
  fireEvent.change(screen.getByLabelText('返す文'), { target: { value: '10時からです' } })
  await act(async () => { fireEvent.blur(screen.getByLabelText('返す文')) })
  expect(screen.queryAllByRole('alert')).toHaveLength(0)
  expect(apiMock.createDraft).not.toHaveBeenCalled()
})
