'use client'


import ReadOnlyNotice from '@/components/shared/read-only-notice'
import { Field as SharedField } from '@/components/shared/form-controls'
import CopyTextButton from '@/components/shared/copy-text-button'
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from 'react'
import KpiCard from '@/components/shared/kpi-card'
import { Check, MailPlus, Plus } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import Disclosure from '@/components/shared/disclosure'
import { RowActions } from '@/components/shared/row-actions'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { useStepUpGate, isStepUpRequired } from '@/components/step-up-prompt'
import type { RestaurantLoginMember } from '@line-crm/shared'
import { ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { restaurantTestApi, type RestaurantIntakeAddress, type RestaurantMembership, type RestaurantStore } from '@/lib/restaurant-test-api'
import { useAccount, type AccountWithStats } from '@/contexts/account-context'
import RestaurantFrame, { type RestaurantContext } from '../common-a/frame'
import { formatStamp, Panel, StatRow, Status } from '../common-a/parts'
import styles from './organization.module.css'
import { permissionDeniedMessage } from '@/components/shared/api-error-message'
import { emptyValue } from '@/components/shared/empty-value'
import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'
import EntitySelect, { entityOptionMetadata } from '@/components/shared/entity-select'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Card from '@/components/shared/card'
import { GridTable, GridHeadRow, GridRow, GridCell, type GridTableDesign } from '@/components/shared/grid-table'
import TruncatedText from '@/components/shared/truncated-text'
import StoreGroups from './store-groups'

/*
 * ★V8 組織・権限（Pencil `bSp4h`、店舗の窓 `vCEKM`、ユーザーの窓 `ou60i`、停止の確認 `bMpC5`、再発行の確認 `rSRFK`）。
 *
 * 左に組織階層（幅280）、右に 店舗管理 → 予約メール取り込みアドレス → 数3 →
 * アカウント一覧 → 権限マトリクス。口は今の画面と同じ。
 * ログインとの連携（今の画面では表の中の選ぶ欄）は、絵の行に場所が無いので
 * 「変更」の窓の中へ移した（機能は落とさない）。
 * 閲覧のみ（変える権限が無い人）には、作る・編集・停止・発行のボタンを置かない。動きは BEHAVIOR.md。
 */

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

const tableDesign: Omit<GridTableDesign, 'columns'> = {
  gap: 'var(--polish-space-card)',
  rowPadding: '0 var(--tpl-list-inset)',
  headHeight: 'var(--polish-table-head)',
  rowHeight: 'var(--polish-table-row)',
  fontSize: 'var(--polish-text-body)',
}

function intakeAddressError(error: unknown): string {
  if (error instanceof ApiError && error.status === 503) return '取り込み用ドメインが未設定です'
  if (error instanceof ApiError && error.status === 403) return permissionDeniedMessage('store')
  return '取り込みアドレスを読み込めませんでした。'
}

function loginSummary(member: RestaurantMembership): string {
  if (!member.staff_id) return 'ログイン未連携'
  const role = member.loginRole === 'owner' ? 'オーナー' : member.loginRole === 'admin' ? '管理者' : 'スタッフ'
  const scope = member.loginAccountScope === 'all' ? '全アカウント' : '担当アカウントのみ'
  return `${member.loginName || 'ログインメンバー'}・${role}${member.loginAccessLevel === 'read_only' ? '（閲覧のみ）' : ''}・${scope}・版 ${member.loginPolicyVersion ?? emptyValue('unknown')}`
}

function Field({ label, name, type = 'text', defaultValue, required = false }: { label: string; name: string; type?: string; defaultValue?: string; required?: boolean }) {
  return <SharedField label={label} required={required}><TextField name={name} type={type} defaultValue={defaultValue} required={required} /></SharedField>
}

function DefaultSelect({ name, ariaLabel, defaultValue, options }: {
  name: string
  ariaLabel: string
  defaultValue: string
  options: { value: string; label: string; disabled?: boolean }[]
}) {
  const [value, setValue] = useState(defaultValue)
  return <SaveErrorField names={["value"]}><Select name={name} aria-label={ariaLabel} value={value} onChange={setValue} size="full" options={options} /></SaveErrorField>
}

function StoreLineAccountSelect({ accounts, stores, currentStore }: {
  accounts: AccountWithStats[]
  stores: RestaurantStore[]
  currentStore?: RestaurantStore
}) {
  const usedByAccount = new Map(stores.filter((item) => item.line_account_id).map((item) => [item.line_account_id!, item.id]))
  return (
    <SharedField label={<><span className={styles.fieldLabel}>LINE公式アカウント<span className={styles.fieldRequired}> *</span></span></>}><DefaultSelect
        name="lineAccountId"
        ariaLabel="LINE公式アカウント"
        defaultValue={currentStore?.line_account_id || ''}
        options={[{ value: '', label: '選択してください' }, ...accounts.map((account) => {
          const usedStoreId = usedByAccount.get(account.id)
          const usedElsewhere = Boolean(usedStoreId && usedStoreId !== currentStore?.id)
          return { value: account.id, label: `${account.displayName || account.name}${usedElsewhere ? '（他店舗で使用中）' : ''}`, disabled: usedElsewhere }
        })]}
      /></SharedField>
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
        <div className={styles.field}><span className={styles.fieldLabel}>タイムゾーン</span><span>日本時間（Asia/Tokyo）</span><SaveErrorField names={["timezone"]}><input type="hidden" name="timezone" value="Asia/Tokyo" /></SaveErrorField></div>
        {store ? (
          <SharedField label={<><span className={styles.fieldLabel}>状態</span></>}><DefaultSelect name="status" ariaLabel="状態" defaultValue={store.status} options={[{ value: 'active', label: '有効' }, { value: 'paused', label: '停止中' }, { value: 'archived', label: 'アーカイブ' }]} /></SharedField>
        ) : null}
        <StoreLineAccountSelect accounts={accounts} stores={stores} currentStore={store} />
      </div>
      <div className={styles.formActions}>
        <Button type="button" disabled={busy} onClick={onCancel}>キャンセル</Button>
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

  return (
    <Panel title="予約メール取り込みアドレス" description="予約媒体から届く通知メールの転送先として設定します。">
      <div className={styles.intakeBody}>
      <Notice tone="warn">このアドレスは予約メールの専用受信口です。第三者へ共有せず、予約媒体の通知設定だけに使用してください。</Notice>
      {notice ? <Notice tone="success" role="status">{notice}</Notice> : null}
      {actionError ? <Notice tone="danger" className={styles.intakeErrorNoticePlacement} >{actionError}</Notice> : null}
      {!store ? (
        <p className={styles.muted}>上部の店舗選択から、設定する店舗を選んでください。</p>
      ) : loading ? (
        <p className={styles.muted}>取り込みアドレスを確認中…</p>
      ) : error ? (
        <p className={styles.intakeError}>{error}</p>
      ) : addresses.length === 0 ? (
        <Notice tone="info">{emptyValue('unconfigured')}</Notice>
      ) : (
        addresses.map((item, saveFieldIndex) => (
          <Card key={item.id} surface="muted" padding="compact" layout="vertical" gap="var(--polish-space-row)">
            <div className={styles.intakeCardHead}>
              <span className={styles.intakeState}>{item.revokedAt ? `${formatStamp(item.revokedAt)}まで有効` : '現在使用中'}</span>
              <span className={styles.spacer} aria-hidden="true" />
              <Status value={item.status} />
            </div>
            <div className={styles.intakeRow}>
              <SaveErrorField names={[`addresses.${saveFieldIndex}.address`,"address","item.address"]}><TextField aria-label={`${store.name}の取り込みアドレス`} readOnly value={item.address} className={styles.intakeAddress} /></SaveErrorField>
              <CopyTextButton value={item.address} aria-label="メールアドレスをコピー"  />
            </div>
            <p className={styles.intakeMeta}>{`発行日時：${formatStamp(item.createdAt)}`}</p>
          </Card>
        ))
      )}
      {store && !error && !readOnly ? (
        <div className={styles.intakeFoot}>
          <Button disabled={issuing || loading} onClick={() => { if (addresses.length > 0) setReissueOpen(true); else void issue() }} busy={issuing} busyLabel="発行中…">
            <MailPlus aria-hidden className={styles.buttonIcon} />アドレスを発行
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
        onConfirm={() => issue()}
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
          <SaveErrorField names={["selected"]}><EntitySelect aria-label={`${member.staff_name}のログインメンバー`} value={selected} onChange={setSelected} size="full" options={[{ value: '', label: '連携しない' }, ...logins.map((l) => ({ ...entityOptionMetadata(l), value: l.id, label: l.name }))]} /></SaveErrorField>
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
        <SharedField label={<><span className={styles.fieldLabel}>役割</span></>}><DefaultSelect name="role" ariaLabel="役割" defaultValue={member?.role ?? 'staff'} options={[{ value: 'staff', label: 'Staff' }, { value: 'store_manager', label: 'StoreManager' }, { value: 'super_admin', label: 'SuperAdmin' }]} /></SharedField>
        <SharedField label={<><span className={styles.fieldLabel}>担当店舗</span></>}><DefaultSelect name="storeId" ariaLabel="担当店舗" defaultValue={member?.store_id ?? ''} options={[{ value: '', label: '全店舗' }, ...stores.map((s) => ({ value: s.id, label: s.name }))]} /></SharedField>
        <Field label="LINE通知UID" name="lineUid" defaultValue={member?.line_uid ?? ''} />
        <Field label="Googleメール" name="googleEmail" type="email" defaultValue={member?.google_email ?? ''} />
      </div>
      {login}
      <div className={`${styles.formActions} ${styles.memberActions}`}>
        <Button type="button" disabled={busy} onClick={onCancel}>キャンセル</Button>
        <Button variant="primary" type="submit" disabled={busy}>{member ? null : <Plus aria-hidden className={styles.buttonIcon} />}{member ? '保存する' : '追加する'}</Button>
      </div>
    </form>
  )
}

function OrganizationBoard({ ctx }: { ctx: RestaurantContext }) {
  const saveErrors = useSaveFormErrors()

  const { data, store, selectedStoreId, busy, mutate } = ctx
  const { accounts, selectedAccountId } = useAccount()
  const role = useStaffRole()
  const readOnly = !canManageRole(role)
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
  const [loginsError,setLoginsError]=useState(false)
  const [loginsRetry,setLoginsRetry]=useState(0)
  const [logins, setLogins] = useState<RestaurantLoginMember[]>([])
  useEffect(() => {
    let current = true
    setLogins([])
    if (accountId) void restaurantTestApi.loginMembers(accountId).then((res) => { if (current) {setLogins(res.data);setLoginsError(false)} }).catch(() => { if (current) setLoginsError(true) })
    return () => { current = false; cancel() }
  }, [accountId, cancel,loginsRetry])

  /* 役割・停止の変更は本人確認（step-up）を挟むことがある（今の画面と同じ）。 */
  const updateMember = async (id: string, body: Record<string, unknown>) => {
    const member = members.find((m) => m.id === id)
    const request = { ...body, expectedPolicyVersion: member?.loginPolicyVersion, idempotencyKey: crypto.randomUUID() }
    try { return await restaurantTestApi.updateMembership(accountId, id, request) }
    catch (error) {
      saveErrors.capture(error);

      if (!isStepUpRequired(error)) throw error
      const token = await gate('staff.permissions.change', '店の役割とログイン権限を変更する');

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

  const organizationTree = (
    <div className={styles.treeBody}>
      <p className={styles.treeTenant}>{`統括：${data.organization?.tenant_name || emptyValue('unconfigured')}`}</p>
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
  )

  return (
    <SaveErrorScope errors={saveErrors}><>
      {loginsError?<ListState kind="error" title="ログインメンバーを読み込めませんでした" onRetry={()=>setLoginsRetry(n=>n+1)}/>:null}
      {readOnly ? (
        <ReadOnlyNotice role="note" />
      ) : null}
      <div className={styles.layout}>
        {prompt}
        <div className={styles.tree}>
          <div className={styles.treeExpanded}>
            <Panel title="組織階層" flush>{organizationTree}</Panel>
          </div>
          <Disclosure className={styles.treeCollapsed} title="組織階層" hint={`${data.stores.length} 店舗`}>
            {organizationTree}
          </Disclosure>
        </div>
        <div className={styles.main}>
          <Panel
            title="店舗管理"
            description="1店舗につき1つのLINE公式アカウントを割り当てます。"
            aside={readOnly ? null : <Button onClick={() => { setShowStoreForm(true); setEditingStoreId('') }}><Plus aria-hidden className={styles.buttonIcon} />店舗を追加する</Button>}
            flush
          >
            <GridTable label="店舗管理" framed={false} design={{ ...tableDesign, columns: 'minmax(0, 1fr) max-content max-content' }}>
              {data.stores.map((s) => (
                <GridRow key={s.id}>
                  <GridCell className={styles.storeText}>
                    <TruncatedText value={s.name} className={styles.memberName} />
                    <TruncatedText value={`${s.code} · ${s.area || 'エリア未設定'} · ${s.capacity}席`} className={styles.sub} />
                    <TruncatedText value={`LINE: ${s.line_account_name ? `${s.line_account_name} 公式` : emptyValue('unconfigured')}`} className={styles.sub} />
                  </GridCell>
                  <GridCell><Status value={s.status} /></GridCell>
                  <GridCell align="right">
                    {readOnly ? null : <RowActions subjectName={s.name} edit={{ onClick: () => { setEditingStoreId(s.id); setShowStoreForm(false) } }} />}
                  </GridCell>
                </GridRow>
              ))}
            </GridTable>
          </Panel>
          <Dialog
            open={showStoreForm || editingStore !== undefined}
            busy={busy}
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
          <StoreGroups key={accountId} accountId={accountId} stores={data.stores} readOnly={readOnly} />
          <IntakeAddressPanel accountId={accountId} store={store} readOnly={readOnly} />
          <StatRow>
            <KpiCard title="所属ユーザー" valueText={`${members.length}名`} detail="名簿に載っている人数" icon={null} presentation="band" value={null} unit="" />
            <KpiCard title="店舗管理者" valueText={`${members.filter((m) => m.role === 'store_manager').length}名`} detail="名簿上の役割（操作権限は別）" icon={null} presentation="band" value={null} unit="" />
            <KpiCard title="連携アカウント" valueText={`${members.filter((m) => m.line_uid || m.google_email).length}件`} detail="LINE UID / Google" icon={null} presentation="band" value={null} unit="" />
          </StatRow>
          <Panel
            title="アカウント一覧"
            description="この一覧は名簿です。ここでの役割・担当店舗の登録だけではログイン権限は変わりません。"
            aside={readOnly ? null : <Button variant="primary" onClick={() => { setShowMemberForm(true); setEditingMemberId('') }}><Plus aria-hidden className={styles.buttonIcon} />ユーザーを追加する</Button>}
            flush
          >
            <GridTable label="アカウント一覧" framed={false} design={{ ...tableDesign, columns: 'minmax(0, 2fr) var(--tpl-rt-col-100) minmax(0, 1fr) minmax(0, 1.5fr) var(--tpl-rt-col-80) var(--tpl-rt-col-130)' }}>
              <GridHeadRow>
                <GridCell role="columnheader">氏名</GridCell>
                <GridCell role="columnheader">役割</GridCell>
                <GridCell role="columnheader">担当店舗</GridCell>
                <GridCell role="columnheader">連携（LINE・Google）</GridCell>
                <GridCell role="columnheader">状態</GridCell>
                <GridCell role="columnheader"><span className="sr-only">操作</span></GridCell>
              </GridHeadRow>
              {members.map((m) => (
                <GridRow key={m.id}>
                  <GridCell className={styles.memberText} title={loginSummary(m)}>
                    <TruncatedText className={styles.memberName} value={m.staff_name} />
                    <TruncatedText className={styles.sub} value={m.email || emptyValue('unconfigured')} />
                  </GridCell>
                  <GridCell className={styles.shortText}>{roleLabel[m.role]}</GridCell>
                  <GridCell><TruncatedText value={data.stores.find((s) => s.id === m.store_id)?.name || '全店舗'} /></GridCell>
                  <GridCell className={styles.memberText}>
                    <span className={styles.shortText}>{`LINE ${m.line_uid ? '設定済' : emptyValue('unconfigured')}`}</span>
                    <TruncatedText className={styles.sub} value={m.google_email || 'Google 未設定'} />
                  </GridCell>
                  <GridCell><Status value={m.status} /></GridCell>
                  <GridCell align="right" data-list-action-cell="">
                    {readOnly ? null : (
                      <RowActions
                        subjectName={m.staff_name}
                        detail={{ label: '変更', disabled: busy, onClick: () => { setEditingMemberId(m.id); setShowMemberForm(false) } }}
                        menuButtonProps={{ disabled: busy }}
                        menuItems={[m.status === 'suspended' ? {
                          id: 'resume', label: '再開', disabled: busy,
                          disabledReason: busy ? 'ほかの操作を反映しています' : undefined,
                          onSelect: () => void mutate(() => updateMember(m.id, { status: 'active' }), '再開しました。'),
                        } : {
                          id: 'stop', label: '停止', tone: 'danger', disabled: busy,
                          disabledReason: busy ? 'ほかの操作を反映しています' : undefined,
                          onSelect: () => setStopId(m.id),
                        }]}
                      />
                    )}
                  </GridCell>
                </GridRow>
              ))}
            </GridTable>
          </Panel>
          <Dialog
            open={showMemberForm || editingMember !== undefined}
            busy={busy}
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
            <GridTable label="権限マトリクス" framed={false} design={{ ...tableDesign, columns: 'minmax(0, 1fr) repeat(3, var(--tpl-rt-col-110))' }}>
              <GridHeadRow>
                <GridCell role="columnheader">操作</GridCell>
                {['SuperAdmin', 'StoreManager', 'Staff'].map((label) => <GridCell key={label} role="columnheader">{label}</GridCell>)}
              </GridHeadRow>
              {MATRIX.map(([label, ...values]) => (
                <GridRow key={label}>
                  <GridCell className={styles.shortText}>{label}</GridCell>
                  {values.map((v, i) => (
                    <GridCell key={i}>
                      {v ? <Check aria-label="できる" className={styles.buttonIcon} /> : <span aria-label="できない">{emptyValue('unknown')}</span>}
                    </GridCell>
                  ))}
                </GridRow>
              ))}
            </GridTable>
          </Panel>
        </div>
      </div>
    </></SaveErrorScope>
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
