'use client'

import EntitySelect from '@/components/shared/entity-select'

/*
 * 送り手の選び口（板 OmYbb「送り手を選ぶ」・G8）。
 * 「店の名前（送り手なし）」を空の値として先頭に置き、その下に使える送り手を並べる。
 * 選んだ送り手はお客さまの LINE で、メッセージの上に出る名前と顔になる。口は lineSenderApi（Codex・GAP1）。
 * 読めなかったときは選び口を出さず、いつもの店の名前で送る（取得失敗を「送り手なし」として黙って扱わない）。
 */
import { useEffect, useState } from 'react'
import type { LineSender } from '@line-crm/shared'
import { lineSenderApi } from '@/lib/api/helpers/gap1'
import Select from './select'

export default function SenderSelect({ accountId, value, onChange, disabled }: {
  accountId: string | null
  /** 選んだ送り手の ID。空は「店の名前（送り手なし）」。 */
  value: string
  onChange: (senderId: string) => void
  disabled?: boolean
}) {
  const [senders, setSenders] = useState<LineSender[] | null>(null)
  useEffect(() => {
    let alive = true
    setSenders(null)
    if (!accountId) return
    void lineSenderApi.list(accountId)
      .then((res) => { if (alive) setSenders(res.success ? res.data.filter((row) => row.status === 'active') : []) })
      .catch(() => { if (alive) setSenders([]) })
    return () => { alive = false }
  }, [accountId])
  // 送り手が 1 人もいない店には出さない（足すのはアカウントの詳細）。
  if (!senders || senders.length === 0) return null
  return (
    <EntitySelect
      aria-label="送り手を選ぶ"
      value={value}
      disabled={disabled}
      onChange={onChange}
      options={[
        { value: '', label: '店の名前（送り手なし）' },
        ...senders.map((sender) => ({ value: sender.id, label: sender.visibility === 'owner_only' ? `${sender.name}（自分の送り手）` : sender.name })),
      ]}
    />
  )
}
