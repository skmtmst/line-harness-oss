'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import type { SavedSearch } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Button from '@/components/shared/button'
import ListState from '@/components/shared/list-state'

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

const USAGE_KIND_LABELS = {
  broadcast: '一斉配信',
  automation: 'オートメーション',
  scenario: 'シナリオ',
  other: 'そのほか',
} as const

/**
 * 保存した検索の一覧。
 *
 * ここは管理だけ。条件を作るのは友だち一覧の絞り込みで、そこから
 * 「この条件を保存」で増える。条件を組む画面を2つ持つと、必ず食い違う。
 */
export default function SavedSearchList({ accountId }: { accountId: string | null }) {
  const [items, setItems] = useState<SavedSearch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [pendingDelete, setPendingDelete] = useState<SavedSearch | null>(null)
  const loadSequence = useRef(0)

  const load = useCallback(async () => {
    const sequence = ++loadSequence.current
    setLoading(true)
    setLoadError('')
    setError('')
    setItems([])
    try {
      if (!accountId) return
      const res = await api.savedSearches.list(accountId)
      if (sequence !== loadSequence.current) return
      if (res.success) setItems(res.data)
    } catch (reason) {
      if (sequence === loadSequence.current) {
        setLoadError(reason instanceof ApiError ? reason.message : '保存した検索を読み込めませんでした')
      }
    } finally {
      if (sequence === loadSequence.current) setLoading(false)
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
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : '削除に失敗しました')
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
        <ListState kind="loading" />
      ) : !accountId ? null
      : loadError ? (
        <ListState
          kind="error"
          description={loadError}
          action={<Button type="button" onClick={() => void load()}>保存した検索を再読み込み</Button>}
        />
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
            const deleteDisabled = !search.lineAccountId || search.canDelete !== true
            const deleteTitle = !search.lineAccountId
              ? '管理者が対象アカウントを割り当てるまで変更できません'
              : search.usedIn === undefined
                ? '使用先を確認できないため削除できません'
              : search.usedIn.length > 0
                ? `使用中のため削除できません（${search.usedIn?.length ?? 0}件）`
              : search.canDelete === true
                ? '保存した検索を削除'
                : '削除できるか確認できません'
            return (
              <section
                key={search.id}
                className="bg-canvas rounded-card border-hairline border p-4 [box-shadow:1px_1px_2px_rgba(15,23,42,0.10)]"
              >
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  {search.lineAccountId ? (
                    <Link
                      href={`/friends?savedSearch=${search.id}`}
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
                  <span
                    className="rounded-pill bg-canvas-sunken px-2 py-0.5 text-caption font-semibold text-ink-secondary"
                    title={search.matchCountError ?? undefined}
                  >
                    該当 {search.matchCount === null || search.matchCount === undefined ? '—' : `${search.matchCount.toLocaleString('ja-JP')}人`}
                  </span>
                  <span className="rounded-pill bg-canvas-sunken px-2 py-0.5 text-caption font-semibold text-ink-secondary">
                    使用先 {search.usedIn === undefined
                      ? '—'
                      : search.usedIn.length === 0
                        ? 'なし'
                        : `${search.usedIn.length}件`}
                  </span>
                  {search.lineAccountId ? (
                    <Link
                      href={`/tags/searches/edit?id=${encodeURIComponent(search.id)}`}
                      className="text-action rounded-md px-2.5 py-1 text-xs font-semibold hover:bg-v6-action-soft"
                    >
                      条件を確認・編集
                    </Link>
                  ) : null}
                  <button
                    onClick={() => remove(search)}
                    disabled={deleteDisabled}
                    title={deleteTitle}
                    className="hover:bg-danger-bg text-danger rounded-md px-2.5 py-1 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    削除
                  </button>
                </div>

                {search.usedIn && search.usedIn.length > 0 ? (
                  <div className="mb-3 flex flex-wrap gap-2 rounded-control border border-warning/20 bg-warning-bg p-2 text-xs text-warning">
                    <span className="font-bold">使用中</span>
                    {search.usedIn.map((usage) => (
                      <span key={`${usage.kind}:${usage.id}`}>
                        {USAGE_KIND_LABELS[usage.kind]}「{usage.name}」
                        （{usage.mode === 'live' ? '条件を自動反映' : '固定した条件'}）
                      </span>
                    ))}
                  </div>
                ) : null}

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
        description="使用先が無いことをサーバーで確認済みです。保存した絞り込み条件だけを削除し、友だち自体は削除しません。"
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
