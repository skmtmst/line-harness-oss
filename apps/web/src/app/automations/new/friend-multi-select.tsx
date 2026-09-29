'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import { RequiredBadge } from '@/components/shared/form-controls'
import { TextField } from '@/components/shared/text-field'
import { api } from '@/lib/api'
import { FRIEND_SELECT_LIMIT, normalizeFriendIds } from './trigger-helpers'

/**
 * 対象の友だちの複数選択（R22・設計G-2）。
 *
 * いま選んでいるアカウントの友だちを名前で探して選ぶ。IDの手入力は
 * させない。選んだ人は札に並べ、人数を見出しに出す（最大100人）。
 * アカウントが替わったら候補は捨てる（別アカウントの混入防止）。
 */
export function FriendMultiSelect({
  accountId,
  selectedIds,
  names,
  onChange,
}: {
  accountId: string | null
  selectedIds: ReadonlyArray<string>
  names: Record<string, string>
  onChange: (ids: string[], nextNames: Record<string, string>) => void
}) {
  const ids = normalizeFriendIds(selectedIds)
  const [query, setQuery] = useState('')
  const [options, setOptions] = useState<Array<{ id: string; name: string }>>([])
  const [searching, setSearching] = useState(false)
  const [searchFailed, setSearchFailed] = useState(false)

  useEffect(() => {
    setOptions([])
    setSearchFailed(false)
    const word = query.trim()
    if (!accountId || word.length < 1) {
      setSearching(false)
      return
    }
    setSearching(true)
    let active = true
    const timer = window.setTimeout(() => {
      void api.friends
        .list({ accountId, search: word, limit: 20 })
        .then((response) => {
          if (!active) return
          if (!response.success) {
            setSearchFailed(true)
            setOptions([])
            return
          }
          setSearchFailed(false)
          setOptions(
            response.data.items.map((item) => ({ id: item.id, name: item.displayName || item.id })),
          )
        })
        .catch(() => {
          if (!active) return
          setSearchFailed(true)
          setOptions([])
        })
        .finally(() => {
          if (active) setSearching(false)
        })
    }, 250)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [accountId, query])

  const labelOf = (id: string): string => names[id] ?? id
  const add = (id: string, name: string) => {
    if (ids.includes(id) || ids.length >= FRIEND_SELECT_LIMIT) return
    onChange([...ids, id], { ...names, [id]: name })
  }
  const remove = (id: string) => {
    onChange(ids.filter((item) => item !== id), names)
  }

  return (
    <div>
      <p id="au-friends-label" className="text-xs font-medium text-ink">
        対象の友だち（{ids.length}人）<RequiredBadge />
      </p>
      {ids.length > 0 ? (
        <ul aria-labelledby="au-friends-label" className="mt-2 flex flex-wrap gap-2">
          {ids.map((id) => (
            <li
              key={id}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-hairline bg-canvas px-3 text-xs font-medium text-ink-secondary"
            >
              <span className="max-w-40 truncate" title={labelOf(id)}>{labelOf(id)}</span>
              <button
                type="button"
                onClick={() => remove(id)}
                aria-label={`${labelOf(id)}を外す`}
                className="inline-flex min-h-6 min-w-6 items-center justify-center rounded-full text-ink-faint hover:text-ink focus-visible:outline-2 focus-visible:outline-status-info"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="relative mt-2">
        <TextField
          aria-label="友だちを名前で探す"
          placeholder={accountId ? '名前で探して選ぶ（例: やま）' : '先にLINEアカウントを選んでください'}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={!accountId}
        />
        {query.trim() ? (
          <div className="absolute inset-x-0 top-full z-10 mt-1 overflow-hidden rounded-control border border-hairline bg-canvas shadow-md">
            {searching ? (
              <p className="px-3 py-2 text-xs text-ink-faint" role="status">探しています…</p>
            ) : searchFailed ? (
              <p className="px-3 py-2 text-xs text-ink-secondary" role="alert">探せませんでした。通信を確かめてください。</p>
            ) : options.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-faint">「{query.trim()}」に合う友だちはいません。</p>
            ) : (
              <ul aria-label="友だちの候補">
                {options.map((option) => {
                  const selected = ids.includes(option.id)
                  const full = ids.length >= FRIEND_SELECT_LIMIT && !selected
                  return (
                    <li key={option.id} className="flex items-center justify-between gap-2 border-t border-hairline px-3 py-2 first:border-t-0">
                      <span className="min-w-0 truncate text-sm text-ink" title={option.name}>{option.name}</span>
                      {selected ? (
                        <span className="shrink-0 text-xs font-medium text-accent-deep">選択中 ✓</span>
                      ) : (
                        <Button variant="secondary" disabled={full} onClick={() => add(option.id, option.name)}>
                          追加
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        ) : null}
      </div>
      <p className="mt-2 text-xs text-ink-secondary">
        {ids.length >= FRIEND_SELECT_LIMIT
          ? '100人まで選べます。これ以上は選べません。'
          : '名前で探して、候補の「追加」を押してください。'}
      </p>
    </div>
  )
}
