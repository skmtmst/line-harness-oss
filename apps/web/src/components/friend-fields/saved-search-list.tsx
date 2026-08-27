'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { SavedSearch } from '@line-crm/shared'
import { api } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'

/**
 * 条件1本を人が読める行にする。
 *
 * 条件の形は保存した時期によって違う（型が決まっていない）。読める鍵が
 * 入っていればそれを並べ、分からない形なら中身をそのまま出す。件数だけ
 * 出していた頃は「2件」としか分からず、開かないと中身が読めなかった。
 */
function describeOne(item: unknown): string {
  if (typeof item === 'string') return item
  if (!item || typeof item !== 'object') return String(item)
  const o = item as Record<string, unknown>
  const label = o.label ?? o.field ?? o.key ?? o.type
  const op = o.op ?? o.operator ?? o.comparator
  const raw = o.value ?? o.values ?? o.val
  const value = Array.isArray(raw) ? raw.join('・') : raw
  const parts = [label, op, value].filter((v) => v !== undefined && v !== null && v !== '')
  return parts.length > 0 ? parts.map(String).join(' ') : JSON.stringify(item)
}

/** 保存した条件の中身。all（かつ）と any（または）に分けて返す。 */
function splitConditions(conditions: unknown): { all: string[]; any: string[]; note: string | null } {
  const c = conditions as { all?: unknown[]; any?: unknown[]; visibility?: string } | null
  if (!c) return { all: [], any: [], note: null }
  const note =
    c.visibility === 'hidden_only'
      ? '非表示の人のみ'
      : c.visibility === 'all'
        ? '表示状態を問わない'
        : null
  return {
    all: (c.all ?? []).map(describeOne),
    any: (c.any ?? []).map(describeOne),
    note,
  }
}

/**
 * 保存した検索の一覧。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、そこから
 * 「この条件を保存」で増える。条件を組む画面を2つ持つと、必ず食い違う。
 */
export default function SavedSearchList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      if (!accountId) return
      const res = await api.savedSearches.list(accountId)
      if (res.success) setItems(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void load()
  }, [load])

  const remove = (search: SavedSearch) => {
    setPendingDelete(search)
  }

  const confirmRemove = async (search: SavedSearch) => {
    setError('')
    try {
      if (!accountId) return
      await api.savedSearches.delete(search.id, accountId)
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

      {!accountId && (
        <div className="bg-info-bg text-info mb-4 rounded-lg p-4 text-sm">
          上部でLINE公式アカウントを選んでください。
        </div>
      )}

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {/*
        設計は1件ずつを札にして、「すべて満たす」と「いずれか1つ以上」を
        左右に並べる。表で「すべて満たす 2 件」とだけ出していた頃は、
        開かないと中身が読めなかった。条件は読めてこそ直せる。
      */}
      {loading ? (
        <p className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </p>
      ) : items.length === 0 ? (
        <p className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          保存した検索はまだありません。
          <Link href="/friends" className="text-accent ml-1 hover:underline">
            友だち一覧へ
          </Link>
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((search) => {
            const { all, any, note } = splitConditions(search.conditions)
            return (
              <section
                key={search.id}
                className="bg-canvas rounded-card border-hairline border p-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {search.lineAccountId ? (
                    <Link
                      href={`/friends?search=${search.id}`}
                      className="text-ink text-sm font-bold hover:underline"
                    >
                      {search.name}
                    </Link>
                  ) : (
                    <span className="text-ink text-sm font-bold">{search.name}</span>
                  )}
                  <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-0.5 text-[11px]">
                    {search.isShared ? '全員' : '自分だけ'}
                  </span>
                  {!search.lineAccountId && (
                    <span className="bg-warning-bg text-warning rounded-pill px-2 py-0.5 text-xs">
                      対象アカウント未割当
                    </span>
                  )}
                  {note && (
                    <span className="bg-info-bg text-info rounded-pill px-2 py-0.5 text-[11px]">
                      {note}
                    </span>
                  )}
                  <span className="text-ink-faint ml-auto text-xs">
                    {new Date(search.createdAt).toLocaleDateString('ja-JP')}
                  </span>
                  <button
                    onClick={() => remove(search)}
                    disabled={!search.lineAccountId}
                    title={!search.lineAccountId ? '管理者が対象アカウントを割り当てるまで変更できません' : undefined}
                    className="hover:bg-danger-bg text-danger rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    削除
                  </button>
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="bg-canvas-sunken rounded-card p-3">
                    <p className="mb-2">
                      <span className="bg-accent-soft text-accent rounded-pill px-2 py-0.5 text-[11px] font-medium">
                        すべて満たす
                      </span>
                      <span className="text-ink-faint ml-1.5 text-[11px]">AND</span>
                    </p>
                    {all.length === 0 ? (
                      <p className="text-ink-faint text-xs">指定なし</p>
                    ) : (
                      <ul className="text-ink-secondary space-y-1 text-xs leading-relaxed">
                        {all.map((line, i) => (
                          <li key={i}>・{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="bg-canvas-sunken rounded-card p-3">
                    <p className="mb-2">
                      <span className="bg-info-bg text-info rounded-pill px-2 py-0.5 text-[11px] font-medium">
                        いずれか1つ以上
                      </span>
                      <span className="text-ink-faint ml-1.5 text-[11px]">OR</span>
                    </p>
                    {any.length === 0 ? (
                      <p className="text-ink-faint text-xs">指定なし</p>
                    ) : (
                      <ul className="text-ink-secondary space-y-1 text-xs leading-relaxed">
                        {any.map((line, i) => (
                          <li key={i}>・{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      )}

      <p className="text-ink-faint mt-3 text-xs">
        保存できるのは 50 件までです。{items.length} / 50 件。
      </p>
      <ConfirmDialog
        open={pendingDelete !== null}
        title={`保存した検索「${pendingDelete?.name ?? ''}」を削除しますか？`}
        description="保存した絞り込み条件を削除します。友だち自体は削除されません。"
        confirmLabel="削除する"
        destructive
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          const target = pendingDelete
          setPendingDelete(null)
          if (target) void confirmRemove(target)
        }}
      />
    </div>
  )
}
