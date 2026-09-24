'use client'

import { X } from 'lucide-react'
import SelectField from '@/components/shared/select-field'
import { useEffect, useState } from 'react'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import type { TrafficPool, PoolAccount, LineAccount } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import StatusBadge from '@/components/shared/status-badge'

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
    try {
      const [poolsRes, accRes] = await Promise.all([api.pools.list(), api.lineAccounts.list()])
      if (poolsRes.success) setPools(poolsRes.data)
      else setError('プール一覧の取得に失敗しました。もう一度読み込んでください。')
      if (accRes.success) setAccounts(accRes.data)
    } catch (err) {
      // FEATURE_DISABLED は共通ゲートが案内へ切り替える。それ以外だけここで伝える。
      if (!(err instanceof ApiError && err.code === 'FEATURE_DISABLED')) {
        setError('プール一覧の取得に失敗しました。もう一度読み込んでください。')
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  // Pin main pool to the top
  const sortedPools = [...pools].sort((a, b) =>
    a.slug === 'main' ? -1 : b.slug === 'main' ? 1 : a.name.localeCompare(b.name),
  )

  // 読み込み済み・失敗なし・0件のときは空状態だけ出す。件数と右上の
  // 作成口を残すと、同じ緑ボタンが2つ・同じ0が2か所に重複する。
  const isEmpty = !loading && !error && sortedPools.length === 0

  return (
    <div>
      {isEmpty ? (
        <ListState
          kind="empty"
          title="まだプールがありません"
          description="プールは、来たお客様を振り分けるLINEアカウントをまとめる入れ物です。"
          action={
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              ＋ プールをつくる
            </Button>
          }
        />
      ) : (
        <>
          <div className="flex justify-between items-center mb-4">
            <span className="text-sm text-ink-secondary">{pools.length} プール</span>
            <Button variant="primary" onClick={() => setShowCreate(true)}>
              ＋ プールをつくる
            </Button>
          </div>

          {loading && pools.length === 0 ? (
            <ListState kind="loading" />
          ) : error && pools.length === 0 ? (
            <ListState
              kind="error"
              title="プール一覧を表示できませんでした"
              description="プール一覧の取得に失敗しました。もう一度読み込んでください。"
              onRetry={() => { void load() }}
            />
          ) : (
            <div className="space-y-3">
              {error ? (
                <div className="border-danger bg-danger-bg text-danger rounded-control flex flex-wrap items-center gap-3 border p-4 text-sm" role="alert">
                  <span className="min-w-0 flex-1">{error}</span>
                  <button type="button" onClick={() => { void load() }} className="shrink-0 font-medium underline">もう一度読み込む</button>
                </div>
              ) : null}
              {sortedPools.map((pool) => (
                <PoolCard key={pool.id} pool={pool} accounts={accounts} onChange={load} />
              ))}
            </div>
          )}
        </>
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
    <div className="bg-canvas border-hairline rounded-card border p-4">
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-medium">
            <span className="min-w-0 truncate" title={pool.name}>{pool.name}</span>
            {isMain && (
              <StatusBadge tone="info" size="compact">
                既定
              </StatusBadge>
            )}
          </h3>
          <p className="text-xs text-ink-faint font-mono truncate" title={pool.slug}>{pool.slug}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="secondary" onClick={onCopy}>
            {copied ? '✓ コピー済' : '公開 URL コピー'}
          </Button>
          {!isMain && (
            <button
              type="button"
              onClick={() => { setDeleteError(''); setConfirmOpen(true) }}
              className="text-danger hover:bg-danger-bg rounded-mini px-2 py-1 text-xs"
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
  const [listError, setListError] = useState('')

  /**
   * 読み直しの失敗は握りつぶさない。一覧が空のままだと「所属なし」と
   * 読み違えるので、取れなかったことを行の下へ出す。
   */
  const reload = async () => {
    try {
      const res = await api.pools.accounts.list(poolId)
      if (res.success) {
        setMembers(res.data)
        setListError('')
      } else {
        setListError('所属アカウントを読み込めませんでした。もう一度お試しください。')
      }
    } catch {
      setListError('所属アカウントを読み込めませんでした。もう一度お試しください。')
    }
  }

  // useEffect の戻り値はcleanup関数だけ。async関数をそのまま返すと
  // ReactがPromiseをcleanupとして扱い、拒否も拾えないので void で包む。
  useEffect(() => {
    void reload()
  }, [poolId])

  const memberAccountIds = new Set(members.map((m) => m.lineAccountId))
  const candidates = accounts.filter((a) => !memberAccountIds.has(a.id))

  const onAdd = async (lineAccountId: string) => {
    try {
      const res = await api.pools.accounts.add(poolId, lineAccountId)
      if (!res.success) throw new Error(res.error)
      await reload()
      onChange()
    } catch {
      // 生のAPIエラーは運用者に読めないので、運用の言葉で出す。
      setListError('このアカウントをプールに追加できませんでした。もう一度お試しください。')
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
              className="bg-canvas-sunken rounded-mini flex items-center justify-between gap-2 px-2 py-1"
            >
              <span className="min-w-0 truncate" title={acc?.name ?? m.lineAccountId}>{acc?.name ?? m.lineAccountId}</span>
              <button
                type="button"
                onClick={() => {
                  setRemoveError('')
                  setRemoveTarget({ id: m.id, name: acc?.name ?? m.lineAccountId })
                }}
                className="text-danger shrink-0 text-xs hover:underline"
              >
                外す
              </button>
            </li>
          )
        })}
        {members.length === 0 && !listError && (
          <li className="text-xs text-ink-faint">所属アカウントなし</li>
        )}
      </ul>
      {listError && (
        <p className="text-danger mt-1 text-xs">{listError}</p>
      )}
      {candidates.length > 0 && (
        <div className="mt-2">
          <SelectField
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) {
                void onAdd(e.target.value)
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
    try {
      const res = await api.pools.create({ slug, name, activeAccountId })
      if (res.success) onCreated()
      else setError(res.error ?? '作成に失敗しました。通信を確かめて、もう一度お試しください。')
    } catch (err) {
      // 400系はAPIの理由（slug重複など）、403・5xxは運用の言葉へ写す（WRITE-01）。
      setError(describeSaveFailure(err))
    } finally {
      // 失敗時に「作成中…」のまま固まらないよう、必ず戻す。
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-scrim fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="bg-canvas rounded-card w-full max-w-md space-y-3 p-6">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-medium">新規プール</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {error && (
          <div className="border-danger bg-danger-bg text-danger rounded-control border p-2 text-xs" role="alert">
            {error}
          </div>
        )}
        <input
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug (例: brand-a)"
          className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 font-mono text-sm"
        />
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="表示名 (例: ブランドA)"
          className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 text-sm"
        />
        <SelectField
          value={activeAccountId}
          onChange={(e) => setActiveAccountId(e.target.value)}
          options={[{ value: '', label: '最初の所属アカウントを選択' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
        />
        <div className="border-hairline flex justify-end gap-2 border-t pt-2">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={() => { void onSubmit() }}
            disabled={submitting || !slug || !name || !activeAccountId}
          >
            {submitting ? '作成中…' : '作成'}
          </Button>
        </div>
      </div>
    </div>
  )
}
