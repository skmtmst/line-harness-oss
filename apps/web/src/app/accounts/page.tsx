'use client'

import { useSearchParams } from 'next/navigation'
import AccountsV8 from '@/v8/settings/accounts/accounts'
import AccountMigration from '../../v8/accounts/migration'

export default function AccountsPage() {
  const searchParams = useSearchParams()
  return searchParams.get('tab') === 'migration' ? <AccountMigration /> : <AccountsV8 />
}
