'use client'

import { useState } from 'react'
import Button from '@/components/shared/button'
import { mergedPersonIdOf } from '@/components/merged-person/merged-person-view'

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
  /** 統合ユーザー詳細（設計 `w8W4Eh`）を開く。開ける行だけに渡る。 */
  onOpenMergedPerson?: (personId: string) => void
}

function formatDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : dateTimeFmt.format(date)
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

export default function UserRow({ row, accountColorMap, onOpenMergedPerson }: Props) {
  const [expanded, setExpanded] = useState(false)
  /*
   * 統合ユーザー詳細を開けるのは、UIDを根拠にまとめた行だけ。
   * 「要確認」（プロフィールが似ているだけ）と「未連携」には、
   * 開く先の統合ユーザーがまだ無い。
   */
  const mergedPersonId = mergedPersonIdOf(row)
  const uidStatus = UID_STATUS[row.identityKeyKind]
  const duplicateCount = row.accounts.length

  return (
    <>
      <tr className="border-b border-divider-soft hover:bg-surface-pearl">
        <td className="overflow-hidden px-3 py-3 text-sm font-semibold text-ink" title={row.displayName ?? undefined}>
          <span className="block truncate">{row.displayName || <span className="text-ink-faint">—</span>}</span>
        </td>
        <td className="min-w-0 px-3 py-3 text-xs text-ink-secondary">
          <span className="block truncate" title={row.emails.join(', ') || undefined}>
            {row.emails[0] ?? <span className="text-ink-faint">未登録</span>}
          </span>
          <span className="mt-0.5 block truncate" title={row.phones.join(', ') || undefined}>
            {row.phones[0] ?? <span className="text-ink-faint">—</span>}
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
                ? 'bg-status-warn-soft text-status-warn-deep'
                : row.identityKeyKind === 'uid'
                  ? 'bg-accent-soft text-accent-hover'
                  : 'bg-canvas-sunken text-ink-secondary'
            }`}
            title={uidStatus.description}
          >
            {uidStatus.label}
          </span>
          {/*
            **LINEユーザーIDを画面に出さない。**

            ここは以前 `U0000000000…` の頭10文字を描き、全文を `title` に入れていた。
            設計 `friends-v6/r7eSi.png` はこの桁に「連携済み／未連携／要確認」という
            **状態の言葉だけ**を置く。言葉はすぐ上の `uidStatus.label` で既に出ている。
            `title` に全文を残すのも同じことなので、まとめて消す。
          */}
        </td>
        <td className="px-3 py-3 text-xs tabular-nums text-ink-secondary">
          <span className="block truncate" title={formatDateTime(row.lastActivityAt)}>
            {formatDateTime(row.lastActivityAt)}
          </span>
        </td>
        <td className="px-3 py-3 text-xs font-semibold">
          <span
            className={row.isDuplicate ? 'text-status-warn-deep' : 'text-ink-faint'}
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            {mergedPersonId && onOpenMergedPerson ? (
              <Button
                type="button"
                data-qa-open="w8W4Eh"
                onClick={() => onOpenMergedPerson(mergedPersonId)}
              >
                統合ユーザーを開く
              </Button>
            ) : null}
            <button
              type="button"
              className="whitespace-nowrap rounded-control bg-action px-3 py-2 text-xs font-bold text-on-action hover:opacity-90"
              aria-expanded={expanded}
              onClick={() => setExpanded((value) => !value)}
            >
              {expanded ? '閉じる' : '詳細を見る'}
            </button>
          </div>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-divider-soft bg-canvas-sunken">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-[#565F59]">登録アカウント詳細</p>
                <ul className="space-y-1 text-sm">
                  {row.accounts.map((a) => (
                    <li key={a.friendId} className="flex flex-wrap items-center gap-2 text-ink-secondary">
                      <span
                        className={`h-2 w-2 rounded-full ${a.isFollowing ? 'bg-accent' : 'bg-ink-disabled'}`}
                      />
                      <span className="font-medium">{a.accountName}</span>
                      <span className="text-xs text-ink-faint">
                        {a.isFollowing ? '友だち' : 'ブロック・削除'}
                      </span>
                      <span className="text-xs text-ink-faint">
                        登録: {fmt.format(new Date(a.joinedAt))}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="space-y-2 text-sm">
                {row.emails.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-ink-secondary">メール（フォーム回答）</p>
                    <p className="text-ink-secondary">{row.emails.join(', ')}</p>
                  </div>
                )}
                {row.phones.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-ink-secondary">電話（フォーム回答）</p>
                    <p className="text-ink-secondary">{row.phones.join(', ')}</p>
                  </div>
                )}
                <div>
                  <p className="text-xs font-medium text-ink-secondary">連携の状態</p>
                  <p className="text-sm text-ink-secondary">{uidStatus.label}</p>
                  <p className="mt-0.5 text-xs text-ink-faint">{uidStatus.description}</p>
                </div>
                {row.xUsername ? (
                  <div>
                    <p className="text-xs font-medium text-ink-secondary">X</p>
                    <p className="text-ink-secondary">@{row.xUsername}</p>
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
