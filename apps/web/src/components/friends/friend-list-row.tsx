'use client'

/* 契約試験が renderToStaticMarkup で描くので、明示的に React を読む。 */
import React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Circle, Star } from 'lucide-react'
import type { FriendListItem } from '@/lib/api'
import type { FriendListColumn } from './friend-list-table'
import Avatar from '@/components/shared/avatar'
import Checkbox from '@/components/shared/checkbox'

interface Props {
  friend: FriendListItem
  selected?: boolean
  onToggleSelect?: () => void
  onToggleAttention?: () => void
  visibleColumns: Set<FriendListColumn>
  gridTemplateColumns: string
}

function statusView(status: FriendListItem['chatStatus']) {
  /*
   * FRIEND-06: 固定4状態は受信箱・詳細・検索と同じ名前で出す。
   * on_hold を対応中へ畳むと、受信箱で保留にした相手が別状態に見える。
   */
  if (status === 'unread') return { label: '未対応', className: 'bg-status-danger-soft text-danger' }
  if (status === 'in_progress') return { label: '対応中', className: 'bg-status-warn-soft text-status-warn-deep' }
  if (status === 'on_hold') return { label: '保留', className: 'bg-action-soft text-action' }
  return { label: '対応済み', className: 'bg-accent-soft text-accent-deep' }
}

export default function FriendListRow({
  friend,
  selected,
  onToggleSelect,
  onToggleAttention,
  visibleColumns,
  gridTemplateColumns,
}: Props) {
  const router = useRouter()
  const status = statusView(friend.chatStatus)
  const latest = friend.latestIncomingMessage
  /*
   * FRIEND-07: 最終接触は受信・送信の新しい方。受信があると送信日時を
   * 比較していなかったため、直前に送った返信があっても古い受信日が残った。
   */
  const incomingAt = latest?.createdAt
  const outgoingAt = friend.latestOutgoingAt
  const lastContact = incomingAt && outgoingAt
    ? (new Date(incomingAt).getTime() >= new Date(outgoingAt).getTime() ? incomingAt : outgoingAt)
    : incomingAt ?? outgoingAt ?? friend.createdAt
  const attention = String(friend.metadata?.__attention ?? '') === '1'

  const openChat = () => router.push(`/chats?friend=${friend.id}`)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={openChat}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          openChat()
        }
      }}
      className="grid h-19.5 min-w-0 cursor-pointer items-center gap-2 border-b border-divider-soft px-3 transition hover:bg-surface-pearl focus:bg-surface-pearl focus:outline-none"
      style={{ gridTemplateColumns }}
    >
      <div onClick={(event) => event.stopPropagation()}>
        {/* ★V7 共通 チェックボックス（gvjpx）。 */}
        <Checkbox
          checked={selected ?? false}
          onCheckedChange={() => onToggleSelect?.()}
          aria-label={`${friend.displayName}を選ぶ`}
        />
      </div>

      <button
        type="button"
        aria-pressed={attention}
        aria-label={`${friend.displayName}の注目を${attention ? '外す' : '付ける'}`}
        onClick={(event) => {
          event.stopPropagation()
          onToggleAttention?.()
        }}
        className={`rounded p-1 ${attention ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep`}
      >
        <Star aria-hidden="true" className={`h-4 w-4 ${attention ? 'fill-current' : ''}`} />
      </button>

      <div className="flex min-w-0 items-center gap-3">
        {/* アバターは設計 `PhxG6` の 40x40 / r=18。真円（r=20）にしない。 */}
        <Avatar name={friend.displayName} src={friend.pictureUrl} size={40} />
        <div className="min-w-0">
          <Link href={`/friends/detail?id=${friend.id}`} onClick={(event) => event.stopPropagation()} title={friend.displayName} className="block truncate text-sm font-bold text-ink hover:text-action hover:underline">
            {friend.displayName}
          </Link>
          <p className="mt-1 truncate text-micro text-ink-faint">登録 {formatDate(friend.createdAt)}</p>
        </div>
      </div>

      {visibleColumns.has('support') ? (
        <div className="min-w-0">
          {/*
            ★V7：対応状況の札と、自分で付ける対応マークを1段に並べる。以前は札・マーク・担当の3段で、
            「対応済み」の札と「●対応中」のマークが縦に並んで食い違って見えた。マークが無い時は何も出さない。
          */}
          <p className="flex min-w-0 items-center gap-2">
            <span className={`inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-micro font-bold ${status.className}`}>{status.label}</span>
            {friend.supportMark ? (
              <span className="flex min-w-0 items-center gap-1 truncate text-micro font-semibold text-ink-secondary" title={`対応マーク：${friend.supportMark.name}`}>
                <Circle aria-hidden="true" className="h-2 w-2 shrink-0 fill-current" style={{ color: friend.supportMark.color ?? 'var(--color-ink-disabled)' }} />
                {friend.supportMark.name}
              </span>
            ) : null}
          </p>
          {/*
            担当者は設計 `PhxG6` の丸アイコン付き（16x16 / r=8 / 頭文字 10px・800）。
            未割り当ては頭文字が無いので全角ハイフンを置く。空欄にすると
            「読み込み中で出ていない」と見分けが付かなくなる。
          */}
          <p className="mt-1 flex min-w-0 items-center gap-1.5 text-micro text-ink-secondary">
            <span
              aria-hidden="true"
              data-operator-avatar={friend.operator ? 'assigned' : 'unassigned'}
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-nano font-extrabold ${friend.operator ? 'text-on-accent' : 'bg-avatar-bg text-ink-faint'}`}
              style={friend.operator ? { backgroundColor: avatarTone(friend.operator.name) } : undefined}
            >
              {friend.operator ? (friend.operator.name.charAt(0) || '－') : '－'}
            </span>
            <span className="truncate">担当：{friend.operator?.name ?? '未割り当て'}</span>
          </p>
        </div>
      ) : null}

      {visibleColumns.has('scenario') ? (
        <div className="min-w-0">
          {friend.activeScenario ? (
            <p className="truncate text-xs font-medium text-ink-secondary" title={friend.activeScenario.name}>{friend.activeScenario.name}</p>
          ) : <span className="text-xs text-ink-faint">なし</span>}
        </div>
      ) : null}

      {visibleColumns.has('latest') ? (
        <div className="min-w-0">
          {latest ? (
            <>
              <p className="truncate text-xs text-ink" title={latest.content}>
                {latest.messageType === 'text' ? latest.content : messageTypeLabel(latest.messageType)}
              </p>
              <p className="mt-1 text-micro text-ink-faint">{formatDateTime(latest.createdAt)}</p>
            </>
          ) : <><span className="text-xs text-ink-secondary">受信なし</span><p className="mt-1 text-micro text-ink-faint">—</p></>}
        </div>
      ) : null}

      {visibleColumns.has('tags') ? (
        <div className="flex min-w-0 flex-wrap content-center gap-1">
          {friend.tags.slice(0, 2).map((tag, index) => (
            <span key={tag.id} title={tag.name} className={`max-w-full truncate rounded-mini px-2 py-1 text-micro font-semibold ${index === 0 ? 'bg-accent-soft text-accent-deep' : 'bg-chip-alt-soft text-chip-alt'}`}>{tag.name}</span>
          ))}
          {friend.tags.length > 2 ? <span className="rounded-mini bg-avatar-bg px-2 py-1 text-micro text-ink-secondary">+{friend.tags.length - 2}</span> : null}
          {!friend.tags.length ? <span className="text-micro text-ink-disabled">—</span> : null}
        </div>
      ) : null}

      {/*
        流入元（N-038）。友だち追加時に一度だけ付く計測値で、
        詳細の「友だち情報」にあるものと同じ firstTrackedLinkName。
        計測なしは空欄にせず「不明」と出す（詳細と同じ言葉）。
      */}
      {visibleColumns.has('source') ? (
        <div className="min-w-0">
          <p className={`truncate text-xs ${friend.firstTrackedLinkName ? 'text-ink-secondary' : 'text-ink-faint'}`} title={friend.firstTrackedLinkName || '不明'}>
            {friend.firstTrackedLinkName || '不明'}
          </p>
        </div>
      ) : null}

      {visibleColumns.has('last') ? (
        <div className="text-center text-xs tabular-nums text-ink-faint" title={formatDateTime(lastContact)}>
          {formatDate(lastContact)}
        </div>
      ) : null}
    </div>
  )
}

/**
 * FRIEND-17: 狭い画面向けの1人1カード表示。
 * グリッド表は最小幅（全列で約960px）を下回ると右の列が切れるため、
 * lg未満ではカードへ切り替える。上段に氏名・状態・担当・最終接触を置き、
 * 残りの列は「詳細」で展開する（切れた領域にだけ存在する操作を残さない）。
 */
export function FriendListCard({
  friend,
  selected,
  onToggleSelect,
  onToggleAttention,
  visibleColumns,
}: Omit<Props, 'gridTemplateColumns'>) {
  const router = useRouter()
  const status = statusView(friend.chatStatus)
  const latest = friend.latestIncomingMessage
  const lastContact = latest?.createdAt ?? friend.latestOutgoingAt ?? friend.createdAt
  const attention = String(friend.metadata?.__attention ?? '') === '1'

  const openChat = () => router.push(`/chats?friend=${friend.id}`)

  const detailRows: Array<{ key: FriendListColumn; label: string; node: React.ReactNode }> = []
  if (visibleColumns.has('scenario')) {
    detailRows.push({
      key: 'scenario',
      label: 'シナリオ',
      node: friend.activeScenario ? friend.activeScenario.name : <span className="text-ink-faint">なし</span>,
    })
  }
  if (visibleColumns.has('latest')) {
    detailRows.push({
      key: 'latest',
      label: '最新メッセージ',
      node: latest
        ? <span title={latest.content}>{latest.messageType === 'text' ? latest.content : messageTypeLabel(latest.messageType)}<span className="ml-2 text-micro text-ink-faint">{formatDateTime(latest.createdAt)}</span></span>
        : <span className="text-ink-secondary">受信なし</span>,
    })
  }
  if (visibleColumns.has('tags')) {
    detailRows.push({
      key: 'tags',
      label: 'タグ・属性',
      node: friend.tags.length ? (
        <span className="flex flex-wrap gap-1">
          {friend.tags.map((tag, index) => (
            <span key={tag.id} title={tag.name} className={`max-w-full truncate rounded-mini px-2 py-1 text-micro font-semibold ${index === 0 ? 'bg-accent-soft text-accent-deep' : 'bg-chip-alt-soft text-chip-alt'}`}>{tag.name}</span>
          ))}
        </span>
      ) : <span className="text-ink-disabled">—</span>,
    })
  }
  if (visibleColumns.has('source')) {
    detailRows.push({
      key: 'source',
      label: '流入元',
      node: <span className={friend.firstTrackedLinkName ? '' : 'text-ink-faint'}>{friend.firstTrackedLinkName || '不明'}</span>,
    })
  }

  return (
    <div className="border-b border-divider-soft px-3 py-3">
      <div className="flex items-start gap-3">
        <div className="pt-1" onClick={(event) => event.stopPropagation()}>
          {/* ★V7 共通 チェックボックス（gvjpx）。 */}
          <Checkbox
            checked={selected ?? false}
            onCheckedChange={() => onToggleSelect?.()}
            aria-label={`${friend.displayName}を選ぶ`}
          />
        </div>
        <button
          type="button"
          aria-pressed={attention}
          aria-label={`${friend.displayName}の注目を${attention ? '外す' : '付ける'}`}
          onClick={(event) => {
            event.stopPropagation()
            onToggleAttention?.()
          }}
          className={`rounded p-1 pt-1.5 ${attention ? 'text-status-warn-deep' : 'text-ink-faint'} hover:bg-status-warn-soft hover:text-status-warn-deep`}
        >
          <Star aria-hidden="true" className={`h-4 w-4 ${attention ? 'fill-current' : ''}`} />
        </button>
        <Avatar name={friend.displayName} src={friend.pictureUrl} size={40} />
        <div className="min-w-0 flex-1">
          <Link href={`/friends/detail?id=${friend.id}`} title={friend.displayName} className="block truncate text-sm font-bold text-ink hover:text-action hover:underline">
            {friend.displayName}
          </Link>
          {friend.supportMark ? (
            <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-micro font-semibold text-ink-secondary">
              <Circle aria-hidden="true" className="h-2 w-2 shrink-0 fill-current" style={{ color: friend.supportMark.color ?? 'var(--color-ink-disabled)' }} />
              {friend.supportMark.name}
            </p>
          ) : null}
          <p className="mt-0.5 truncate text-micro text-ink-secondary">担当：{friend.operator?.name ?? '未割り当て'}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {/* statusView() の戻り値を className へ入れると静的に読めない。判定をここへ展開する。 */}
          <span
            className={`inline-flex whitespace-nowrap rounded-full px-2 py-1 text-micro font-bold ${
              friend.chatStatus === 'unread'
                ? 'bg-status-danger-soft text-danger'
                : friend.chatStatus === 'in_progress' || friend.chatStatus === 'on_hold'
                  ? 'bg-status-warn-soft text-status-warn-deep'
                  : 'bg-accent-soft text-accent-deep'
            }`}
          >
            {status.label}
          </span>
          <span className="text-micro tabular-nums text-ink-faint" title={formatDateTime(lastContact)}>{formatDate(lastContact)}</span>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7">
        <button
          type="button"
          onClick={openChat}
          className="text-xs font-semibold text-action hover:underline"
        >
          受信箱で開く
        </button>
        {detailRows.length > 0 ? (
          <details className="w-full">
            <summary className="cursor-pointer list-none text-xs font-semibold text-ink-secondary">詳細を表示</summary>
            <dl className="mt-2 space-y-1.5 text-xs">
              {detailRows.map((row) => (
                <div key={row.key} className="flex gap-2">
                  <dt className="w-20 shrink-0 text-ink-faint">{row.label}</dt>
                  <dd className="min-w-0 flex-1 break-words text-ink-secondary">{row.node}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
      </div>
    </div>
  )
}

function formatDateTime(iso: string): string {
  const trimmed = iso.replace(/(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/, '')
  return trimmed.replace('T', ' ').slice(0, 16).replace(/-/g, '/')
}

function messageTypeLabel(messageType: string): string {
  return ({
    sticker: 'スタンプ',
    image: '画像',
    video: '動画',
    audio: '音声',
    file: 'ファイル',
    location: '位置情報',
  } as Record<string, string>)[messageType] ?? 'メッセージ'
}

/** 今年は「8月14日」、それ以外は「2025年8月14日」（★V7：数字の斜線より読みやすい）。 */
function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number)
  if (!year || !month || !day) return iso.slice(0, 10)
  const thisYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(new Date()))
  return year === thisYear ? `${month}月${day}日` : `${year}年${month}月${day}日`
}

function avatarTone(name: string): string {
  const palette = [
    'var(--color-avatar-indigo)',
    'var(--color-avatar-blue)',
    'var(--color-avatar-slate)',
    'var(--color-avatar-green)',
  ]
  const index = [...name].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0) % palette.length
  return palette[index]
}
