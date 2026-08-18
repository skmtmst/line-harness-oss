'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { FriendListItem } from '@/lib/api'

interface Props {
  friend: FriendListItem
  onDetailClick?: () => void
  /** 選ばれているか。まとめて操作する帯は、1人以上選んだときだけ出る。 */
  selected?: boolean
  onToggleSelect?: () => void
}

// 一覧の1行。見出しと同じ8枠を並べる:
// 選択 / 名前 / 対応マーク / シナリオ / 受信メッセージ / ★つきタグ・友だち情報 /
// 最終接触 / 詳細
// 枠の数が見出しと合っていないと、右の列だけが横にずれる。
// Clicking the row navigates to the per-friend chat view at
// `/chats?friend=<id>` so the operator can read history / reply / mark as
// resolved without leaving the list. Tags are intentionally kept in the
// detail drawer so a large number of automatic tags cannot stretch the row.
export default function FriendListRow({ friend, onDetailClick, selected, onToggleSelect }: Props) {
  const router = useRouter()
  const navigateToChat = () => router.push(`/chats?friend=${friend.id}`)
  const incoming = friend.latestIncomingMessage
  const scenario = friend.activeScenario
  const isFollowing = friend.isFollowing

  return (
    <div
      onClick={navigateToChat}
      role="link"
      tabIndex={0}
      onKeyDown={(e) => {
        // Only react when the row itself is the keyboard target. Otherwise
        // an Enter/Space pressed on a nested button (e.g. タグ編集) would
        // bubble up here and override the button's own click handler,
        // navigating away instead of toggling the tag editor.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          navigateToChat()
        }
      }}
      className="grid grid-cols-[32px_220px_80px_120px_1fr_160px_110px_88px] gap-3 px-4 py-3 border-b border-gray-100 hover:bg-gray-50 cursor-pointer items-start focus:outline-none focus:bg-gray-50"
    >
      {/*
        選択。行そのものが個別トークへのリンクなので、ここでの操作は
        行に伝えない。伝えると、選ぼうとしただけで画面が変わる。
      */}
      <div className="pt-1" onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected ?? false}
          onChange={() => onToggleSelect?.()}
          aria-label={`${friend.displayName} を選ぶ`}
          className="accent-accent h-4 w-4 cursor-pointer"
        />
      </div>

      {/* 名前 + アバター + 登録日 */}
      <div className="flex items-start gap-2">
        {friend.pictureUrl ? (
          <img
            src={friend.pictureUrl}
            alt={friend.displayName}
            className="w-9 h-9 rounded-full object-cover bg-gray-100 flex-shrink-0"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium flex-shrink-0">
            {friend.displayName?.charAt(0) ?? '?'}
          </div>
        )}
        <div className="min-w-0">
          {/* 行のクリックはトークを開く。名前からは詳細へ行けるようにする。
              行の動きを変えると、既にトークを開く操作として覚えられている
              ものが変わってしまう。 */}
          <Link
            href={`/friends/detail?id=${friend.id}`}
            onClick={(event) => event.stopPropagation()}
            className="block truncate text-sm font-medium text-gray-900 hover:underline"
          >
            {friend.displayName}
          </Link>
          <p className="text-[10px] text-gray-400 mt-0.5">登録: {formatJstDate(friend.createdAt)}</p>
          {!isFollowing && (
            <p className="text-[10px] text-red-400 mt-0.5">ブロック / 退会</p>
          )}
        </div>
      </div>

      {/* 対応マーク — chats.status 由来 (unread / in_progress / resolved).
          見出しと同じ数の枠を並べる。名前の中に入れていたころは、
          行だけ1枠少なくなって右の3列が見出しとずれていた。 */}
      <div className="pt-1">
        {friend.chatStatus === 'unread' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-100 text-red-700">
            未対応
          </span>
        ) : friend.chatStatus === 'in_progress' ? (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-yellow-100 text-yellow-700">
            対応中
          </span>
        ) : (
          <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-500">
            対応済み
          </span>
        )}
      </div>

      {/* シナリオ */}
      <div className="pt-1">
        {scenario ? (
          <div>
            <p className="text-xs font-medium text-blue-700 truncate" title={scenario.name}>
              {scenario.name}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              {scenario.status === 'active' ? '配信中' : scenario.status === 'delivering' ? '配信処理中' : scenario.status}
            </p>
          </div>
        ) : (
          <span className="text-xs text-gray-400">停止中</span>
        )}
      </div>

      {/* 受信メッセージ */}
      <div className="min-w-0">
        {incoming ? (
          <>
            <p className="text-xs text-gray-700 line-clamp-2 break-all">
              {incoming.messageType === 'text' ? incoming.content : `[${incoming.messageType}]`}
            </p>
            <p className="text-[10px] text-gray-400 mt-1">
              ({formatJstTimestamp(incoming.createdAt)})
            </p>
          </>
        ) : (
          <span className="text-xs text-gray-400">受信なし</span>
        )}
      </div>

      {/* 流入など、一覧で判別しやすい最小限の友だち情報だけを表示。 */}
      <div className="space-y-1">
        {friend.firstTrackedLinkName && (
          <p className="text-[10px] text-gray-500">
            <span className="text-gray-400">ASP_LP名：</span>
            {friend.firstTrackedLinkName}
          </p>
        )}
        {friend.refCode && !friend.firstTrackedLinkName && (
          <p className="text-[10px] text-gray-500">
            <span className="text-gray-400">流入：</span>
            {friend.refCode}
          </p>
        )}
        {/* IG account attribution (written by IG Harness cross-link, first touch) */}
        {(() => {
          const meta = (friend as unknown as { metadata?: Record<string, unknown> }).metadata
          const igUsername = meta?.ig_account_username as string | undefined
          const igAccountId = meta?.ig_account_id as string | undefined
          if (!igUsername && !igAccountId) return null
          return (
            <p className="text-[10px] text-pink-600">
              <span className="text-gray-400">IG流入：</span>
              {igUsername ? `@${igUsername}` : igAccountId}
            </p>
          )
        })()}
        {!friend.firstTrackedLinkName && !friend.refCode &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_username &&
          !(friend as unknown as { metadata?: Record<string, unknown> }).metadata?.ig_account_id && (
          <span className="text-[10px] text-gray-300">—</span>
        )}
      </div>

      {/*
        最終接触（設計 `V2 2-2 友だち` の最右の列）。
        放置されている人を見つけるための列で、対応マークと対で読む。
        「未対応で2週間」が一目で分かる。

        いまは最後の受信時刻を返す口が一覧に無いので、登録日を出す。
        docs/v025-open-questions.md に残している。
      */}
      <div className="pt-1 text-xs text-gray-500 tabular-nums">
        {formatJstDate(friend.createdAt)}
      </div>

      <div className="pt-0.5 text-right">
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDetailClick?.() }}
          className="w-full rounded-lg border border-emerald-600 bg-white px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-50"
        >
          詳細
        </button>
      </div>
    </div>
  )
}

// Format ISO ts to "YYYY-MM-DD HH:MM:SS" in JST. The DB stores values
// already in JST (`+09:00` strftime), so we render as-is — using the
// browser's locale formatter would re-interpret as UTC and shift 9h.
function formatJstTimestamp(iso: string): string {
  // Accept both `2026-05-08T13:45:00.000+09:00` and `2026-05-08T13:45:00`.
  // Slice off the timezone suffix and the millisecond decimals to land on
  // the 19-char canonical form, then swap T → space.
  const trimmed = iso.replace(/(\.\d+)?(Z|[+\-]\d{2}:?\d{2})?$/, '')
  return trimmed.replace('T', ' ').slice(0, 19)
}

// Date-only variant for the registration column. Same JST-as-stored
// rationale — slice off everything after the date portion.
function formatJstDate(iso: string): string {
  return iso.slice(0, 10).replace(/-/g, '/')
}
