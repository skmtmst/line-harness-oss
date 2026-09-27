'use client'

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
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前で検索"
        className="min-w-[240px] flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
      />
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input
          type="checkbox"
          checked={overdueOnly}
          onChange={(e) => onChange({ overdueOnly: e.target.checked })}
        />
        1時間以上のみ
      </label>
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
