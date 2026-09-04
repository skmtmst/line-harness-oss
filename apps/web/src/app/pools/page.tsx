'use client'

import SelectField from '@/components/shared/select-field'
import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import type { TrafficPool, PoolAccount, LineAccount } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import ConfirmDialog from '@/components/shared/confirm-dialog'

export default function PoolsPage() {
  usePageTitle('プール管理')
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    const [poolsRes, accRes] = await Promise.all([api.pools.list(), api.lineAccounts.list()])
    if (poolsRes.success) setPools(poolsRes.data)
    else setError('プール一覧の取得に失敗しました')
    if (accRes.success) setAccounts(accRes.data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Pin main pool to the top
  const sortedPools = [...pools].sort((a, b) =>
    a.slug === 'main' ? -1 : b.slug === 'main' ? 1 : a.name.localeCompare(b.name),
  )

  return (
    <div>
      <Header
        description="LINE 公式アカウントの分散先を管理します。アカウントが 1 つでも『メインプール』として表示されます。"
      />

      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{pools.length} プール</span>
        <button
          onClick={() => setShowCreate(true)}
          className="px-3 py-1.5 rounded bg-blue-600 text-white text-sm hover:bg-blue-700"
        >
          + 新規プール
        </button>
      </div>

      {error && (
        <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm mb-4">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
          読み込み中...
        </div>
      ) : (
        <div className="space-y-3">
          {sortedPools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} accounts={accounts} onChange={load} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePoolModal
          accounts={accounts}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function PoolCard({
  pool,
  accounts,
  onChange,
}: {
  pool: TrafficPool
  accounts: LineAccount[]
  onChange: () => void
}) {
  const isMain = pool.slug === 'main'
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const publicUrl = `${apiBase}/pool/${pool.slug}`
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard requires secure context — silent fallback
    }
  }
  /**
   * 削除の確認。ブラウザの `confirm()` は「プール「x」を削除しますか?」と
   * しか言えず、公開URLが止まることも、記録が残ることも読めない。失敗は
   * `alert` で生のAPIエラーを出していた。共通の窓へ移した（設計 `H2S1T4`）。
   */
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

  const onDelete = async () => {
    // 押している間は受け付けない。二度押しの2回目は404になり、
    // 消えているのに「削除できませんでした」と出る。
    if (isMain || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.pools.delete(pool.id)
      if (!res.success) throw new Error(res.error)
      setConfirmOpen(false)
      onChange()
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setDeleteError('このプールを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="font-medium">
            {pool.name}
            {isMain && (
              <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                既定
              </span>
            )}
          </h3>
          <p className="text-xs text-gray-500 font-mono">{pool.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onCopy}
            className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
          >
            {copied ? '✓ コピー済' : '公開 URL コピー'}
          </button>
          {!isMain && (
            <button
              onClick={() => { setDeleteError(''); setConfirmOpen(true) }}
              className="text-xs px-2 py-1 text-red-600 hover:bg-red-50 rounded"
            >
              削除
            </button>
          )}
        </div>
      </div>
      <PoolAccountList poolId={pool.id} accounts={accounts} onChange={onChange} />

      <ConfirmDialog
        open={confirmOpen}
        title={`プール「${pool.name}」を削除しますか？`}
        description={`公開URL ${publicUrl} は使えなくなり、これから来たお客様はどのアカウントにも振り分けられません。所属していたLINEアカウントと、これまでの流入の記録は残ります。この操作は取り消せません。`}
        confirmLabel="削除する"
        destructive
        busy={deleting}
        error={deleteError}
        onConfirm={() => void onDelete()}
        onCancel={() => {
          if (deleting) return
          setConfirmOpen(false)
          setDeleteError('')
        }}
      />
    </div>
  )
}

function PoolAccountList({
  poolId,
  accounts,
  onChange,
}: {
  poolId: string
  accounts: LineAccount[]
  onChange: () => void
}) {
  const [members, setMembers] = useState<PoolAccount[]>([])
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const reload = async () => {
    const res = await api.pools.accounts.list(poolId)
    if (res.success) setMembers(res.data)
  }

  useEffect(() => {
    reload()
  }, [poolId])

  const memberAccountIds = new Set(members.map((m) => m.lineAccountId))
  const candidates = accounts.filter((a) => !memberAccountIds.has(a.id))

  const onAdd = async (lineAccountId: string) => {
    const res = await api.pools.accounts.add(poolId, lineAccountId)
    if (res.success) {
      await reload()
      onChange()
    }
  }

  /**
   * 外す確認。あとから入れ直せるので `destructive` は付けない。
   * 消えない操作まで赤くすると、本当に消える操作の赤が効かなくなる。
   */
  const onRemove = async () => {
    // 押している間は受け付けない。
    if (!removeTarget || removing) return
    setRemoving(true)
    setRemoveError('')
    try {
      const res = await api.pools.accounts.remove(poolId, removeTarget.id)
      if (!res.success) throw new Error(res.error)
      setRemoveTarget(null)
      await reload()
      onChange()
    } catch {
      // 生のAPIエラーは運用者に読めないので、窓の中に運用の言葉で出す。
      setRemoveError('このアカウントをプールから外せませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="mt-2">
      <ul className="text-sm space-y-1">
        {members.map((m) => {
          const acc = accounts.find((a) => a.id === m.lineAccountId)
          return (
            <li
              key={m.id}
              className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded"
            >
              <span>{acc?.name ?? m.lineAccountId}</span>
              <button
                onClick={() => {
                  setRemoveError('')
                  setRemoveTarget({ id: m.id, name: acc?.name ?? m.lineAccountId })
                }}
                className="text-xs text-red-600 hover:underline"
              >
                外す
              </button>
            </li>
          )
        })}
        {members.length === 0 && (
          <li className="text-xs text-gray-400">所属アカウントなし</li>
        )}
      </ul>
      {candidates.length > 0 && (
        <div className="mt-2">
          <SelectField
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                onAdd(e.target.value)
                e.target.value = ''
              }
            }}
            options={[{ value: '', label: '＋ アカウントを追加' }, ...candidates.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={`「${removeTarget?.name ?? ''}」をこのプールから外しますか？`}
        description="これから来たお客様は、このアカウントへ振り分けられなくなります。アカウント自体と、これまでの流入の記録は残ります。外したあとで、同じアカウントを入れ直せます。"
        confirmLabel="外す"
        busy={removing}
        error={removeError}
        onConfirm={() => void onRemove()}
        onCancel={() => {
          if (removing) return
          setRemoveTarget(null)
          setRemoveError('')
        }}
      />
    </div>
  )
}

function CreatePoolModal({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: LineAccount[]
  onClose: () => void
  onCreated: () => void
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [activeAccountId, setActiveAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async () => {
    if (!slug || !name || !activeAccountId) return
    setSubmitting(true)
    setError('')
    const res = await api.pools.create({ slug, name, activeAccountId })
    setSubmitting(false)
    if (res.success) onCreated()
    else setError(res.error ?? '作成に失敗しました')
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-md p-6 space-y-3">
        <h2 className="text-lg font-medium">新規プール</h2>
        {error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug (例: brand-a)"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-mono"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="表示名 (例: ブランドA)"
          className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
        />
        <SelectField
          value={activeAccountId}
          onChange={(e) => setActiveAccountId(e.target.value)}
          options={[{ value: '', label: '最初の所属アカウントを選択' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
        <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
          <button onClick={onClose} className="text-sm px-3 py-1.5 text-gray-600">
            キャンセル
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || !slug || !name || !activeAccountId}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? '作成中…' : '作成'}
          </button>
        </div>
      </div>
    </div>
  )
}
