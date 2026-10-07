'use client'

/*
 * ★V8 プール管理（Pencil `u3iab3`）。
 *
 * 白い板の頭（題・説明・右に「新規プール」）→ 左に「設定の中のメニュー」→
 * 右にプールのカードを2列、その下に「外す」の案内の帯。
 * データの口は今の画面（app/pools/page.tsx）と同じ：
 * プール一覧・LINEアカウント一覧・プールごとの所属アカウント・追加・外す・削除。
 * 「新規プール」は V8 の作る画面（/pools/new・`D0AOyx`）へ移る。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Info, Plus } from 'lucide-react'
import type { LineAccount, PoolAccount, TrafficPool } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { isPoolsFeatureAvailable } from '@/lib/pools-availability'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { usePageTitle } from '@/components/shell/page-chrome'
import { SettingsPage } from '@/components/templates'
import SettingsInnerNav from '@/components/layout/settings-inner-nav'
import { FeatureDisabledScreen } from '@/components/feature-disabled-gate'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { RowMenu } from '@/components/shared/row-actions'
import ListState from '@/components/shared/list-state'
import frame from '../sa-frame.module.css'
import styles from './pools.module.css'

type AccountWithStats = LineAccount & { stats?: { friendCount: number } }

const TITLE = 'プール管理'
const DESCRIPTION = '来たお客さまを振り分ける LINE アカウントをまとめる入れ物です。公開 URL から来た人を、稼働中の所属アカウントからランダムに振り分けます。'

/** 既定のプール（main）を先頭に、あとは作った順。 */
export function orderPools(pools: readonly TrafficPool[]): TrafficPool[] {
  return [...pools].sort((a, b) => {
    if (a.slug === 'main') return -1
    if (b.slug === 'main') return 1
    return a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name, 'ja')
  })
}

export default function PoolsV8() {
  usePageTitle(TITLE)
  const role = useStaffRole()
  // 役割が読めるまでは今までどおり出し、見るだけと分かったら操作を隠す（最後の守りはサーバの 403）。
  const canManage = role === null || canManageRole(role)
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // どこも無効と確定したときは口を呼ばず、案内だけ出す（403 自体が console error になるため・#703）。
  const [featureOff, setFeatureOff] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    setFeatureOff(false)
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
      if (accRes.success) setAccounts(accRes.data as AccountWithStats[])
    } catch (err) {
      // FEATURE_DISABLED は共通ゲートが案内へ切り替える。それ以外だけここで伝える。
      if (!(err instanceof ApiError && err.code === 'FEATURE_DISABLED')) {
        setError('プール一覧の取得に失敗しました。もう一度読み込んでください。')
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (featureOff) {
    return (
      <div className={frame.screen}>
        <SettingsPage boardId="u3iab3" title={TITLE} description={DESCRIPTION} navigation={<SettingsInnerNav inline />}>
          <FeatureDisabledScreen featureId="multi_store_hierarchy" />
        </SettingsPage>
      </div>
    )
  }

  const ordered = orderPools(pools)
  // 読み込み済み・失敗なし・0件のときは空状態だけ出す（右上の作る口と重ねない）。
  const isEmpty = !loading && !error && ordered.length === 0
  const createButton = (
    <Button variant="primary" href="/pools/new">
      <Plus size={15} aria-hidden="true" />新規プール
    </Button>
  )

  return (
    <div className={frame.screen}>
      <SettingsPage
        boardId="u3iab3"
        title={TITLE}
        description={DESCRIPTION}
        actions={canManage && !isEmpty ? createButton : undefined}
        navigation={<SettingsInnerNav inline />}
      >
        {loading ? <ListState kind="loading" /> : error ? (
          <ListState kind="error" title="プール一覧を表示できませんでした" description={error} onRetry={() => { void load() }} />
        ) : isEmpty ? (
          <ListState
            kind="empty"
            title="まだプールがありません"
            description="プールは、来たお客さまを振り分ける LINE アカウントをまとめる入れ物です。"
            action={canManage ? createButton : undefined}
          />
        ) : (
          <>
            <div className={styles.cards}>
              {ordered.map((pool) => (
                <PoolCard key={pool.id} pool={pool} accounts={accounts} canManage={canManage} onChange={() => void load()} />
              ))}
            </div>
            <p className={styles.notice} role="note">
              <Info size={16} aria-hidden="true" className={styles.noticeIcon} />
              <span>「外す」と、これから来たお客さまはそのアカウントへ振り分けられなくなります。アカウント自体と、これまでの流入の記録は残ります。</span>
            </p>
          </>
        )}
      </SettingsPage>
    </div>
  )
}

function PoolCard({ pool, accounts, canManage, onChange }: {
  pool: TrafficPool
  accounts: AccountWithStats[]
  canManage: boolean
  onChange: () => void
}) {
  const isMain = pool.slug === 'main'
  const apiBase = process.env.NEXT_PUBLIC_API_URL ?? ''
  const publicUrl = `${apiBase}/pool/${pool.slug}`
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')

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

  const onDelete = async () => {
    // 押している間は受け付けない（二度押しの2回目は404になり、消えているのに失敗と出る）。
    if (isMain || deleting) return
    setDeleting(true)
    setDeleteError('')
    try {
      const res = await api.pools.delete(pool.id)
      if (!res.success) throw new Error(res.error)
      setConfirmOpen(false)
      onChange()
    } catch {
      setDeleteError('このプールを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <section className={styles.card} aria-label={pool.name}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitleBox}>
          <h2 className={styles.cardTitle} title={pool.name}>{pool.name}</h2>
          <p className={styles.slug} title={pool.slug}>slug：{pool.slug}{isMain ? '・既定' : ''}</p>
        </div>
        {canManage && !isMain ? (
          <div className={styles.menuBox}>
            <RowMenu
              label={`${pool.name}の操作`}
              menuLabel="操作"
              open={menuOpen}
              onOpenChange={setMenuOpen}
              items={[{ id: 'delete', label: '削除する', tone: 'danger', onSelect: () => { setMenuOpen(false); setDeleteError(''); setConfirmOpen(true) } }]}
            />
          </div>
        ) : null}
      </div>
      <div className={styles.urlRow}>
        <span className={styles.url} title={publicUrl}>{publicUrl}</span>
        <Button variant="secondary" onClick={() => void onCopy()}>
          <Copy size={15} aria-hidden="true" />{copied ? 'コピー済' : '公開 URL コピー'}
        </Button>
      </div>
      {copyError ? <p role="alert" className={styles.inlineError}>{copyError}</p> : null}
      <PoolMembers poolId={pool.id} accounts={accounts} canManage={canManage} onChange={onChange} />

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

function PoolMembers({ poolId, accounts, canManage, onChange }: {
  poolId: string
  accounts: AccountWithStats[]
  canManage: boolean
  onChange: () => void
}) {
  const [members, setMembers] = useState<PoolAccount[]>([])
  const [removeTarget, setRemoveTarget] = useState<{ id: string; name: string } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')
  const [listError, setListError] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLButtonElement>(null)

  // 読み直しの失敗は握りつぶさない（空のままだと「所属なし」と読み違える）。
  const reload = useCallback(async () => {
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
  }, [poolId])

  useEffect(() => {
    void reload()
  }, [reload])

  const memberIds = new Set(members.map((m) => m.lineAccountId))
  const candidates = accounts.filter((a) => !memberIds.has(a.id))

  const onAdd = async (lineAccountId: string) => {
    try {
      const res = await api.pools.accounts.add(poolId, lineAccountId)
      if (!res.success) throw new Error(res.error)
      await reload()
      onChange()
    } catch {
      setListError('このアカウントをプールに追加できませんでした。もう一度お試しください。')
    }
  }

  // 外す確認。あとから入れ直せるので destructive は付けない。
  const onRemove = async () => {
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
      setRemoveError('このアカウントをプールから外せませんでした。状態を読み直してから、もう一度お試しください。')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <>
      <p className={styles.membersLabel}>所属アカウント（来たお客さまをランダムに振り分けます）</p>
      <ul className={styles.members}>
        {members.map((m) => {
          const acc = accounts.find((a) => a.id === m.lineAccountId)
          const name = acc?.name ?? m.lineAccountId
          const friends = acc?.stats?.friendCount == null ? '—' : acc.stats.friendCount.toLocaleString('ja-JP')
          return (
            <li key={m.id} className={styles.member}>
              <span className={styles.memberName} title={name}>{name}</span>
              <span className={styles.memberFriends}>{`友だち ${friends}`}</span>
              {canManage ? (
                <Button variant="secondary" onClick={() => { setRemoveError(''); setRemoveTarget({ id: m.id, name }) }}>外す</Button>
              ) : null}
            </li>
          )
        })}
        {members.length === 0 && !listError ? <li className={styles.empty}>所属アカウントなし</li> : null}
      </ul>
      {listError ? (
        <p role="alert" className={styles.inlineError}>
          {listError}{' '}
          <button type="button" className={styles.textButton} onClick={() => void reload()}>読み直す</button>
        </p>
      ) : null}
      {canManage && candidates.length > 0 ? (
        <div className={styles.menuBox}>
          <button
            ref={addRef}
            type="button"
            className={styles.addLink}
            aria-haspopup="menu"
            aria-expanded={addOpen}
            onClick={() => setAddOpen(!addOpen)}
          >
            ＋ アカウントを追加
          </button>
          <ActionMenu
            open={addOpen}
            anchorRef={addRef}
            ariaLabel="追加するアカウント"
            onClose={() => setAddOpen(false)}
            items={candidates.map((a) => ({ id: a.id, label: a.name, onSelect: () => { setAddOpen(false); void onAdd(a.id) } }))}
          />
        </div>
      ) : null}

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
    </>
  )
}
