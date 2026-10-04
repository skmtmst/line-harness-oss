'use client'

/*
 * ★V8-B 組織・権限（板 `bSp4h`）。
 *
 * v7（restaurant-console.tsx の Organization）と同じ口で、板の形で置く：
 * 左に組織階層、右に 店舗管理 → 予約メール取り込みアドレス → 数3 →
 * アカウント一覧 → 権限マトリクス。名簿の登録だけではログイン権限は
 * 変わらない（v7 と同じ注記）。
 */
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Plus, RotateCw } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ApiError } from '@/lib/api'
import {
  restaurantTestApi,
  type RestaurantIntakeAddress,
  type RestaurantMembership,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import { formatDateTime } from '@/lib/format'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import RestaurantShell, { Panel, Stat, Status, type RestaurantV8Context } from './shell'
import styles from './shell.module.css'

const roleLabel: Record<RestaurantMembership['role'], string> = {
  super_admin: 'SuperAdmin',
  store_manager: 'StoreManager',
  staff: 'Staff',
}

function intakeAddressError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return '取り込み用ドメインが未設定です'
  if (error instanceof ApiError && error.status === 403) return '取り込みアドレスはオーナーまたは管理者だけが確認できます。'
  return '取り込みアドレスを読み込めませんでした。'
}

function intakeDate(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '日時不明'
  return formatDateTime(date)
}

/** 板「店舗管理」の1行。編集は板 `vCEKM` の窓で開く。 */
function StoreRow({ store, onEdit }: {
  store: RestaurantStore
  onEdit: () => void
}) {
  return (
    <div className={styles.storeRow}>
      <div className={styles.storeRowHead}>
        <div className={styles.storeRowText}>
          <p className={styles.storeRowName}>
            <span>{store.name}</span>
            <Status value={store.status} />
          </p>
          <p className={styles.cellSub}>{store.code} ・ {store.area || 'エリア未設定'} ・ {store.capacity}席</p>
          <p className={styles.storeLine}>LINE: {store.line_account_name ? `${store.line_account_name} 公式` : '未設定'}</p>
        </div>
        <Button size="compact" onClick={onEdit}>編集</Button>
      </div>
    </div>
  )
}

function Field({ label, name, type = 'text', defaultValue, required = false }: {
  label: string
  name: string
  type?: string
  defaultValue?: string
  required?: boolean
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}{required ? <span className={styles.fieldRequired}> *</span> : null}</span>
      <input name={name} type={type} defaultValue={defaultValue} required={required} className={styles.input} />
    </label>
  )
}

function DefaultSelect({ name, ariaLabel, defaultValue, options }: {
  name: string
  ariaLabel: string
  defaultValue: string
  options: { value: string; label: string; disabled?: boolean }[]
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <Select
      name={name}
      aria-label={ariaLabel}
      value={value}
      onChange={setValue}
      size="full"
      options={options}
    />
  )
}

function StoreLineAccountSelect({ accounts, stores, currentStore }: {
  accounts: AccountWithStats[]
  stores: RestaurantStore[]
  currentStore?: RestaurantStore
}) {
  const usedByAccount = new Map(stores.filter((item) => item.line_account_id).map((item) => [item.line_account_id!, item.id]))
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>LINE公式アカウント<span className={styles.fieldRequired}> *</span></span>
      <DefaultSelect
        name="lineAccountId"
        ariaLabel="LINE公式アカウント"
        defaultValue={currentStore?.line_account_id || ''}
        options={[{ value: '', label: '選択してください' }, ...accounts.map((account) => {
          const usedStoreId = usedByAccount.get(account.id)
          const usedElsewhere = Boolean(usedStoreId && usedStoreId !== currentStore?.id)
          return { value: account.id, label: `${account.displayName || account.name}${usedElsewhere ? '（他店舗で使用中）' : ''}`, disabled: usedElsewhere }
        })]}
      />
    </label>
  )
}

/** 店舗の追加・編集フォーム（板では「編集」を押した行の下に開く）。 */
function StoreForm({ store, accounts, stores, busy, onSubmit, onCancel }: {
  store?: RestaurantStore
  accounts: AccountWithStats[]
  stores: RestaurantStore[]
  busy: boolean
  onSubmit: (form: FormData) => void
  onCancel?: () => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <form key={store?.id ?? 'new'} onSubmit={submit} className={styles.inlineForm}>
      <div className={styles.formGrid}>
        <Field label="店舗名" name="name" defaultValue={store?.name} required />
        <Field label="店舗コード" name="code" defaultValue={store?.code} required />
        <Field label="エリア" name="area" defaultValue={store?.area || ''} />
        <Field label="収容人数" name="capacity" type="number" defaultValue={String(store?.capacity ?? 24)} required />
        <Field label="タイムゾーン" name="timezone" defaultValue={store?.timezone || 'Asia/Tokyo'} required />
        {store ? (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>状態</span>
            <DefaultSelect name="status" ariaLabel="状態" defaultValue={store.status} options={[{ value: 'active', label: '有効' }, { value: 'paused', label: '一時停止' }, { value: 'archived', label: '保管済' }]} />
          </label>
        ) : null}
        <StoreLineAccountSelect accounts={accounts} stores={stores} currentStore={store} />
      </div>
      <div className={styles.formActions}>
        {onCancel ? <Button type="button" onClick={onCancel}>キャンセル</Button> : null}
        <Button variant="primary" type="submit" disabled={busy}>{store ? '保存する' : '店舗を登録する'}</Button>
      </div>
    </form>
  )
}

/** 板「予約メール取り込みアドレス」。 */
function IntakeAddressPanel({ accountId, store }: { accountId: string; store: RestaurantStore | null }) {
  const [addresses, setAddresses] = useState<RestaurantIntakeAddress[]>([])
  const [loading, setLoading] = useState(false)
  const [issuing, setIssuing] = useState(false)
  const [reissueOpen, setReissueOpen] = useState(false)
  const [error, setError] = useState('')
  const [actionError, setActionError] = useState('')
  const [notice, setNotice] = useState('')
  const [copiedId, setCopiedId] = useState('')
  const storeId = store?.id || ''

  const loadAddresses = useCallback(async () => {
    if (!accountId || !storeId) {
      setAddresses([])
      setError('')
      return
    }
    setLoading(true)
    setError('')
    setActionError('')
    setNotice('')
    try {
      const response = await restaurantTestApi.listIntakeAddresses(accountId, storeId)
      setAddresses(response.data)
    } catch (caught) {
      setAddresses([])
      setError(intakeAddressError(caught))
    } finally {
      setLoading(false)
    }
  }, [accountId, storeId])

  useEffect(() => { void loadAddresses() }, [loadAddresses])

  const issue = async () => {
    if (!storeId || error) return
    setReissueOpen(false)
    setIssuing(true)
    setNotice('')
    setActionError('')
    try {
      await restaurantTestApi.issueIntakeAddress(accountId, storeId)
      await loadAddresses()
      setNotice(addresses.length > 0 ? '新しいアドレスを発行しました。旧アドレスは90日後に失効します。' : '取り込みアドレスを発行しました。')
    } catch (caught) {
      setActionError(intakeAddressError(caught))
    } finally {
      setIssuing(false)
    }
  }

  const copy = async (item: RestaurantIntakeAddress) => {
    setActionError('')
    try {
      await navigator.clipboard.writeText(item.address)
      setCopiedId(item.id)
      window.setTimeout(() => setCopiedId((current) => current === item.id ? '' : current), 1500)
    } catch {
      setActionError('コピーできませんでした。アドレスを選択して手動でコピーしてください。')
    }
  }

  return (
    <Panel title="予約メール取り込みアドレス" description="予約媒体から届く通知メールの転送先として設定します。">
      <div className={styles.intakeWarning}>このアドレスは予約メールの専用受信口です。第三者へ共有せず、予約媒体の通知設定だけに使用してください。</div>
      {notice ? <p className={styles.intakeNotice}>{notice}</p> : null}
      {actionError ? <p className={styles.intakeError}>{actionError}</p> : null}
      {!store ? (
        <p className={styles.mutedText}>上部の店舗選択から、設定する店舗を選んでください。</p>
      ) : loading ? (
        <p className={styles.mutedText}>取り込みアドレスを確認中…</p>
      ) : error ? (
        <p className={styles.intakeError}>{error}</p>
      ) : addresses.length === 0 ? (
        <div className={styles.intakeEmpty}><p>未発行</p></div>
      ) : (
        <div className={styles.intakeList}>
          {addresses.map((item) => (
            <div key={item.id} className={styles.intakeCard}>
              <div className={styles.intakeCardHead}>
                <p className={styles.cellSub}>{item.revokedAt ? `${intakeDate(item.revokedAt)}まで有効` : '現在使用中'}</p>
                <Status value={item.status} />
              </div>
              <div className={styles.intakeRow}>
                <input
                  aria-label={`${store.name}の取り込みアドレス`}
                  readOnly
                  value={item.address}
                  className={`${styles.input} ${styles.intakeAddress}`}
                />
                <Button size="compact" onClick={() => void copy(item)}>{copiedId === item.id ? 'コピー済み' : 'コピー'}</Button>
              </div>
              <p className={styles.cellSub}>発行日時: {intakeDate(item.createdAt)}</p>
            </div>
          ))}
        </div>
      )}
      {store && !error ? (
        <div className={styles.intakeFoot}>
          <Button size="compact" disabled={issuing || loading} onClick={() => { if (addresses.length > 0) setReissueOpen(true); else void issue() }}>
            <RotateCw size={13} aria-hidden />{issuing ? '発行中…' : 'アドレスを発行'}
          </Button>
        </div>
      ) : null}
      <ConfirmDialog
        open={reissueOpen}
        designNode="rSRFK"
        title="新しい取り込みアドレスを発行しますか？"
        description="いまのアドレスは90日後に失効します。それまでに、媒体側の通知先を新しいアドレスへ変えてください。変えないと予約の取り込みが止まります。"
        confirmLabel="発行する"
        busy={issuing}
        onCancel={() => setReissueOpen(false)}
        onConfirm={() => void issue()}
      />
    </Panel>
  )
}

/** 板「アカウント一覧」の1行分のフォーム。 */
function MemberForm({ member, stores, busy, onSubmit, onCancel }: {
  member?: RestaurantMembership
  stores: RestaurantStore[]
  busy: boolean
  onSubmit: (form: FormData) => void
  onCancel?: () => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <form key={member?.id ?? 'new'} onSubmit={submit} className={styles.inlineForm}>
      <div className={styles.formGridWide}>
        <Field label="氏名" name="staffName" defaultValue={member?.staff_name} required />
        <Field label="メール" name="email" type="email" defaultValue={member?.email ?? ''} />
        <label className={styles.field}>
          <span className={styles.fieldLabel}>役割</span>
          <DefaultSelect name="role" ariaLabel="役割" defaultValue={member?.role ?? 'staff'} options={[{ value: 'staff', label: 'Staff' }, { value: 'store_manager', label: 'StoreManager' }, { value: 'super_admin', label: 'SuperAdmin' }]} />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>担当店舗</span>
          <DefaultSelect name="storeId" ariaLabel="担当店舗" defaultValue={member?.store_id ?? ''} options={[{ value: '', label: '全店舗' }, ...stores.map((s) => ({ value: s.id, label: s.name }))]} />
        </label>
        <Field label="LINE通知UID" name="lineUid" defaultValue={member?.line_uid ?? ''} />
        <Field label="Googleメール" name="googleEmail" type="email" defaultValue={member?.google_email ?? ''} />
      </div>
      <div className={styles.formActions}>
        {onCancel ? <Button type="button" onClick={onCancel}>キャンセル</Button> : null}
        <Button variant="primary" type="submit" disabled={busy}>{member ? '保存する' : '追加する'}</Button>
      </div>
    </form>
  )
}

function OrganizationBoard({ ctx }: { ctx: RestaurantV8Context }) {
  const { data, store, selectedStoreId, busy, mutate } = ctx
  const { accounts, selectedAccountId } = useAccount()
  const members = selectedStoreId ? data.memberships.filter((m) => !m.store_id || m.store_id === selectedStoreId) : data.memberships
  const [showStoreForm, setShowStoreForm] = useState(false)
  const [editingStoreId, setEditingStoreId] = useState('')
  const [showMemberForm, setShowMemberForm] = useState(false)
  const [editingMemberId, setEditingMemberId] = useState('')
  const [stopId, setStopId] = useState('')
  const editingMember = members.find((m) => m.id === editingMemberId)
  const editingStore = data.stores.find((s) => s.id === editingStoreId)
  const stopping = members.find((m) => m.id === stopId)
  const closeStoreDialog = useCallback(() => { setShowStoreForm(false); setEditingStoreId('') }, [])
  const closeMemberDialog = useCallback(() => { setShowMemberForm(false); setEditingMemberId('') }, [])
  const accountId = selectedAccountId || ''

  const submitStore = (id: string | null) => (form: FormData) => {
    const body = {
      name: String(form.get('name') || ''),
      code: String(form.get('code') || ''),
      area: String(form.get('area') || ''),
      capacity: Number(form.get('capacity')),
      lineAccountId: String(form.get('lineAccountId') || ''),
    }
    if (id) {
      void mutate(
        () => restaurantTestApi.updateStore(accountId, id, { ...body, status: String(form.get('status')) as RestaurantStore['status'] }),
        '店舗情報を更新しました。',
      ).then((ok) => { if (ok) setEditingStoreId('') })
    } else {
      void mutate(
        () => restaurantTestApi.createStore(accountId, { ...body, timezone: String(form.get('timezone') || 'Asia/Tokyo') }),
        '店舗を追加しました。',
      ).then((ok) => { if (ok) setShowStoreForm(false) })
    }
  }

  const submitMember = (id: string | null) => (form: FormData) => {
    const body = {
      storeId: form.get('storeId') || null,
      staffName: form.get('staffName'),
      email: form.get('email'),
      role: form.get('role'),
      lineUid: form.get('lineUid'),
      googleEmail: form.get('googleEmail'),
    }
    if (id) {
      void mutate(() => restaurantTestApi.updateMembership(accountId, id, body), '所属ユーザーを更新しました。ログイン権限は変わりません。')
        .then((ok) => { if (ok) setEditingMemberId('') })
    } else {
      void mutate(() => restaurantTestApi.createMembership(accountId, body), '飲食店向けの名簿へ追加しました。この登録だけではログイン権限は変わりません。')
        .then((ok) => { if (ok) setShowMemberForm(false) })
    }
  }

  return (
    <div className={styles.orgGrid}>
      <Panel title="組織階層">
        <p className={styles.cellSub}>統括: {data.organization?.tenant_name || '未設定'}</p>
        <div className={styles.orgRoot}>{data.organization?.name}</div>
        <div className={styles.orgChildren}>
          {data.stores.map((s) => (
            <div key={s.id} className={styles.orgStore}>
              <span className={styles.orgStoreName}>{s.name}</span>
              <Status value={s.status} />
            </div>
          ))}
        </div>
      </Panel>
      <div className={styles.orgMain}>
        <Panel
          title="店舗管理"
          description="1店舗につき1つのLINE公式アカウントを割り当てます。"
          aside={<Button size="compact" onClick={() => { setShowStoreForm(true); setEditingStoreId('') }}><Plus size={13} aria-hidden />店舗を追加する</Button>}
        >
          <div className={styles.storeList}>
            {data.stores.map((s) => (
              <StoreRow key={s.id} store={s} onEdit={() => { setEditingStoreId(s.id); setShowStoreForm(false) }} />
            ))}
          </div>
        </Panel>
        {/* 板 `vCEKM`（店舗の追加・編集の窓）。 */}
        <Dialog
          open={showStoreForm || editingStore !== undefined}
          designNode="vCEKM"
          title={editingStore ? `${editingStore.name}を編集` : '店舗を追加する'}
          onCancel={closeStoreDialog}
        >
          <StoreForm
            store={editingStore}
            accounts={accounts}
            stores={data.stores}
            busy={busy}
            onSubmit={submitStore(editingStore ? editingStore.id : null)}
            onCancel={closeStoreDialog}
          />
        </Dialog>
        <IntakeAddressPanel accountId={accountId} store={store} />
        <div className={styles.stats}>
          <Stat label="所属ユーザー" value={`${members.length}名`} note="名簿に載っている人数" />
          <Stat label="店舗管理者" value={`${members.filter((m) => m.role === 'store_manager').length}名`} note="名簿上の役割（操作権限は別）" />
          <Stat label="連携アカウント" value={`${members.filter((m) => m.line_uid || m.google_email).length}件`} note="LINE UID / Google" />
        </div>
        <Panel
          title="アカウント一覧"
          description="この一覧は名簿です。ここでの役割・担当店舗の登録だけではログイン権限は変わりません。実際の操作は、ログイン中のスタッフの役割（オーナー・管理者・スタッフ）で決まります。"
          aside={<Button variant="primary" size="compact" onClick={() => { setShowMemberForm(true); setEditingMemberId('') }}><Plus size={13} aria-hidden />ユーザーを追加する</Button>}
          flush
        >
          {/* 板 `ou60i`（飲食店向けユーザーの追加・変更の窓）。 */}
          <Dialog
            open={showMemberForm || editingMember !== undefined}
            designNode="ou60i"
            title={editingMember ? `${editingMember.staff_name}を変更` : '飲食店向けユーザーを追加'}
            onCancel={closeMemberDialog}
          >
            <MemberForm
              member={editingMember}
              stores={data.stores}
              busy={busy}
              onSubmit={submitMember(editingMember ? editingMember.id : null)}
              onCancel={closeMemberDialog}
            />
          </Dialog>
          <DataTable className="rounded-none border-0">
            <thead>
              <TableHeadRow>
                <Th>氏名</Th>
                <Th>役割</Th>
                <Th>担当店舗</Th>
                <Th>連携（LINE・Google）</Th>
                <Th>状態</Th>
                <Th>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {members.map((m) => (
                <Tr key={m.id}>
                  <Td>
                    <span className={styles.cellName}>{m.staff_name}</span>
                    <p className={styles.cellSub}>{m.email || 'メール未設定'}</p>
                  </Td>
                  <Td>{roleLabel[m.role]}</Td>
                  <Td>{data.stores.find((s) => s.id === m.store_id)?.name || '全店舗'}</Td>
                  <Td>
                    <p className={m.line_uid ? styles.linked : styles.cellSub}>LINE {m.line_uid ? '設定済' : '未設定'}</p>
                    <p className={styles.cellSub}>{m.google_email || 'Google 未設定'}</p>
                  </Td>
                  <Td><Status value={m.status} /></Td>
                  <Td>
                    <div className={styles.rowActions}>
                      <Button size="compact" disabled={busy} onClick={() => { setEditingMemberId(m.id); setShowMemberForm(false) }}>変更</Button>
                      {m.status === 'suspended' ? (
                        <Button size="compact" disabled={busy} onClick={() => void mutate(() => restaurantTestApi.updateMembership(accountId, m.id, { status: 'active' }), '再開しました。')}>再開</Button>
                      ) : (
                        <Button size="compact" disabled={busy} onClick={() => setStopId(m.id)}>停止</Button>
                      )}
                    </div>
                  </Td>
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
        <ConfirmDialog
          open={Boolean(stopping)}
          designNode="bMpC5"
          title="この所属ユーザーを停止しますか？"
          description="名簿には残り、再開できます。この名簿だけではログイン権限は変わりません。"
          confirmLabel="停止する"
          busy={busy}
          onCancel={() => setStopId('')}
          onConfirm={() => { if (stopping) void mutate(() => restaurantTestApi.updateMembership(accountId, stopping.id, { status: 'suspended' }), '停止しました。').then(() => setStopId('')) }}
        />
        <Panel title="権限マトリクス" description="想定の役割分担です。実際の操作可否は、ログイン中のスタッフの役割（オーナー・管理者・スタッフ）で決まります。" flush>
          <DataTable className="rounded-none border-0">
            <thead>
              <TableHeadRow>
                <Th>操作</Th>
                <Th align="center">SuperAdmin</Th>
                <Th align="center">StoreManager</Th>
                <Th align="center">Staff</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {([
                ['全店閲覧・契約設定', true, false, false],
                ['担当店舗の設定・承認', true, true, false],
                ['予約入力・配席', true, true, true],
                ['Google/LINE公開承認', true, true, false],
              ] as [string, boolean, boolean, boolean][]).map(([label, ...values]) => (
                <Tr key={label}>
                  <Td>{label}</Td>
                  {values.map((v, i) => (
                    <Td key={i} align="center">{v ? <span className={styles.matrixYes}>✓</span> : <span className={styles.matrixNo}>—</span>}</Td>
                  ))}
                </Tr>
              ))}
            </tbody>
          </DataTable>
        </Panel>
      </div>
    </div>
  )
}

export default function OrganizationV8() {
  return (
    <RestaurantShell
      boardId="bSp4h"
      title="組織・権限"
      description="本部・店舗・スタッフの閲覧範囲と承認権限を管理します。"
    >
      {(ctx) => <OrganizationBoard ctx={ctx} />}
    </RestaurantShell>
  )
}
