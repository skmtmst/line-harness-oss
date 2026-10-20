'use client'

/*
 * 配るアカウントの欄（統括のリッチメニューを作る③「配る先」 など）。共通の「配るアカウントを選ぶ」窓（dJZ7Q・）を開く1行。
 * 選べるのは統括のひな形の口が返す配り先（allowed）だけ。友だちの数は統括のアカウント一覧と同じ口から読み、
 * 選んだアカウントの友だちの合計を onFriendTotal で返す（1つでも読めないときは null。足し算で嘘の数を出さない）。
 */
import { useEffect, useMemo, useState } from 'react'
import { HqAccountPickerField } from '@/components/shared/hq-account-picker'
import SectionHeader from '@/components/shared/section-header'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import styles from '../hq-broadcasts/create.module.css'
import { emptyValue } from '@/components/shared/empty-value'

export default function HqAccountPicker({ title, help, allowed, selected, onChange, note, disabled, onFriendTotal }: {
  title: string
  /** 題の右の「？」の中身。 */
  help?: string
  /** 配れるアカウント（統括のひな形の口の配り先）。 */
  allowed: Array<{ id: string; name: string }>
  selected: string[]
  onChange: (ids: string[]) => void
  /** 欄の下の説明。無いときは出さない。 */
  note?: string
  disabled?: boolean
  /** 選んだアカウントの友だちの合計（読めないときは null）。 */
  onFriendTotal?: (total: number | null) => void
}) {
  const [friends, setFriends] = useState<Map<string, number | null>>(new Map())
  const allowedKey = allowed.map((account) => account.id).join(',')
  useEffect(() => {
    let current = true
    void Promise.resolve().then(() => api.lineAccounts.list()).then((list) => {
      if (current && list?.success) setFriends(new Map(list.data.map((account) => [account.id, account.stats?.friendCount ?? null])))
    }).catch(() => undefined)
    return () => { current = false }
  }, [allowedKey])
  const accounts = useMemo(() => allowed.map((account) => ({ ...account, friendCount: friends.has(account.id) ? friends.get(account.id) ?? null : null })), [allowed, friends])
  const total = useMemo(() => {
    if (selected.length === 0) return 0
    let sum = 0
    for (const id of selected) {
      const count = friends.get(id)
      if (count == null) return null
      sum += count
    }
    return sum
  }, [friends, selected])
  useEffect(() => { onFriendTotal?.(total) }, [onFriendTotal, total])
  return (
    <div className={styles.accounts} data-design-node="gQabc-accounts">
      <SectionHeader title={title} help={help} helpLabel={help ? `${title}の説明` : undefined} />
      <HqAccountPickerField label={title} accounts={accounts} value={selected} onChange={onChange} disabled={disabled}
        meta={(account) => `友だち ${account.friendCount == null ? emptyValue('unknown') : formatNumber(account.friendCount)}`} />
      {note ? <p className={styles.accountsNote} aria-live="polite">{selected.length === 0 ? `アカウントを選んでください。${note}` : `${formatNumber(selected.length)} アカウントを選んでいます。${note}`}</p> : null}
    </div>
  )
}
