'use client'

import { RowMenu } from '@/components/shared/row-actions'

/** 残高の行の行き先を、共通の「…」へ集める。 */
export default function BalanceRowMenu({ friendId, friendName, readonly }: { friendId: string; friendName: string; readonly: boolean }) {
  const href = `/mileage/friends/detail?id=${encodeURIComponent(friendId)}`
  return <RowMenu size="row" label={`${friendName}のマイルの操作`} items={[
    { id: 'detail', label: '明細を見る', href, external: false },
    ...(!readonly ? [{ id: 'adjust', label: '増減', href: `${href}&adjust=1`, external: false }] : []),
  ]} />
}
