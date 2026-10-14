// @vitest-environment happy-dom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import FolderPanel from '@/components/shared/folder-panel'
import ListToolbar from '@/components/shared/list-toolbar'
import Pagination from '@/components/shared/pagination'
import { PageHeading } from '@/components/templates/page-frame'
import BookingLedgerFrame from '@/v8/booking-bookings/ledger-frame'
import BookingLedgerBody from '@/v8/booking-bookings/ledger-body'

afterEach(cleanup)

function Ledger({ readOnly = false }: { readOnly?: boolean }) {
  const [activeId, setActiveId] = useState('all')
  const [query, setQuery] = useState('')
  const rows = [{ id: 'all', label: 'すべて', count: 3 }, { id: 'cut', label: 'カット', count: 3 }]
  return <BookingLedgerFrame view="month">
    <PageHeading title="予約管理" />
    <BookingLedgerBody view="month" readOnly={readOnly} stats={<p>今月の予約3件</p>}
      folders={<FolderPanel heading="メニュー" rows={rows} activeId={activeId} onSelect={setActiveId} />}
      folderNav={{ rows, activeId, onSelect: setActiveId, label: 'メニュー' }}
      toolbar={<ListToolbar search={{ placeholder: 'お客さま名で検索', value: query, onChange: setQuery }} />}
      pagination={<Pagination page={1} pageCount={1} onPageChange={() => {}} range={{ total: 3, first: 1, last: 3 }} />}>
      <p>{`選択中:${activeId} 検索:${query}`}</p>
    </BookingLedgerBody>
  </BookingLedgerFrame>
}

it('月のメニュー絞り込みは左の列と畳んだ欄で同じ選択を使う', async () => {
  const { container } = render(<Ledger />)
  const folders = container.querySelector('[data-template-region="folders"]') as HTMLElement
  fireEvent.click(within(folders).getByRole('button', { name: /^カット/ }))
  expect(screen.getByText('選択中:cut 検索:')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'メニュー' }))
  fireEvent.click(within(screen.getByRole('option', { name: 'すべて' })).getByRole('button'))
  expect(screen.getByText('選択中:all 検索:')).toBeTruthy()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '花子' } })
  await waitFor(() => expect(screen.getByText('選択中:all 検索:花子')).toBeTruthy())
  const page = container.querySelector('[data-page-template="list"]')!
  expect(page.querySelector('[data-list-skeleton="templates"] [data-template-region="stats"]')?.textContent).toContain('今月の予約3件')
  expect(page.querySelector('[data-template-region="pagination"] [data-pagination-summary]')?.textContent).toContain('3件中 1〜3件')
  expect((screen.getByRole('button', { name: '次のページ' }) as HTMLButtonElement).disabled).toBe(true)
})

it('閲覧のみでもメニューと検索を使え、更新の口を足さない', async () => {
  render(<Ledger readOnly />)
  expect(screen.getByText(/閲覧のみで見ています/)).toBeTruthy()
  expect(screen.queryByRole('button', { name: /作る|電話の予約/ })).toBeNull()
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: '花子' } })
  await waitFor(() => expect(screen.getByText('選択中:all 検索:花子')).toBeTruthy())
})
