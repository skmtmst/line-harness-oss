'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { SavedSearch } from '@line-crm/shared'
import { api } from '@/lib/api'

/** 条件の中身を人が読める形にする。JSONのまま見せても伝わらない。 */
function describeConditions(conditions: unknown): string {
  const c = conditions as { all?: unknown[]; any?: unknown[]; visibility?: string } | null
  if (!c) return '—'
  const parts: string[] = []
  if (c.all?.length) parts.push(`すべて満たす ${c.all.length} 件`)
  if (c.any?.length) parts.push(`どれか満たす ${c.any.length} 件`)
  if (c.visibility === 'hidden_only') parts.push('非表示の人のみ')
  if (c.visibility === 'all') parts.push('表示状態を問わない')
  return parts.length > 0 ? parts.join(' ／ ') : '—'
}

/**
 * 保存した検索の一覧。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、そこから
 * 「この条件を保存」で増える。条件を組む画面を2つ持つと、必ず食い違う。
 */
export default function SavedSearchList() {
  const [items, setItems] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.savedSearches.list()
      if (res.success) setItems(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const remove = async (search: SavedSearch) => {
    if (!confirm(`「${search.name}」を削除しますか？`)) return
    setError('')
    try {
      await api.savedSearches.delete(search.id)
      void load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <p className="text-ink-secondary mb-4 text-sm">
        友だち一覧で組んだ絞り込みを保存したものです。ここでは名前の確認と削除ができます。
        新しく保存するときは、友だち一覧の絞り込みから「この条件を保存」を押してください。
      </p>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="bg-canvas-sunken border-hairline border-b">
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                名前
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                条件
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                共有
              </th>
              <th className="text-ink-faint px-4 py-3 text-left text-xs font-semibold uppercase">
                保存日
              </th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr>
                <td colSpan={5} className="text-ink-faint px-4 py-8 text-center text-sm">
                  読み込み中...
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={5} className="text-ink-faint px-4 py-8 text-center text-sm">
                  保存した検索はまだありません。
                  <Link href="/friends" className="text-accent ml-1 hover:underline">
                    友だち一覧へ
                  </Link>
                </td>
              </tr>
            ) : (
              items.map((search) => (
                <tr key={search.id} className="hover:bg-canvas-sunken">
                  <td className="px-4 py-3">
                    <Link
                      href={`/friends?search=${search.id}`}
                      className="text-ink text-sm font-medium hover:underline"
                    >
                      {search.name}
                    </Link>
                  </td>
                  <td className="text-ink-secondary px-4 py-3 text-sm">
                    {describeConditions(search.conditions)}
                  </td>
                  <td className="px-4 py-3">
                    <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px]">
                      {search.isShared ? '全員' : '自分だけ'}
                    </span>
                  </td>
                  <td className="text-ink-faint px-4 py-3 text-xs">
                    {new Date(search.createdAt).toLocaleDateString('ja-JP')}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => remove(search)}
                      className="hover:bg-danger-bg text-danger rounded-md px-2.5 py-1 text-xs font-medium"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-ink-faint mt-3 text-xs">
        保存できるのは 50 件までです。{items.length} / 50 件。
      </p>
    </div>
  )
}
