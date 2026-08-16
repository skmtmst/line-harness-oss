'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import type { FriendField } from '@line-crm/shared'
import { api, type FriendDetail } from '@/lib/api'
import Header from '@/components/layout/header'
import TagBadge from '@/components/friends/tag-badge'
import { FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

/**
 * 友だち詳細。
 *
 * ルートが /friends/[id] ではなく /friends/detail?id= なのは、この管理画面が
 * 静的書き出し（next.config の output: 'export'）だから。動的セグメントは
 * ビルド時に全IDが分からないと書き出せない。既存の /scenarios/detail?id= や
 * /rich-menus/edit?id= と同じ形にそろえている。
 */

const TABS = [
  { key: 'info', label: '情報欄' },
  { key: 'forms', label: 'フォームの回答' },
] as const
type TabKey = (typeof TABS)[number]['key']

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FriendField
  value: string
  onChange: (v: string) => void
}) {
  const readOnly = field.ecIsMaster
  const base =
    'border-hairline rounded-control w-full border px-3 py-2 text-sm disabled:bg-canvas-sunken disabled:text-ink-faint'

  if (field.type === 'textarea') {
    return (
      <textarea
        rows={3}
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={`${base} resize-y`}
      />
    )
  }
  if (field.type === 'select' || field.type === 'multi_select') {
    // 複数選択も、いまは1つ選ぶ形にしている。複数選択のUIは
    // 値の持ち方（区切り文字）を決めてから作る。
    return (
      <select
        value={value}
        disabled={readOnly}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      >
        <option value="">— 未設定 —</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.type === 'checkbox') {
    return (
      <label className="flex cursor-pointer items-center gap-2">
        <input
          type="checkbox"
          checked={value === '1'}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.checked ? '1' : '')}
          className="rounded border-gray-300"
        />
        <span className="text-ink-secondary text-sm">はい</span>
      </label>
    )
  }
  const inputType =
    field.type === 'number'
      ? 'number'
      : field.type === 'date'
        ? 'date'
        : field.type === 'url'
          ? 'url'
          : field.type === 'tel'
            ? 'tel'
            : field.type === 'email'
              ? 'email'
              : 'text'
  return (
    <input
      type={inputType}
      value={value}
      disabled={readOnly}
      onChange={(e) => onChange(e.target.value)}
      className={base}
    />
  )
}

function FriendDetailInner() {
  const params = useSearchParams()
  const friendId = params.get('id') ?? ''
  const rawTab = params.get('tab')
  const tab: TabKey = (TABS.find((t) => t.key === rawTab)?.key ?? 'info') as TabKey

  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [fields, setFields] = useState<FriendField[]>([])
  const [hiddenPersonalCount, setHiddenPersonalCount] = useState(0)
  const [values, setValues] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [warnings, setWarnings] = useState<string[]>([])

  const load = useCallback(async () => {
    if (!friendId) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const [friendRes, fieldsRes] = await Promise.all([
        api.friends.get(friendId),
        api.friendFields.forFriend(friendId),
      ])
      if (friendRes.success) setFriend(friendRes.data)
      if (fieldsRes.success) {
        setFields(fieldsRes.data.items)
        setHiddenPersonalCount(fieldsRes.data.hiddenPersonalCount)
        const next: Record<string, string> = {}
        for (const f of fieldsRes.data.items) next[f.id] = f.value ?? ''
        setValues(next)
      }
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [friendId])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    setWarnings([])
    try {
      // 変わったものだけ送る。全部送ると、見ただけの項目にも
      // 更新の記録（updated_by / updated_at）が付いてしまう。
      const changed: Record<string, string | null> = {}
      for (const f of fields) {
        const before = f.value ?? ''
        const after = values[f.id] ?? ''
        if (before !== after) changed[f.id] = after === '' ? null : after
      }
      if (Object.keys(changed).length === 0) {
        setNotice('変更はありません')
        return
      }
      const res = await api.friendFields.saveForFriend(friendId, changed)
      if (!res.success) {
        setError(res.error)
        return
      }
      if (res.warnings?.length) setWarnings(res.warnings)
      setNotice(`${res.data.updated} 件を保存しました`)
      void load()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  if (!friendId) {
    return (
      <div>
        <Header title="友だち詳細" />
        <p className="text-ink-faint bg-canvas rounded-card border-hairline border p-8 text-center text-sm">
          友だちが指定されていません。
          <Link href="/friends" className="text-accent ml-1 hover:underline">
            友だち一覧へ戻る
          </Link>
        </p>
      </div>
    )
  }

  const starred = fields.filter((f) => f.isStarred)
  const rest = fields.filter((f) => !f.isStarred)

  return (
    <div>
      <Header title={friend?.displayName ?? '友だち詳細'} />

      <nav className="text-ink-faint mb-4 text-xs">
        <Link href="/friends" className="hover:underline">
          友だち
        </Link>
        <span className="mx-1.5">›</span>
        <span>{friend?.displayName ?? '詳細'}</span>
      </nav>

      {error && (
        <div className="bg-danger-bg border-danger-bg text-danger mb-4 rounded-lg border p-4 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[20rem_1fr]">
          {/* 左：プロフィール */}
          <aside className="bg-canvas rounded-card border-hairline space-y-4 border p-5">
            <div className="flex items-center gap-3">
              {friend?.pictureUrl ? (
                // 静的書き出しのため next/image の最適化は使えない。
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={friend.pictureUrl}
                  alt=""
                  className="h-14 w-14 rounded-full object-cover"
                />
              ) : (
                <div className="bg-canvas-sunken text-ink-faint flex h-14 w-14 items-center justify-center rounded-full text-lg">
                  {friend?.displayName?.slice(0, 1) ?? '?'}
                </div>
              )}
              <div className="min-w-0">
                <p className="text-ink truncate text-sm font-semibold">{friend?.displayName}</p>
                <p className="text-ink-faint truncate text-xs">
                  {friend?.isFollowing ? '友だち' : 'ブロック中・退会'}
                </p>
              </div>
            </div>

            {friend?.tags && friend.tags.length > 0 && (
              <div>
                <p className="text-ink-faint mb-1.5 text-xs font-semibold">タグ</p>
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((t) => (
                    <TagBadge key={t.id} tag={t} />
                  ))}
                </div>
              </div>
            )}

            <dl className="space-y-1.5 text-xs">
              <div className="flex justify-between gap-2">
                <dt className="text-ink-faint">追加日</dt>
                <dd className="text-ink-secondary">
                  {friend?.createdAt ? new Date(friend.createdAt).toLocaleDateString('ja-JP') : '—'}
                </dd>
              </div>
              {friend?.firstTrackedLinkName && (
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-faint">流入元</dt>
                  <dd className="text-ink-secondary truncate">{friend.firstTrackedLinkName}</dd>
                </div>
              )}
            </dl>

            <Link
              href={`/chats?friendId=${friendId}`}
              className="bg-accent text-on-accent hover:bg-accent-hover rounded-control block w-full px-4 py-2 text-center text-sm font-medium transition-colors"
            >
              トークを開く
            </Link>
          </aside>

          {/* 右：タブ */}
          <div>
            <div className="border-hairline mb-4 flex gap-1 border-b">
              {TABS.map((t) => (
                <Link
                  key={t.key}
                  href={`/friends/detail?id=${friendId}&tab=${t.key}`}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
                    tab === t.key
                      ? 'border-accent text-accent'
                      : 'text-ink-secondary hover:text-ink border-transparent'
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>

            {tab === 'info' && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {fields.length === 0 ? (
                  <p className="text-ink-faint py-6 text-center text-sm">
                    情報欄の項目がまだありません。
                    <Link
                      href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                      className="text-accent ml-1 hover:underline"
                    >
                      項目を追加
                    </Link>
                  </p>
                ) : (
                  <>
                    {[...starred, ...rest].map((field) => (
                      <div key={field.id} className="mb-4">
                        <label className="text-ink-secondary mb-1 block text-sm font-medium">
                          {field.isStarred && <span className="text-warning mr-1">★</span>}
                          {field.name}
                          <span className="text-ink-faint ml-1.5 text-xs font-normal">
                            {FIELD_TYPE_LABELS[field.type] ?? field.type}
                          </span>
                          {field.isPersonal && (
                            <span className="bg-warning-bg text-warning rounded-pill ml-1.5 px-1.5 py-0.5 text-[10px]">
                              個人情報
                            </span>
                          )}
                        </label>
                        <FieldInput
                          field={field}
                          value={values[field.id] ?? ''}
                          onChange={(v) => setValues((prev) => ({ ...prev, [field.id]: v }))}
                        />
                        {field.ecIsMaster && (
                          <p className="text-ink-faint mt-1 text-xs">
                            EC側の値が正のため、ここからは変更できません。
                          </p>
                        )}
                      </div>
                    ))}

                    {hiddenPersonalCount > 0 && (
                      <p className="text-ink-faint bg-canvas-sunken rounded-control mb-4 px-3 py-2 text-xs">
                        個人情報の項目が {hiddenPersonalCount} 件あります。
                        表示にはオーナーまたは管理者の権限が要ります。
                      </p>
                    )}

                    {warnings.length > 0 && (
                      <ul className="bg-warning-bg text-warning mb-3 space-y-1 rounded-lg p-3 text-xs">
                        {warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    )}
                    {notice && <p className="text-success mb-3 text-sm">{notice}</p>}

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={save}
                        disabled={saving}
                        className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40"
                      >
                        {saving ? '保存中...' : '保存'}
                      </button>
                      <Link
                        href={`/tags/fields/new?back=/friends/detail?id=${friendId}`}
                        className="border-hairline text-ink-secondary rounded-control hover:bg-canvas-sunken border px-4 py-2 text-sm font-medium"
                      >
                        項目を追加
                      </Link>
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'forms' && (
              <div className="bg-canvas rounded-card border-hairline border p-5">
                {!friend?.formSubmissions || friend.formSubmissions.length === 0 ? (
                  <p className="text-ink-faint py-6 text-center text-sm">
                    フォームの回答はまだありません。
                  </p>
                ) : (
                  <ul className="divide-hairline divide-y">
                    {friend.formSubmissions.map((s) => (
                      <li key={s.id} className="py-3 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="text-ink text-sm font-medium">{s.formName}</p>
                          <p className="text-ink-faint text-xs">
                            {new Date(s.createdAt).toLocaleString('ja-JP')}
                          </p>
                        </div>
                        <dl className="mt-1.5 space-y-0.5">
                          {Object.entries(s.data ?? {}).map(([k, v]) => (
                            <div key={k} className="flex gap-2 text-xs">
                              <dt className="text-ink-faint shrink-0">{k}</dt>
                              <dd className="text-ink-secondary break-all">
                                {Array.isArray(v) ? v.join(', ') : String(v ?? '')}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function FriendDetailPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <FriendDetailInner />
    </Suspense>
  )
}
