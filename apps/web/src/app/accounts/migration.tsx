'use client'

import { runStatusView, MigrationItemDialog, ExecuteConfirmDialog, RollbackConfirmDialog } from './migration-dialogs'
export { runStatusView, MigrationItemDialog, ExecuteConfirmDialog, RollbackConfirmDialog } from './migration-dialogs'

import { usePageTitle } from '@/components/shell/page-chrome'

import UidMigrationV8 from './uid-migration'
export { parseUidCsv, splitUidCsvLine } from './use-uid-migration'
import { useUidMigration } from './use-uid-migration'

export default function AccountMigration() {
  usePageTitle('UID移行')
  const m = useUidMigration()

  return <UidMigrationV8 m={m} />
}
