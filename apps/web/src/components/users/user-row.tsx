'use client'

import { useState } from 'react'

const fmt = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const dateTimeFmt = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

const ACCOUNT_BADGE_COLORS = [
  'bg-emerald-100 text-emerald-700',
  'bg-sky-100 text-sky-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-slate-100 text-slate-700',
]

export interface UserRowData {
  identityKey: string
  identityKeyKind: 'url_token' | 'uid' | 'solo'
  displayName: string | null
  pictureUrl: string | null
  accounts: Array<{
    accountId: string
    accountName: string
    lineUserId: string
    isFollowing: boolean
    joinedAt: string
    friendId: string
  }>
  xUsername: string | null
  emails: string[]
  phones: string[]
  lastActivityAt: string
  isDuplicate: boolean
}

interface Props {
  row: UserRowData
  accountColorMap: Map<string, string>
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date)
}

function shortenUid(value: string): string {
  return value.length > 14 ? `${value.slice(0, 10)}…` : value
}

const UID_STATUS = {
  url_token: {
    label: '要確認',
    description: 'プロフィール情報を手がかりにまとめています。同じ人か確認が必要です。',
  },
  uid: {
    label: 'UIDで連携',
    description: 'LINE UIDを根拠にまとめています。',
  },
  solo: {
    label: '未連携',
    description: 'ほかの友だちとはまだ連携していません。',
  },
} as const

export default function UserRow({ row, accountColorMap }: Props) {
  const [expanded, setExpanded] = useState(false)
  const uidStatus = UID_STATUS[row.identityKeyKind]
  const primaryUid = row.accounts[0]?.lineUserId
  const duplicateCount = row.accounts.length

  return (
    <>
      <tr className="border-b border-v6-divider hover:bg-v6-surface">
        <td className="overflow-hidden px-3 py-3 text-sm font-semibold text-v6-ink" title={row.displayName ?? undefined}>
          <span className="block truncate">{row.displayName || <span className="text-v6-ink-faint">—</span>}</span>
        </td>
        <td className="min-w-0 px-3 py-3 text-xs text-v6-ink-secondary">
          <span className="block truncate" title={row.emails.join(', ') || undefined}>
            {row.emails[0] ?? <span className="text-v6-ink-faint">未登録</span>}
          </span>
          <span className="mt-0.5 block truncate" title={row.phones.join(', ') || undefined}>
            {row.phones[0] ?? <span className="text-v6-ink-faint">—</span>}
          </span>
        </td>
        <td className="px-3 py-3">
          <div className="flex flex-wrap gap-1">
            {row.accounts.map((a) => {
              const color = accountColorMap.get(a.accountId) ?? ACCOUNT_BADGE_COLORS[0]
              return (
                <span
                  key={a.accountId}
                  title={a.accountName}
                  className={`max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${color}`}
                >
                  {a.accountName}
                </span>
              )
            })}
          </div>
        </td>
        <td className="min-w-0 px-3 py-3">
          <span
            className={`inline-flex max-w-full truncate rounded-full px-2 py-0.5 text-xs font-semibold ${
              row.identityKeyKind === 'url_token'
                ? 'bg-v6-warning-bg text-v6-warning'
                : row.identityKeyKind === 'uid'
                  ? 'bg-v6-accent-soft text-v6-accent-hover'
                  : 'bg-v6-surface-strong text-v6-ink-secondary'
            }`}
            title={uidStatus.description}
          >
            {uidStatus.label}
          </span>
          <span className="mt-1 block truncate font-mono text-nano text-v6-ink-faint" title={primaryUid}>
            {primaryUid ? shortenUid(primaryUid) : '—'}
          </span>
        </td>
        <td className="px-3 py-3 text-xs tabular-nums text-v6-ink-secondary">
          <span className="block truncate" title={formatDateTime(row.lastActivityAt)}>
            {formatDateTime(row.lastActivityAt)}
          </span>
        </td>
        <td className="px-3 py-3 text-xs font-semibold">
          <span
            className={row.isDuplicate ? 'text-v6-warning' : 'text-v6-ink-faint'}
            title={
              row.isDuplicate
                ? `${duplicateCount}つのアカウントに登録されています。送信前に配信先の確認が必要です。`
                : '複数アカウントへの登録はありません。'
            }
          >
            {row.isDuplicate ? '要確認' : '対象外'}
          </span>
        </td>
        <td className="px-3 py-3 text-right">
          <button
            type="button"
            className="whitespace-nowrap rounded-v6-control bg-action px-3 py-2 text-xs font-bold text-on-action hover:opacity-90"
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? '閉じる' : '詳細を見る'}
          </button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-v6-divider bg-v6-surface-strong">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-[#565F59]">登録アカウント詳細</p>
                <ul className="space-y-1 text-sm">
                  {row.accounts.map((a) => (
                    <li key={a.friendId} className="flex flex-wrap items-center gap-2 text-v6-ink-secondary">
                      <span
                        className={`h-2 w-2 rounded-full ${a.isFollowing ? 'bg-v6-accent' : 'bg-v6-ink-disabled'}`}
                      />
                      <span className="font-medium">{a.accountName}</span>
                      <span className="font-mono text-xs text-v6-ink-faint" title={a.lineUserId}>
                        UID: {shortenUid(a.lineUserId)}
                      </span>
                      <span className="text-xs text-v6-ink-faint">
                        登録: {fmt.format(new Date(a.joinedAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 text-sm">
                {row.emails.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-v6-ink-secondary">メール（フォーム回答）</p>
                    <p className="text-v6-ink-secondary">{row.emails.join(', ')}</p>
                  </div>
                )}
                {row.phones.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-v6-ink-secondary">電話（フォーム回答）</p>
                    <p className="text-v6-ink-secondary">{row.phones.join(', ')}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-v6-ink-secondary">連携の状態</p>
                  <p className="text-sm text-v6-ink-secondary">{uidStatus.label}</p>
                  <p className="mt-0.5 text-xs text-v6-ink-faint">{uidStatus.description}</p>
                </div>
                {row.xUsername ? (
                  <div>
                    <p className="text-xs font-medium text-v6-ink-secondary">X</p>
                    <p className="text-v6-ink-secondary">@{row.xUsername}</p>
                  </div>
                ) : null}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}
