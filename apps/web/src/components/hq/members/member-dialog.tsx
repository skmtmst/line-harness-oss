'use client'

import { useEffect, useId, useState, type ReactNode } from 'react'
import type { LineAccount, StaffMember } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import SelectField from '@/components/shared/select-field'
import { TextField } from '@/components/shared/text-field'

export type MemberDialogValue = {
  name: string
  email: string
  role: 'admin' | 'viewer'
  assignedLineAccountId: string
  accountScope: 'all' | 'accounts'
  scopedLineAccountIds: string[]
  isActive: boolean
}

/**
 * 権限者を招待する／変更する。★V6 36-5 の「＋ 権限者を招待」と「変更」。
 *
 * 招待では名前・メール・役割・最初に表示する店舗・担当範囲を聞く。
 * 変更では役割・担当範囲・状態（有効／無効）だけ。名前とメールは本人が持つ。
 */
export default function MemberDialog({
  open,
  member,
  accounts,
  isSelf,
  busy,
  error,
  onSubmit,
  onCancel,
}: {
  open: boolean
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

  useEffect(() => {
    if (!open) return
    setValue(initial(member, accounts))
    setLocalError('')
  }, [open, member, accounts])

  const set = <K extends keyof MemberDialogValue>(key: K, next: MemberDialogValue[K]) => setValue((v) => ({ ...v, [key]: next }))
  const toggleAccount = (id: string) =>
    set('scopedLineAccountIds', value.scopedLineAccountIds.includes(id) ? value.scopedLineAccountIds.filter((x) => x !== id) : [...value.scopedLineAccountIds, id])

  const submit = () => {
    if (!member) {
      if (!value.name.trim()) return setLocalError('名前を入力してください')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim())) return setLocalError('正しいメールアドレスを入力してください')
      if (!value.assignedLineAccountId) return setLocalError('最初に表示する店舗を選んでください')
    }
    if (value.accountScope === 'accounts' && value.scopedLineAccountIds.length === 0) {
      return setLocalError('担当する店舗を1つ以上選んでください')
    }
    setLocalError('')
    onSubmit({ ...value, name: value.name.trim(), email: value.email.trim() })
  }

  return (
    <Dialog
      open={open}
      title={member ? `${member.name}さんの権限を変える` : '権限者を招待'}
      description={member ? undefined : '招待メールが届き、メールの確認と LINE の連携が済むとログインできます。招待メールの有効期限は48時間です。'}
      confirmLabel={member ? '変更を保存' : '招待メールを送る'}
      busy={busy}
      error={localError || error}
      onConfirm={submit}
      onCancel={onCancel}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        {!member ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="名前" htmlFor={`${uid}-name`}>
              <TextField id={`${uid}-name`} value={value.name} maxLength={100} disabled={busy} autoFocus onChange={(e) => set('name', e.target.value)} className="w-full" placeholder="例: 山田 太郎" />
            </Field>
            <Field label="メールアドレス" htmlFor={`${uid}-email`}>
              <TextField id={`${uid}-email`} type="email" value={value.email} disabled={busy} onChange={(e) => set('email', e.target.value)} className="w-full" placeholder="例: staff@example.com" />
            </Field>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="役割" htmlFor={`${uid}-role`} note={isSelf ? '自分の役割は変えられません' : undefined}>
            <SelectField
              id={`${uid}-role`}
              className="w-full"
              style={{ width: '100%' }}
              value={value.role}
              disabled={busy || isSelf}
              onChange={(e) => set('role', e.target.value as 'admin' | 'viewer')}
              options={[
                { value: 'admin', label: '管理者（すべて操作できる）' },
                { value: 'viewer', label: '閲覧のみ（見るだけ）' },
              ]}
            />
          </Field>
          {!member ? (
            <Field label="最初に表示する店舗" htmlFor={`${uid}-assigned`}>
              <SelectField
                id={`${uid}-assigned`}
                className="w-full"
                style={{ width: '100%' }}
                value={value.assignedLineAccountId}
                disabled={busy}
                onChange={(e) => set('assignedLineAccountId', e.target.value)}
                options={accounts.map((a) => ({ value: a.id, label: a.name }))}
              />
            </Field>
          ) : (
            <Field label="状態" htmlFor={`${uid}-active`} note={isSelf ? '自分の状態は変えられません' : undefined}>
              <SelectField
                id={`${uid}-active`}
                className="w-full"
                style={{ width: '100%' }}
                value={value.isActive ? 'active' : 'inactive'}
                disabled={busy || isSelf}
                onChange={(e) => set('isActive', e.target.value === 'active')}
                options={[
                  { value: 'active', label: '有効（ログインできる）' },
                  { value: 'inactive', label: '無効（ログインできない）' },
                ]}
              />
            </Field>
          )}
        </div>

        <fieldset className="flex flex-col gap-2" disabled={busy}>
          <legend className="text-label font-bold text-ink">担当範囲</legend>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-label text-ink">
              <input type="radio" name={`${uid}-scope`} className="accent-accent-deep" checked={value.accountScope === 'all'} onChange={() => { set('accountScope', 'all'); set('scopedLineAccountIds', []) }} />
              全店舗
            </label>
            <label className="flex items-center gap-2 text-label text-ink">
              <input type="radio" name={`${uid}-scope`} className="accent-accent-deep" checked={value.accountScope === 'accounts'} onChange={() => set('accountScope', 'accounts')} />
              指定した店舗だけ
            </label>
          </div>
          {value.accountScope === 'accounts' ? (
            <div className="grid gap-1.5 rounded-control border border-hairline p-3 sm:grid-cols-2">
              {accounts.map((account) => (
                <label key={account.id} className="flex items-center gap-2 text-label text-ink">
                  <input type="checkbox" className="accent-accent-deep" checked={value.scopedLineAccountIds.includes(account.id)} onChange={() => toggleAccount(account.id)} />
                  <span className="truncate">{account.name}</span>
                </label>
              ))}
              {accounts.length === 0 ? <p className="text-caption text-ink-faint">店舗がまだありません。</p> : null}
            </div>
          ) : (
            <p className="text-micro text-ink-faint">統括のすべての店舗を見て操作できます。</p>
          )}
        </fieldset>
      </form>
    </Dialog>
  )
}

function Field({ label, note, htmlFor, children }: { label: string; note?: string; htmlFor: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={htmlFor} className="text-label font-bold text-ink">{label}</label>
        {note ? <span className="text-micro text-ink-faint">{note}</span> : null}
      </div>
      {children}
    </div>
  )
}

function initial(member: StaffMember | null, accounts: LineAccount[]): MemberDialogValue {
  return {
    name: member?.name ?? '',
    email: member?.email ?? '',
    role: member?.role === 'viewer' ? 'viewer' : 'admin',
    assignedLineAccountId: member?.assignedLineAccountId ?? accounts[0]?.id ?? '',
    accountScope: member?.accountScope ?? 'all',
    scopedLineAccountIds: member?.scopedLineAccountIds ?? [],
    isActive: member?.isActive ?? true,
  }
}
