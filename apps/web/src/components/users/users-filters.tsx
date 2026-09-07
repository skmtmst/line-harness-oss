'use client'

interface AccountOption {
  id: string
  name: string
}

interface Props {
  q: string
  onlyDups: boolean
  account: string
  uid: string
  accountOptions: AccountOption[]
  onChange: (next: { q?: string; onlyDups?: boolean; account?: string; uid?: string }) => void
}

export default function UsersFilters({
  q,
  onlyDups,
  account,
  uid,
  accountOptions,
  onChange,
}: Props) {
  return (
    <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => onChange({ q: e.target.value })}
        placeholder="名前・X・メール・電話・UIDで検索"
        className="h-10 min-w-0 flex-1 rounded-control border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-accent"
      />
      <label className="flex h-10 items-center gap-2 whitespace-nowrap rounded-control border border-hairline bg-canvas px-3 text-sm text-ink-secondary">
        <input
          type="checkbox"
          checked={onlyDups}
          onChange={(e) => onChange({ onlyDups: e.target.checked })}
        />
        複数アカウントのみ
      </label>
      <select
        value={uid}
        onChange={(e) => onChange({ uid: e.target.value })}
        className="v6-select h-10 min-w-[176px] rounded-control border border-hairline bg-canvas pl-3 text-sm text-ink"
      >
        <option value="">UID：すべて</option>
        <option value="linked">UID：連携済み</option>
        <option value="unlinked">UID：未連携・要確認</option>
      </select>
      <select
        value={account}
        onChange={(e) => onChange({ account: e.target.value })}
        className="v6-select h-10 min-w-[176px] rounded-control border border-hairline bg-canvas pl-3 text-sm text-ink"
      >
        <option value="">所属：すべて</option>
        {accountOptions.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </div>
  )
}
