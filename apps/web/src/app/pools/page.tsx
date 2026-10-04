'use client'

import '@/app/notifications/readonly-v8.css'
import ReadonlyHeaderV8 from '@/app/notifications/readonly-header-v8'
import { SettingsNavV8 } from '../settings/settings-nav-v8'
import styles from './pools-v8.module.css'

import { X, Copy, MoreHorizontal, Plus } from 'lucide-react'
import IconButton from '@/components/shared/icon-button'
import ActionMenu from '@/components/shared/action-menu'
import Select from '@/components/shared/select'
import { useEffect, useState } from 'react'
import { api, ApiError, describeSaveFailure } from '@/lib/api'
import type { TrafficPool, PoolAccount, LineAccount } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'

type AccountWithStats = LineAccount & { stats?: { friendCount: number } }

export default function PoolsPage() {
  usePageTitle('プール管理')
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  // どこも無効と確定したときは口を発行せず、この案内を直接出す。
  // 403 の応答自体が console error になるため、取ってから切り替えるのでは遅い。
  const [featureOff, setFeatureOff] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    setFeatureOff(false)
    // 有効な場所が1つも無ければ GET /api/traffic-pools を発行しない（#703）。
    // 判定と取得の隙間で切られたときは従来どおり共通ゲートが案内へ切り替える。
    if (!(await isPoolsFeatureAvailable())) {
      setPools([])
      setFeatureOff(true)
      setLoading(false)
      return
    }
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

  // 無効と確定したときは管理UIを出さず、共通ゲートと同じ案内だけ出す。
  if (featureOff) {
    return (
      <div>
        <FeatureDisabledScreen featureId="multi_store_hierarchy" />
      </div>
    )
  }

  // 読み込み済み・失敗なし・0件のときは空状態だけ出す。件数と右上の
  // 作成口を残すと、同じ緑ボタンが2つ・同じ0が2か所に重複する。
  const isEmpty = !loading && !error && sortedPools.length === 0

  return (
    <div className={styles.page} data-design-node="u3iab3">
      <ReadonlyHeaderV8 title="プール管理" description="来たお客さまを振り分けるLINEアカウントをまとめる入れ物です。公開URLから来た人を、稼働中の所属アカウントからランダムに振り分けます。"
        actions={!isEmpty && !showCreate ? <Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={15} aria-hidden="true" />新規プール</Button> : undefined} />
      <div className={styles.layout}>
        <SettingsNavV8 />
        <div className={styles.main}>
          {loading ? <ListState kind="loading" /> : error ? (
            <ListState kind="error" title="プール一覧を表示できませんでした" description={error} onRetry={() => { void load() }} />
          ) : isEmpty ? (
            <ListState kind="empty" title="まだプールがありません" description="プールは、来たお客様を振り分けるLINEアカウントをまとめる入れ物です。"
              action={<Button variant="primary" onClick={() => setShowCreate(true)}><Plus size={15} aria-hidden="true" />新規プール</Button>} />
          ) : (
            <>
              <div className={styles.cards}>
                {sortedPools.map((pool) => <PoolCard key={pool.id} pool={pool} accounts={accounts} onChange={load} />)}
              </div>
              <Notice tone="info" message="「外す」と、これから来たお客さまはそのアカウントへ振り分けられなくなります。アカウント自体と、これまでの流入の記録は残ります。" />
            </>
          )}
        </div>
      </div>

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
  accounts: AccountWithStats[]
  onChange: () => void
}) {
  const isMain = pool.slug === 'main'
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const publicUrl = `${apiBase}/pool/${pool.slug}`
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const onCopy = async () => {
    try {
      setCopyError('')
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopyError('コピーできませんでした。公開URLを選んでコピーしてください。')
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
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div className="min-w-0">
          <h2 className={styles.name} title={pool.name}>{pool.name}</h2>
          <p className={styles.slug} title={pool.slug}>slug：{pool.slug}{isMain ? '・既定' : ''}</p>
        </div>
        {!isMain && <div>
          <IconButton aria-label={`${pool.name}の操作`} onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen}><MoreHorizontal size={16} /></IconButton>
          <ActionMenu open={menuOpen} onClose={() => setMenuOpen(false)} items={[{ id: 'delete', label: '削除する', tone: 'danger', onSelect: () => { setMenuOpen(false); setDeleteError(''); setConfirmOpen(true) } }]} />
        </div>}
      </div>
      <div className={styles.urlRow}>
        <span className={styles.url} title={publicUrl}>{publicUrl}</span>
        <Button variant="secondary" onClick={onCopy}><Copy size={15} aria-hidden="true" />{copied ? 'コピー済' : '公開 URL コピー'}</Button>
      </div>
      {copyError && <p role="alert" className="text-xs text-ink-secondary">{copyError}</p>}
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
    </section>
  )
}

function PoolAccountList({
  poolId,
  accounts,
  onChange,
}: {
  poolId: string
  accounts: AccountWithStats[]
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
    <div className={styles.members}>
      <div className={styles.membersLabel}>所属アカウント<HelpTip label="所属アカウントの説明">来たお客さまを稼働中の所属先へランダムに振り分けます。</HelpTip></div>
      <ul className={styles.memberList}>
        {members.map((m) => {
          const acc = accounts.find((a) => a.id === m.lineAccountId)
          return (
            <li
              key={m.id}
              className={styles.member}
            >
              <span className="min-w-0 truncate" title={acc?.name ?? m.lineAccountId}>{acc?.name ?? m.lineAccountId}</span>
              <span className="shrink-0 text-xs text-ink-secondary">友だち {acc?.stats?.friendCount == null ? '—' : acc.stats.friendCount.toLocaleString('ja-JP')}</span>
              <Button variant="secondary" onClick={() => {
                setRemoveError('')
                setRemoveTarget({ id: m.id, name: acc?.name ?? m.lineAccountId })
              }}>外す</Button>
            </li>
          )
        })}
        {members.length === 0 && !listError && (
          <li className="text-xs text-ink-faint">所属アカウントなし</li>
        )}
      </ul>
      {listError && (
        <p role="alert" className="mt-1 text-xs text-ink-secondary">{listError} <button type="button" onClick={() => void reload()} className="text-action underline">読み直す</button></p>
      )}
      {candidates.length > 0 && (
        <div className="mt-2">
          <Select
            aria-label="追加するアカウント"
            value=""
            onChange={(value) => {
              if (value) {
                void onAdd(value)
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
  accounts: AccountWithStats[]
  onClose: () => void
  onCreated: () => void
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [activeAccountId, setActiveAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // 共通ダイアログと同じ約束: 開いたら窓の中へフォーカス・Tabは窓の中・
  // Escapeで閉じる・閉じたら起点へ戻す・背面はスクロールしない。
  const panelRef = useOverlayFocus(true, onClose)

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
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-pool-title"
        className="bg-canvas rounded-card w-full max-w-md space-y-3 p-6"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 id="create-pool-title" className="text-lg font-semibold">新規プール</h2>
          <button type="button" onClick={onClose} aria-label="閉じる" className="rounded-mini p-1 text-ink-secondary hover:bg-canvas-sunken">
            <X aria-hidden="true" className="h-5 w-5" />
          </button>
        </div>
        {error && (
          <Notice tone="danger" message={error} />
        )}
        {/*
          R617: 項目名がplaceholderだけだと、入力後に何の欄か消える。
          labelと入力欄はhtmlForとidで結び付ける。暗黙の関連付けだと、
          labelの中のHelpTipのbuttonが先に来て入力欄へ結び付かなくなる
          （実ブラウザで input.labels が空になる）ため、HelpTipはlabelの
          外へ置き、入力欄の読み上げ名に混ざらないようにする。
          読み上げ名（placeholder・aria-label由来）は元からあるので残す。
        */}
        <div>
          <div className="mb-1 flex items-center gap-1">
            <label htmlFor="create-pool-slug" className="text-ink-secondary text-sm font-medium">slug</label>
            <HelpTip label="slugの説明">
              公開URLに使う識別子です。
            </HelpTip>
          </div>
          <input
            id="create-pool-slug"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="例: brand-a"
            className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 font-mono text-sm"
          />
        </div>
        <div>
          <label htmlFor="create-pool-name" className="text-ink-secondary mb-1 block text-sm font-medium">表示名</label>
          <input
            id="create-pool-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例: ブランドA"
            className="border-hairline bg-canvas text-ink rounded-control w-full border px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="create-pool-account" className="text-ink-secondary mb-1 block text-sm font-medium">最初の所属アカウント</label>
          <Select
            id="create-pool-account"
            aria-label="最初の所属アカウント"
            value={activeAccountId}
            onChange={(value) => setActiveAccountId(value)}
            options={[{ value: '', label: '最初の所属アカウントを選択' }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]}
          />
        </div>
        <div className="border-hairline flex justify-end gap-2 border-t pt-2">
          <Button variant="secondary" onClick={onClose}>
            キャンセル
          </Button>
          <Button
            variant="primary"
            onClick={() => { void onSubmit() }}
            disabled={submitting || !slug || !name || !activeAccountId}
            className="text-sm px-3 py-1.5 rounded-mini bg-action text-on-accent hover:brightness-90 disabled:opacity-50" busy={submitting} busyLabel="作成中…">作る
          </Button>
        </div>
      </div>
    </div>
  )
}
