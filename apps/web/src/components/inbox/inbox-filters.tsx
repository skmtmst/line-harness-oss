'use client'

import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  account: string
  overdueOnly: boolean
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; account?: string; overdueOnly?: boolean }) => void
}

export default function InboxFilters({
  q,
  account,
  overdueOnly,
  accountOptions,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-control bg-canvas p-4 shadow-card ring-1 ring-hairline">
      <input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前で検索"
        className="min-w-[240px] flex-1 rounded-mini border border-hairline px-3 py-2 text-sm"
      />
      <Checkbox
        checked={overdueOnly}
        onCheckedChange={(checked) => onChange({ overdueOnly: checked })}
      >1時間以上のみ</Checkbox>
      <Select
        value={account}
        onChange={(value) => onChange({ account: value })}
        aria-label="アカウント"
        options={[
          { value: '', label: '全アカウント' },
          ...accountOptions.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
    </div>
  )
}
