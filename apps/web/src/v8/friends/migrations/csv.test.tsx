// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const model = vi.hoisted(() => ({ locked: false, expires: '2030-01-01T00:00:00Z' }))
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ usePathname: () => '/friends/migrations', useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }))
vi.mock('./use-friend-migrations', () => ({
  MANAGE_FORBIDDEN: '管理者だけが操作できます', JOB_STATUS_LABELS: { completed: '反映ずみ' }, formatImportBytes: () => '',
  useFriendMigrations: () => ({ status: 'ready', summary: null, file: null, importId: null, message: '', exportResult: null, busy: false,
    jobs: [{ id: 'export/1', kind: 'export', status: 'completed', created_at: '2026-01-01T00:00:00Z', created_by_name: '担当', row_count: 2, expires_at: model.expires }],
    accounts: [], columns: ['basic'], accountId: 'acc', manageLocked: model.locked, setAccountId: vi.fn(), toggleColumn: vi.fn(), createExport: vi.fn(), onPickFile: vi.fn(), previewImport: vi.fn(), cancelImport: vi.fn(), executeImport: vi.fn(), load: vi.fn(),
  }),
}))
import Csv from './csv'
afterEach(cleanup)
beforeEach(() => { model.locked = false; model.expires = '2030-01-01T00:00:00Z' })
test('期限内の完成済みCSVは既存のダウンロード先を開く', () => {
  render(<Csv />)
  expect(screen.getByRole('link', { name: 'CSVで書き出す' }).getAttribute('href')).toBe(`${process.env.NEXT_PUBLIC_API_URL}/api/friends/exports/export%2F1/download`)
})
test('期限切れの履歴にはダウンロードの操作を出さない', () => {
  model.expires = '2000-01-01T00:00:00Z'
  render(<Csv />)
  expect(screen.queryByRole('link', { name: 'CSVで書き出す' })).toBeNull()
})
test('閲覧者は履歴を読めるが管理者用のダウンロードを出さない', () => {
  model.locked = true
  render(<Csv />)
  expect(screen.getByText('反映ずみ')).toBeTruthy()
  expect(screen.queryByRole('link', { name: 'CSVで書き出す' })).toBeNull()
  expect(screen.queryByRole('button', { name: '書き出しを作る' })).toBeNull()
})
