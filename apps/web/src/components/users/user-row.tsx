'use client'

import { useState } from 'react'
import { RowActions } from '@/components/shared/row-actions'
import StatusBadge from '@/components/shared/status-badge'
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

export default function UserRow({ row, onOpenMergedPerson }: Props) {
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
            {row.accounts.map((a) => (
              <span
                key={a.accountId}
                title={a.accountName}
                className="max-w-full truncate rounded-full bg-canvas-sunken px-2 py-0.5 text-xs font-medium text-ink-secondary"
              >
                {a.accountName}
              </span>
            ))}
          </div>
        </td>
        <td className="min-w-0 px-3 py-3">
          <StatusBadge
            tone={
              row.identityKeyKind === 'url_token'
                ? 'warning'
                : row.identityKeyKind === 'uid'
                  ? 'success'
                  : 'neutral'
            }
            size="compact"
            title={uidStatus.description}
          >
            {uidStatus.label}
          </StatusBadge>
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
          {row.isDuplicate ? (
            <StatusBadge
              tone="warning"
              size="compact"
              title={`${duplicateCount}つのアカウントに登録されています。送信前に配信先の確認が必要です。`}
            >
              要確認
            </StatusBadge>
          ) : (
            <span
              className="text-ink-faint"
              title="複数アカウントへの登録はありません。"
            >
              対象外
            </span>
          )}
        </td>
        <td className="px-3 py-3 text-right">
          {/*
            行の操作は枠つきボタン1つ（詳細の開閉）＋「…」にまとめた
            「統合ユーザーを開く」。緑の塗りは行ごとに置かない。
          */}
          <RowActions
            detail={{
              label: expanded ? '閉じる' : '詳細を見る',
              onClick: () => setExpanded((value) => !value),
            }}
            menuItems={
              mergedPersonId && onOpenMergedPerson
                ? [
                    {
                      id: 'open-merged-person',
                      label: '統合ユーザーを開く',
                      onSelect: () => onOpenMergedPerson(mergedPersonId),
                    },
                  ]
                : []
            }
            menuButtonProps={
              mergedPersonId && onOpenMergedPerson
                ? { 'data-qa-open': 'w8W4Eh' }
                : undefined
            }
            subjectName={row.displayName ?? undefined}
          />
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-divider-soft bg-canvas-sunken">
          <td colSpan={7} className="px-6 py-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold text-ink-secondary">登録アカウント詳細</p>
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
