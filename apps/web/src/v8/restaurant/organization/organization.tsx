'use client'

/*
 * ★V8 組織・権限（Pencil `bSp4h`、店舗の窓 `vCEKM`、ユーザーの窓 `ou60i`、停止の確認 `bMpC5`、再発行の確認 `rSRFK`）。
 *
 * 左に組織階層（幅280）、右に 店舗管理 → 予約メール取り込みアドレス → 数3 →
 * アカウント一覧 → 権限マトリクス。口は今の画面と同じ。
 * ログインとの連携（今の画面では表の中の選ぶ欄）は、絵の行に場所が無いので
 * 「変更」の窓の中へ移した（機能は落とさない）。
 * 閲覧のみ（変える権限が無い人）には、作る・編集・停止・発行のボタンを置かない。動きは BEHAVIOR.md。
 */
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import { Copy, Eye, MailPlus, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { useStepUpGate, isStepUpRequired } from '@/components/step-up-prompt'
import type { RestaurantLoginMember } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import {
  restaurantTestApi,
  type RestaurantIntakeAddress,
  type RestaurantMembership,
  type RestaurantStore,
} from '@/lib/restaurant-test-api'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import RestaurantFrame, { type RestaurantContext } from '../common-a/frame'
import { formatStamp, Panel, Stat, StatRow, Status } from '../common-a/parts'
import styles from './organization.module.css'

const roleLabel: Record<RestaurantMembership['role'], string> = {
  super_admin: 'SuperAdmin',
  store_manager: 'StoreManager',
  staff: 'Staff',
}

const MATRIX: [string, boolean, boolean, boolean][] = [
  ['全店閲覧・契約設定', true, false, false],
  ['担当店舗の設定・承認', true, true, false],
  ['予約入力・配席', true, true, true],
  ['Google/LINE公開承認', true, true, false],
]

function intakeAddressError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return '取り込み用ドメインが未設定です'
  if (error instanceof ApiError && error.status === 403) return '取り込みアドレスはオーナーまたは管理者だけが確認できます。'
  return '取り込みアドレスを読み込めませんでした。'
}

function loginSummary(member: RestaurantMembership): string {
  if (!member.staff_id) return 'ログイン未連携'
  const role = member.loginRole === 'owner' ? 'オーナー' : member.loginRole === 'admin' ? '管理者' : 'スタッフ'
  const scope = member.loginAccountScope === 'all' ? '全アカウント' : '担当アカウントのみ'
  return `${member.loginName || 'ログインメンバー'}・${role}${member.loginAccessLevel === 'read_only' ? '（閲覧のみ）' : ''}・${scope}・版 ${member.loginPolicyVersion ?? '—'}`
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
      <TextField name={name} type={type} defaultValue={defaultValue} required={required} />
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
  return <Select name={name} aria-label={ariaLabel} value={value} onChange={setValue} size="full" options={options} />
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

/** 店舗の追加・編集（窓 vCEKM）。 */
function StoreForm({ store, accounts, stores, busy, onSubmit, onCancel }: {
  store?: RestaurantStore
  accounts: AccountWithStats[]
  stores: RestaurantStore[]
  busy: boolean
  onSubmit: (form: FormData) => void
  onCancel: () => void
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <form key={store?.id ?? 'new'} onSubmit={submit} className={styles.form}>
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
        <Button type="button" onClick={onCancel}>キャンセル</Button>
        <Button variant="primary" type="submit" disabled={busy}>{store ? '保存する' : '店舗を登録する'}</Button>
      </div>
    </form>
  )
}

/** 予約メール取り込みアドレス（今の画面と同じ口：一覧・発行・再発行の確認・コピー）。 */
function IntakeAddressPanel({ accountId, store, readOnly }: { accountId: string; store: RestaurantStore | null; readOnly: boolean }) {
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
    if (!accountId || !storeId) { setAddresses([]); setError(''); return }
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
      <div className={styles.intakeBody}>
      <p className={styles.intakeWarning}>このアドレスは予約メールの専用受信口です。第三者へ共有せず、予約媒体の通知設定だけに使用してください。</p>
      {notice ? <p className={styles.intakeNotice} role="status">{notice}</p> : null}
      {actionError ? <p className={styles.intakeError} role="alert">{actionError}</p> : null}
      {!store ? (
        <p className={styles.muted}>上部の店舗選択から、設定する店舗を選んでください。</p>
      ) : loading ? (
        <p className={styles.muted}>取り込みアドレスを確認中…</p>
      ) : error ? (
        <p className={styles.intakeError}>{error}</p>
      ) : addresses.length === 0 ? (
        <p className={styles.intakeEmpty}>未発行</p>
      ) : (
        addresses.map((item) => (
          <div key={item.id} className={styles.intakeCard}>
            <div className={styles.intakeCardHead}>
              <span className={styles.intakeState}>{item.revokedAt ? `${formatStamp(item.revokedAt)}まで有効` : '現在使用中'}</span>
              <span className={styles.spacer} aria-hidden="true" />
              <Status value={item.status} />
            </div>
            <div className={styles.intakeRow}>
              <TextField aria-label={`${store.name}の取り込みアドレス`} readOnly value={item.address} className={styles.intakeAddress} />
              <Button onClick={() => void copy(item)}><Copy aria-hidden className={styles.buttonIcon} />{copiedId === item.id ? 'コピー済み' : 'コピー'}</Button>
            </div>
            <p className={styles.intakeMeta}>{`発行日時：${formatStamp(item.createdAt)}`}</p>
          </div>
        ))
      )}
      {store && !error && !readOnly ? (
        <div className={styles.intakeFoot}>
          <Button disabled={issuing || loading} onClick={() => { if (addresses.length > 0) setReissueOpen(true); else void issue() }}>
            <MailPlus aria-hidden className={styles.buttonIcon} />{issuing ? '発行中…' : 'アドレスを発行'}
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
      </div>
    </Panel>
  )
}

/** ログインとの連携（窓 ou60i の中。今の画面では表の中にあった）。 */
function LoginConnection({ member, logins, busy, save }: { member: RestaurantMembership; logins: RestaurantLoginMember[]; busy: boolean; save: (id: string | null) => void }) {
  const [selected, setSelected] = useState(member.staff_id || '')
  useEffect(() => setSelected(member.staff_id || ''), [member.staff_id])
  return (
    <div className={styles.loginBox}>
      <span className={styles.fieldLabel}>ログインとの連携</span>
      <p className={styles.muted}>{loginSummary(member)}</p>
      {logins.length ? (
        <div className={styles.loginRow}>
          <Select aria-label={`${member.staff_name}のログインメンバー`} value={selected} onChange={setSelected} size="full" options={[{ value: '', label: '連携しない' }, ...logins.map((l) => ({ value: l.id, label: l.name }))]} />
          <Button disabled={busy || selected === (member.staff_id || '')} onClick={() => save(selected || null)}>ログインと連携</Button>
        </div>
      ) : null}
    </div>
  )
}

/** ユーザーの追加・変更（窓 ou60i）。 */
function MemberForm({ member, stores, busy, onSubmit, onCancel, login }: {
  member?: RestaurantMembership
  stores: RestaurantStore[]
  busy: boolean
  onSubmit: (form: FormData) => void
  onCancel: () => void
  login?: ReactNode
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    onSubmit(new FormData(event.currentTarget))
  }
  return (
    <form key={member?.id ?? 'new'} onSubmit={submit} className={styles.form}>
      <div className={`${styles.formGrid} ${styles.memberGrid}`}>
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
      {login}
      <div className={`${styles.formActions} ${styles.memberActions}`}>
        <Button type="button" onClick={onCancel}>キャンセル</Button>
        <Button variant="primary" type="submit" disabled={busy}>{member ? null : <Plus aria-hidden className={styles.buttonIcon} />}{member ? '保存する' : '追加する'}</Button>
      </div>
    </form>
  )
}

function OrganizationBoard({ ctx }: { ctx: RestaurantContext }) {
  const { data, store, selectedStoreId, busy, mutate } = ctx
  const { accounts, selectedAccountId } = useAccount()
  const role = useStaffRole()
  const readOnly = role !== null && !canManageRole(role)
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
  const { gate, prompt, cancel } = useStepUpGate()
  const [logins, setLogins] = useState<RestaurantLoginMember[]>([])
  useEffect(() => {
    let current = true
    setLogins([])
    if (accountId) void restaurantTestApi.loginMembers(accountId).then((res) => { if (current) setLogins(res.data) }).catch(() => { if (current) setLogins([]) })
    return () => { current = false; cancel() }
  }, [accountId, cancel])

  /* 役割・停止の変更は本人確認（step-up）を挟むことがある（今の画面と同じ）。 */
  const updateMember = async (id: string, body: Record<string, unknown>) => {
    const member = members.find((m) => m.id === id)
    const request = { ...body, expectedPolicyVersion: member?.loginPolicyVersion, idempotencyKey: crypto.randomUUID() }
    try { return await restaurantTestApi.updateMembership(accountId, id, request) }
    catch (error) {
      if (!isStepUpRequired(error)) throw error
      const token = await gate('staff.permissions.change', '店の役割とログイン権限を変更する')
      if (!token) throw new Error('本人確認を中止しました。変更は保存されていません。')
      return restaurantTestApi.updateMembership(accountId, id, request, token)
    }
  }

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
      void mutate(() => updateMember(id, body), members.find((m) => m.id === id)?.staff_id ? '所属ユーザーとログイン権限を更新しました。' : '所属ユーザーを更新しました。')
        .then((ok) => { if (ok) setEditingMemberId('') })
    } else {
      void mutate(() => restaurantTestApi.createMembership(accountId, body), '飲食店向けの名簿へ追加しました。この登録だけではログイン権限は変わりません。')
        .then((ok) => { if (ok) setShowMemberForm(false) })
    }
  }

  return (
    <>
      {readOnly ? (
        <div className={styles.readOnly} role="note"><Eye aria-hidden className={styles.readOnlyIcon} /><span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span></div>
      ) : null}
      <div className={styles.layout}>
        {prompt}
        <Panel title="組織階層" narrow flush>
          <div className={styles.treeBody}>
          <p className={styles.treeTenant}>{`統括：${data.organization?.tenant_name || '未設定'}`}</p>
          <p className={styles.treeRoot}>{data.organization?.name}</p>
          <div className={styles.treeChildren}>
            {data.stores.map((s) => (
              <div key={s.id} className={styles.treeStore}>
                <span className={styles.treeStoreName}>{s.name}</span>
                <span className={styles.spacer} aria-hidden="true" />
                <Status value={s.status} />
              </div>
            ))}
          </div>
          </div>
        </Panel>
        <div className={styles.main}>
          <Panel
            title="店舗管理"
            description="1店舗につき1つのLINE公式アカウントを割り当てます。"
            aside={readOnly ? null : <Button onClick={() => { setShowStoreForm(true); setEditingStoreId('') }}><Plus aria-hidden className={styles.buttonIcon} />店舗を追加する</Button>}
            flush
          >
            {data.stores.map((s) => (
              <div key={s.id} className={styles.storeRow}>
                <div className={styles.storeText}>
                  <p className={styles.storeName}><span>{s.name}</span><Status value={s.status} /></p>
                  <p className={styles.storeSub}>{`${s.code} · ${s.area || 'エリア未設定'} · ${s.capacity}席`}</p>
                  <p className={styles.storeLine}>{`LINE: ${s.line_account_name ? `${s.line_account_name} 公式` : '未設定'}`}</p>
                </div>
                {readOnly ? null : <Button onClick={() => { setEditingStoreId(s.id); setShowStoreForm(false) }}>編集</Button>}
              </div>
            ))}
          </Panel>
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
          <IntakeAddressPanel accountId={accountId} store={store} readOnly={readOnly} />
          <StatRow>
            <Stat label="所属ユーザー" value={`${members.length}名`} note="名簿に載っている人数" />
            <Stat label="店舗管理者" value={`${members.filter((m) => m.role === 'store_manager').length}名`} note="名簿上の役割（操作権限は別）" />
            <Stat label="連携アカウント" value={`${members.filter((m) => m.line_uid || m.google_email).length}件`} note="LINE UID / Google" />
          </StatRow>
          <Panel
            title="アカウント一覧"
            description="この一覧は名簿です。ここでの役割・担当店舗の登録だけではログイン権限は変わりません。"
            aside={readOnly ? null : <Button variant="primary" onClick={() => { setShowMemberForm(true); setEditingMemberId('') }}><Plus aria-hidden className={styles.buttonIcon} />ユーザーを追加する</Button>}
            flush
          >
            <div role="table" aria-label="アカウント一覧" className={styles.table}>
              <div role="row" className={styles.headRow}>
                <span role="columnheader" className={`${styles.cell} ${styles.colName}`}>氏名</span>
                <span role="columnheader" className={`${styles.cell} ${styles.colRole}`}>役割</span>
                <span role="columnheader" className={`${styles.cell} ${styles.colRole}`}>担当店舗</span>
                <span role="columnheader" className={`${styles.cell} ${styles.colLink}`}>連携（LINE・Google）</span>
                <span role="columnheader" className={`${styles.cell} ${styles.colState}`}>状態</span>
                <span role="columnheader" className={`${styles.cell} ${styles.colOps}`}><span className="sr-only">操作</span></span>
              </div>
              {members.map((m) => (
                <div key={m.id} role="row" className={styles.row}>
                  <span role="cell" className={`${styles.cell} ${styles.colName}`} title={loginSummary(m)}>
                    <span className={styles.memberName}>{m.staff_name}</span>
                    <span className={styles.sub}>{m.email || 'メール未設定'}</span>
                  </span>
                  <span role="cell" className={`${styles.cell} ${styles.colRole}`}>{roleLabel[m.role]}</span>
                  <span role="cell" className={`${styles.cell} ${styles.colRole}`}>{data.stores.find((s) => s.id === m.store_id)?.name || '全店舗'}</span>
                  <span role="cell" className={`${styles.cell} ${styles.colLink}`}>
                    <span className={styles.linkMain}>{`LINE ${m.line_uid ? '設定済' : '未設定'}`}</span>
                    <span className={styles.sub}>{m.google_email || 'Google 未設定'}</span>
                  </span>
                  <span role="cell" className={`${styles.cell} ${styles.colState}`}><Status value={m.status} /></span>
                  <span role="cell" className={`${styles.cell} ${styles.colOps}`}>
                    {readOnly ? null : (
                      <span className={styles.ops}>
                        <Button disabled={busy} onClick={() => { setEditingMemberId(m.id); setShowMemberForm(false) }}>変更</Button>
                        {m.status === 'suspended' ? (
                          <Button disabled={busy} onClick={() => void mutate(() => updateMember(m.id, { status: 'active' }), '再開しました。')}>再開</Button>
                        ) : (
                          <Button disabled={busy} onClick={() => setStopId(m.id)}>停止</Button>
                        )}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </Panel>
          <Dialog
            open={showMemberForm || editingMember !== undefined}
            designNode="ou60i"
            designWidth={560}
            designTop={140}
            designHeaderPadding="24px 24px 0"
            designHeaderHeight={50}
            title={editingMember ? `${editingMember.staff_name}を変更` : '飲食店向けユーザーを追加'}
            onCancel={closeMemberDialog}
          >
            <MemberForm
              member={editingMember}
              stores={data.stores}
              busy={busy}
              onSubmit={submitMember(editingMember ? editingMember.id : null)}
              onCancel={closeMemberDialog}
              login={editingMember ? (
                <LoginConnection
                  member={editingMember}
                  logins={logins}
                  busy={busy}
                  save={(staffId) => void mutate(() => restaurantTestApi.linkMembershipLogin(accountId, editingMember.id, staffId), 'ログインメンバーとの連携を保存しました。')}
                />
              ) : null}
            />
          </Dialog>
          <Dialog
            open={Boolean(stopping)}
            designNode="bMpC5"
            designWidth={480}
            designTop={300}
            title="この所属ユーザーを停止しますか？"
            designHeaderPadding="24px 24px 0"
            designHeaderHeight={50}
            busy={busy}
            onCancel={() => setStopId('')}
            footer={<></>}
          >
            {/* 絵（bMpC5）：だれを止めるか（役割・担当店舗）と、名簿の停止はログインを変えないこと（受け口も名簿だけを変える）。 */}
            {stopping ? (
              <div className={styles.stopBody}>
                <p className={styles.stopWho}>{`${stopping.staff_name}（${roleLabel[stopping.role]}・${data.stores.find((s) => s.id === stopping.store_id)?.name || '全店舗'}）`}</p>
                <p className={styles.stopNote}>名簿には残り、再開できます。ログインの権限は変わりません。</p>
                <div className={styles.stopActions}>
                  <Button onClick={() => setStopId('')} disabled={busy}>キャンセル</Button>
                  <Button variant="danger" busy={busy} busyLabel="処理中…" disabled={busy} onClick={() => { if (stopping) void mutate(() => updateMember(stopping.id, { status: 'suspended' }), '停止しました。').then(() => setStopId('')) }}>停止する</Button>
                </div>
              </div>
            ) : null}
          </Dialog>
          <Panel title="権限マトリクス" description="想定の役割分担です。実際の操作可否は、ログイン中のスタッフの役割（オーナー・管理者・スタッフ）で決まります。" flush>
            <div role="table" aria-label="権限マトリクス" className={styles.table}>
              <div role="row" className={styles.headRow}>
                <span role="columnheader" className={`${styles.cell} ${styles.colName}`}>操作</span>
                {['SuperAdmin', 'StoreManager', 'Staff'].map((label) => <span key={label} role="columnheader" className={`${styles.cell} ${styles.colMatrix}`}>{label}</span>)}
              </div>
              {MATRIX.map(([label, ...values]) => (
                <div key={label} role="row" className={styles.row}>
                  <span role="cell" className={`${styles.cell} ${styles.colName}`}>{label}</span>
                  {values.map((v, i) => (
                    <span key={i} role="cell" className={`${styles.cell} ${styles.colMatrix}`}>
                      {v ? <span className={styles.matrixYes} aria-label="できる">✓</span> : <span className={styles.matrixNo} aria-label="できない">—</span>}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  )
}

export default function OrganizationV8() {
  return (
    <RestaurantFrame
      boardId="bSp4h"
      title="組織・権限"
      description="本部・店舗・スタッフの閲覧範囲と承認権限を管理します。"
    >
      {(ctx) => <OrganizationBoard ctx={ctx} />}
    </RestaurantFrame>
  )
}
