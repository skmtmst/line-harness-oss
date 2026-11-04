// @vitest-environment happy-dom
import React from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EntryRoute } from '@line-crm/shared'
import BulkRoutesDialog from './bulk-dialog'
const calls = vi.hoisted(() => ({ update: vi.fn() }))
vi.mock('@/lib/api', async original => { const actual = await original<typeof import('@/lib/api')>(); return { ...actual, api: { ...actual.api, entryRoutes: { ...actual.api.entryRoutes, update: calls.update } } } })

afterEach(() => { cleanup(); calls.update.mockReset() })

it('一括操作の受付先アカウントは推測せず環境とともに示す', () => {
  render(<BulkRoutesDialog targets={[{ id: 'route-1', name: '人工経路', isActive: true } as EntryRoute]} genreOptions={[]} initialAction="pause" onApplied={vi.fn()} onClose={vi.fn()} />)
  const dialog = screen.getByRole('dialog', { name: '流入経路をまとめて操作' })
  expect(within(dialog).getByText('受付先アカウント')).toBeTruthy()
  expect(within(dialog).getByText('受付先の全アカウントは確認できません。')).toBeTruthy()
  expect(within(dialog).getByText('不明')).toBeTruthy()
  expect(within(dialog).getByText('環境')).toBeTruthy()
  expect(within(dialog).getByText('人工経路')).toBeTruthy()
})

it('一括操作中に対象が変わったら残りを送らない', async () => {
  let finish!: (value: { success: boolean }) => void
  calls.update.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const scope = { current: { id: 'a', generation: 0 } }
  render(<BulkRoutesDialog targets={['r1', 'r2'].map(id => ({ id, name: id, isActive: true } as EntryRoute))} genreOptions={[]} initialAction="pause" scopeRef={scope} onApplied={vi.fn()} onClose={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: '2 件に実行する' }))
  expect(calls.update).toHaveBeenCalledTimes(1)
  scope.current = { id: 'b', generation: 1 }
  await act(async () => { finish({ success: true }) })
  expect(calls.update).toHaveBeenCalledTimes(1)
})

it('アカウント切替後の古い一括確認は実行しない', () => {
  const scope = { current: { id: 'a', generation: 0 } }
  const view = render(<BulkRoutesDialog targets={[{ id: 'route-1', name: '人工経路', isActive: true } as EntryRoute]} genreOptions={[]} initialAction="pause" scopeRef={scope} onApplied={vi.fn()} onClose={vi.fn()} />)
  const button = screen.getByRole('button', { name: '1 件に実行する' })
  const key = Object.keys(button).find(k => k.startsWith('__reactProps$'))!
  const old = (button as unknown as Record<string, { onClick: () => void }>)[key].onClick
  scope.current = { id: 'b', generation: 1 }
  view.unmount()
  old()
  expect(calls.update).not.toHaveBeenCalled()
})
