'use client'

import Checkbox from '@/components/shared/checkbox'
import SearchField from '@/components/shared/search-field'

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
      <SearchField
        value={q}
        onChange={(value) => onChange({ q: value })}
        onClear={() => onChange({ q: '' })}
        placeholder="名前・X・メール・電話・UIDで検索"
        aria-label="統合ユーザーをUIDで検索"
        className="min-w-0 flex-1"
      />
      <Checkbox
        checked={onlyDups}
        onCheckedChange={(checked) => onChange({ onlyDups: checked })}
        className="whitespace-nowrap"
      >
        複数アカウントのみ
      </Checkbox>
      <select
        value={uid}
        onChange={(e) => onChange({ uid: e.target.value })}
        aria-label="UID連携で絞り込む"
        className="v6-select h-10 min-w-44 rounded-control border border-hairline bg-canvas pl-3 text-sm text-ink"
      >
        <option value="">UID：すべて</option>
        <option value="linked">UID：連携済み</option>
        <option value="unlinked">UID：未連携・要確認</option>
      </select>
      <select
        value={account}
        onChange={(e) => onChange({ account: e.target.value })}
        aria-label="所属アカウントで絞り込む"
        className="v6-select h-10 min-w-44 rounded-control border border-hairline bg-canvas pl-3 text-sm text-ink"
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
