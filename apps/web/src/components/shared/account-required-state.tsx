import type { ReactNode } from 'react'
import ListState from './list-state'

/** アカウント未選択と未登録を区別する。 */
export default function AccountRequiredState({ hasAccounts, icon }: { hasAccounts: boolean; icon?: ReactNode }) {
  return <ListState kind="empty" icon={icon} title={hasAccounts ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
}
