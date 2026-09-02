'use client'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  onlyDups: boolean
  account: string
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; onlyDups?: boolean; account?: string }) => void
}

export default function UsersFilters({
  q,
  onlyDups,
  account,
  accountOptions,
  onChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[#DADDE2] bg-white p-4 shadow-[1px_1px_2px_rgba(29,29,31,0.13)]">
      <input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前・X・メール・電話・UIDで検索"
        className="min-w-[240px] flex-1 rounded-[9px] border border-[#DADDE2] px-3 py-2 text-sm outline-none focus:border-[#07C653]"
      />
      <label className="flex items-center gap-2 whitespace-nowrap text-sm text-[#565F59]">
        <input
          type="checkbox"
          checked={onlyDups}
          onChange={(e) => onChange({ onlyDups: e.target.checked })}
        />
        複数アカウントのみ
      </label>
      <select
        value={account}
        onChange={(e) => onChange({ account: e.target.value })}
        className="rounded-[9px] border border-[#DADDE2] bg-white px-3 py-2 text-sm text-[#1D1D1F]"
      >
        <option value="">全アカウント</option>
        {accountOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
