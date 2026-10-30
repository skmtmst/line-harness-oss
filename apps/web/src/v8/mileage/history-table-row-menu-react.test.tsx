// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MileageAdminHistoryItem } from '@/lib/api'
import HistoryTable from './history-table'

vi.mock('next/link', () => ({ default: () => null }))
vi.mock('@/components/shared/list-navigation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/shared/list-navigation')>()
  return { ...actual, useListNavigationRouter: () => ({ push() {} }) }
})

afterEach(cleanup)

const base: MileageAdminHistoryItem = {
  id: 'h1', primaryFriendId: 'friend-1', displayName: '田中', pictureUrl: null,
  entryType: 'grant', status: 'pending', amount: 100, reason: '来店', source: 'manual',
  hasSourceEvent: false, sourceReferenceId: null, ruleName: null, mode: 'manual',
  executedByStaffName: '店長', lineAccountName: '店舗', balanceAfter: 100,
  occurredAt: '2026-10-01T00:00:00.000Z',
}

function setup(item: MileageAdminHistoryItem, readonly = false) {
  const openPending = vi.fn()
  const setMenuId = vi.fn()
  const { rerender } = render(
    <HistoryTable items={[item]} readonly={readonly} menuId={null} setMenuId={setMenuId}
      openPending={openPending} viewName={() => '田中'} />,
  )
  const openMenu = async () => {
    fireEvent.click(screen.getByRole('button', { name: '田中の明細の操作' }))
    const id = setMenuId.mock.calls.at(-1)?.[0] ?? null
    rerender(
      <HistoryTable items={[item]} readonly={readonly} menuId={id} setMenuId={setMenuId}
        openPending={openPending} viewName={() => '田中'} />,
    )
  }
  return { openPending, openMenu }
}

/**
 * 108：行の右は「いちばん大事な操作1つ＋『…』」。「…」の中にも
 * 同じ主操作を入れる（hq-templates の参照形）。
 */
it('保留中の行はボタンと「…」の両方に確定するを出す', async () => {
  const { openMenu } = setup({ ...base, status: 'pending' })
  expect(screen.getByRole('button', { name: '確定する' })).toBeTruthy()
  await openMenu()
  expect(await screen.findByRole('menuitem', { name: '確定する' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '取り消す' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '友だちを見る' })).toBeTruthy()
})

it('戻せる行はボタンと「…」の両方に取り消すを出す', async () => {
  const { openMenu } = setup({ ...base, status: 'available' })
  expect(screen.getByRole('button', { name: '取り消す' })).toBeTruthy()
  await openMenu()
  expect(await screen.findByRole('menuitem', { name: '取り消す' })).toBeTruthy()
  expect(screen.getByRole('menuitem', { name: '友だちを見る' })).toBeTruthy()
})

it('「…」の確定するも同じ保存口を呼ぶ', async () => {
  const { openPending, openMenu } = setup({ ...base, status: 'pending' })
  await openMenu()
  fireEvent.click(await screen.findByRole('menuitem', { name: '確定する' }))
  expect(openPending).toHaveBeenCalledWith('confirm', expect.objectContaining({ id: 'h1' }))
})
