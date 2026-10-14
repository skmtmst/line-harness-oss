// @vitest-environment happy-dom
import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const model = vi.hoisted(() => ({ download: vi.fn(), created: false, locked: false, expires: '2030-01-01T00:00:00Z' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ usePathname: () => '/friends/migrations', useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }))
vi.mock('./use-friend-migrations', () => ({
  MANAGE_FORBIDDEN: '管理者だけが操作できます', JOB_STATUS_LABELS: { completed: '反映ずみ' }, formatImportBytes: () => '',
  useFriendMigrations: () => ({ status: 'ready', summary: null, file: null, importId: null, message: '', exportResult: model.created ? { id: 'new-export', rowCount: 2, downloadUrl: '/unused' } : null, busy: false,
    jobs: [{ id: 'export/1', kind: 'export', status: 'completed', created_at: '2026-01-01T00:00:00Z', created_by_name: '担当', row_count: 2, expires_at: model.expires }],
    accounts: [], columns: ['basic'], accountId: 'acc', manageLocked: model.locked, downloadExport: model.download, setAccountId: vi.fn(), toggleColumn: vi.fn(), createExport: vi.fn(), onPickFile: vi.fn(), previewImport: vi.fn(), cancelImport: vi.fn(), executeImport: vi.fn(), load: vi.fn(),
  }),
}))
import Csv from './csv'
afterEach(cleanup)
beforeEach(() => { model.download.mockClear(); model.created = false; model.locked = false; model.expires = '2030-01-01T00:00:00Z' })
test('期限内の完成済みCSVは既存のダウンロード先を開く', () => {
  render(<Csv />)
  fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す', exact: true }))
  expect(model.download).toHaveBeenCalledWith('export/1')
})
test('期限切れの履歴にはダウンロードの操作を出さない', () => {
  model.expires = '2000-01-01T00:00:00Z'
  render(<Csv />)
  expect(screen.queryByRole('button', { name: 'CSVで書き出す', exact: true })).toBeNull()
})
test('閲覧者は履歴を読めるが管理者用のダウンロードを出さない', () => {
  model.locked = true
  render(<Csv />)
  expect(screen.getByText('反映ずみ')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'CSVで書き出す', exact: true })).toBeNull()
  expect(screen.queryByRole('button', { name: '書き出しを作る' })).toBeNull()
})

test('先に作ったCSVがあっても閲覧者へ保存の操作を残さない', () => {
  model.created = true
  model.locked = true
  render(<Csv />)
  expect(screen.queryByRole('button', { name: /^CSVで書き出す/ })).toBeNull()
})
test('書き出し直後の保存も同じ認証付き操作へ渡す', () => {
  model.created = true
  render(<Csv />)
  fireEvent.click(screen.getByRole('button', { name: 'CSVで書き出す（2件）' }))
  expect(model.download).toHaveBeenCalledWith('new-export')
})


test('CSVを追加する欄をキー操作でき、閲覧者はファイルを追加できない', () => {
  const { rerender } = render(<Csv />)
  const zone = screen.getByRole('button', { name: 'CSVを追加', exact: true })
  expect(zone.querySelector('button')).toBeNull()
  const input = zone.querySelector('input')!; const opened = vi.fn(); input.addEventListener('click', opened)
  fireEvent.keyDown(zone, { key: 'Enter' }); expect(opened).toHaveBeenCalledTimes(1)
  model.locked = true; rerender(<Csv />)
  fireEvent.keyDown(zone, { key: 'Enter' }); expect(opened).toHaveBeenCalledTimes(1)
  expect(zone.getAttribute('aria-disabled')).toBe('true')
})
