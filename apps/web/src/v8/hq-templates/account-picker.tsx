'use client'

/*
 * 配るアカウントの欄（リッチメニューの作る④など）。共通の「配るアカウントを選ぶ」窓（dJZ7Q・B-133）を開く1行。
 * 選べるのは統括のひな形の口が返す配り先（allowed）だけ。友だちの数は統括のアカウント一覧と同じ口から読む。
 */
import { useEffect, useMemo, useState } from 'react'
import { HqAccountPickerField } from '@/components/shared/hq-account-picker'
import { api } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import styles from '../hq-broadcasts/create.module.css'

export default function HqAccountPicker({ title, allowed, selected, onChange, note, disabled }: {
  title: string
  /** 配れるアカウント（統括のひな形の口の配り先）。 */
  allowed: Array<{ id: string; name: string }>
  selected: string[]
  onChange: (ids: string[]) => void
  /** 選んだ数のあとに続ける説明。 */
  note: string
  disabled?: boolean
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
  return (
    <div className={styles.accounts} data-design-node="gQabc-accounts">
      <h3>{title}</h3>
      <HqAccountPickerField label={title} accounts={accounts} value={selected} onChange={onChange} disabled={disabled}
        meta={(account) => `友だち ${account.friendCount == null ? '—' : formatNumber(account.friendCount)}`} />
      <p className={styles.accountsNote} aria-live="polite">{selected.length === 0 ? `アカウントを選んでください。${note}` : `${formatNumber(selected.length)} アカウントを選んでいます。${note}`}</p>
    </div>
  )
}
