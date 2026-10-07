'use client'

/*
 * ★V8 統括のメンバーの窓（Pencil `yLKwV` 権限者を招待・`BHEl9` 権限を変更する・`M4jS9` 変える前の確認）。
 *
 * 読み書きの中身は v7（components/hq/members/member-dialog.tsx）と同じ：
 *   招待＝名前・メール・役割・担当範囲・最初に表示するアカウント
 *   変更＝役割・担当範囲・最初に表示するアカウント・状態（名前とメールは本人が持つ）
 * 見た目だけを絵どおりに組んだ：幅 620・上から 110 の窓、欄は全幅で縦に並べ、担当範囲と状態は
 * 行内のラジオ、担当するアカウントは枠の中に縦1列のチェック、下の帯は線の下で真ん中寄せ。
 * 窓の枠・×・題は共通の Dialog、頭の寸法は dialog-head.module.css。
 */
import { useEffect, useId, useState, type ReactNode } from 'react'
import { Send, ShieldCheck } from 'lucide-react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import { Field as FormField } from '@/components/shared/form-controls'
import Radio from '@/components/shared/radio'
import Select from '@/components/shared/select'
import StatusBadge from '@/components/shared/status-badge'
import { TextField } from '@/components/shared/text-field'
import head from './dialog-head.module.css'
import styles from './member-dialog.module.css'

/** 絵 `yLKwV`・`BHEl9` の窓の幅と上からの位置（px）。 */
const MEMBER_WIDTH = 620
const MEMBER_TOP = 110
/** 絵 `M4jS9` の確認の窓。 */
const CONFIRM_TOP = 220

export type MemberRole = 'admin' | 'staff' | 'viewer'

export type MemberDialogValue = {
  name: string
  email: string
  role: MemberRole
  assignedLineAccountId: string
  accountScope: 'all' | 'accounts'
  scopedLineAccountIds: string[]
  isActive: boolean
}

/**
 * 招待メールは送った日から7日（実装 `staff-invite.ts` が7日で送る）。
 * 絵 `yLKwV` の「10/9（金）18:40」の形で出す。
 */
export function inviteExpiryLabel(now: Date = new Date()): string {
  const at = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(at)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${pick('month')}/${pick('day')}（${pick('weekday')}）${pick('hour')}:${pick('minute')}`
}

/** 担当範囲で選べるアカウント。アーカイブしたものは選ばせない（今の担当範囲に入っているものは残す）。 */
function choosableAccounts(accounts: LineAccount[], keep: string[]): LineAccount[] {
  return accounts.filter((account) => {
    const archived = Boolean((account as { archivedAt?: string | null }).archivedAt)
    return !archived || keep.includes(account.id)
  })
}

function initial(member: StaffMember | null, accounts: LineAccount[]): MemberDialogValue {
  return {
    name: member?.name ?? '',
    email: member?.email ?? '',
    /*
     * 招待は「閲覧のみ」から始める（絵 `yLKwV`）。広い権限は選んだときだけ渡す。
     * 変更は今の役割のまま（v7 は担当者を管理者に置き換えていた）。
     */
    role: member ? (member.role === 'viewer' ? 'viewer' : member.role === 'staff' ? 'staff' : 'admin') : 'viewer',
    assignedLineAccountId: member?.assignedLineAccountId ?? accounts[0]?.id ?? '',
    /* 招待は「指定したアカウントだけ」＋最初に表示するアカウントから始める（絵 `yLKwV`）。 */
    accountScope: member ? member.accountScope ?? 'all' : accounts[0] ? 'accounts' : 'all',
    scopedLineAccountIds: member ? member.scopedLineAccountIds ?? [] : accounts[0] ? [accounts[0].id] : [],
    isActive: member?.isActive ?? true,
  }
}

/**
 * 権限者を招待する／変更する窓。
 */
export default function MemberDialogV8({
  open,
  session,
  member,
  accounts,
  isSelf,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean
  /**
   * 開き直しの番号。変わったときだけ中身を初めに戻す。確認の窓を出す間はこの窓を閉じ、
   * 確認で「キャンセル」したら入れた中身のまま戻す（open だけでは戻さない）。
   */
  session: number
  /** 変えるとき。招待は null。 */
  member: StaffMember | null
  accounts: LineAccount[]
  /** 自分自身を変えるとき。役割と状態は触らせない（自分の管理者権限を外す事故を防ぐ）。 */
  isSelf?: boolean
  busy?: boolean
  error?: string
  onSubmit: (value: MemberDialogValue) => void
  onCancel: () => void
}) {
  const uid = useId()
  const [value, setValue] = useState<MemberDialogValue>(initial(member, accounts))
  const [localError, setLocalError] = useState('')
  /* 板 `ukPgd`：名前・メールの間違いは欄の下に赤で出し、直すまで送るボタンを押せなくする。 */
  const [fieldErrors, setFieldErrors] = useState<{ name?: string; email?: string }>({})

  useEffect(() => {
    setValue(initial(member, accounts))
    setLocalError('')
    setFieldErrors({})
  }, [session, member, accounts])

  const set = <K extends keyof MemberDialogValue>(key: K, next: MemberDialogValue[K]) => {
    setValue((v) => ({ ...v, [key]: next }))
    if (key === 'name' || key === 'email') {
      const field = key as 'name' | 'email'
      setFieldErrors((errors) => (errors[field] ? { ...errors, [field]: undefined } : errors))
    }
  }
  const toggleAccount = (id: string) =>
    set('scopedLineAccountIds', value.scopedLineAccountIds.includes(id) ? value.scopedLineAccountIds.filter((x) => x !== id) : [...value.scopedLineAccountIds, id])

  const submit = () => {
    if (!member) {
      const errors = {
        name: value.name.trim() ? undefined : '名前を入力してください',
        email: !value.email.trim()
          ? 'メールアドレスを入力してください'
          : /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ? undefined : 'メールアドレスの形が正しくありません（@ のあとに .com などが要ります）',
      }
      setFieldErrors(errors)
      if (errors.name || errors.email) return setLocalError('')
      if (!value.assignedLineAccountId) return setLocalError('最初に表示するアカウントを選んでください')
    }
    if (value.accountScope === 'accounts' && value.scopedLineAccountIds.length === 0) {
      return setLocalError('担当するアカウントを1つ以上選んでください')
    }
    setLocalError('')
    onSubmit({ ...value, name: value.name.trim(), email: value.email.trim() })
  }

  /* 絵 `BHEl9`：変更の窓には決まりの注をいつも出す（自分・招待中の人のどちらでも同じ文）。 */
  const note = member ? '自分の役割と状態は変えられません。招待中の人には「招待メールを再送」が出ます。' : ''
  /* 担当者は今その役割の人にだけ出す（新しく担当者にするには機能ごとの権限が要るので、ログインユーザーの画面で決める）。 */
  const roleOptions = [
    { value: 'admin', label: '管理者（すべて操作できる）' },
    ...(member?.role === 'staff' ? [{ value: 'staff', label: '担当者（担当範囲のアカウントだけ）' }] : []),
    { value: 'viewer', label: '閲覧のみ（見るだけ）' },
  ]
  const scopeAccounts = choosableAccounts(accounts, value.scopedLineAccountIds)

  return (
    <Dialog
      open={open}
      title={member ? 'メンバーの権限を変更する' : '権限者を招待'}
      description={
        member
          ? member.email ? `${member.name}（${member.email}）` : member.name
          : `招待メールは送った日から 7 日（${inviteExpiryLabel()} まで）有効です。メールの確認と LINE の連携が済むとログインできます。`
      }
      /* 板 `ukPgd`：招待の入力の間違いは同じ窓の状態として印を付ける。 */
      designNode={member ? 'BHEl9' : fieldErrors.name || fieldErrors.email ? 'ukPgd' : 'yLKwV'}
      designWidth={MEMBER_WIDTH}
      designTop={MEMBER_TOP}
      busy={busy}
      error={localError || error || undefined}
      onCancel={onCancel}
      footer={
        <div className={`${head.footer} ${head.footerCenter}`}>
          <Button type="button" onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={submit} disabled={busy || Boolean(fieldErrors.name || fieldErrors.email)} busy={busy} busyLabel="処理中…">
            {member ? null : <Send aria-hidden="true" className={styles.icon} />}
            {member ? '変更を保存' : '招待メールを送る'}
          </Button>
        </div>
      }
    >
      <form
        className={`${head.head} ${styles.form}`}
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {!member ? (
          <div className={styles.pair}>
            <FormField label="名前" htmlFor={`${uid}-name`} error={fieldErrors.name}>
              <TextField id={`${uid}-name`} value={value.name} maxLength={100} disabled={busy} autoFocus invalid={Boolean(fieldErrors.name)} onChange={(e) => set('name', e.target.value)} className={styles.full} placeholder="例: 山田 太郎" />
            </FormField>
            <FormField label="メールアドレス" htmlFor={`${uid}-email`} error={fieldErrors.email}>
              <TextField id={`${uid}-email`} type="email" value={value.email} disabled={busy} invalid={Boolean(fieldErrors.email)} onChange={(e) => set('email', e.target.value)} className={styles.full} placeholder="例: staff@example.com" />
            </FormField>
          </div>
        ) : null}

        <Field label="役割" htmlFor={`${uid}-role`} note={isSelf ? '自分の役割は変えられません' : undefined}>
          <Select
            aria-label="役割"
            size="full"
            id={`${uid}-role`}
            value={value.role}
            disabled={busy || isSelf}
            onChange={(next) => set('role', next as MemberRole)}
            options={roleOptions}
          />
        </Field>

        <div className={styles.group} role="group" aria-labelledby={`${uid}-scope-label`}>
          <span id={`${uid}-scope-label`} className={styles.label}>担当範囲</span>
          <div className={styles.radios}>
            <Radio name={`${uid}-scope`} value="all" checked={value.accountScope === 'all'} disabled={busy} onChange={() => { set('accountScope', 'all'); set('scopedLineAccountIds', []) }}>全アカウント</Radio>
            <Radio name={`${uid}-scope`} value="accounts" checked={value.accountScope === 'accounts'} disabled={busy} onChange={() => set('accountScope', 'accounts')}>指定したアカウントだけ</Radio>
          </div>
          {value.accountScope === 'accounts' ? (
            <div className={styles.checks} role="group" aria-label="担当するアカウント">
              {scopeAccounts.map((account) => (
                <Checkbox key={account.id} checked={value.scopedLineAccountIds.includes(account.id)} disabled={busy} onCheckedChange={() => toggleAccount(account.id)}>{account.name}</Checkbox>
              ))}
              {scopeAccounts.length === 0 ? <p className={styles.note}>アカウントがまだありません。</p> : null}
            </div>
          ) : (
            <p className={styles.note}>統括のすべてのアカウントを見て操作できます。</p>
          )}
        </div>

        <Field label="最初に表示するアカウント" htmlFor={`${uid}-assigned`}>
          <Select
            aria-label="最初に表示するアカウント"
            size="full"
            id={`${uid}-assigned`}
            value={value.assignedLineAccountId}
            disabled={busy}
            onChange={(next) => set('assignedLineAccountId', next)}
            options={accounts.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>

        {member ? (
          <div className={styles.group} role="radiogroup" aria-labelledby={`${uid}-active-label`}>
            <span id={`${uid}-active-label`} className={styles.label}>状態{isSelf ? <span className={styles.note}>自分の状態は変えられません</span> : null}</span>
            <div className={styles.radios}>
              <Radio name={`${uid}-active`} value="active" checked={value.isActive} disabled={busy || isSelf} onChange={() => set('isActive', true)}>有効（ログインできる）</Radio>
              <Radio name={`${uid}-active`} value="inactive" checked={!value.isActive} disabled={busy || isSelf} onChange={() => set('isActive', false)}>無効（ログインできない）</Radio>
            </div>
          </div>
        ) : null}

        {note ? <p className={styles.callout}>{note}</p> : null}
      </form>
    </Dialog>
  )
}

function Field({ label, note, htmlFor, children }: { label: string; note?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <div className={styles.labelRow}>
        <label htmlFor={htmlFor} className={styles.label}>{label}</label>
        {note ? <span className={styles.note}>{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

const ROLE_WORD: Record<string, string> = { owner: 'オーナー', admin: '管理者', staff: '担当者', viewer: '閲覧のみ' }
/** 請求の画面を見られるのはオーナーと管理者だけ。 */
const seesBilling = (role: string) => role === 'owner' || role === 'admin'

/** 板 `M4jS9`「権限を変える確認」。変える前に変更前→変更後を並べる。 */
export function MemberChangeConfirmV8({ member, value, accountNames, busy, error, onCancel, onConfirm }: {
  member: StaffMember
  value: MemberDialogValue
  accountNames: Map<string, string>
  busy: boolean
  error: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const roleOf = (role: string) => ROLE_WORD[role] ?? role
  const scopeOf = (scope: 'all' | 'accounts', ids: string[]) => (
    scope === 'all' ? 'すべてのアカウント' : ids.map((id) => accountNames.get(id) ?? id).join('・') || '（選択なし）'
  )
  const beforeScope = member.accountScope ?? 'all'
  const beforeIds = member.scopedLineAccountIds ?? []
  const rows = [
    { label: '役割', before: roleOf(member.role), after: roleOf(value.role), changed: member.role !== value.role },
    {
      label: '担当範囲',
      before: scopeOf(beforeScope, beforeIds),
      after: scopeOf(value.accountScope, value.scopedLineAccountIds),
      changed: beforeScope !== value.accountScope || beforeIds.join(',') !== value.scopedLineAccountIds.join(','),
    },
    {
      label: '請求の画面',
      before: seesBilling(member.role) ? '見られる' : '見られない',
      after: seesBilling(value.role) ? '見られる' : '見られない',
      changed: seesBilling(member.role) !== seesBilling(value.role),
    },
    {
      label: '状態',
      before: member.isActive ? '有効' : '停止中',
      after: value.isActive ? '有効' : '停止中',
      changed: member.isActive !== value.isActive,
    },
  ].filter((row) => row.label !== '状態' || row.changed)
  /* 管理者を外す・止めるときはサーバーが確認コードを求める（STEP_UP_REQUIRED）。押す前に分かるように書く。 */
  const needsCode = seesBilling(member.role) && (!seesBilling(value.role) || !value.isActive)
  return (
    <Dialog
      open
      title={`${member.name} さんの権限を変えますか？`}
      designNode="M4jS9"
      designWidth={MEMBER_WIDTH}
      designTop={CONFIRM_TOP}
      busy={busy}
      error={error || undefined}
      onCancel={onCancel}
      footer={
        <div className={`${head.footer} ${head.footerEnd}`}>
          <Button type="button" onClick={onCancel} disabled={busy}>キャンセル</Button>
          <Button type="button" variant="primary" onClick={onConfirm} disabled={busy} busy={busy} busyLabel="処理中…">
            {needsCode ? <ShieldCheck aria-hidden="true" className={styles.icon} /> : null}
            {needsCode ? '確認コードを入れて変える' : '変える'}
          </Button>
        </div>
      }
    >
      <div className={`${head.head} ${styles.form}`}>
        <dl className={styles.confirmList}>
          {rows.map((row) => (
            <div key={row.label} className={styles.confirmRow}>
              <dt className={styles.confirmLabel}>{row.label}</dt>
              <dd className={styles.confirmValue}>{row.before} → {row.after}</dd>
              {/* 絵 `M4jS9`：点なしの薄い琥珀の札（状態の札の形）。 */}
              {row.changed ? <StatusBadge tone="warning" dot={false}>変わる</StatusBadge> : null}
            </div>
          ))}
        </dl>
        <p className={styles.confirmNote}>管理者が 1 人だけのときは、その人を管理者から外せません。管理者を外すときは、6 桁の確認コードを入れます。</p>
      </div>
    </Dialog>
  )
}
