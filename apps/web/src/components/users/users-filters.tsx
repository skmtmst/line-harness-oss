'use client'

import Checkbox from '@/components/shared/checkbox'
import SearchField from '@/components/shared/search-field'
import Select from '@/components/shared/select'

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
      <Select
        aria-label="UID連携で絞り込む"
        value={uid}
        onChange={(value) => onChange({ uid: value })}
        options={[
          { value: '', label: 'UID：すべて' },
          { value: 'linked', label: 'UID：連携済み' },
          { value: 'unlinked', label: 'UID：未連携・要確認' },
        ]}
      />
      <Select
        aria-label="所属アカウントで絞り込む"
        value={account}
        onChange={(value) => onChange({ account: value })}
        options={[
          { value: '', label: '所属：すべて' },
          ...accountOptions.map((a) => ({ value: a.id, label: a.name })),
        ]}
      />
    </div>
  )
}
