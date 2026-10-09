// @vitest-environment happy-dom
import { useRef, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const apiMocks = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn() }))
vi.mock('@/lib/api', () => ({ api: { lineAccounts: { list: apiMocks.list, updateHierarchy: apiMocks.update } } }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
import AccountOrdering from './account-ordering'
import Dialog from '../shared/dialog'
afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-theme') })
function Harness() {
  const [open, setOpen] = useState(true), [busy, setBusy] = useState(false)
  const guard = useRef<((close: () => void) => void) | null>(null)
  return <Dialog open={open} title="構成を直す" busy={busy} onCancel={() => guard.current?.(() => setOpen(false))}><AccountOrdering closeGuardRef={guard} onBusyChange={setBusy} /></Dialog>
}
it('WEB-239: 構成を変えた窓は×とEscで確認し、保存中は閉じない', async () => {
  apiMocks.list.mockResolvedValue({ success: true, data: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
  let finish!: (value: { success: boolean }) => void
  apiMocks.update.mockImplementation(() => new Promise(resolve => { finish = resolve }))
  render(<Harness />)
  await waitFor(() => expect(screen.getByRole('button', { name: 'Aの移動先を選ぶ' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Aの移動先を選ぶ' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /「B」の子にする/ }))
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(screen.getByRole('dialog', { name: /保存していない変更/ })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: /編集を続ける/ }))
  fireEvent.click(screen.getByRole('button', { name: /並びを保存する/ }))
  await waitFor(() => expect(screen.getByRole('button', { name: '閉じる' }).disabled).toBe(true))
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.getByRole('dialog', { name: '構成を直す' })).toBeTruthy()
  await act(async () => finish({ success: true }))
})

it('WEB-239: 構成の保存で通信が失敗しても、変更を残して編集と離脱確認に戻れる', async () => {
  apiMocks.list.mockResolvedValue({ success: true, data: [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }] })
  apiMocks.update.mockRejectedValue(new Error('通信が切れました'))
  render(<Harness />)
  fireEvent.click(await screen.findByRole('button', { name: 'Aの移動先を選ぶ' }))
  fireEvent.click(screen.getByRole('menuitem', { name: /「B」の子にする/ }))
  fireEvent.click(screen.getByRole('button', { name: /並びを保存する/ }))
  await screen.findByText('通信が切れました')
  await waitFor(() => expect(screen.getByRole('button', { name: '閉じる' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '閉じる' }))
  expect(screen.getByRole('dialog', { name: /保存していない変更/ })).toBeTruthy()
})
