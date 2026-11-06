// @vitest-environment happy-dom
import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
vi.mock('@/components/shell/page-chrome', () => ({ usePageTitle: () => {}, usePageCrumbs: () => {} }))
vi.mock('next/navigation', () => ({ usePathname: () => '/friends/migrations', useRouter: () => ({ push() {}, replace() {} }), useSearchParams: () => new URLSearchParams() }))
vi.mock('./use-uid-migration', async original => ({
  ...await original<typeof import('./use-uid-migration')>(),
  useUidMigration: () => ({ status: 'ready', active: null, runs: [], accounts: [], me: null, canDecide: false, busy: false, mappings: [], rollbackConflicts: [] }),
}))
import UidMigrationV8 from './uid'
afterEach(cleanup)
it('移行履歴が空のとき、絞り込み変更ではなく未移行を伝える', () => {
  render(<UidMigrationV8 initialRunId={null} />)
  expect(screen.getByText('まだ移行していません')).toBeTruthy()
  expect(screen.queryByText('条件を変えるか、新しく作成してください。')).toBeNull()
})
