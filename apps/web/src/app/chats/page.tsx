'use client'

import Avatar from '@/components/shared/avatar'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { parseStickerMessageContent, stickerFallback } from '@line-crm/shared'
import {
  api,
  ApiError,
  fetchApi,
  type ChatDetail as ApiChatDetail,
  type ChatDetailMessage,
  type ChatListItem,
  type InboxStats,
  type ScheduledChatSend,
} from '@/lib/api'
import { buildSupportEmailInboxQuery } from './support-email-query'
import { clampSearchQuery, SEARCH_QUERY_MAX_LENGTH } from '@/lib/search-query'
import { withRequestTimeout } from '@/lib/request-timeout'
import { INBOX_INFO_PANEL_MIN_VIEWPORT } from './inbox-layout'
import { OperatorDropdown, StatusDropdown, type ChatStatus } from '@/components/chats/inbox-dropdown'
import { unreadLookup } from '@/components/chats/assignee-unread'
import InboxFilterPanel from '@/components/chats/inbox-filter-panel'
import SavedViewDialog, { type SavedViewDraft, type SavedViewSaveResult } from '@/components/chats/saved-view-dialog'
import { IdempotencyKeyStore } from '@/lib/idempotency-key-store'
import { startVisiblePoll } from '@/lib/visible-polling'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { useAccount } from '@/contexts/account-context'
import TemplatePicker from '@/components/chats/template-picker'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSidebar from '@/components/chats/friend-info-sidebar'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { Suspense } from 'react'
import EmailThread from '@/components/support/email-thread'
import Button from '@/components/shared/button'
import { useOverlayFocus } from '@/components/shared/overlay-utils'
import { MoreAction } from '@/components/shared/row-actions'
import { CheckCircle2, Link2, NotebookPen, PanelRightClose, PanelRightOpen, Star, X } from 'lucide-react'

type Chat = ChatListItem

/**
 * 会話のメッセージ1件。形は `api.ts` の `ChatDetailMessage`
 *（`GET /api/chats/:id` の実応答）に寄せる。画面が独自の型を持つと
 * 口の形が変わっても型検査が黙るため、ここでは別名にするだけ。
 */
type ChatDetail = ApiChatDetail

type StatusFilter = 'all' | 'unread' | 'in_progress' | 'on_hold' | 'resolved'

/** 受信箱に混ぜるメールの1件（/api/support/inbox の email ぶん）。 */
interface EmailInboxItem {
  id: string
  threadId: string
  customerName: string
  /** 相手のメールアドレス。友だちを手で探すときの手がかりになる。 */
  customerIdentifier?: string
  subject: string
  preview: string
  status: 'unread' | 'in_progress' | 'on_hold' | 'resolved'
  revision: number
  assignedStaffId?: string | null
  assignedStaffName?: string | null
  /** 受信・送信のうち新しい方の時刻。口はこの順で返す。無い口は受信時刻に倒す。 */
  lastMessageAt?: string | null
  lastIncomingAt: string
  isUnread: boolean
}

/** 受信箱一覧の続きを読む位置。口の並び（未読が先・新しい順）と同じ3点。 */
type ListCursor = { at: string; id: string; unread: 0 | 1 }

const statusConfig: Record<Chat['status'], { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-danger-bg text-danger' },
  in_progress: { label: '対応中', className: 'bg-warning-bg text-warning' },
  on_hold: { label: '保留', className: 'bg-info-bg text-info' },
  resolved: { label: '対応済み', className: 'bg-success-bg text-success' },
}

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: 'すべて' },
  { key: 'unread', label: '未対応' },
  { key: 'in_progress', label: '対応中' },
  { key: 'on_hold', label: '保留' },
  { key: 'resolved', label: '対応済み' },
]

import { normalizeSavedViewConditions, type InboxSavedViewConditions } from './saved-view-types'
import { savedViewFailureMessage } from './saved-view-failure'
import { savedViewSummary } from './saved-view-summary'
import { buildOutgoingMessage, refreshChatListAfterSend } from './send-optimistic'
import { describeSendFailure } from './send-failure'

type InboxSavedView = {
  id: string
  name: string
  conditions: InboxSavedViewConditions
  createdBy: string | null
  isShared: boolean
  isFavorite?: boolean
  /** 保存条件を現在の受信箱へ当てた件数。未接続は null。 */
  matchCount?: number | null
}

function ChannelBadge({ channel }: { channel: 'line' | 'email' }) {
  return channel === 'line' ? (
    <span className="bg-accent-deep text-on-accent inline-flex h-5 min-w-8 items-center justify-center rounded-md px-1.5 text-micro font-bold">
      LINE
    </span>
  ) : (
    <span className="bg-canvas-sunken text-ink-secondary border-hairline inline-flex h-5 min-w-8 items-center justify-center rounded-md border px-1.5 text-micro font-bold">
      MAIL
    </span>
  )
}

// 一覧の1ページ件数。worker 側の上限(MAX_LIST_LIMIT=200)と揃える。
// 300 のままだと API が200件に丸めるのに画面は300件で「続き」を判定し、
// 201件目以降に「さらに読み込む」が出ず開けなくなる。
const CHAT_PAGE_SIZE = 200

/** 一覧の末尾から「続きを読む」位置を作る。口の並び（未読が先・新しい順）と同じ3点。 */
function toListCursor(
  last: Pick<ChatListItem, 'id' | 'lastMessageAt' | 'isUnread'> | undefined,
): ListCursor | null {
  if (!last?.lastMessageAt) return null
  return { at: last.lastMessageAt, id: last.id, unread: last.isUnread ? 1 : 0 }
}

function StickerMessageImage({ content }: { content: string }) {
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  const sticker = parseStickerMessageContent(content)
  const fallback = stickerFallback(content)

  // 本文由来のURLをそのまま読みに行く。https 以外(意図しない scheme・
  // 空文字など)は画像にせず、文字の代替表示に倒す。共通側の許可リスト
  // 検証(#493-C1)が入るまでの間の最低限の guard。
  if (!sticker || failed || !sticker.stickerUrl.startsWith('https://')) {
    return (
      <span className="inline-flex flex-col items-center gap-1">
        <span>{fallback}</span>
        {sticker && failed ? (
          <button
            type="button"
            onClick={() => { setFailed(false); setRetryKey((key) => key + 1) }}
            className="text-action text-[11px] font-semibold underline underline-offset-2"
          >
            画像を読み込み直す
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <img
      key={retryKey}
      src={sticker.stickerUrl}
      alt={fallback}
      className="max-h-[140px] max-w-[140px] object-contain"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

/**
 * 履歴の画像メッセージ(INBOX-30)。
 *
 * 以前は alt 空・onError なしの `<img>` だけで、404・期限切れ・回線断で
 * 何も出ない空白になっていた。スタンプと同じく、失敗は代替表示と
 * 再読み込みに倒す。画像の内容は推測して書かない。
 */
function ChatImageMessage({ content }: { content: string }) {
  const [failed, setFailed] = useState(false)
  const [retryKey, setRetryKey] = useState(0)
  let url: string | null = null
  try {
    const parsed = JSON.parse(content) as { originalContentUrl?: unknown; previewImageUrl?: unknown }
    const candidate = parsed.originalContentUrl ?? parsed.previewImageUrl
    if (typeof candidate === 'string' && candidate.startsWith('https://')) url = candidate
  } catch {
    url = null
  }

  if (!url || failed) {
    return (
      <span className="flex min-w-40 flex-col items-center justify-center gap-1.5 rounded-md bg-canvas-sunken px-4 py-6 text-center">
        <span className="text-ink-faint text-xs">画像を読み込めませんでした</span>
        {url ? (
          <button
            type="button"
            onClick={() => { setFailed(false); setRetryKey((key) => key + 1) }}
            className="text-action text-xs font-semibold underline underline-offset-2"
          >
            画像を読み込み直す
          </button>
        ) : null}
      </span>
    )
  }

  return (
    <img
      key={retryKey}
      src={url}
      alt="画像"
      className="max-w-[200px] rounded"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  )
}

function formatInboxDatetime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/*
 * 予約時刻は「日本時間」が約束(INBOX-21)。入力欄も一覧も端末の
 * 時間帯ではなく Asia/Tokyo で読み書きする。JST は夏時間がないので
 * オフセットは常に +09:00。
 */
const INBOX_TIME_ZONE = 'Asia/Tokyo'

function formatJstScheduledAt(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', {
    timeZone: INBOX_TIME_ZONE,
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * datetime-local の値(日本時間の約束)をオフセット付きのISOへ変える(INBOX-21)。
 * 'YYYY-MM-DDTHH:MM' のまま送ると、サーバー側の Date.parse がその実行環境の
 * 時間帯(UTC)で読み、選んだ時刻から9時間ずれた予約になる。JSTは夏時間が
 * ないので +09:00 で固定する。すでにオフセット付きの値はそのまま通す。
 */
function jstDatetimeLocalToIso(local: string): string {
  if (!local) return local
  if (/[zZ]$|[+-]\d{2}:\d{2}$/.test(local)) return local
  return `${local}+09:00`
}

/** UTCのISOを datetime-local の値へ戻す(日本時間で見せる)。 */
function isoToJstDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: INBOX_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d)
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  // '24' 表記の深夜0時は datetime-local が読めないので '00' に直す。
  const hour = pick('hour') === '24' ? '00' : pick('hour')
  return `${pick('year')}-${pick('month')}-${pick('day')}T${hour}:${pick('minute')}`
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return ''
  if (bytes < 1024) return `${bytes}B`
  return `${Math.round(bytes / 1024)}KB`
}

/** サーバーと同じ数え方(JSの .length)。差し込みは解決後の長さでサーバーが最終判定する。 */
const MESSAGE_MAX_LENGTH = 5000

/** 入力欄の自動拡張の上限。text-sm(行の高さ約20px)の8行＋上下余白。 */
const TEXTAREA_MAX_HEIGHT_PX = 168

/**
 * 設計 `xGLVe` の一覧は日付だけの `08/18`。年まで出すと桁が伸びて、
 * 同じ行の右に並ぶ対応状況の札を押し出す。年は見出し側で出す。
 */
function formatInboxListDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 設計 `xGLVe` は、返信を待たせている行だけ日付ではなく待ち時間を出す
 * （`1時間12分`）。上の帯の「最長 ◯◯待ち」と同じ物差し。
 * **最終受信からの差なので、新しい口は要らない。**
 */
function formatWaitingDuration(iso: string | null, nowMs: number): string | null {
  if (!iso) return null
  const at = new Date(iso).getTime()
  if (!Number.isFinite(at)) return null
  const minutes = Math.floor((nowMs - at) / 60000)
  if (minutes < 0) return null
  if (minutes < 1) return '1分未満'
  if (minutes < 60) return `${minutes}分`
  const hours = Math.floor(minutes / 60)
  return `${hours}時間${minutes % 60}分`
}

function sameYmd(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatYmdSlash(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

/**
 * URL状態の友だちIDが口へ渡せる形か。
 *
 * `api.chats.get` はIDを素のまま path へ入れるため、`/ ? #`
 * 空白を含む値はここで弾く。弾いた値は口を呼ばず、別人も開かない(#673)。
 */
function isSafeFriendIdForInbox(value: string): boolean {
  if (!value || value.length > 128) return false
  return /^[A-Za-z0-9_-]+$/.test(value)
}

/**
 * URLで会話を開けなかった理由ごとの案内文。
 *
 * どれも「別人を開かない」で揃える。理由を混ぜると、権限が無いのか
 * 選んでいるアカウントが違うのかが読み手に伝わらない(#673)。
 */
const DEEP_LINK_NOTICE = {
  /** IDの形が壊れている。口は呼ばない。 */
  malformed: '指定の会話を開けませんでした。URLの指定が正しくありません。友だち詳細の「受信箱で開く」から開き直してください。',
  /** 存在しない、または見る権限が無い。 */
  unavailable: '指定の会話を開けませんでした。存在しないか、見る権限がありません。URLを確かめるか、友だち詳細の「受信箱で開く」から開き直してください。',
  /** 見る権限はあるが、いま選んでいるアカウントの相手ではない。 */
  otherAccount: '指定の会話は、いま選んでいるLINEアカウントの相手ではありません。返信の送信元が変わって別のアカウントから送ってしまうため、開きません。上のアカウント切替で相手のアカウントに変えてから開き直してください。',
} as const

/** URLに残す保存検索IDの名前。再読込・共有で同じ条件を復元する足場(N-021)。 */
const SAVED_VIEW_URL_KEY = 'savedView'

/**
 * 受信箱のURLを組み立てる。
 *
 * 保存検索を選んだあとは `savedView=<id>` を channel と一緒に残す。
 * URLが条件を持たないと、再読込・共有のたびに絞り込みが消える(N-021)。
 */
function buildInboxUrl(channel: 'all' | 'line' | 'email', savedViewId: string | null): string {
  const query = new URLSearchParams()
  if (channel !== 'all') query.set('channel', channel)
  if (savedViewId) query.set(SAVED_VIEW_URL_KEY, savedViewId)
  const text = query.toString()
  return text ? `/chats?${text}` : '/chats'
}

/*
 * 下書きの保管キー(#962 F06)。同じ会話IDが別アカウントにもあり得るので、
 * アカウントと会話の両方で区切る。`\u001f` はIDに出ない区切り。
 */
function draftKeyOf(accountId: string | null | undefined, chatId: string | null | undefined): string {
  return `${accountId ?? ''}\u001f${chatId ?? ''}`
}

function ChatsPageInner({ channel }: { channel: 'all' | 'line' | 'email' }) {
  const router = useRouter()
  const params = useSearchParams()
  // URLが指す保存検索のID。再読込・URL共有からの復元元(N-021)。
  const savedViewParam = (params.get(SAVED_VIEW_URL_KEY) ?? '').trim()
  const { selectedAccountId, selectedAccount, loading: accountsLoading } = useAccount()
  const [chats, setChats] = useState<Chat[]>([])
  /**
   * URLで指定された会話が開けなかったときの案内。
   *
   * 不正・存在しない・別アカウント・選択中と違うアカウントのIDでも
   * 別人を開かず、空のまま理由と戻り先を出す(#673)。
   */
  const [deepLinkNotice, setDeepLinkNotice] = useState('')
  /** URL由来で開こうとしているID。手選びと区別するための目印。 */
  const deepLinkIdRef = useRef<string | null>(null)
  /**
   * URL指定の解決の世代。遅い友だち照会が、新しいURLやアカウント切替で
   * 始まった解決を上書きしないようにする(#673)。
   */
  const deepLinkRequestIdRef = useRef(0)
  /**
   * メールの問い合わせ。LINEのトークと同じ一覧に混ぜる。
   *
   * 設計 `V2 2-1 受信箱` の一覧は「✉ 定期便の解約について」のように
   * メールも同じ並びに入っている。出どころで場所を分けると、
   * 返信を待っている人を2か所で探すことになる。
   */
  const [emailItems, setEmailItems] = useState<EmailInboxItem[]>([])
  /*
   * メール一覧だけの失敗表示。LINE側の `error` とは別にする。
   * 以前は失敗が無言で「メール0件」に見え、未対応の見落としになった。
   * 成功したら消す。ふだんは何も出ない。
   */
  const [emailError, setEmailError] = useState('')
  // 初回・条件変更時の取得中。追加読み込みとは分け、0件表示を先走らせない。
  const [emailLoading, setEmailLoading] = useState(true)
  // 中央ペインで開いているメール。LINEのトークと排他。
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null)
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  /*
   * URLの `?status=` で絞り込み済みの受信箱を開けるようにする（IDEA-01）。
   * ダッシュボードの「対応が必要な受信」は `?status=unread` でここへ来る。
   * 旧い深掘りリンクの `unanswered=1` も「未対応」として受ける。
   */
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() => {
    const raw = (params.get('status') ?? '').trim()
    if (statusFilters.some((f) => f.key === raw)) return raw as StatusFilter
    if (params.get('unanswered') === '1' || params.get('unanswered') === 'true') return 'unread'
    return 'all'
  })
  const [quickFilter, setQuickFilter] = useState<'all' | 'reply' | 'overdue'>('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [filterOpen, setFilterOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  // 一覧が長くなると状態の絞り込みだけでは足りない（設計 `ListPane` の「名前で検索」）。
  // 送信側で絞ると、打つたびに一覧を取り直して重い。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  const [debouncedNameQuery, setDebouncedNameQuery] = useState('')
  const [savedViews, setSavedViews] = useState<InboxSavedView[]>([])
  const [savedViewsOpen, setSavedViewsOpen] = useState(false)
  const [savedViewMenuId, setSavedViewMenuId] = useState<string | null>(null)
  const [savedViewName, setSavedViewName] = useState('')
  const [savedViewError, setSavedViewError] = useState('')
  const [savingView, setSavingView] = useState(false)
  const [savedViewSuccess, setSavedViewSuccess] = useState(false)
  /*
   * savedViews が「どのアカウント分」か。アカウント切替で一覧が
   * 取り直される間、前のアカウントの一覧でURLのIDを誤適用しない(N-021)。
   */
  const [savedViewsAccountId, setSavedViewsAccountId] = useState<string | null>(null)
  // URLの保存検索IDが見つからなかったときの案内。適用せず既定条件へ戻したことを伝える。
  const [savedViewNotice, setSavedViewNotice] = useState('')
  // 担当の選択肢（設計 `TalkPane` の「担当」）。
  const [operators, setOperators] = useState<Array<{ id: string; name: string }>>([])
  /*
    保存した検索の要約で、担当者IDを名前にするための対応表。
    **引けないときは名前を作らない**——`savedViewSummary` が人数で言う。
  */
  const operatorNames = useMemo(
    () => new Map(operators.map((operator) => [operator.id, operator.name])),
    [operators],
  )

  /*
    担当者ごとの未読数（設計 `YZaDK`）。**画面に見えている行から数えない**——
    一覧はページ送りされるので、2ページ目の未読が落ちる。
    `null` は「まだ読めていない」。**実値0とは別。**
  */
  const [assigneeUnread, setAssigneeUnread] = useState<InboxStats['assigneeUnread'] | null>(null)
  /*
   * INBOX-09: 札の件数。「どの条件に対する応答か」を key で結び付け、
   * 条件を変えた直後に古い条件の件数が出ないようにする。
   */
  const [quickCounts, setQuickCounts] = useState<{
    key: string
    counts: { all: number; reply: number; overdue: number }
  } | null>(null)
  const quickCountsRequestRef = useRef(0)
  const [assigneeUnreadStatus, setAssigneeUnreadStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  /*
   * 顧客情報の開閉(#982 LAY-01/LAY-02)。
   *
   * 3列に収まる幅（`INBOX_INFO_PANEL_MIN_VIEWPORT`＝1536px〜）では右列と
   * して常設し、既定は開く。それより狭い幅ではトークの上に重ねる
   * ドロワーにし、既定は閉じる——開きっぱなしだと返信の本文が隠れる。
   * 以前は `hidden xl:block` で1280px未満は常に非表示で、開閉ボタンを
   * 押しても何も出なかった。
   *
   * `friendInfoChoice` は運用者が明示的に開閉したときだけ値を持つ。
   * 未操作のあいだは `wideInfoPanel`（現在の画面幅）に従うので、
   * 幅を変えても入力中の文章や選択中の相手を失わない。
   */
  const [wideInfoPanel, setWideInfoPanel] = useState(false)
  const [friendInfoChoice, setFriendInfoChoice] = useState<boolean | null>(null)
  useEffect(() => {
    const media = window.matchMedia(`(min-width: ${INBOX_INFO_PANEL_MIN_VIEWPORT}px)`)
    const sync = () => setWideInfoPanel(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  const showFriendInfo = friendInfoChoice ?? wideInfoPanel
  const setShowFriendInfo = (next: boolean | ((current: boolean) => boolean)) => {
    setFriendInfoChoice((current) => (typeof next === 'function' ? next(current ?? wideInfoPanel) : next))
  }
  /*
   * ドロワーで開いているあいだは Escape で閉じられるようにし、
   * 開いた時点でフォーカスをパネルへ移す。常設の列（広い幅）では
   * 開閉ボタンがいつも見えているので、この扱いはドロワーだけにする。
   */
  const customerPanelRef = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!showFriendInfo || wideInfoPanel) return
    customerPanelRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setFriendInfoChoice(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [showFriendInfo, wideInfoPanel])
  // 送信の細かい設定。既定は畳む。出しっぱなしだと入力欄が縦に伸びて
  // トークが読めなくなる。
  const [showComposerOptions, setShowComposerOptions] = useState(false)
  const [showMemoEditor, setShowMemoEditor] = useState(false)
  const [memoDraft, setMemoDraft] = useState('')
  const [memoSaving, setMemoSaving] = useState(false)
  const [memoError, setMemoError] = useState('')
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const [imageError, setImageError] = useState('')
  /*
   * INBOX-23: 画像の準備(アップロード)結果は「選んだ会話」にだけ返す。
   * 完了を待つ間に別の会話・アカウントへ切り替わっても、今開いている
   * 入力欄へ書かない。進行中・失敗・添付済みも会話ごとに預かる。
   * 同一会話での選び直し・「外す」は世代を進めて古い結果を捨てる。
   */
  const imageJobGenRef = useRef(new Map<string, number>())
  const imageErrorDraftsRef = useRef(new Map<string, string>())
  const imageMetaDraftsRef = useRef(new Map<string, { name: string; size: number }>())
  const [imageBusyKeys, setImageBusyKeys] = useState<ReadonlySet<string>>(new Set())
  const [pendingImageMeta, setPendingImageMeta] = useState<{ name: string; size: number } | null>(null)
  const pendingImageMetaRef = useRef(pendingImageMeta)
  pendingImageMetaRef.current = pendingImageMeta
  const imageErrorRef = useRef(imageError)
  imageErrorRef.current = imageError
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false)

  /**
   * 画像を1枚選ぶ。
   *
   * **1MB まで。** LINE はプレビュー用の画像が1MBまでで、ここは元画像と
   * プレビューに同じURLを渡している。10MB と書いてあった案内は、
   * 実際には1MBで弾かれるので直した。
   */
  const handlePickImage = async (file: File) => {
    // 選んだ時点のアカウント＋会話を固定する(INBOX-23)。完了時に
    // どこへ出すかはこの鍵で決め、今開いている会話へは直接書かない。
    const ownerKey = draftKeyOf(selectedAccountId, selectedChatId)
    const reportError = (message: string) => {
      imageErrorDraftsRef.current.set(ownerKey, message)
      if (draftOwnerKeyRef.current === ownerKey) setImageError(message)
    }
    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      reportError('JPEG か PNG を選んでください')
      return
    }
    if (file.size > 1024 * 1024) {
      reportError('1MB 以下にしてください')
      return
    }
    const generation = (imageJobGenRef.current.get(ownerKey) ?? 0) + 1
    imageJobGenRef.current.set(ownerKey, generation)
    imageErrorDraftsRef.current.delete(ownerKey)
    if (draftOwnerKeyRef.current === ownerKey) setImageError('')
    setImageBusyKeys((prev) => new Set(prev).add(ownerKey))
    try {
      const res = await api.uploads.image(file)
      // 取消・別の画像への選び直しが済んでいれば、この結果は捨てる。
      if (imageJobGenRef.current.get(ownerKey) !== generation) return
      if (!res.success) {
        // 準備(アップロード)の失敗であり、相手への送信は始まっていない
        // (INBOX-31)。「送れなかった」とは言わない。
        reportError('画像を添付できませんでした。選び直してください')
        return
      }
      const value: ImageUploaderValue = {
        mode: 'line-image',
        originalContentUrl: res.data.url,
        previewImageUrl: res.data.url,
      }
      imageDraftsRef.current.set(ownerKey, value)
      imageMetaDraftsRef.current.set(ownerKey, { name: file.name, size: file.size })
      if (draftOwnerKeyRef.current === ownerKey) {
        setPendingImage(value)
        setPendingImageMeta({ name: file.name, size: file.size })
      }
    } catch {
      if (imageJobGenRef.current.get(ownerKey) !== generation) return
      reportError('画像を添付できませんでした。選び直してください')
    } finally {
      setImageBusyKeys((prev) => {
        const next = new Set(prev)
        next.delete(ownerKey)
        return next
      })
    }
  }

  /** 添付を外す。読み込み中の結果が遅れて届いても復活しないよう世代を進める。 */
  const clearPendingImage = () => {
    const ownerKey = draftKeyOf(selectedAccountId, selectedChatId)
    imageJobGenRef.current.set(ownerKey, (imageJobGenRef.current.get(ownerKey) ?? 0) + 1)
    imageDraftsRef.current.delete(ownerKey)
    imageMetaDraftsRef.current.delete(ownerKey)
    imageErrorDraftsRef.current.delete(ownerKey)
    setPendingImage(null)
    setPendingImageMeta(null)
    setImageError('')
  }
  const statusFilterRef = useRef<StatusFilter>('all')
  // Send mode: 'enter' = Enter sends, Shift+Enter = newline; 'shift-enter' = reverse
  /*
   * 送信キーの初期値は Shift + Enter。**選び直せる。**
   *
   * Enter 単体だと、書きかけで改行しようとして送ってしまう。取り消せない
   * ものが相手へ飛ぶので、既定は事故の起きにくい方にする。
   * 一度選ぶと chat.sendMode に残り、次からはその設定が使われる。
   * メール側（email-thread.tsx）も同じ置き場・同じ既定。
   */
  const [sendMode, setSendMode] = useState<'enter' | 'shift-enter'>('shift-enter')
  const [loading, setLoading] = useState(true)
  // 送信や詳細取得の error と混ぜず、一覧0件と一覧障害を判別する。
  const [chatListFailed, setChatListFailed] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreChats, setHasMoreChats] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [attentionSaving, setAttentionSaving] = useState(false)
  const [error, setError] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [pendingImage, setPendingImage] = useState<ImageUploaderValue | null>(null)
  const [sending, setSending] = useState(false)
  // N-025: 引用返信。会話の中の1件を引用して返す。
  const [quotedMessage, setQuotedMessage] = useState<ChatDetailMessage | null>(null)
  // N-025: 送信予約。JSTの datetime-local 値をそのまま口へ渡し、
  // 保存はサーバー側でUTCへ正規化される。
  const [scheduledSends, setScheduledSends] = useState<ScheduledChatSend[]>([])
  // 予約一覧の取得失敗は「予約なし」と分けて持つ。0件のまま黙ると、
  // 消えたわけではない予約を送り忘れる(#962 F07)。
  const [scheduledSendsFailed, setScheduledSendsFailed] = useState(false)
  const [scheduleInput, setScheduleInput] = useState('')
  const [showSchedulePanel, setShowSchedulePanel] = useState(false)
  const [scheduling, setScheduling] = useState(false)
  const sendLockRef = useRef(false)
  const sendKeysRef = useRef(new IdempotencyKeyStore())
  // 予約送信の多重実行ロック。state の scheduling は描画を待つため、
  // 同じ tick の二度押しを止めるには ref が要る(sendLockRef と同じ型・#965)。
  const scheduleLockRef = useRef(false)
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false)
  const isComposingRef = useRef(false)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  /*
   * INBOX-27: スクロール位置の決め方を分けるための記録。
   * - stickToBottomRef: いま下端にいるか。下端にいる間だけ新着へ追従する。
   * - prevMessageWindowRef: 前回描いた会話・最後尾・件数。追加か切替かを判別する。
   * - pendingPrependRef: 「前のメッセージ」で上へ足す直前の高さと位置。
   * - unseenIncoming: 読んでいる途中に下へ届いた相手からの新着件数。
   */
  const stickToBottomRef = useRef(true)
  const prevMessageWindowRef = useRef<{ chatId: string; lastId: string | null; count: number } | null>(null)
  const pendingPrependRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null)
  const [unseenIncoming, setUnseenIncoming] = useState(0)
  // U008: 狭い幅で切れた宛先名を、その場で全文に広げるための状態。
  const [headerNameExpanded, setHeaderNameExpanded] = useState(false)
  // 会話を変えたら広げた表示も元へ戻す。
  useEffect(() => {
    setHeaderNameExpanded(false)
    setUnseenIncoming(0)
    stickToBottomRef.current = true
  }, [selectedChatId])

  // ページング用カーソル。表示リストは楽観更新で並び替わるため、
  // 「サーバから最後に受け取った行」を ref で保持して次ページの起点にする
  // (offset 方式だと新着で行が押し下げられた分が欠落する)。
  const nextCursorRef = useRef<ListCursor | null>(null)
  // 会話を素早く切り替えたとき、前の会話の遅い応答で現在の詳細を
  // 上書きしない。注目操作が別の友だちへ向く事故もここで防ぐ。
  const detailRequestIdRef = useRef(0)
  const detailAccountRef = useRef(selectedAccountId)
  /*
   * いま画面で開いている会話ID。通信の応答が「どの会話へ向けたものか」を
   * 照合するために描画のたびに同期する（listFilterKeyRef と同じ型）。
   * 切替後に届いた古い応答の履歴マージ・入力欄クリア・予約一覧反映を
   * 止める(#962 F03/F06/F07)。
   */
  const selectedChatIdRef = useRef<string | null>(selectedChatId)
  selectedChatIdRef.current = selectedChatId
  /*
   * 入力中の下書き(本文・添付画像)は「アカウント＋会話」ごとに預かる
   * (#962 F06)。切替のたびに消すと、送信応答を待つ間に別の会話を
   * 開いただけで書きかけが消える。預かった下書きは送信した版だけを
   * 破棄し、追記・差し替えされた版は残す(dropSentDraft)。
   */
  const messageContentRef = useRef(messageContent)
  messageContentRef.current = messageContent
  const pendingImageRef = useRef(pendingImage)
  pendingImageRef.current = pendingImage
  const messageDraftsRef = useRef(new Map<string, string>())
  const imageDraftsRef = useRef(new Map<string, ImageUploaderValue>())
  const draftOwnerKeyRef = useRef(draftKeyOf(selectedAccountId, selectedChatId))
  // 保存検索一覧の取得がどのアカウントに向けたものか。切替中に遅れて届いた
  // 旧アカウントの応答で、新しいアカウントの一覧を上書きしない(N-021)。
  const savedViewsRequestAccountRef = useRef<string | null>(null)
  /*
   * 処理済みのURL savedView値。router.replace の反映より描画が先に走る
   * 隙間に、復元効果が同じIDをもう一度適用して手動の条件変更を
   * 上書きするのを防ぐ(N-021)。
   */
  const savedViewConsumedRef = useRef<string | null>(null)

  useEffect(() => {
    /*
     * #625: サーバーへ送る検索語は上限へ切り詰める。入力欄の maxLength に
     * 頼るだけだと、保存した検索の復元など欄を通らない経路で長い語が
     * そのまま出ていく。
     */
    const timer = window.setTimeout(() => setDebouncedNameQuery(clampSearchQuery(nameQuery.trim())), 250)
    return () => window.clearTimeout(timer)
  }, [nameQuery])

  const buildListParams = useCallback((cursor: ListCursor | null) => {
    const params: {
      status?: string; accountId?: string; q?: string;
      operatorId?: string; unreadOnly?: boolean; quickFilter?: 'reply' | 'overdue';
      limit?: number; beforeUnread?: 0 | 1; beforeAt?: string; beforeId?: string;
    } = {}
    if (statusFilter !== 'all') params.status = statusFilter
    if (selectedAccountId) params.accountId = selectedAccountId
    if (debouncedNameQuery) params.q = debouncedNameQuery
    if (assigneeFilter !== 'all') params.operatorId = assigneeFilter
    if (unreadOnly) params.unreadOnly = true
    if (quickFilter !== 'all') params.quickFilter = quickFilter
    params.limit = CHAT_PAGE_SIZE
    if (cursor) {
      params.beforeUnread = cursor.unread
      params.beforeAt = cursor.at
      params.beforeId = cursor.id
    }
    return params
  }, [statusFilter, selectedAccountId, debouncedNameQuery, assigneeFilter, unreadOnly, quickFilter])

  // Compare at render time too: an old request can finish before the next effect runs.
  const listFilterKey = JSON.stringify([statusFilter, selectedAccountId, debouncedNameQuery, assigneeFilter, unreadOnly, quickFilter])
  const listFilterKeyRef = useRef(listFilterKey)
  listFilterKeyRef.current = listFilterKey
  const chatListRequestRef = useRef(0)
  const emailListRequestRef = useRef(0)
  const emailMoreLockRef = useRef(false)
  // 描画中の条件と、各一覧が最後まで取得できた条件を結び付ける。
  // useEffect が loading を立てる前の1描画でも、旧条件の0件を新条件の0件と誤認しない。
  const [chatListCompletedKey, setChatListCompletedKey] = useState<string | null>(null)
  const [emailListCompletedKey, setEmailListCompletedKey] = useState<string | null>(null)

  // メール一覧の1ページ件数。上限200切りっぱなしだった offset なし取得を、
  // LINE側と同じく「さらに読み込む」で遡れるようにする。
  const EMAIL_PAGE_SIZE = 200
  const [loadingMoreEmails, setLoadingMoreEmails] = useState(false)
  const [hasMoreEmails, setHasMoreEmails] = useState(false)

  /** メールの問い合わせを取る。LINEと同じ一覧に混ぜるため。 */
  const loadEmails = useCallback(async (offset = 0, append = false) => {
    const requestId = append ? emailListRequestRef.current : ++emailListRequestRef.current
    if (append) {
      if (emailMoreLockRef.current) return
      emailMoreLockRef.current = true
      setLoadingMoreEmails(true)
    } else {
      setEmailItems([])
      setHasMoreEmails(false)
      emailMoreLockRef.current = false
      setLoadingMoreEmails(false)
      setEmailLoading(true)
      setEmailError('')
    }
    try {
      // #625: 応答なしの要求は時間切れの失敗にし、読み込み中を残さない。
      const res = await withRequestTimeout(fetchApi<{
        success: boolean
        data: { items: EmailInboxItem[]; summary?: { total: number } }
      }>(
        `/api/support/inbox?${buildSupportEmailInboxQuery({
          status: statusFilter,
          query: debouncedNameQuery,
          limit: EMAIL_PAGE_SIZE,
          offset,
          assignee: assigneeFilter,
          unreadOnly,
          quickFilter: quickFilter === 'all' ? undefined : quickFilter,
        })}`,
      ))
      if (listFilterKeyRef.current !== listFilterKey || emailListRequestRef.current !== requestId) return
      if (res.success) {
        setEmailError('')
        if (append) {
          const rows = res.data.items
          setEmailItems((prev) => {
            const seen = new Set(prev.map((e) => e.id))
            return [...prev, ...rows.filter((r) => !seen.has(r.id))]
          })
          setHasMoreEmails(offset + rows.length < (res.data.summary?.total ?? offset + rows.length))
        } else {
          setEmailItems(res.data.items)
          setHasMoreEmails(res.data.items.length >= EMAIL_PAGE_SIZE
            && res.data.items.length < (res.data.summary?.total ?? res.data.items.length + 1))
        }
      } else {
        // 口が success:false を返したときも、0件と区別できるよう失敗を出す。
        setEmailError('メールの読み込みに失敗しました。')
        if (!append) setEmailItems([])
      }
    } catch {
      if (listFilterKeyRef.current !== listFilterKey || emailListRequestRef.current !== requestId) return
      // メールが出ないだけ。LINEのトークは使えるが、0件と区別できるよう失敗を出す。
      setEmailError('メールの読み込みに失敗しました。')
      if (!append) setEmailItems([])
    } finally {
      if (append && listFilterKeyRef.current === listFilterKey && emailListRequestRef.current === requestId) {
        emailMoreLockRef.current = false
        setLoadingMoreEmails(false)
      }
      if (!append && listFilterKeyRef.current === listFilterKey && emailListRequestRef.current === requestId) {
        setEmailListCompletedKey(listFilterKey)
        setEmailLoading(false)
      }
    }
  }, [statusFilter, debouncedNameQuery, assigneeFilter, unreadOnly, quickFilter, listFilterKey])

  useEffect(() => {
    void loadEmails()
  }, [loadEmails])

  const loadChats = useCallback(async () => {
    const requestId = ++chatListRequestRef.current
    setChats([])
    nextCursorRef.current = null
    setHasMoreChats(false)
    setLoadingMore(false)
    setLoading(true)
    setChatListFailed(false)
    setError('')
    try {
      // #625: 応答なしの要求は時間切れの失敗にし、読み込み中を残さない。
      const chatRes = await withRequestTimeout(api.chats.list(buildListParams(null)))
      if (listFilterKeyRef.current !== listFilterKey || chatListRequestRef.current !== requestId) return
      if (chatRes.success) {
        setChatListFailed(false)
        const rows = chatRes.data
        setChats(rows)
        const last = rows[rows.length - 1]
        nextCursorRef.current = toListCursor(last)
        // ページ丁度いっぱい返ってきた = 続きがある可能性が高い
        setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      } else {
        // 一覧の失敗は一覧の中の失敗行(再読み込みボタンつき)が伝える。
        // 上部の汎用 error は送信・詳細など別の操作の失敗に使う(N-030)。
        setChatListFailed(true)
      }
    } catch {
      if (listFilterKeyRef.current !== listFilterKey || chatListRequestRef.current !== requestId) return
      setChatListFailed(true)
    } finally {
      if (listFilterKeyRef.current === listFilterKey && chatListRequestRef.current === requestId) {
        setChatListCompletedKey(listFilterKey)
        setLoading(false)
      }
    }
  }, [buildListParams, listFilterKey])

  // 「さらに読み込む」— サーバ由来カーソルの続きを取得して末尾に追加する。
  // 楽観更新との競合に備えて既存 id は除外し、重複表示を防ぐ。
  const loadMoreChats = useCallback(async () => {
    if (loadingMore) return
    const cursor = nextCursorRef.current
    if (!cursor) {
      setHasMoreChats(false)
      return
    }
    setLoadingMore(true)
    const requestId = chatListRequestRef.current
    try {
      // #625: 応答なしの要求は時間切れの失敗にし、読み込み中を残さない。
      const chatRes = await withRequestTimeout(api.chats.list(buildListParams(cursor)))
      if (listFilterKeyRef.current !== listFilterKey || chatListRequestRef.current !== requestId) return
      if (chatRes.success) {
        const rows = chatRes.data
        setChats((prev) => {
          const seen = new Set(prev.map((c) => c.id))
          return [...prev, ...rows.filter((r) => !seen.has(r.id))]
        })
        const last = rows[rows.length - 1]
        nextCursorRef.current = toListCursor(last)
        setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      }
    } catch {
      if (listFilterKeyRef.current !== listFilterKey || chatListRequestRef.current !== requestId) return
      setError('チャットの追加読み込みに失敗しました。')
    } finally {
      if (listFilterKeyRef.current === listFilterKey && chatListRequestRef.current === requestId) setLoadingMore(false)
    }
  }, [loadingMore, buildListParams, listFilterKey])

  // Keep refs in sync so setChats updater can read the latest filter without stale closure
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])

  // Load/save sendMode preference (guarded — privacy-restricted browsers throw)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat.sendMode')
      if (saved === 'enter' || saved === 'shift-enter') setSendMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])

  /*
    保存検索の条件を画面の絞り込みへ写す。戻り値は条件が指す channel。
    ドロップダウンからの適用と、URLからの復元の両方が同じ手順を使う(N-021)。

    **形を確かめてから読む。** 受信箱より前に作られた行は
    `{ all: [], any: [] }` の形で入っていて、`conditions.statuses.length` を
    そのまま読むと受信箱ごと真っ白になる。
  */
  const applySavedViewConditions = useCallback((view: InboxSavedView): 'all' | 'line' | 'email' => {
    const conditions = normalizeSavedViewConditions(view.conditions)
    setNameQuery(clampSearchQuery(conditions.query ?? ''))
    setStatusFilter(conditions.statuses.length === 1 ? conditions.statuses[0] : 'all')
    setAssigneeFilter(conditions.assignees.length === 1 ? conditions.assignees[0] : 'all')
    /*
      N-020: 保存時の絞り込みをそのまま戻す。以前は due だけを見て
      「要返信」が「すべて」へ潰れ、未読だけ表示も落ちていた。
      古い行の quickFilter は normalizeSavedViewConditions が due から復元済み。
    */
    setQuickFilter(conditions.quickFilter)
    setUnreadOnly(conditions.unread === 'mine')
    return conditions.channels.length === 1 ? conditions.channels[0] : 'all'
  }, [])

  /*
    手で条件を変えたら、URLの savedView は現在の条件を指さなくなる。
    残すと再読込・URL共有で古い条件が復活するので外す(N-021)。
    channel・friend・thread など他の指定はそのまま残す。
  */
  const dropSavedViewParam = useCallback(() => {
    const current = params.get(SAVED_VIEW_URL_KEY)
    if (!current) return
    // URLの更新が届くまでの間に復元効果が同じIDを再適用しないよう、
    // 外す時点で処理済みにする(N-021)。
    savedViewConsumedRef.current = current
    const next = new URLSearchParams(params.toString())
    next.delete(SAVED_VIEW_URL_KEY)
    const text = next.toString()
    router.replace(text ? `/chats?${text}` : '/chats')
  }, [params, router])

  const loadSavedViews = useCallback(async () => {
    const accountId = selectedAccountId
    // 切替中に前のアカウントの応答が遅れて届いても、新しい一覧を上書きしない。
    savedViewsRequestAccountRef.current = accountId
    if (!accountId) {
      setSavedViews([])
      setSavedViewsAccountId(null)
      return
    }
    try {
      const response = await api.chats.savedViews.list(accountId)
      if (savedViewsRequestAccountRef.current !== accountId) return
      if (response.success) {
        setSavedViews(response.data.map((view) => ({
          ...view,
          conditions: normalizeSavedViewConditions(view.conditions),
        })))
        setSavedViewsAccountId(accountId)
      }
    } catch {
      if (savedViewsRequestAccountRef.current !== accountId) return
      setSavedViewError('保存した検索を読み込めませんでした')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadSavedViews()
  }, [loadSavedViews])

  /*
    URLの `savedView=<id>` を、いま選んでいるアカウントの保存検索へ照合して復元する(N-021)。

    - 一覧はアカウントごとに取り直す。現在のアカウント分が届くまでは
      何もしない。届く前に前のアカウントの一覧で探すと、別アカウントの
      IDを誤って適用する。
    - IDが見つからない（削除済み・別アカウント・不正）ときは適用せず、
      既定条件へ戻して案内し、URLからも外す。残すと再読込のたびに
      同じ案内が出る。
    - 見つかったときは条件を写す。保存された channel が今と違えば
      URL側をそろえる（channel はURLが正本）。
    - 手で条件を変えたときは dropSavedViewParam が先にIDを外すので、
      ここで古い条件が再上書きされることはない。
  */
  useEffect(() => {
    if (!savedViewParam) {
      // URLから外れたら処理済み印も戻す。同じ検索を選び直せるようにする。
      savedViewConsumedRef.current = null
      return
    }
    // 同じ値は一度だけ処理する。手動変更で外した直後の再適用を防ぐ。
    if (savedViewConsumedRef.current === savedViewParam) return
    if (accountsLoading) return
    if (selectedAccountId && savedViewsAccountId !== selectedAccountId) return
    savedViewConsumedRef.current = savedViewParam
    const view = savedViews.find((item) => item.id === savedViewParam)
    if (!view) {
      setNameQuery('')
      setDebouncedNameQuery('')
      setStatusFilter('all')
      setQuickFilter('all')
      setAssigneeFilter('all')
      setUnreadOnly(false)
      setSavedViewNotice('URLの保存した検索は見つかりませんでした。削除されたか、別のLINEアカウントの検索の可能性があります。既定の条件で表示しています。')
      dropSavedViewParam()
      return
    }
    const nextChannel = applySavedViewConditions(view)
    setSavedViewNotice('')
    if (nextChannel !== channel) {
      const next = new URLSearchParams(params.toString())
      if (nextChannel === 'all') next.delete('channel')
      else next.set('channel', nextChannel)
      const text = next.toString()
      router.replace(text ? `/chats?${text}` : '/chats')
    }
  }, [savedViewParam, savedViews, savedViewsAccountId, selectedAccountId, accountsLoading, channel, params, router, applySavedViewConditions, dropSavedViewParam])

  const currentSavedViewConditions = (draft?: Omit<SavedViewDraft, 'name' | 'favorite'>): InboxSavedViewConditions => {
    /*
      N-020: 「未読だけ表示」とクイック絞り込み（要返信／期限超過）も保存する。
      quickFilter の overdue は旧軸 due にも写して、古いWorkerの件数計算が
      同じ条件で数えられるようにする。
    */
    const savedQuickFilter = draft?.quickFilter ?? quickFilter
    return {
      version: 1,
      // #625: 保存する検索語も画面と同じ上限へそろえる。
      query: clampSearchQuery(nameQuery.trim()),
      channels: (draft?.channel ?? channel) === 'all'
        ? ['line', 'email']
        : [(draft?.channel ?? channel) as 'line' | 'email'],
      statuses: (draft?.status ?? statusFilter) === 'all'
        ? ['unread', 'in_progress', 'on_hold', 'resolved']
        : [(draft?.status ?? statusFilter) as Exclude<StatusFilter, 'all'>],
      assignees: (draft?.assignee ?? assigneeFilter) === 'all' ? [] : [draft?.assignee ?? assigneeFilter],
      unread: (draft?.unreadOnly ?? unreadOnly) ? 'mine' : 'all',
      quickFilter: savedQuickFilter,
      messageTypes: [],
      receivedFrom: null,
      receivedTo: null,
      sort: 'newest',
      due: savedQuickFilter === 'overdue' ? 'overdue' : 'all',
    }
  }

  const createSavedView = async (draft?: SavedViewDraft): Promise<SavedViewSaveResult> => {
    if (savingView) return { success: false, error: '保存処理が終わるまでお待ちください' }
    // モーダルから呼ぶときは、そこで打った名前をそのまま使う。
    // 状態の更新を待つと、1回目の保存が空の名前で走る。
    const name = (draft?.name ?? savedViewName).trim()
    if (!name) {
      const message = '名前を入力してください'
      setSavedViewError(message)
      return { success: false, error: message }
    }
    setSavingView(true)
    setSavedViewError('')
    try {
      if (!selectedAccountId) {
        const message = 'LINE公式アカウントを選んでください'
        setSavedViewError(message)
        return { success: false, error: message }
      }
      const response = await api.chats.savedViews.create(selectedAccountId, {
        name,
        conditions: currentSavedViewConditions(draft),
        isFavorite: draft?.favorite ?? false,
      })
      if (!response.success) {
        const message = '保存できませんでした。時間を置いてもう一度お試しください。'
        setSavedViewError(message)
        return { success: false, error: message }
      }
      setSavedViewName('')
      await loadSavedViews()
      setSaveDialogOpen(false)
      setSavedViewsOpen(true)
      setSavedViewSuccess(true)
      return { success: true }
    } catch (reason) {
      /*
        **失敗の種類で言い分ける。** fetchApi は !ok を ApiError として投げる
        ので、409(同名の競合)も403(権限)も通信障害もここへ来る。全部を
        「時間を置いて」と言うと、名前を変えれば直る競合まで待たせてしまう
        (N-027)。文言は運用者向けに作り、APIの内部文言は素通ししない。
      */
      const message = savedViewFailureMessage(reason)
      setSavedViewError(message)
      return { success: false, error: message }
    } finally {
      setSavingView(false)
    }
  }

  const applySavedView = (view: InboxSavedView) => {
    const nextChannel = applySavedViewConditions(view)
    setSavedViewNotice('')
    // savedView=<id> をURLへ残す。残さないと再読込・共有で条件が消える(N-021)。
    savedViewConsumedRef.current = view.id
    router.push(buildInboxUrl(nextChannel, view.id))
    setSavedViewsOpen(false)
  }
  useEffect(() => {
    try { localStorage.setItem('chat.sendMode', sendMode) } catch { /* ignore */ }
  }, [sendMode])

  // 会話詳細は直近100件ずつ。全文一括(1000件)だと長期の会話で応答が重い。
  // 古い分は「前のメッセージ」で遡る。
  const CHAT_MESSAGE_PAGE_SIZE = 100
  const [messagesHasMore, setMessagesHasMore] = useState(false)
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)

  const loadChatDetail = useCallback(async (chatId: string) => {
    /*
     * 呼び出しの時点で開いている会話と違う相手への要求は丸ごと捨てる
     * (A02-01)。更新操作の完了後に遅れて走る再読込が、切替先の会話の
     * 応答を無効化して前の会話を表示し直すのを防ぐ。世代のカウントも
     * 進めないので、いま走っている新しい会話の取得はそのまま生きる。
     */
    if (selectedChatIdRef.current !== chatId) return
    const requestedAccountId = detailAccountRef.current
    const requestId = ++detailRequestIdRef.current
    setDetailLoading(true)
    setError('')
    try {
      const res = await api.chats.get(chatId, { limit: CHAT_MESSAGE_PAGE_SIZE })
      if (requestId !== detailRequestIdRef.current) return
      // 取得の途中で別の会話・アカウントへ切り替わっていたら適用しない。
      if (selectedChatIdRef.current !== chatId || detailAccountRef.current !== requestedAccountId) return
      if (res.success) {
        const detail = res.data
        setChatDetail(detail)
        setMessagesHasMore(detail.hasMoreMessages === true)
        // URL指定の会話が開けた。案内は消す(#673)。
        if (deepLinkIdRef.current === chatId) setDeepLinkNotice('')
      } else {
        setChatDetail(null)
        setMessagesHasMore(false)
        setError('会話を読み込めませんでした。時間を置いてもう一度お試しください。')
        // 存在しない・別アカウントのIDでも別人を開かず、案内を出す(#673)。
        // 口は存在の有無を404に倒すので、ここでは区別しない。
        if (deepLinkIdRef.current === chatId) setDeepLinkNotice(DEEP_LINK_NOTICE.unavailable)
      }
    } catch {
      if (requestId !== detailRequestIdRef.current) return
      setChatDetail(null)
      setMessagesHasMore(false)
      setError('会話を読み込めませんでした。時間を置いてもう一度お試しください。')
      if (deepLinkIdRef.current === chatId) setDeepLinkNotice(DEEP_LINK_NOTICE.unavailable)
    } finally {
      if (requestId === detailRequestIdRef.current) setDetailLoading(false)
    }
  }, [])

  // 「前のメッセージ」— 表示中の最古の1件より古い分を先頭に足す。
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages || !selectedChatId) return
    const oldest = chatDetail?.messages?.[0]
    if (!oldest) {
      setMessagesHasMore(false)
      return
    }
    /*
     * 取得の起点となった会話とアカウントを固定する(#962 F03)。
     * 応答が遅れて別の会話・アカウントへ切り替わったあとに届いても、
     * そこへ前の会話の履歴を混ぜない。
     */
    const requestedChatId = selectedChatId
    const requestedAccountId = selectedAccountId
    setLoadingOlderMessages(true)
    try {
      const res = await api.chats.get(requestedChatId, {
        limit: CHAT_MESSAGE_PAGE_SIZE,
        beforeAt: oldest.eventAt ?? oldest.createdAt,
        beforeId: oldest.id,
      })
      if (selectedChatIdRef.current !== requestedChatId || detailAccountRef.current !== requestedAccountId) return
      if (res.success) {
        const detail = res.data
        const rows = detail.messages ?? []
        /*
         * INBOX-27: 上へ足す追加なので、いま読んでいる位置を保持する。
         * 追加前の高さを記録し、描画後の効果で「増えた分だけscrollTopを
         * 足す」ことで同じメッセージが同じ画面位置に残る。
         */
        const el = messagesScrollRef.current
        if (el) pendingPrependRef.current = { scrollHeight: el.scrollHeight, scrollTop: el.scrollTop }
        setChatDetail((prev) => {
          if (!prev || prev.id !== requestedChatId) return prev
          const seen = new Set((prev.messages ?? []).map((m) => m.id))
          return { ...prev, messages: [...rows.filter((m) => !seen.has(m.id)), ...(prev.messages ?? [])] }
        })
        setMessagesHasMore(detail.hasMoreMessages === true)
      }
    } catch {
      if (selectedChatIdRef.current !== requestedChatId || detailAccountRef.current !== requestedAccountId) return
      setError('前のメッセージを読み込めませんでした。')
    } finally {
      setLoadingOlderMessages(false)
    }
  }, [loadingOlderMessages, selectedChatId, selectedAccountId, chatDetail?.messages])

  /*
   * INBOX-12: 開いている会話を静かに取り直す。
   * 会話ID・アカウント・定期取得の世代の照合を通った応答だけを適用する
   * ので、切替前に出した遅い応答は別の会話へ混ざらない。世代は初回
   * 読み込み(loadChatDetail)が使う detailRequestIdRef とは別にする。
   * 共有すると定期取得が初回読み込みを「古い応答」にして読み込み中の
   * まま止まる。
   * 「前のメッセージ」で遡って読み込んだ古い分は消さずに残す。
   */
  const detailPollSeqRef = useRef(0)
  const refreshChatDetailQuietly = useCallback(async (): Promise<boolean> => {
    const chatId = selectedChatIdRef.current
    if (!chatId) return true
    const requestId = ++detailPollSeqRef.current
    const accountId = detailAccountRef.current
    try {
      const res = await api.chats.get(chatId, { limit: CHAT_MESSAGE_PAGE_SIZE })
      if (requestId !== detailPollSeqRef.current) return true
      if (selectedChatIdRef.current !== chatId || detailAccountRef.current !== accountId) return true
      if (!res.success) return false
      const detail = res.data
      let keptOlder = false
      setChatDetail((prev) => {
        if (!prev || prev.id !== detail.id) return detail
        const latest = detail.messages ?? []
        const prevMsgs = prev.messages ?? []
        const latestIds = new Set(latest.map((m) => m.id))
        const windowStart = latest[0]?.createdAt ?? ''
        const older = prevMsgs.filter(
          (m) => !latestIds.has(m.id) && (!windowStart || m.createdAt < windowStart),
        )
        keptOlder = older.length > 0
        return { ...detail, messages: [...older, ...latest] }
      })
      if (keptOlder) {
        // 遡った分を残している間は「さらに古い分があるか」は前の値を守る。
      } else {
        setMessagesHasMore(detail.hasMoreMessages === true)
      }
      return true
    } catch {
      return false
    }
  }, [])

  // 一覧も静かに取り直す。全画面の読み込み(loadChats)は一覧を空にして
  // 操作を止めるので、定期更新では既存の並びを崩さずに差し替える。
  const listPollRequestRef = useRef(0)
  const loadChatsQuietly = useCallback(async (): Promise<boolean> => {
    const requestId = ++listPollRequestRef.current
    try {
      const res = await api.chats.list(buildListParams(null))
      if (listPollRequestRef.current !== requestId) return true
      if (listFilterKeyRef.current !== listFilterKey) return true
      if (!res.success) return false
      const rows = res.data
      setChats((prev) => {
        const freshIds = new Set(rows.map((row) => row.id))
        const merged = rows.slice()
        // 「さらに読み込む」で足した分は一覧の下に残す。
        for (const chat of prev) if (!freshIds.has(chat.id)) merged.push(chat)
        return merged
      })
      const last = rows[rows.length - 1]
      nextCursorRef.current = toListCursor(last)
      setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      setChatListFailed(false)
      return true
    } catch {
      return false
    }
  }, [buildListParams, listFilterKey])

  /*
   * INBOX-12: 会話の定期更新。
   * 画面が見えている間だけ5秒起点で取り直す(タブを隠すと止まり、
   * 戻ると再開する)。失敗は待ちを延ばし、5回続いたら止まって理由と
   * 再試行を出す。応答を適用するのは照合を通った時だけ。
   */
  const [chatPollStalled, setChatPollStalled] = useState(false)
  const [chatPollRetryKey, setChatPollRetryKey] = useState(0)
  useEffect(() => {
    setChatPollStalled(false)
    const poll = startVisiblePoll({
      work: async () => {
        const detailOk = await refreshChatDetailQuietly()
        const listOk = channel === 'email' ? true : await loadChatsQuietly()
        if (!detailOk || !listOk) throw new Error('inbox poll failed')
      },
      onGiveUp: () => setChatPollStalled(true),
      onRecovered: () => setChatPollStalled(false),
    })
    return () => poll.stop()
  }, [refreshChatDetailQuietly, loadChatsQuietly, channel, chatPollRetryKey])

  // 同じ会話IDが別アカウントにも存在していても、切替前の遅い応答を表示しない。
  // 初回表示では深いリンクを消さず、実際にアカウントが変わったときだけ外す。
  useEffect(() => {
    if (detailAccountRef.current === selectedAccountId) return
    detailAccountRef.current = selectedAccountId
    detailRequestIdRef.current += 1
    setSelectedChatId(null)
    setChatDetail(null)
    setDetailLoading(false)
    setAttentionSaving(false)
  }, [selectedAccountId])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  useEffect(() => {
    const refresh = () => {
      void loadChats()
      void loadEmails()
    }
    window.addEventListener(UNANSWERED_REFRESH_EVENT, refresh)
    return () => window.removeEventListener(UNANSWERED_REFRESH_EVENT, refresh)
  }, [loadChats, loadEmails])

  // Deep-link from other pages. LINE is ?friend=<friendId> (?friendId= is
  // the old form kept for shared URLs), email is ?thread=<threadId>.
  // Selecting one side always clears the other so the center panel has
  // exactly one conversation to show. Re-runs on URL change so back/forward
  // and shared URLs keep the target; reload works because the target lives
  // in the URL (#673). Manual selection never rewrites the URL, so a
  // state-only change never triggers this.
  //
  // 会話を開く前に、対象の友だちが「いま選んでいるLINEアカウント」の相手か
  // を必ず確かめる。`GET /api/chats/:id` は見る権限だけを見ており、画面で
  // 選んでいるアカウントは見ない(apps/worker の requireVisibleChat)。
  // A社とB社の両方を見られる担当者がB選択中にA社の友だちのURLを開くと、
  // 会話はA社なのに送信元の表示はB社になり、そのまま返信すると別アカウント
  // から送ってしまう。だからここで選択中アカウントへ固定する(#673)。
  useEffect(() => {
    const threadId = (params.get('thread') ?? '').trim()
    const rawFriend = (params.get('friend') ?? params.get('friendId') ?? '').trim()
    if (threadId) {
      deepLinkRequestIdRef.current += 1
      deepLinkIdRef.current = null
      setDeepLinkNotice('')
      setSelectedChatId(null)
      setSelectedThreadId(threadId)
      return
    }
    // URLに対象が無いときは何もしない。手で選んだ会話を消さない。
    if (!rawFriend) return
    const requestId = deepLinkRequestIdRef.current + 1
    deepLinkRequestIdRef.current = requestId
    if (!isSafeFriendIdForInbox(rawFriend)) {
      // 不正なIDは口へ渡さず、別人も開かない。案内だけ出す。
      deepLinkIdRef.current = rawFriend
      setSelectedThreadId(null)
      setSelectedChatId(null)
      setDeepLinkNotice(DEEP_LINK_NOTICE.malformed)
      return
    }
    // アカウント一覧が届くまでは判定できない。届いてから同じ効果が
    // もう一度動くので、ここでは開かずに待つ。先に開くと、照合前の
    // 会話が一瞬見えてしまう。
    if (accountsLoading) return

    deepLinkIdRef.current = rawFriend
    setSelectedThreadId(null)
    // 照合できるまでは会話を選ばない。ここで選ぶと `api.chats.get` が
    // 走り、別アカウントの会話が表示されてしまう。
    setSelectedChatId(null)
    setDeepLinkNotice('')

    let cancelled = false
    void (async () => {
      let friendAccountId: string | null = null
      try {
        const res = await api.friends.get(rawFriend)
        if (!res.success) {
          if (!cancelled && deepLinkRequestIdRef.current === requestId) {
            setDeepLinkNotice(DEEP_LINK_NOTICE.unavailable)
          }
          return
        }
        // `lineAccountId` は `GET /api/friends/:id` の実応答にあるが、
        // 共有の型にはまだ無い。ここだけで読む。
        friendAccountId = (res.data as { lineAccountId?: string | null }).lineAccountId ?? null
      } catch {
        if (!cancelled && deepLinkRequestIdRef.current === requestId) {
          setDeepLinkNotice(DEEP_LINK_NOTICE.unavailable)
        }
        return
      }
      if (cancelled || deepLinkRequestIdRef.current !== requestId) return
      // アカウントを選んでいないときは送信元も出ないので、取り違えは
      // 起きない。一覧も全アカウント分を出しているので、ここは通す。
      if (selectedAccountId && friendAccountId !== selectedAccountId) {
        setDeepLinkNotice(DEEP_LINK_NOTICE.otherAccount)
        return
      }
      setDeepLinkNotice('')
      setSelectedChatId(rawFriend)
    })()
    return () => { cancelled = true }
  }, [params, selectedAccountId, accountsLoading])

  useEffect(() => {
    if (selectedChatId) {
      loadChatDetail(selectedChatId)
    } else {
      detailRequestIdRef.current += 1
      setChatDetail(null)
      setDetailLoading(false)
    }
  }, [selectedChatId, loadChatDetail])

  // N-025: 会話を開いた/変えたとき、その会話の送信予約を読む。
  // 予約はfriend単位なので会話IDはそのまま使える。失敗しても画面は止めない。
  const loadScheduledSends = useCallback(async (chatId: string) => {
    // 取得の起点となったアカウントを固定する。切替後に届いた応答は捨てる。
    const requestedAccountId = detailAccountRef.current
    try {
      const res = await api.chats.scheduled(chatId)
      if (selectedChatIdRef.current !== chatId || detailAccountRef.current !== requestedAccountId) return
      // 口の形が変わったり古い環境の応答でも、一覧は必ず配列を保つ。
      if (res.success) {
        setScheduledSendsFailed(false)
        setScheduledSends(Array.isArray(res.data?.scheduled) ? res.data.scheduled : [])
      } else {
        setScheduledSendsFailed(true)
      }
    } catch {
      if (selectedChatIdRef.current !== chatId || detailAccountRef.current !== requestedAccountId) return
      // 失敗を「予約なし」にしない。一覧は空に戻さず、失敗だけを知らせる(#962)。
      setScheduledSendsFailed(true)
    }
  }, [])

  useEffect(() => {
    // 会話を切り替えたら前の会話の予約を残さない。応答が遅れても
    // その間に前の会話の行が見える事故を防ぐ(#962 F07)。
    setScheduledSends([])
    setScheduledSendsFailed(false)
    if (selectedChatId) {
      void loadScheduledSends(selectedChatId)
    }
  }, [selectedChatId, loadScheduledSends])

  useEffect(() => {
    setMemoDraft(chatDetail?.notes ?? '')
    setMemoError('')
    setShowMemoEditor(false)
  }, [chatDetail?.id, chatDetail?.notes])

  // 会話を切り替えたら引用中の選択と予約パネルは閉じる。
  // 前の会話のメッセージを引用したまま別の会話へ送ると、別friendの
  // メッセージ指定で口が404を返すため、ここで必ず外す。
  useEffect(() => {
    setQuotedMessage(null)
    setShowSchedulePanel(false)
    setScheduleInput('')
  }, [selectedChatId])

  /*
   * 会話・アカウントを切り替えたら、いまの下書きを前の会話の鍵で預け、
   * 次の会話に預けてあった下書きを戻す(#962 F06)。切り替えただけで
   * 書きかけの文面や添付が消えないようにする。
   */
  useEffect(() => {
    const nextKey = draftKeyOf(selectedAccountId, selectedChatId)
    const prevKey = draftOwnerKeyRef.current
    if (prevKey === nextKey) return
    draftOwnerKeyRef.current = nextKey
    const stashedText = messageContentRef.current
    if (stashedText) messageDraftsRef.current.set(prevKey, stashedText)
    else messageDraftsRef.current.delete(prevKey)
    setMessageContent(messageDraftsRef.current.get(nextKey) ?? '')
    const stashedImage = pendingImageRef.current
    if (stashedImage) imageDraftsRef.current.set(prevKey, stashedImage)
    else imageDraftsRef.current.delete(prevKey)
    setPendingImage(imageDraftsRef.current.get(nextKey) ?? null)
    // 添付のファイル名・準備の失敗も会話ごとに預かる(INBOX-23/32)。
    const stashedMeta = pendingImageMetaRef.current
    if (stashedMeta) imageMetaDraftsRef.current.set(prevKey, stashedMeta)
    else imageMetaDraftsRef.current.delete(prevKey)
    setPendingImageMeta(imageMetaDraftsRef.current.get(nextKey) ?? null)
    const stashedImageError = imageErrorRef.current
    if (stashedImageError) imageErrorDraftsRef.current.set(prevKey, stashedImageError)
    else imageErrorDraftsRef.current.delete(prevKey)
    setImageError(imageErrorDraftsRef.current.get(nextKey) ?? '')
    setImagePreviewOpen(false)
  }, [selectedAccountId, selectedChatId])

  // Surface deep-linked chats in the sidebar even when the current account
  // filter or status filter would exclude them — otherwise the user replies
  // and the conversation stays invisible until they refresh.
  // Re-runs when `chats` changes (e.g. after loadChats refetches on filter
  // change) so the synthetic entry is re-injected if the next API result
  // does not include it. Returning `prev` unchanged when already present
  // avoids any update loop.
  useEffect(() => {
    if (!chatDetail) return
    setChats((prev) => {
      if (prev.some((c) => c.id === chatDetail.id)) return prev
      // /api/chats/:id may not populate the lastMessage* fields; derive
      // from the messages array as a fallback so the sidebar preview is
      // not stuck on "(まだメッセージなし)".
      const lastMsg = chatDetail.messages?.[chatDetail.messages.length - 1]
      const entry: Chat = {
        id: chatDetail.id,
        friendId: chatDetail.friendId,
        friendName: chatDetail.friendName,
        friendPictureUrl: chatDetail.friendPictureUrl,
        operatorId: chatDetail.operatorId ?? null,
        status: chatDetail.status,
        notes: chatDetail.notes ?? null,
        revision: chatDetail.revision,
        lastMessageAt: chatDetail.lastMessageAt ?? lastMsg?.createdAt ?? null,
        lastMessageContent: chatDetail.lastMessageContent ?? lastMsg?.content ?? null,
        lastMessageDirection: chatDetail.lastMessageDirection ?? lastMsg?.direction ?? null,
        lastMessageType: chatDetail.lastMessageType ?? (lastMsg?.isUnsent ? 'unsent' : lastMsg?.messageType) ?? null,
        isUnread: false,
        createdAt: chatDetail.createdAt,
        updatedAt: chatDetail.updatedAt ?? chatDetail.createdAt,
      }
      return [entry, ...prev]
    })
  }, [chatDetail, chats])

  /*
   * INBOX-27: メッセージの描画後にスクロール位置を決める。
   *
   * - 最初の表示・会話の切替 … 新しい方(下端)から見せる。
   * - 「前のメッセージ」で上へ足した … 高さの増分だけ scrollTop を足して、
   *   読んでいたメッセージが同じ画面位置に残るようにする。
   * - 下への新着(自分の送信・相手の返信・定期更新) … 下端にいる時だけ
   *   追従。読み返している途中なら動かさず、新着件数の目印を出す。
   */
  useLayoutEffect(() => {
    const el = messagesScrollRef.current
    const list = chatDetail?.messages
    if (!el || !list || list.length === 0) {
      if (!list || list.length === 0) prevMessageWindowRef.current = null
      return
    }
    const lastId = list[list.length - 1]?.id ?? null
    const prev = prevMessageWindowRef.current
    prevMessageWindowRef.current = { chatId: chatDetail.id, lastId, count: list.length }

    const prepend = pendingPrependRef.current
    pendingPrependRef.current = null
    if (prepend) {
      const delta = el.scrollHeight - prepend.scrollHeight
      if (delta > 0) el.scrollTop = prepend.scrollTop + delta
      return
    }

    const sameChat = prev?.chatId === chatDetail.id
    if (!sameChat) {
      el.scrollTop = el.scrollHeight
      return
    }
    const appended = prev.lastId !== lastId
    if (appended && !stickToBottomRef.current) {
      // 読み返し中に届いた分は動かさず、実際に増えた相手からの件数だけ出す。
      const prevIndex = list.findIndex((m) => m.id === prev.lastId)
      const fresh = prevIndex >= 0 ? list.slice(prevIndex + 1) : list
      const incomingCount = fresh.filter((m) => m.direction === 'incoming').length
      if (incomingCount > 0) setUnseenIncoming((count) => count + incomingCount)
      return
    }
    el.scrollTop = el.scrollHeight
  }, [chatDetail?.messages, chatDetail?.id])

  // 画像などの遅れての読み込みで高さが伸びても、読み返し中の位置を崩さない。
  // 下端にいる時だけ下端へ寄せ直す。失敗→代替表示で高さが縮む場合も同じ。
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el || typeof MutationObserver === 'undefined') return
    const observer = new MutationObserver(() => {
      if (pendingPrependRef.current) return
      if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(el, { childList: true, subtree: true, attributes: true })
    return () => observer.disconnect()
  }, [selectedChatId])

  // スクロール位置を追い続ける。下端にいる間だけ新着へ追従する(INBOX-27)。
  useEffect(() => {
    const el = messagesScrollRef.current
    if (!el) return
    const onScroll = () => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 40
      stickToBottomRef.current = atBottom
      if (atBottom) setUnseenIncoming(0)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => el.removeEventListener('scroll', onScroll)
  }, [selectedChatId])

  // Auto-resize textarea as messageContent grows (INBOX-20: 3行〜8行で伸ばす)
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT_PX)}px`
  }, [messageContent])

  // 案内付きの空状態から一覧へ戻る。URLの指定も外す。
  // 外さないと再読込で同じ指定が復活する(#673)。
  const clearDeepLink = () => {
    deepLinkRequestIdRef.current += 1
    deepLinkIdRef.current = null
    setDeepLinkNotice('')
    setSelectedChatId(null)
    // 会話の指定だけ外す。保存検索は一覧の条件なので残す(N-021)。
    router.replace(buildInboxUrl(channel, savedViewParam || null))
  }

  // 状態の切り替えの5つの押し場所。選んでいる所だけ Tab で止まる
  // （ラジオの決まり）。左右・先頭・末尾のキーで選ぶ。
  const statusFilterButtonRefs = useRef<(HTMLButtonElement | null)[]>([])
  const handleStatusFilterKeyDown = (event: React.KeyboardEvent) => {
    const current = statusFilters.findIndex((f) => f.key === statusFilter)
    let next: number | null = null
    if (event.key === 'ArrowRight') next = (current + 1) % statusFilters.length
    else if (event.key === 'ArrowLeft') next = (current - 1 + statusFilters.length) % statusFilters.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = statusFilters.length - 1
    if (next == null) return
    event.preventDefault()
    const filter = statusFilters[next]
    setStatusFilter(filter.key)
    dropSavedViewParam()
    statusFilterButtonRefs.current[next]?.focus()
  }

  const handleSelectChat = (chatId: string) => {
    // 手選びはURL指定を上書きする。古い案内とURL状態を残さない。
    // friend / thread を残すと、再読込で手選び前の会話へ戻る(#673)。
    // 世代も進める。進めないと、走っている友だち照会が後から
    // 手で選んだ会話を上書きする。
    deepLinkRequestIdRef.current += 1
    deepLinkIdRef.current = null
    setDeepLinkNotice('')
    setSelectedChatId(chatId)
    // friend は外すが、一覧条件の savedView は残す(N-021)。
    router.replace(buildInboxUrl(channel, savedViewParam || null))
    // 既読はログイン中の担当者だけに反映する。対応状況は変えない。
    setChats((prev) => prev.map((chat) => (
      chat.id === chatId ? { ...chat, isUnread: false } : chat
    )))
    void api.chats.markRead(chatId).catch(() => {
      // 会話を開く処理は止めない。次の一覧取得で正しい未読へ戻る。
    })
    /*
     * 開いていたメールを外す。
     *
     * 右側は「メールが選ばれていたらメール」を先に見るので、ここで
     * 外さないと、LINEのトークを選んでも前のメールが出たままになる。
     * メールを一度開くと、以後どのトークも開けなくなっていた。
     * メール側は逆にLINEの選択を外していたので、片側だけ抜けていた。
     */
    setSelectedThreadId(null)
    // 下書きは会話ごとの預かりに移した(#962 F06)。ここで消すと、
    // 切り替えただけで書きかけが消える。預け・戻しは上の効果が担う。
  }

  /*
   * 送信・予約に使った版の下書きだけを預かりから外す(#962 F06)。
   * 応答を待つ間に文面へ追記したり画像を付け替えたりしていれば、
   * それは別の版なので残す。
   */
  const dropSentDraft = (
    chatId: string,
    accountId: string | null,
    sent: { content?: string; image?: ImageUploaderValue | null },
  ) => {
    const key = draftKeyOf(accountId, chatId)
    if (sent.content !== undefined && messageDraftsRef.current.get(key)?.trim() === sent.content) {
      messageDraftsRef.current.delete(key)
    }
    if (sent.image && imageDraftsRef.current.get(key) === sent.image) {
      imageDraftsRef.current.delete(key)
      imageMetaDraftsRef.current.delete(key)
    }
  }

  const handleSendMessage = async () => {
    if (!selectedChatId || sending || sendLockRef.current) return
    if (!messageContent.trim() && !pendingImage) return
    // INBOX-29: 上限を超えた本文は送らない(下書きは消さない)。
    if (messageContent.length > MESSAGE_MAX_LENGTH) {
      setError(`メッセージは${MESSAGE_MAX_LENGTH.toLocaleString()}文字までです。`)
      return
    }
    const sendingChatId = selectedChatId  // capture the chat id for this send
    const sendingAccountId = selectedAccountId  // 送信開始時のアカウントを固定する
    sendLockRef.current = true
    setSending(true)
    try {
      const now = new Date().toISOString()
      let currentRevision = chatDetail?.revision
      // N-022: 画像と本文が両方あるときは1回の結合送信にする。
      // 2回に分けると画像だけ届く部分送信になる。
      const useCombined = Boolean(pendingImage && pendingImage.mode === 'line-image' && messageContent.trim())
      if (useCombined && pendingImage && pendingImage.mode === 'line-image') {
        const content = messageContent.trim()
        const imgPayload = JSON.stringify({
          originalContentUrl: pendingImage.originalContentUrl,
          previewImageUrl: pendingImage.previewImageUrl,
        })
        const signature = JSON.stringify({ chatId: sendingChatId, combined: true, image: imgPayload, content, quotedMessageId: quotedMessage?.id ?? null })
        const sendResult = await api.chats.sendCombined(sendingChatId,
          {
            image: {
              originalContentUrl: pendingImage.originalContentUrl,
              previewImageUrl: pendingImage.previewImageUrl,
            },
            text: content,
            revision: currentRevision,
            quotedMessageId: quotedMessage?.id,
          },
          sendKeysRef.current.get(signature),
        )
        if (sendResult.success) currentRevision = sendResult.data.revision
        sendKeysRef.current.clear(signature)
        /*
         * 送信した版だけを消す(#962 F06)。応答を待つ間に別の会話・別
         * アカウントへ切り替わっていたり、同じ会話でも送信中に追記・
         * 付け替えされていれば、その下書きと添付は残す。
         */
        dropSentDraft(sendingChatId, sendingAccountId, { content, image: pendingImage })
        if (selectedChatIdRef.current === sendingChatId && detailAccountRef.current === sendingAccountId) {
          if (pendingImageRef.current === pendingImage) {
            setPendingImage(null)
            setPendingImageMeta(null)
          }
          setMessageContent((prev) => (prev.trim() === content ? '' : prev))
        }
        const staffName = sendResult.success ? sendResult.data.sentByStaffName : '自分'
        const combinedMessages = [
          buildOutgoingMessage({ messageType: 'image', content: imgPayload, sentByStaffName: staffName, sentAt: now }),
          buildOutgoingMessage({ messageType: 'text', content, sentByStaffName: staffName, sentAt: now }),
        ]
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          revision: sendResult.success ? sendResult.data.revision : prev.revision,
          messages: [...(prev.messages ?? []), ...combinedMessages],
        } : prev)
        setChats((prev) => {
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          return refreshChatListAfterSend(prev, statusFilterRef.current, (c) => (c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            lastMessageContent: content,
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'text' as const,
          } : c))
        })
      }
      // --- Image send path (runs first when image is present) ---
      if (!useCombined && pendingImage && pendingImage.mode === 'line-image') {
        const imgPayload = JSON.stringify({
          originalContentUrl: pendingImage.originalContentUrl,
          previewImageUrl: pendingImage.previewImageUrl,
        })
        const signature = JSON.stringify({ chatId: sendingChatId, messageType: 'image', content: imgPayload, quotedMessageId: quotedMessage?.id ?? null })
        const sendResult = await api.chats.send(sendingChatId,
          { messageType: 'image', content: imgPayload, revision: currentRevision, quotedMessageId: quotedMessage?.id },
          sendKeysRef.current.get(signature),
        )
        if (sendResult.success) currentRevision = sendResult.data.revision
        sendKeysRef.current.clear(signature)
        dropSentDraft(sendingChatId, sendingAccountId, { image: pendingImage })
        // 送信した会話が開かれたまま、かつ添付が送った版のままのときだけ外す(#962 F06)。
        if (selectedChatIdRef.current === sendingChatId && detailAccountRef.current === sendingAccountId) {
          if (pendingImageRef.current === pendingImage) {
            setPendingImage(null)
            setPendingImageMeta(null)
          }
        }
        // Optimistic update for image
        const imageMessage = buildOutgoingMessage({
          messageType: 'image',
          content: imgPayload,
          sentByStaffName: sendResult.success ? sendResult.data.sentByStaffName : '自分',
          sentAt: now,
        })
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          revision: sendResult.success ? sendResult.data.revision : prev.revision,
          messages: [...(prev.messages ?? []), imageMessage],
        } : prev)
        setChats((prev) => {
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          // 返信すると対応中に変わるので、別の絞り込みを見ているときは一覧から外れる
          return refreshChatListAfterSend(prev, statusFilterRef.current, (c) => (c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            lastMessageContent: '[画像]',
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'image' as const,
          } : c))
        })
      }
      // --- Text send path (runs independently — both paths execute when both image and text are present) ---
      if (!useCombined && messageContent.trim()) {
        const content = messageContent.trim()
        const signature = JSON.stringify({ chatId: sendingChatId, messageType: 'text', content, quotedMessageId: quotedMessage?.id ?? null })
        const sendResult = await api.chats.send(sendingChatId,
          { content, revision: currentRevision, quotedMessageId: quotedMessage?.id },
          sendKeysRef.current.get(signature),
        )
        if (sendResult.success) currentRevision = sendResult.data.revision
        sendKeysRef.current.clear(signature)
        /*
         * 送信した版だけを消す(#962 F06)。応答を待つ間に別の会話・別
         * アカウントへ切り替わっていたり、送信中に追記されていれば、
         * その下書きは残す。
         */
        dropSentDraft(sendingChatId, sendingAccountId, { content })
        if (selectedChatIdRef.current === sendingChatId && detailAccountRef.current === sendingAccountId) {
          setMessageContent((prev) => (prev.trim() === content ? '' : prev))
        }
        // Optimistic update: append message locally instead of refetching (prevents scroll jump / full reload feel)
        // Only mutate chatDetail if it still corresponds to the chat we just sent to
        const textMessage = buildOutgoingMessage({
          messageType: 'text',
          content,
          sentByStaffName: sendResult.success ? sendResult.data.sentByStaffName : '自分',
          sentAt: now,
        })
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          revision: sendResult.success ? sendResult.data.revision : prev.revision,
          messages: [...(prev.messages ?? []), textMessage],
        } : prev)
        setChats((prev) => {
          // Skip reconciliation if the list no longer contains this chat (e.g. tab changed mid-send)
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          // 返信すると対応中に変わるので、別の絞り込みを見ているときは一覧から外れる
          return refreshChatListAfterSend(prev, statusFilterRef.current, (c) => (c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            // 一覧の preview も即時更新する。incoming 優先ロジックで上書きされ得るが、
            // 楽観 UI では「operator が今送った文面」が一瞬見えるのが期待動作。
            // 次回 loadChats() で server 側の真の最新 (incoming 優先) に reconcile される。
            lastMessageContent: content,
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'text' as const,
          } : c))
        })
      }
      // 手動返信で未対応が 1 件減るので、サイドバーのバッジを即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
      // 引用は1回の送信で使い切る。残すと次の返信にも同じ引用が付く。
      // 送信した会話が開かれたまま、かつ引用が送った版のままのときだけ外す(#962 F06)。
      if (selectedChatIdRef.current === sendingChatId && detailAccountRef.current === sendingAccountId) {
        setQuotedMessage((prev) => (prev === quotedMessage ? null : prev))
      }
    } catch (sendError) {
      // 別の会話・アカウントへ切り替えたあとの古い失敗は、
      // 新しい画面へ出さない(A02-04)。
      if (detailAccountRef.current === sendingAccountId && selectedChatIdRef.current === sendingChatId) {
        setError(describeSendFailure(sendError))
      }
    } finally {
      setSending(false)
      sendLockRef.current = false
    }
  }

  /**
   * N-025: 本文を予約送信する。画像つきは予約口がまだ持たないため止める。
   * 成功したら入力と引用をクリアし、予約一覧を読み直す。
   */
  const handleScheduleSend = async () => {
    if (!selectedChatId || scheduling || scheduleLockRef.current) return
    const content = messageContent.trim()
    if (!content) return
    // INBOX-29: 上限を超えた本文は予約もさせない。
    if (messageContent.length > MESSAGE_MAX_LENGTH) {
      setError(`メッセージは${MESSAGE_MAX_LENGTH.toLocaleString()}文字までです。`)
      return
    }
    if (!scheduleInput) {
      setError('予約する日時を選んでください')
      return
    }
    if (pendingImage) {
      setError('画像つきの予約送信にはまだ対応していません')
      return
    }
    const schedulingChatId = selectedChatId
    const schedulingAccountId = selectedAccountId
    setScheduling(true)
    scheduleLockRef.current = true
    try {
      /*
       * 同じ送信版には同じ操作キーを使い回す(#965)。通信中の二度押しや
       * 失敗後の再試行で毎回新しいキーを生やすと、処理待ちの予約行が
       * 二重に登録される。成功した版は消して、次の予約を別操作にする。
       */
      const signature = JSON.stringify({
        kind: 'schedule',
        chatId: schedulingChatId,
        content,
        scheduledAt: scheduleInput,
        quotedMessageId: quotedMessage?.id ?? null,
      })
      const res = await api.chats.schedule(schedulingChatId, {
        content,
        // 入力欄は日本時間の約束(INBOX-21)。オフセットを付けて送り、
        // サーバー側の時間帯に左右されない同じ瞬間を保存する。
        scheduledAt: jstDatetimeLocalToIso(scheduleInput),
        quotedMessageId: quotedMessage?.id,
      }, sendKeysRef.current.get(signature))
      if (res.success) {
        sendKeysRef.current.clear(signature)
        // 予約した版だけを消す。切替先の下書きや開いたパネルは触らない(#962 F06)。
        dropSentDraft(schedulingChatId, schedulingAccountId, { content })
        if (selectedChatIdRef.current === schedulingChatId && detailAccountRef.current === schedulingAccountId) {
          setMessageContent((prev) => (prev.trim() === content ? '' : prev))
          setQuotedMessage((prev) => (prev === quotedMessage ? null : prev))
          setScheduleInput((prev) => (prev === scheduleInput ? '' : prev))
          setShowSchedulePanel(false)
        }
        await loadScheduledSends(schedulingChatId)
      }
    } catch (scheduleError) {
      // 別の会話・アカウントへ切り替えたあとの古い失敗は、
      // 新しい画面へ出さない(A02-04)。
      if (detailAccountRef.current === schedulingAccountId && selectedChatIdRef.current === schedulingChatId) {
        setError(describeSendFailure(scheduleError))
      }
    } finally {
      setScheduling(false)
      scheduleLockRef.current = false
    }
  }

  /** 予約の取消。送信中・送信済みは口が409で拒否し、一覧を読み直す。 */
  const handleCancelScheduled = async (scheduleId: string) => {
    if (!selectedChatId) return
    try {
      const res = await api.chats.cancelScheduled(selectedChatId, scheduleId)
      if (res.success) {
        setScheduledSends((prev) => prev.filter((row) => row.id !== scheduleId))
      }
    } catch {
      setError('予約の取消に失敗しました。一覧を読み込み直してください。')
      void loadScheduledSends(selectedChatId)
    }
  }

  /** 予約時刻の変更。datetime-local の JST 値はオフセットを付けて口へ渡す(INBOX-21)。 */
  const handleReschedule = async (scheduleId: string, nextAt: string) => {
    if (!selectedChatId || !nextAt) return
    try {
      const res = await api.chats.updateScheduled(selectedChatId, scheduleId, { scheduledAt: jstDatetimeLocalToIso(nextAt) })
      if (res.success) await loadScheduledSends(selectedChatId)
    } catch {
      setError('予約時刻の変更に失敗しました。一覧を読み込み直してください。')
      void loadScheduledSends(selectedChatId)
    }
  }

  /** 担当を付け替える（設計 `TalkPane` の「担当」）。 */
  const handleOperatorUpdate = async (operatorId: string | null) => {
    if (!selectedChatId || !chatDetail) return
    try {
      await api.chats.update(selectedChatId, { operatorId, revision: chatDetail.revision })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setError('担当の更新に失敗しました。')
    }
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>(
          '/api/operators',
        )
        if (!cancelled && res.success) setOperators(res.data)
      } catch {
        // 担当を選べないだけ。返信そのものは続けられる。
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    /*
      **アカウントを切り替えたら、前の集計をその場で捨てる。**
      読み終わるまで残すと、別のアカウントの未読数を見たまま担当者を選ぶ。
    */
    setAssigneeUnread(null)
    setAssigneeUnreadStatus('loading')
    ;(async () => {
      try {
        /*
          この口はアカウント引数を取らない（担当者の見える範囲で絞る作り）。
          **新しい契約は足さない。** 切り替えのたびに読み直して、
          前のアカウントの数を残さないことだけを守る。
        */
        const res = await api.chatStats.get()
        if (cancelled) return
        /* 失敗の返事を成功として読まない。`—` のままにする。 */
        if (!res.success) throw new Error('failed')
        setAssigneeUnread(res.data.assigneeUnread)
        setAssigneeUnreadStatus('ready')
      } catch {
        /*
          **集計の失敗を0件と扱わない。** `null` のままにして数だけ `—` にする。
          担当者一覧そのものは `/api/operators` の結果を保つ。
        */
        if (!cancelled) {
          setAssigneeUnread(null)
          setAssigneeUnreadStatus('error')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId])

  /*
   * INBOX-09: 「すべて／要返信／1時間以上待ち」の件数は、一覧と同じ条件で
   * サーバーに数えさせる。quickFilter 自体は条件に含めない（各札は
   * 「その札を押したときの件数」を表す）。応答が着順違れで戻っても
   * requestId で新しい方だけを採用する。
   */
  const quickCountsKey = JSON.stringify([statusFilter, selectedAccountId, debouncedNameQuery, assigneeFilter, unreadOnly, channel])
  useEffect(() => {
    const requestId = ++quickCountsRequestRef.current
    const key = quickCountsKey
    // #625: 応答なしの要求は時間切れの失敗にする。件数は「—」へ戻り、0化しない。
    void withRequestTimeout(api.chats.quickCounts({
      status: statusFilter === 'all' ? undefined : statusFilter,
      operatorId: assigneeFilter === 'all' ? undefined : assigneeFilter,
      accountId: selectedAccountId || undefined,
      q: debouncedNameQuery || undefined,
      unreadOnly,
      channel,
    })).then((res) => {
      if (quickCountsRequestRef.current !== requestId) return
      /* 失敗や変な形の応答を0件と読まない。`—` のままにする。 */
      setQuickCounts(
        res.success && res.data && typeof res.data.all === 'number'
          ? { key, counts: { all: res.data.all, reply: res.data.reply, overdue: res.data.overdue } }
          : null,
      )
    }).catch(() => {
      if (quickCountsRequestRef.current === requestId) setQuickCounts(null)
    })
  }, [quickCountsKey, statusFilter, selectedAccountId, debouncedNameQuery, assigneeFilter, unreadOnly, channel])

  const handleStatusUpdate = async (newStatus: Chat['status']) => {
    if (!selectedChatId || !chatDetail) return
    try {
      await api.chats.update(selectedChatId, { status: newStatus, revision: chatDetail.revision })
      loadChatDetail(selectedChatId)
      loadChats()
      // 対応済み/未読の切替は未対応バッジに影響するので即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
    } catch {
      setError('ステータスの更新に失敗しました。')
    }
  }

  /** 友だち一覧と同じ「注目」を受信箱の★から切り替える。 */
  const handleAttentionUpdate = async () => {
    if (!chatDetail || attentionSaving) return
    const updatingChatId = chatDetail.id
    const next = !chatDetail.isAttention
    setAttentionSaving(true)
    setChatDetail((current) => current?.id === updatingChatId ? { ...current, isAttention: next } : current)
    try {
      // N-040(#808): 友だちの現行改訂値を読んでから送り、競合は上書きしない。
      const detail = await fetchApi<{ success: boolean; data: { updatedAt: string } }>(
        `/api/friends/${chatDetail.friendId}`,
      )
      await fetchApi<{ success: boolean; data: unknown }>(
        `/api/friends/${chatDetail.friendId}/metadata?expectedUpdatedAt=${encodeURIComponent(detail.data.updatedAt)}`,
        { method: 'PUT', body: JSON.stringify({ __attention: next ? '1' : null }) },
      )
    } catch (error) {
      setChatDetail((current) => current?.id === updatingChatId ? { ...current, isAttention: !next } : current)
      if (error instanceof ApiError && error.status === 409) {
        setError('ほかの変更が先に保存されました。最新の状態で確認してもう一度お試しください。')
      } else {
        setError('注目の変更に失敗しました。')
      }
    } finally {
      setAttentionSaving(false)
    }
  }

  /*
   * 内部メモの紙を閉じる。Escape・キャンセル・フォーカス戻しで
   * 共通なので1か所にする(N-031)。
   */
  const closeMemoEditor = useCallback(() => {
    setMemoDraft(chatDetail?.notes ?? '')
    setMemoError('')
    setShowMemoEditor(false)
  }, [chatDetail?.notes])

  /*
   * role="dialog" の紙なのに Tab が裏の送信欄へ抜け、閉じても
   * フォーカスがボタンへ戻らなかった(N-031)。共通部品と同じ
   * useOverlayFocus で、Tabを紙の中に留め・Escapeで閉じ・
   * 閉じたら開いたボタンへフォーカスを戻す。
   */
  const memoPopoverRef = useOverlayFocus(showMemoEditor, closeMemoEditor, memoSaving)

  const handleSaveMemo = async () => {
    if (!selectedChatId || memoSaving) return
    /*
     * 保存を始めた会話と版を固定する(INBOX-25)。応答を待つ間に別の
     * 会話・アカウントへ切り替わっても、その画面へ結果を書き込まない。
     */
    const savingChatId = selectedChatId
    const savingAccountId = selectedAccountId
    const savingRevision = chatDetail?.revision
    const notes = memoDraft.trim() || null
    setMemoSaving(true)
    setMemoError('')
    try {
      const response = await api.chats.update(savingChatId, {
        notes,
        revision: savingRevision,
      })
      if (!response.success) throw new Error(response.error || '内部メモを保存できませんでした')
      // 返ってきた版を採用する。古い版のまま次の保存を送ると409になる。
      setChatDetail((current) => current && current.id === savingChatId
        ? { ...current, notes: response.data?.notes ?? notes, revision: response.data.revision }
        : current)
      setChats((current) => current.map((chat) => chat.id === savingChatId
        ? { ...chat, notes }
        : chat))
      // 開いている紙を閉じるのは、いまも同じ会話を見ているときだけ。
      if (selectedChatIdRef.current === savingChatId && detailAccountRef.current === savingAccountId) {
        setShowMemoEditor(false)
      }
    } catch (memoSaveError) {
      if (selectedChatIdRef.current === savingChatId && detailAccountRef.current === savingAccountId) {
        setMemoError(memoSaveError instanceof Error ? memoSaveError.message : '内部メモを保存できませんでした')
      }
    } finally {
      setMemoSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // IME変換確定のEnterでは送信しない
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
    if (e.key !== 'Enter') return
    // sendMode 'enter': Enter単体で送信、Shift+Enterは改行
    // sendMode 'shift-enter': Shift+Enterで送信、Enter単体は改行
    const shouldSend = sendMode === 'enter' ? !e.shiftKey : e.shiftKey
    if (shouldSend) {
      e.preventDefault()
      handleSendMessage()
    }
  }


  // INBOX-29: 上限を超えた本文は送らせない(下書きは消さない)。
  const messageLength = messageContent.length
  const messageOverLimit = messageLength > MESSAGE_MAX_LENGTH
  // この会話で画像の準備(アップロード)が進行中か(INBOX-23/31)。
  const imageUploading = imageBusyKeys.has(draftKeyOf(selectedAccountId, selectedChatId))
  /*
   * INBOX-09: 札の件数は一覧と同じ条件（アカウント・検索・担当・経路・
   * 未読）をサーバーで数えたものだけを出す。以前は「すべて」に画面へ
   * 読み込んだ行数（最大200件）を出し、「要返信」にはフィルタを
   * 通さない別集計を出していたため、押した結果と件数が一致しなかった。
   * 条件に対応した応答が届くまでは `—` を出し、部分件数を全件数の
   * ように見せない。
   */
  const quickCountsNow = quickCounts?.key === quickCountsKey ? quickCounts.counts : null
  const hasInboxFilters = Boolean(
    nameQuery.trim()
      || statusFilter !== 'all'
      || quickFilter !== 'all'
      || assigneeFilter !== 'all'
      || unreadOnly,
  )
  // 入力からdebounce反映までを「0件」と断定しない。古い条件の結果が一瞬見えるため。
  const nameQueryPending = nameQuery.trim() !== debouncedNameQuery
  const currentFilterNotLoaded = (channel !== 'email' && chatListCompletedKey !== listFilterKey)
    || (channel !== 'line' && emailListCompletedKey !== listFilterKey)
  const inboxListLoading = nameQueryPending
    || currentFilterNotLoaded
    || (channel !== 'email' && loading)
    || (channel !== 'line' && emailLoading)
  const inboxListFailed = (channel !== 'email' && chatListFailed)
    || (channel !== 'line' && Boolean(emailError))
  const clearInboxFilters = () => {
    setNameQuery('')
    setDebouncedNameQuery('')
    setStatusFilter('all')
    setQuickFilter('all')
    setAssigneeFilter('all')
    setUnreadOnly(false)
    // 手動で解除したので、URLの保存検索IDも外す(N-021)。
    dropSavedViewParam()
  }
  const activeFriendId = (chatDetail?.id === selectedChatId ? chatDetail.friendId : null)
    ?? chats.find((chat) => chat.id === selectedChatId)?.friendId
    ?? null
  return (
    <div className="space-y-3">
      {savedViewSuccess ? (
        /*
          INBOX-11: 横幅は画面の左右16px以内。以前の minWidth:520 は
          320/390px より大きく、閉じる操作まで画面外に出ていた。
          閉じるボタンは縮めず、本文は折り返す。
        */
        <div
          role="status"
          className="bg-accent-soft text-accent-deep border-accent fixed top-20 left-1/2 z-50 flex w-[calc(100vw-2rem)] max-w-[520px] -translate-x-1/2 items-center gap-2 rounded-control border px-4 py-3 text-sm font-bold shadow-float"
        >
          <CheckCircle2 aria-hidden="true" size={18} className="shrink-0" />
          <span className="min-w-0">保存した検索を作成しました</span>
          <button
            type="button"
            onClick={() => setSavedViewSuccess(false)}
            aria-label="保存完了のお知らせを閉じる"
            className="hover:bg-accent/10 ml-auto shrink-0 rounded-control p-1"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
      ) : null}
      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}
      {/*
        URLの保存検索IDが見つからなかったときの案内(N-021)。
        既定条件へ戻したことだけを伝える。障害ではないので error とは分ける。
      */}
      {savedViewNotice && (
        <div role="status" className="mb-4 rounded-lg border border-hairline bg-canvas-sunken p-3 text-sm text-ink-secondary">
          {savedViewNotice}
        </div>
      )}

      <section
        data-design="Filters"
        data-inbox-v4="quick-filters"
        className="relative flex min-h-10 flex-wrap items-center gap-2"
        aria-label="受信箱のクイック絞り込み"
      >
        {[
          { key: 'all' as const, label: 'すべて', title: undefined },
          { key: 'reply' as const, label: '要返信', title: '対応状況が「未対応」の会話' },
          /*
           * INBOX-10: ここで数えるのは対応期限ではなく、未対応のまま
           * 最後のやり取りから1時間以上たった会話。「期限超過」と書くと
           * 設定した期限の超過に読めるため、実態に合う名前にする。
           */
          { key: 'overdue' as const, label: '1時間以上待ち', title: '未対応のまま、最後のやり取りから1時間以上たった会話' },
        ].map((filter) => (
          <button
            key={filter.key}
            type="button"
            onClick={() => { setQuickFilter(filter.key); dropSavedViewParam() }}
            aria-pressed={quickFilter === filter.key}
            title={filter.title}
            className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              quickFilter === filter.key
                ? 'border-accent-deep bg-accent-soft text-accent-deep'
                : 'border-hairline bg-canvas text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {filter.label}
            {/* 件数がまだ無い時は「—」を出さない（★V7：意味の無い記号を置かない）。 */}
            {quickCountsNow ? <span className="ml-1 tabular-nums">{quickCountsNow[filter.key]}</span> : null}
          </button>
        ))}
        <span className="ml-auto" />
        {/*
          設計 `xGLVe` は「絞り込み」と「保存した検索」を右に並べ、押すと
          右から420pxのパネルが出る（`bXyEA`）。

          以前は `<details>` の小さな箱（208px）で、中身は対応状況だけだった。
          設計は 対応状況・担当者・受信経路・期限・メッセージ種別・未読だけ の
          6項目。**箱が小さいと、置ける条件の数が先に決まってしまう。**
        */}
        <Button type="button" onClick={() => setFilterOpen(true)} aria-expanded={filterOpen}>
          絞り込み
        </Button>
        {/*
          INBOX-11: メニューは「保存した検索」ボタンではなく、画面幅いっぱいの
          この行（section.relative）を基準に右端を合わせる。ボタン基準の
          right-0 だと、狭い画面でボタンが左に折り返されたときパネルの
          左側が画面外へ出た。幅も画面の左右16px以内に収める。
        */}
        <div>
          <Button
            type="button"
            onClick={() => {
              setSavedViewsOpen((open) => !open)
              setSavedViewError('')
            }}
            aria-expanded={savedViewsOpen}
          >
            保存した検索
          </Button>
          {savedViewsOpen && (
            <div className="border-hairline absolute top-full right-0 z-40 mt-1.5 max-h-[min(70dvh,32rem)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-xl border bg-canvas p-4 shadow-xl">
              <p className="text-ink text-sm font-bold">保存した検索</p>
              <div className="mt-3 space-y-1">
                {savedViews.length === 0 ? (
                  <p className="bg-canvas-sunken text-ink-faint rounded-lg px-3 py-3 text-xs">
                    まだ保存した検索はありません。
                  </p>
                ) : savedViews.map((view) => (
                  <div key={view.id} className="hover:bg-canvas-sunken flex items-center gap-2 rounded-lg px-2 py-1.5">
                    <button
                      type="button"
                      onClick={() => applySavedView(view)}
                      className="text-ink min-w-0 flex-1 truncate text-left text-xs font-semibold"
                      title={view.name}
                    >
                      {view.name}{view.isShared ? '（共有）' : ''}
                      {/*
                        **名前の下に、何で絞ったかを出す。**
                        設計 `ASsb3` は「対応マーク：未対応／期限：超過」のように書く。
                        名前だけだと、`未対応・期限超過` と `河野担当の未対応` の
                        どちらを押せばいいのかが、名前の付け方頼みになる。
                      */}
                      <span className="text-ink-faint mt-0.5 block truncate text-[11px] font-normal">
                        {savedViewSummary(normalizeSavedViewConditions(view.conditions), operatorNames)}
                      </span>
                    </button>
                    <span className="text-ink-secondary shrink-0 text-xs tabular-nums">
                      {typeof view.matchCount === 'number' ? `${view.matchCount}件` : '—件'}
                    </span>
                    <div className="relative shrink-0">
                      <MoreAction
                        label={`${view.name}の操作`}
                        aria-expanded={savedViewMenuId === view.id}
                        data-qa-open={view.id === savedViews[0]?.id ? 'ASsb3-menu' : undefined}
                        onClick={() => setSavedViewMenuId((current) => current === view.id ? null : view.id)}
                      />
                      {savedViewMenuId === view.id ? (
                        <div className="border-hairline bg-canvas absolute top-full right-0 z-50 mt-1 w-40 rounded-control border p-1 shadow-lg" role="menu">
                          <button
                            type="button"
                            role="menuitem"
                            onClick={async () => {
                              if (!selectedAccountId) return
                              await api.chats.savedViews.delete(view.id, selectedAccountId)
                              setSavedViewMenuId(null)
                              await loadSavedViews()
                            }}
                            className="text-danger hover:bg-status-danger-soft w-full rounded-mini px-2.5 py-2 text-left text-xs"
                          >
                            保存した検索を削除
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
              {savedViews.some((view) => typeof view.matchCount !== 'number') ? (
                <p className="text-ink-faint mt-2 text-xs leading-relaxed">
                  該当件数は、保存した条件ごとの集計が接続されると表示されます。「—件」は0件ではありません。
                </p>
              ) : null}
              {/*
                前はここに名前の入力欄と保存ボタンが直接並んでいた。
                **何を保存しようとしているのかが書いていない**ので、絞り込みを
                変えたつもりで前の条件を保存してしまう。設計（`Ln4zS`）は
                名前と「保存する条件」を並べて見せてから保存させる。
              */}
              <div className="border-hairline mt-3 border-t pt-3">
                <Button variant="primary" type="button" onClick={() => {
                  setSavedViewSuccess(false)
                  setSaveDialogOpen(true)
                }}>
                  現在の条件を保存
                </Button>
                {savedViewError && <p className="mt-1.5 text-xs text-danger">{savedViewError}</p>}
              </div>
            </div>
          )}
        </div>
        <Button href="/tags?tab=marks" className="h-10 shrink-0">
          <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10M9 4v6M15 14v6" /></svg>
          対応ルール
        </Button>
        <SavedViewDialog
          open={saveDialogOpen}
          initialValue={{
            status: statusFilter,
            quickFilter,
            channel,
            assignee: assigneeFilter,
            unreadOnly,
            favorite: true,
          }}
          operators={operators}
          existingNames={savedViews.map((view) => view.name)}
          saving={savingView}
          onSave={async (draft) => {
            setSavedViewName(draft.name)
            return createSavedView(draft)
          }}
          onClose={() => setSaveDialogOpen(false)}
        />
        {filterOpen || showTemplatePicker ? (
          <style>{`
            [aria-label="テンプレートを選択"] {
              background-color: rgb(16 24 40 / 33%) !important;
            }
            div:has(> section[aria-label="絞り込み"]) > div[aria-hidden="true"] {
              background-color: transparent !important;
            }
          `}</style>
        ) : null}
        <InboxFilterPanel
          open={filterOpen}
          value={{ status: statusFilter === 'all' ? 'all' : statusFilter, assignee: assigneeFilter, channel, unreadOnly }}
          operators={operators}
          onChange={(next) => {
            setStatusFilter(next.status as StatusFilter)
            setAssigneeFilter(next.assignee)
            setUnreadOnly(next.unreadOnly)
            if (next.channel !== channel) {
              // 手動の条件変更なので savedView は残さない(N-021)。
              router.push(buildInboxUrl(next.channel, null))
            } else {
              dropSavedViewParam()
            }
          }}
          onReset={() => {
            setStatusFilter('all')
            setAssigneeFilter('all')
            setUnreadOnly(false)
            router.push('/chats')
          }}
          onClose={() => setFilterOpen(false)}
        />
      </section>

      <div
        data-design="Panes"
        className="border-[#E5E7EB] bg-canvas shadow-card relative flex h-[calc(100vh-196px)] min-h-[560px] overflow-hidden rounded-[10px] border"
      >
        {/* Left Panel: Chat List */}
        {/* 設計 `ListPane` 360px。 */}
        {/*
          顧客情報を開いている間は一覧を 288px に留める(#982 LAY-01)。
          以前は 2xl で 420px へ急拡大し、一覧+トーク+顧客情報の3列が
          1536px でちょうど収まらなくなっていた。顧客情報を閉じた
          2列だけのときだけ 420px へ広げる。
        */}
        {/* 狭い画面では、開いている間は一覧を隠して中央を広く使う。
            メールを開いたときも同じ。ここが LINE だけを見ていたので、
            メールを開いても一覧が残って中央が半分のままだった。 */}
        <div
          data-inbox-v4="conversation-list"
          className={`bg-canvas lg:flex-shrink-0 border-r flex-col overflow-hidden border-hairline ${showFriendInfo ? 'lg:w-72' : 'lg:w-[330px] 2xl:w-[420px]'} ${selectedChatId || selectedThreadId ? 'hidden lg:flex' : 'flex'}`}
        >
          {/* タブ (すべて / 未読 / 対応中 / 対応済み) は意図的に削除。直近メッセージが見やすい LINE 風一覧を優先。 */}

          {/* 設計 `ListPane` の「名前で検索」。一覧が長くなると状態の絞り込みだけでは足りない。 */}
          <div className="border-b border-hairline p-3">
            <div className="relative">
              <svg className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-[#98A2B3]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
              <input
              type="search"
              value={nameQuery}
              onChange={(e) => { setNameQuery(clampSearchQuery(e.target.value)); dropSavedViewParam() }}
              maxLength={SEARCH_QUERY_MAX_LENGTH}
              placeholder="名前・メールアドレス・内容で検索"
              aria-label="名前・メールアドレス・内容で検索"
              className="w-full rounded-lg border border-hairline bg-canvas py-2 pr-3 pl-9 text-xs text-ink outline-none focus:border-accent-deep focus:ring-2 focus:ring-accent-deep/15"
              />
            </div>
            {/*
              #670 02: 外の「担当者」と中の「担当者：すべて」が二重だった。
              プルダウンが自分で名乗るため、外の字は置かない。
            */}
            <label className="mt-2 flex items-center gap-2 text-[11px] font-semibold text-ink-secondary">
              <span className="min-w-0 flex-1">
                {/*
                  未読数は集計の口から渡す。**画面に見えている行から数えない**
                  ——一覧はページ送りされるので、2ページ目の未読が落ちる。
                  0件の担当者も選択肢に残す（契約上、0件は配列に載らないので実値0として描く）。
                */}
                <OperatorDropdown
                  value={assigneeFilter}
                  operators={operators}
                  onChange={(next) => { setAssigneeFilter(next); dropSavedViewParam() }}
                  label="担当者"
                  ariaLabel="担当者で絞り込む"
                  unreadOf={unreadLookup(assigneeUnread)}
                  unreadUnavailable={assigneeUnreadStatus === 'error'}
                />
              </span>
            </label>
            <div className="mt-2 flex min-w-0 flex-nowrap items-center gap-1 overflow-hidden">
              {CHANNELS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => router.push(buildInboxUrl(item.key, null))}
                  aria-label={item.label}
                  title={item.label}
                  aria-pressed={channel === item.key}
                  className={`inline-flex shrink-0 items-center justify-center rounded-md px-1.5 py-1.5 text-[11px] font-semibold whitespace-nowrap ${channel === item.key ? 'bg-accent-soft text-accent-deep' : 'text-ink hover:bg-shell'}`}
                >
                  {item.key === 'line' && <ChannelBadge channel="line" />}
                  {item.key === 'email' && <ChannelBadge channel="email" />}
                  {item.key === 'all' && item.label}
                </button>
              ))}
              <span
                data-inbox-sort="fixed"
                className="text-ink-secondary ml-auto shrink-0 text-[11px] font-semibold whitespace-nowrap"
              >
                並び順：未読が先・新しい順
              </span>
            </div>
          </div>

          {/*
            状態の絞り込みは5等分の切り替え。左の欄（開いている間は288px）でも
            必ず1行に収まるよう、折り返さない・5つで幅いっぱいにする。
            選んだ所は白地に濃い文字。読み上げはラジオの決まり。
          */}
          <div className="border-b border-hairline px-3 py-2">
            <div
              role="radiogroup"
              aria-label="対応状況で絞り込む"
              onKeyDown={handleStatusFilterKeyDown}
              className="bg-shell flex h-8 flex-nowrap items-stretch rounded-lg p-0.5"
            >
              {statusFilters.map((f, index) => {
                const selected = statusFilter === f.key
                return (
                  <button
                    key={f.key}
                    ref={(el) => { statusFilterButtonRefs.current[index] = el }}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    title={f.label}
                    onClick={() => { setStatusFilter(f.key); dropSavedViewParam() }}
                    // #639 の素のボタンの最小高さ32pxをここだけ外す。
                    // 切り替え全体の高さ32pxの中に収めるため。
                    style={{ minHeight: 0 }}
                    className={`min-w-0 flex-1 truncate rounded-md px-1 text-center text-xs whitespace-nowrap transition-colors ${
                      selected
                        ? 'bg-canvas font-semibold text-ink shadow-sm'
                        : 'text-ink-secondary hover:text-ink font-medium'
                    }`}
                  >
                    {f.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto">
            <>
                {/*
                  メール一覧の失敗行。LINEだけ見ているときは出さない。
                  以前は失敗が無言で「メール0件」に見え、未対応の見落としになった。
                  ふだん（成功時）は何も出ないので、一覧の見た目は変わらない。
                */}
                {channel !== 'line' && emailError && (
                  <div role="alert" className="border-b border-hairline bg-danger-bg px-4 py-3">
                    <p className="text-sm text-danger">{emailError}</p>
                    <button
                      type="button"
                      onClick={() => { void loadEmails() }}
                      className="mt-1.5 text-sm font-semibold text-danger underline underline-offset-2"
                    >
                      メールを読み込み直す
                    </button>
                  </div>
                )}
                {/*
                  LINE一覧の失敗行。メールだけ見ているときは出さない。
                  「もう一度お試しください」とだけ書かれた帯では、直す手段が
                  ページ全体の再読み込みしかない(N-030)。失敗した一覧の場所で
                  同じ条件の再取得へ戻れるようにする。
                */}
                {channel !== 'email' && chatListFailed && (
                  <div role="alert" className="border-b border-hairline bg-danger-bg px-4 py-3">
                    <p className="text-sm text-danger">チャットの読み込みに失敗しました。</p>
                    <button
                      type="button"
                      onClick={() => { void loadChats() }}
                      className="mt-1.5 text-sm font-semibold text-danger underline underline-offset-2"
                    >
                      会話を読み込み直す
                    </button>
                  </div>
                )}
                {/*
                  メールの問い合わせを同じ一覧の先頭に混ぜる。
                  設計 `V2 2-1 受信箱` の一覧は「✉ 定期便の解約について」のように
                  メールも同じ並びに入っている。出どころで場所を分けると、
                  返信を待っている人を2か所で探すことになる。

                  押したときの行き先だけは分ける。LINEはこの画面のトーク、
                  メールはメールの往復で、中央に出すものの作りが違う。
                */}
                {/*
                  LINE とメールを1本に混ぜる。どちらも口側で「未読が先・
                  新しい順」に並んでいるので、画面では並べ替えない。
                  受け取った順のまま、先頭同士を比べて混ぜるだけで全体が
                  保たれる。ページ送りで足された分も、各出どころの続き
                  として正しい場所に入る。

                  行の中身の作りは出どころで違う（メールは件名、LINE は
                  最後のメッセージと未対応の印）ので、描き方はそれぞれ
                  残したまま、混ぜ方だけそろえる。
                */}
                {(() => {
                  const mailRows = (channel === 'line' ? [] : emailItems)
                  .filter((item) =>
                    nameQuery.trim() === ''
                      ? true
                      : [item.customerName, item.customerIdentifier, item.subject, item.preview]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(nameQuery.trim().toLowerCase())),
                  )
                  .filter((item) => statusFilter === 'all' || item.status === statusFilter)
                  .map((item) => ({
                    at: item.lastMessageAt ?? item.lastIncomingAt,
                    unread: item.isUnread,
                    node: (
                    // 区切り線は外の箱が持つ。押し場所に border-hairline を書くと
                    // 直書きボタンの借金に数えられる (design-debt)。
                    <div key={item.id} className="border-b border-hairline">
                    <button
                      onClick={() => {
                        // LINEの選択を外す。両方開いていると中央に何を
                        // 出すのか決まらない。URL指定の案内とURL状態も外す。
                        // friend を残すと、再読込で古いLINE会話へ戻る(#673)。
                        deepLinkRequestIdRef.current += 1
                        deepLinkIdRef.current = null
                        setDeepLinkNotice('')
                        setSelectedChatId(null)
                        setSelectedThreadId(item.threadId)
                        router.replace(buildInboxUrl(channel, savedViewParam || null))
                        setEmailItems((prev) => prev.map((email) => (
                          email.threadId === item.threadId ? { ...email, isUnread: false } : email
                        )))
                        void fetchApi(`/api/support/email/threads/${encodeURIComponent(item.threadId)}/read`, {
                          method: 'POST',
                        }).catch(() => undefined)
                      }}
                      className={`w-full px-3 py-3 text-left transition-colors ${
                        selectedThreadId === item.threadId ? 'bg-accent-soft' : 'hover:bg-shell'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {/* メールの行も名前の頭文字（以前は全員「M」で、誰の会話か目で追えなかった）。 */}
                          <Avatar name={item.customerName} size={40} />
                          {item.isUnread && (
                            <span className="border-canvas bg-danger absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2" aria-label="未読" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-ink truncate text-sm font-medium">{item.customerName}</p>
                            <span className="text-ink-faint shrink-0 text-xs tabular-nums">
                              {formatInboxListDate(item.lastIncomingAt)}
                            </span>
                          </div>
                          <div className="mt-1 flex items-start justify-between gap-2">
                            <p className="text-ink-faint line-clamp-2 min-w-0 flex-1 text-xs leading-4">
                              {item.subject || item.preview}
                            </p>
                            <span
                              className={`rounded-pill shrink-0 px-2 py-0.5 text-micro font-semibold ${statusConfig[item.status].className}`}
                            >
                              {statusConfig[item.status].label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <ChannelBadge channel="email" />
                            <span className="text-ink-faint inline-flex min-w-0 items-center gap-1 text-xs">
                              <span className="bg-action-soft text-action flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold">
                                {(item.assignedStaffName ?? '未').charAt(0)}
                              </span>
                              <span className="truncate">担当：{item.assignedStaffName ?? '未割り当て'}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                    </div>
                    ),
                  }))
                  const lineRows = (channel === 'email' ? [] : chats)
                  .filter((chat) =>
                    nameQuery.trim() === ''
                      ? true
                      : [chat.friendName, chat.lastMessageContent]
                          .filter(Boolean)
                          .some((value) => String(value).toLowerCase().includes(nameQuery.trim().toLowerCase())),
                  )
                  .map((chat) => {
                  const isSelected = selectedChatId === chat.id
                  const operatorName = operators.find((operator) => operator.id === chat.operatorId)?.name ?? null
                  // 「真の自発（要対応）」= chat.status='unread'。webhook 側で auto_reply に
                  // マッチしなかった incoming のみ unread に設定される。auto_reply trigger
                  // (キーワード "コスト比較" 等) は matched 扱いで unread 化しない。
                  // 太字と印の表示はこの status を使う。direction だけだと button 押下も
                  // 強調してしまって S/N 比が悪化する。
                  const needsAttention = chat.status === 'unread'
                  /*
                    設計 `xGLVe` は、今日届いてまだ返していない行だけ待ち時間を
                    出す。古い行まで「◯◯時間待ち」にすると桁が伸びて読めない。
                  */
                  const waitingLabel = needsAttention
                    && chat.lastMessageAt
                    && sameYmd(chat.lastMessageAt, new Date().toISOString())
                    ? formatWaitingDuration(chat.lastMessageAt, Date.now())
                    : null
                  // 最新メッセージの本文 preview。flex/image は文字列で見せても意味が薄いので type 表記に置換。
                  const previewRaw = chat.lastMessageContent ?? ''
                  const preview = (() => {
                    // 絵文字は付けない。言葉だけで何かは分かる。
                    if (chat.lastMessageType === 'image') return '画像'
                    if (chat.lastMessageType === 'flex') return 'Flexメッセージ'
                    if (chat.lastMessageType === 'sticker') return 'スタンプ'
                    if (chat.lastMessageType === 'video') return '動画'
                    if (chat.lastMessageType === 'audio') return '音声'
                    if (chat.lastMessageType === 'file') return 'ファイル'
                    if (chat.lastMessageType === 'location') return '位置情報'
                    if (chat.lastMessageType === 'unsent') return '送信を取り消しました'
                    return previewRaw.replace(/\n+/g, ' ').slice(0, 60)
                  })()
                  // 区切り線は外の箱が持つ。押し場所に border-hairline を書くと
                  // 直書きボタンの借金に数えられる (design-debt)。
                  const node = (
                    <div key={chat.id} className="border-b border-hairline">
                    <button
                      onClick={() => handleSelectChat(chat.id)}
                      className={`w-full px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-accent-soft'
                          : chat.isUnread
                            /*
                              設計 `f0zn6` は、自分あての未読だけ行の地を薄い赤に
                              する。丸い点だけだと、行を目で追うときに見落とす。
                            */
                            ? 'bg-status-danger-soft hover:bg-status-danger-selected'
                            : 'hover:bg-shell'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="relative shrink-0">
                          {/* ★V7 友だちの顔：画像が読めない時も色つきの頭文字。 */}
                          <Avatar name={chat.friendName} src={chat.friendPictureUrl} size={40} />
                          {chat.isUnread && (
                            <span className="border-canvas bg-danger absolute -top-0.5 -right-0.5 h-3 w-3 rounded-full border-2" aria-label="未読" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              <p className="text-sm font-medium text-ink truncate">{chat.friendName}</p>
                            </div>
                            {waitingLabel ? (
                              <span className="text-status-warn-deep shrink-0 text-nano font-semibold">{waitingLabel}</span>
                            ) : (
                              <span className="text-ink-faint shrink-0 text-xs tabular-nums">{formatInboxListDate(chat.lastMessageAt)}</span>
                            )}
                          </div>
                          {/*
                            設計は行ごとに状態を出す。色だけだと、赤い点が
                            「未読」なのか「未対応」なのか区別が付かない。
                          */}
                          <div className="mt-1 flex items-start justify-between gap-2">
                            <p
                              className={`line-clamp-2 min-w-0 flex-1 text-xs leading-4 ${
                                needsAttention ? 'text-ink font-medium' : 'text-ink-faint'
                              }`}
                              title={preview}
                            >
                              {chat.lastMessageDirection === 'outgoing' && (
                                <span className="text-ink-faint mr-1">返信：</span>
                              )}
                              {preview || <span className="text-ink-faint italic">(まだメッセージなし)</span>}
                            </p>
                            <span
                              className={`rounded-pill shrink-0 px-2 py-0.5 text-micro font-semibold ${statusConfig[chat.status].className}`}
                            >
                              {statusConfig[chat.status].label}
                            </span>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <ChannelBadge channel="line" />
                            <span className="text-ink-faint inline-flex min-w-0 items-center gap-1 text-xs">
                              <span className="bg-action-soft text-action flex h-4 w-4 shrink-0 items-center justify-center rounded-full font-bold">
                                {(operatorName ?? '未').charAt(0)}
                              </span>
                              <span className="truncate">担当：{operatorName ?? '未割り当て'}</span>
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                    </div>
                  )
                  return { at: chat.lastMessageAt ?? '', unread: chat.isUnread, node }
                })
                  // 両方とも口側で「未読が先・新しい順」。未読の有無が違う
                  // 行同士は時刻に関わらず未読が先、同じ中では新しい順。
                  const precedes = (
                    a: { at: string; unread: boolean },
                    b: { at: string; unread: boolean },
                  ): number =>
                    Number(b.unread) - Number(a.unread)
                    || String(b.at).localeCompare(String(a.at))
                  const rows: { node: React.ReactNode }[] = []
                  {
                    let i = 0
                    let j = 0
                    while (i < mailRows.length && j < lineRows.length) {
                      if (precedes(mailRows[i], lineRows[j]) <= 0) rows.push(mailRows[i++])
                      else rows.push(lineRows[j++])
                    }
                    while (i < mailRows.length) rows.push(mailRows[i++])
                    while (j < lineRows.length) rows.push(lineRows[j++])
                  }
                  if (inboxListLoading) {
                    return (
                      <div
                        role="status"
                        data-inbox-list-state="loading"
                        className="text-ink-faint flex min-h-36 items-center justify-center px-4 py-8 text-center text-sm"
                      >
                        会話を読み込んでいます...
                      </div>
                    )
                  }
                  if (rows.length > 0) return rows.map((row) => row.node)
                  // 障害を0件と誤認させない。具体的な理由は各チャネルのエラー表示に任せる。
                  if (inboxListFailed) return null
                  return (
                    <div
                      data-inbox-list-state={hasInboxFilters ? 'filtered-empty' : 'empty'}
                      className="text-ink-faint flex min-h-36 flex-col items-center justify-center px-4 py-8 text-center"
                    >
                      <p className="text-sm font-semibold text-ink-secondary">
                        {hasInboxFilters ? '条件に一致する会話がありません' : 'まだ会話がありません'}
                      </p>
                      {hasInboxFilters && (
                        <button
                          type="button"
                          onClick={clearInboxFilters}
                          className="text-action mt-3 text-sm font-semibold underline underline-offset-2"
                        >
                          絞り込みを解除
                        </button>
                      )}
                    </div>
                  )
                })()}

                {hasMoreChats && (
                  <button
                    onClick={() => { void loadMoreChats() }}
                    disabled={loadingMore}
                    className="w-full px-4 py-3 text-sm text-success hover:bg-accent-soft disabled:opacity-50 border-b border-hairline"
                  >
                    {loadingMore ? '読み込み中...' : 'さらに読み込む'}
                  </button>
                )}
                {/*
                  メールの続き。メールは上限200件で切れていた分を offset で遡る。
                  LINEの「さらに読み込む」とは別物なので文言を分ける。
                */}
                {hasMoreEmails && (
                  <button
                    onClick={() => { void loadEmails(emailItems.length, true) }}
                    disabled={loadingMoreEmails}
                    className="w-full px-4 py-3 text-sm text-success hover:bg-accent-soft disabled:opacity-50 border-b"
                    style={{ borderBottomColor: 'var(--color-hairline)' }}
                  >
                    {loadingMoreEmails ? '読み込み中...' : 'メールの続きを読み込む'}
                  </button>
                )}
            </>
          </div>
        </div>

        {/* Right Panel: Chat Detail */}
        {/*
          `min-w-0 flex-1` だけにして、トーク列は残り幅いっぱいに伸縮させる。
          以前の `xl:min-w-xl`（576px）は min-w-0 を上書きして 1280〜1536px
          で右の顧客情報を画面外へ押し出していた(#982 LAY-01)。
          顧客情報は狭い幅では列ではなくドロワーで開く（下の aside 参照）。
        */}
        <div
          data-inbox-v4="talk-pane"
          className={`min-w-0 flex-1 bg-canvas flex-col overflow-hidden ${showFriendInfo ? 'border-r border-[#E5E7EB]' : ''} ${selectedChatId || selectedThreadId ? 'flex' : 'hidden lg:flex'}`}
        >
          {selectedThreadId ? (
            /* メールの往復。LINEのトークと同じ場所に出す。 */
            <EmailThread
              threadId={selectedThreadId}
              onBack={() => setSelectedThreadId(null)}
              customerInfoOpen={showFriendInfo}
              onOpenCustomerInfo={() => setShowFriendInfo(true)}
              onChanged={() => {
                void loadEmails()
              }}
            />
          ) : deepLinkNotice ? (
            // URL指定の会話が開けなかったときの空状態。別人は開かず、
            // 理由と戻り先だけ出す(#673)。不正IDではselectedChatIdがnullに
            // なるため、通常の「選択してください」より先に判定する。
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-md text-center">
                <p className="text-ink text-sm font-semibold">会話を開けませんでした</p>
                <p className="text-ink-secondary mt-2 text-sm leading-relaxed">{deepLinkNotice}</p>
                <Button onClick={clearDeepLink} className="mt-4">
                  受信箱の一覧へ戻る
                </Button>
              </div>
            </div>
          ) : !selectedChatId ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              {/* 空の右側に、何をすればよいかを添える（★V7・better-writing「空の状態は次の一手を」）。 */}
              <span aria-hidden="true" className="bg-canvas-sunken text-ink-faint mb-1 flex h-12 w-12 items-center justify-center rounded-full">
                <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /></svg>
              </span>
              <p className="text-ink text-sm font-bold">会話を選ぶと、ここに表示されます</p>
              <p className="text-ink-faint max-w-xs text-xs leading-relaxed">左の一覧から選んでください。「要返信」で、まだ返していない会話だけに絞れます。</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-ink-faint text-sm">読み込み中...</p>
            </div>
          ) : chatDetail ? (
            <>
              {/* Chat Header */}
              {/*
                U008: 狭い幅では「戻る・顔・名前」を1行目いっぱいに取り、
                操作（注目・担当・対応・顧客情報）は2行目へ折り返す。
                操作が同じ行にいると 390px で宛先の名前が潰れて、
                誰への返信か読めなかった。640px 以上では従来どおり1行。
              */}
              <div className="flex min-h-[66px] flex-wrap items-center gap-x-2 gap-y-2 border-b border-[#E5E7EB] bg-canvas px-4 py-3 sm:flex-nowrap">
                <div className="flex min-w-0 basis-full items-center gap-2 sm:basis-auto sm:flex-1">
                  <button
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-ink-faint hover:text-ink-secondary"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {/*
                    設計 `xGLVe` の見出しは、アバター・名前・「本名・種別・
                    最終受信」の3点。**写真が無い人でも丸は出す。** 頭文字を
                    入れておかないと、灰色の空丸が並んで誰の会話か目で追えない。
                  */}
                  <Avatar name={chatDetail.friendName} src={chatDetail.friendPictureUrl} size={32} />
                  <div className="min-w-0">
                    {/*
                      U008: 長い表示名が狭い幅で切れても、押すと(キーボードでも)
                      全文に広げられる。title でも全文を確認できる。
                    */}
                    <button
                      type="button"
                      title={chatDetail.friendName}
                      aria-expanded={headerNameExpanded}
                      onClick={() => setHeaderNameExpanded((v) => !v)}
                      className={`block w-full text-left text-sm font-medium text-ink ${headerNameExpanded ? 'whitespace-normal break-all' : 'truncate'}`}
                    >
                      {chatDetail.friendName}
                    </button>
                    <p
                      className="mt-0.5 truncate text-xs text-ink-faint"
                      title={`${chatDetail.friendRealName ? `${chatDetail.friendRealName}・` : ''}LINE・最終受信 ${formatInboxDatetime(chatDetail.lastMessageAt)}`}
                    >
                      {chatDetail.friendRealName ? `${chatDetail.friendRealName}・` : ''}LINE・最終受信 {formatInboxDatetime(chatDetail.lastMessageAt)}
                    </p>
                  </div>
                </div>

                {/*
                  設計 `TalkPane` の上部。「対応」と「担当」をここで切り替える。
                  以前は状態がバッジで出ているだけで、変えるには別の場所を
                  探す必要があった。返信しながら状態を動かすので、
                  同じ場所に置く。
                */}
                {/* 右へ寄せる。名前は左、操作は右。目で追う向きがそろう。
                    U008/U010: 狭い幅で2行目へ落ちたときも右端で切れないよう、
                    sm 未満では中でも折り返せるようにする（320pxでは3行目まで使う）。
                    sm 以上では従来どおり1行・高さ40pxを保つ。 */}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:flex-nowrap">
                  <button
                    type="button"
                    aria-label={chatDetail.isAttention ? '注目から外す' : '注目にする'}
                    aria-pressed={chatDetail.isAttention}
                    disabled={attentionSaving}
                    onClick={() => void handleAttentionUpdate()}
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control border disabled:cursor-wait disabled:opacity-60 ${chatDetail.isAttention ? 'border-warning bg-warning-bg text-warning' : 'border-hairline bg-canvas text-ink-faint hover:bg-canvas-sunken'}`}
                  >
                    <Star aria-hidden="true" size={17} fill={chatDetail.isAttention ? 'currentColor' : 'none'} />
                  </button>
                  {/*
                    素の select 要素から専用のプルダウンへ替えた。
                    **開いた中身がブラウザ任せだと画像に写らない。** 設計の
                    2-8 / 2-9 / 2-10 は「開いた状態」なので、素のセレクトの
                    ままでは永久に見比べられない。色の丸と札も設計どおりに出す。
                  */}
                  {/*
                    設計 `xGLVe` / `H3lAOB` の並びは 担当 → 対応状況。
                    先に「誰が」を決めてから「どうなっている」を動かす順で、
                    一覧の行の並び（担当の札 → 対応状況の札）とも向きがそろう。
                  */}
                  <OperatorDropdown
                    value={chatDetail.operatorId ?? 'unassigned'}
                    operators={operators}
                    onChange={(next) => {
                      if (next === 'all') return
                      void handleOperatorUpdate(next === 'unassigned' ? null : next)
                    }}
                    label="担当"
                    ariaLabel="担当者を変える"
                    allowAll={false}
                    compact={showFriendInfo}
                  />
                  <StatusDropdown
                    value={chatDetail.status as ChatStatus}
                    onChange={(next) => void handleStatusUpdate(next as Chat['status'])}
                    ariaLabel="対応状況を変える"
                  />
                  {/*
                    設計 `H3lAOB` は、閉じているときも開いているときも
                    **同じ場所に同じ1つのボタン**を置く。閉じる口が右パネルの
                    中にしか無いと、閉じたあと戻す口を別の場所で探すことになる。
                  */}
                  <button
                    type="button"
                    data-inbox-v6="customer-info-toggle"
                    onClick={() => setShowFriendInfo((current) => !current)}
                    aria-expanded={showFriendInfo}
                    className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-[#E5E7EB] bg-canvas px-2.5 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
                  >
                    {showFriendInfo
                      ? <PanelRightClose aria-hidden="true" size={14} />
                      : <PanelRightOpen aria-hidden="true" size={14} />}
                    {showFriendInfo ? '顧客情報を閉じる' : '顧客情報を表示'}
                  </button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/*
                    「未読に戻す」「対応中にする」「対応済みにする」は
                    上の「対応 ▾」と同じことをしていたので外した。
                    同じ操作の入口が2つあると、どちらが正なのか分からない。
                  */}
                </div>
              </div>

              {/* Messages — LINE-style chat bubbles */}
              <div className="relative flex min-h-0 flex-1 flex-col">
              <div ref={messagesScrollRef} className="flex-1 space-y-2 overflow-y-auto p-4" style={{ backgroundColor: '#7292BD' }}>
                {/*
                  古い履歴の続き。直近100件だけ読んでいる会話で出す。
                  押すと今見えている最古の1件より古い分を上に足す。
                */}
                {messagesHasMore && (chatDetail.messages?.length ?? 0) > 0 && (
                  <div className="flex justify-center pb-1">
                    <button
                      type="button"
                      onClick={() => { void loadOlderMessages() }}
                      disabled={loadingOlderMessages}
                      className="bg-canvas/90 rounded-pill px-3 py-1 text-xs font-semibold text-action shadow-sm disabled:opacity-50"
                    >
                      {loadingOlderMessages ? '読み込み中...' : '前のメッセージ'}
                    </button>
                  </div>
                )}
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-on-accent/60 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const prevMsg = idx > 0 ? (chatDetail.messages ?? [])[idx - 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const isOutgoing = msg.direction === 'outgoing'

                    // メッセージ表示の分岐
                    let bubbleContent: React.ReactNode
                    if (msg.isUnsent) {
                      bubbleContent = <span className="text-ink-faint">送信を取り消しました</span>
                    } else if (msg.messageType === 'flex') {
                      bubbleContent = (
                        <div className="max-w-[300px]">
                          <FlexPreviewComponent content={msg.content} maxWidth={280} />
                        </div>
                      )
                    } else if (msg.messageType === 'image') {
                      // INBOX-30: 404・期限切れ・回線断は空白にせず、
                      // 理由の出る代替表示と読み込み直しに倒す。
                      bubbleContent = <ChatImageMessage content={msg.content} />
                    } else if (msg.messageType === 'sticker') {
                      bubbleContent = <StickerMessageImage content={msg.content} />
                    } else {
                      bubbleContent = <span>{msg.content}</span>
                    }

                    if (msg.source === 'scenario') {
                      const startedAt = new Date(msg.createdAt).toLocaleString('ja-JP', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                      return (
                        <div key={msg.id}>
                          {showDateSep && (
                            <div className="my-3 flex justify-center">
                              <span className="bg-ink/20 text-on-accent/85 rounded-full px-2.5 py-0.5 text-[11px]">
                                {formatYmdSlash(msg.createdAt)}
                              </span>
                            </div>
                          )}
                          <div className="my-2 flex items-center justify-center gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-pill bg-canvas/90 px-3 py-1 text-[11px] font-semibold text-action shadow-sm">
                              <Link2 aria-hidden="true" size={13} />
                              シナリオ「{msg.scenarioName ?? '名称未設定'}」を開始
                            </span>
                            <time className="text-micro text-ink-faint">{startedAt}</time>
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div key={msg.id}>
                        {showDateSep && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] text-on-accent/85 bg-ink/20 px-2.5 py-0.5 rounded-full">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <div
                          className={`flex gap-2 ${isOutgoing ? 'items-end justify-end' : 'items-start justify-start'}`}
                        >
                          {/* 相手のアイコン（incoming のみ） */}
                          {!isOutgoing && (
                            chatDetail.friendPictureUrl ? (
                              <img src={chatDetail.friendPictureUrl} alt="" className="h-8 w-8 flex-shrink-0 rounded-full" />
                            ) : (
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-avatar-indigo text-xs font-bold text-on-action" aria-hidden="true">
                                {chatDetail.friendName.charAt(0)}
                              </div>
                            )
                          )}

                          <div className={`flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            {/* メッセージバブル */}
                            <div
                              className={`max-w-[320px] px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                                isOutgoing
                                  ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-on-accent'
                                  : 'min-w-64 rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-canvas text-ink'
                              }`}
                              style={isOutgoing ? { backgroundColor: 'var(--color-accent-deep)' } : undefined}
                            >
                              {/* N-025: 引用元の表示。取り消された引用元は本文を出さない。 */}
                              {msg.quoted && (
                                <div
                                  data-inbox-v6="quoted-message"
                                  className={`mb-1.5 rounded border-l-2 py-0.5 pl-2 text-xs ${
                                    isOutgoing ? 'border-on-accent/40 text-on-accent/80' : 'border-accent text-ink-faint'
                                  }`}
                                >
                                  {msg.quoted.isUnsent
                                    ? '取り消されたメッセージ'
                                    : msg.quoted.messageType === 'text'
                                      ? msg.quoted.content
                                      : `[${msg.quoted.messageType}]`}
                                </div>
                              )}
                              {bubbleContent}
                            </div>
                            {/* 時刻と引用操作 */}
                            <span className="mt-0.5 flex items-center gap-2 px-1">
                              <span className="text-xs text-on-accent/50">
                                {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              {!msg.isUnsent && (
                                <button
                                  type="button"
                                  data-inbox-v6="quote-reply"
                                  onClick={() => {
                                    setQuotedMessage(msg)
                                    textareaRef.current?.focus()
                                  }}
                                  className="text-caption text-on-accent/60 underline-offset-2 hover:text-on-accent hover:underline"
                                >
                                  引用
                                </button>
                              )}
                            </span>
                          </div>

                          {/*
                            相手に見える送信元はLINE公式アカウント。管理画面では、
                            その下に実際に返信した担当者も出して取り違えを防ぐ。
                          */}
                          {isOutgoing && (
                            <div className="mb-0.5 flex w-24 shrink-0 flex-col items-center gap-1">
                              {selectedAccount?.pictureUrl ? (
                                <img
                                  src={selectedAccount.pictureUrl}
                                  alt=""
                                  className="border-canvas h-9 w-9 rounded-full border-2 object-cover"
                                />
                              ) : (
                                <div
                                  className="border-canvas flex h-9 w-9 items-center justify-center rounded-full border-2 bg-[#EAFBF0] text-[12px] font-bold text-[#057A37]"
                                  title={selectedAccount?.displayName ?? selectedAccount?.name ?? '送信アカウント'}
                                >
                                  {(selectedAccount?.displayName ?? selectedAccount?.name ?? '送').charAt(0)}
                                </div>
                              )}
                              <div
                                className="border-canvas/70 bg-canvas/90 text-ink-secondary inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold shadow-sm"
                                title={msg.sentByStaffName ?? '担当者情報なし'}
                              >
                                <span className="bg-action text-on-action flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full text-micro font-bold">
                                  {(msg.sentByStaffName ?? '担').charAt(0)}
                                </span>
                                <span className="truncate">{msg.sentByStaffName ?? '担当者'}</span>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              {/*
                INBOX-27: 読み返している途中に下へ届いた新着は、位置を
                動かさず件数の目印だけ出す。押すと新しい方へ移る。
              */}
              {unseenIncoming > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const el = messagesScrollRef.current
                    if (el) el.scrollTop = el.scrollHeight
                    setUnseenIncoming(0)
                  }}
                  className="bg-canvas/95 text-action absolute bottom-3 left-1/2 -translate-x-1/2 rounded-pill px-3 py-1.5 text-xs font-semibold shadow-md"
                >
                  新着 {unseenIncoming} 件
                </button>
              )}
              </div>

              {/*
                入力欄（設計 `Reply`）。3段。

                  上: テンプレート・送信設定・内部メモ
                  中: メッセージを入力
                  下: 改行案内、画像は JPEG / PNG、1枚 10MB まで …… 送信

                以前は送信キーの設定・入力中ローディング・画像の投入枠が
                すべて出しっぱなしで、入力欄が縦に伸びてトークが読めなかった。
                よく使うものだけ出し、設定は畳む。
              */}
              <div data-inbox-v4="composer" className="sticky bottom-0 z-10 border-t border-[#E5E7EB] bg-canvas px-4 py-3 relative">
                {/* INBOX-12: 定期更新が連続失敗で止まったときの理由と再試行 */}
                {chatPollStalled && (
                  <p className="text-danger mb-2 text-xs">
                    会話の更新を一時停止しています（接続できません）。
                    <button
                      type="button"
                      onClick={() => setChatPollRetryKey((key) => key + 1)}
                      className="font-bold underline"
                    >
                      再試行する
                    </button>
                  </p>
                )}
                {/* 上段 */}
                {/*
                  U010: テンプレート・送信の設定・内部メモは横に収まらなければ
                  次の行へ折り返す。1行に固定したままだと 390px では右の
                  「内部メモ」が画面外へ切れて、存在自体に気づけない。
                */}
                <div className="mb-2 flex items-center gap-2">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {/* 設計 2-1-1。選ぶと本文が入力欄に入る。 */}
                    <button
                      type="button"
                      onClick={() => setShowTemplatePicker(true)}
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-canvas px-3 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
                    >
                      ▧ テンプレートを選択
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowComposerOptions((v) => !v)}
                      className="inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-canvas px-3 text-xs font-semibold text-[#2563EB] hover:bg-[#F7F8F6]"
                    >
                      ⚙ {showComposerOptions ? '送信の設定を閉じる' : '送信の設定'}
                    </button>
                    {/*
                      設計 `B7CER8` は、開いている間このボタン自体が
                      琥珀色に変わる。窓が上に出るので、どのボタンから出た窓
                      なのかが分かる印が要る。
                    */}
                    <button
                      type="button"
                      data-inbox-v6="internal-memo-toggle"
                      onClick={() => setShowMemoEditor((current) => !current)}
                      aria-expanded={showMemoEditor}
                      className={`inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border px-3 text-xs font-semibold ${
                        showMemoEditor
                          ? 'border-status-warn bg-status-warn-soft text-status-warn-deep'
                          : 'border-[#E5E7EB] bg-canvas text-[#344054] hover:bg-[#F7F8F6]'
                      }`}
                    >
                      <NotebookPen aria-hidden="true" size={14} />
                      内部メモ
                    </button>
                  </div>
                </div>

                {/* 送信の設定は送信キーだけ。入力中ローディングと画像の投入枠は
                    ここから外した。画像は下の枠のアイコンから選ぶ。 */}
                {showComposerOptions && (
                  <div className="bg-canvas-sunken rounded-card mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 p-3 text-xs">
                    <span className="text-ink-faint">送信キー:</span>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="radio"
                        checked={sendMode === 'enter'}
                        onChange={() => setSendMode('enter')}
                        className="accent-accent"
                      />
                      <span>Enter</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1">
                      <input
                        type="radio"
                        checked={sendMode === 'shift-enter'}
                        onChange={() => setSendMode('shift-enter')}
                        className="accent-accent"
                      />
                      <span>Shift+Enter</span>
                    </label>
                  </div>
                )}

                {/*
                  設計 `B7CER8` の内部メモは**画面を覆う窓ではなく、
                  「内部メモ」ボタンの上に出る紙**。トークを隠さずに、
                  直前のやり取りを見ながら書けるようにするため。
                */}
                {showMemoEditor && (
                  <div
                    role="dialog"
                    aria-labelledby="chat-internal-memo-title"
                    data-inbox-v6="internal-memo-popover"
                    ref={memoPopoverRef}
                    /*
                      INBOX-19: 紙はボタンの上へ伸びるため、高さの上限を
                      画面から差し引いておく。上限を超えた分は紙の中だけを
                      スクロールさせ、見出しと操作が画面上部へ欠けない
                      ようにする。
                    */
                    className="border-hairline rounded-panel shadow-float absolute bottom-full left-4 z-30 mb-2 max-h-[calc(100dvh-9rem)] w-[calc(100%-2rem)] max-w-[760px] overflow-y-auto border bg-canvas p-5"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <h2 id="chat-internal-memo-title" className="text-ink flex items-center gap-2 text-sm font-bold">
                        <NotebookPen aria-hidden="true" size={16} className="text-status-warn" />
                        内部メモを追加
                      </h2>
                      <span className="rounded-pill bg-status-warn-soft text-status-warn-deep text-micro shrink-0 px-2 py-0.5 font-semibold">
                        スタッフのみ
                      </span>
                    </div>
                    <p className="text-ink-faint mt-2 text-xs">
                      対応方針や引き継ぎ内容を入力してください。顧客には表示・送信されません。
                    </p>
                    <label htmlFor="chat-internal-memo" className="sr-only">内部メモの本文</label>
                    <textarea
                      id="chat-internal-memo"
                      value={memoDraft}
                      onChange={(event) => setMemoDraft(event.target.value)}
                      rows={4}
                      placeholder="例：次回返信時に配送先住所を確認する"
                      className="border-hairline focus:border-accent focus:ring-accent/15 rounded-control mt-3 w-full resize-y border bg-canvas px-3 py-2 text-sm leading-6 outline-none focus:ring-2"
                    />
                    {memoError && <p className="text-danger mt-1 text-xs">{memoError}</p>}
                    {/*
                      INBOX-19: 説明は独立した行へ。操作と同じ flex 行に置くと、
                      狭い幅で説明が1文字ずつ縦に割れ、紙全体が上へ伸びて
                      見出しが画面外へ出ていた。
                    */}
                    <p className="text-ink-faint mt-3 text-xs">この内容は社内メンバーだけが確認できます</p>
                    <div className="mt-3 flex items-center justify-end gap-2">
                      {/* 設計 `B7CER8` の2つは h36・角丸8・13px・600。共通ボタンと同値。 */}
                      <Button
                        onClick={closeMemoEditor}
                      >
                        キャンセル
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void handleSaveMemo()}
                        disabled={memoSaving || memoDraft === (chatDetail?.notes ?? '')}
                      >
                        {memoSaving ? '保存中...' : 'メモを保存'}
                      </Button>
                    </div>
                  </div>
                )}

                {/* N-025: 引用中のメッセージ。×で外す。 */}
                {quotedMessage && (
                  <div
                    data-inbox-v6="quote-preview"
                    className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent-soft px-3 py-1.5 text-xs"
                  >
                    <span className="shrink-0 font-semibold text-ink-faint">引用:</span>
                    <span className="min-w-0 flex-1 truncate text-ink-secondary">
                      {quotedMessage.isUnsent
                        ? '取り消されたメッセージ'
                        : quotedMessage.messageType === 'text'
                          ? quotedMessage.content
                          : `[${quotedMessage.messageType}]`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setQuotedMessage(null)}
                      aria-label="引用を解除"
                      className="shrink-0 text-ink-faint hover:text-danger"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </div>
                )}

                {/* N-025: 送信予約パネル。日時はJSTのdatetime-localで入力する。 */}
                {showSchedulePanel && (
                  <div
                    data-inbox-v6="schedule-panel"
                    className="mb-2 rounded-lg border border-hairline bg-canvas-sunken p-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <label htmlFor="schedule-at" className="text-ink-faint text-xs">
                        送る日時:
                      </label>
                      <input
                        id="schedule-at"
                        type="datetime-local"
                        value={scheduleInput}
                        onChange={(e) => setScheduleInput(e.target.value)}
                        className="rounded-control border border-hairline bg-canvas px-2 py-1 text-xs"
                      />
                      <Button
                        variant="primary"
                        type="button"
                        onClick={() => void handleScheduleSend()}
                        disabled={scheduling || messageOverLimit || !messageContent.trim() || !scheduleInput}
                      >
                        {scheduling ? '予約中...' : 'この日時で予約する'}
                      </Button>
                      <span className="text-ink-faint text-xs">入力した日時は日本時間です</span>
                    </div>
                    {scheduledSendsFailed && (
                      <p className="mt-2 text-xs text-danger">
                        予約の一覧を読み込めませんでした。
                        <button
                          type="button"
                          data-inbox-v6="scheduled-retry"
                          onClick={() => { if (selectedChatId) void loadScheduledSends(selectedChatId) }}
                          className="ml-1 font-semibold underline"
                        >
                          再読み込み
                        </button>
                      </p>
                    )}
                    {scheduledSends.length > 0 && (
                      <ul className="mt-2 space-y-1.5">
                        {scheduledSends.map((row) => (
                          <li
                            key={row.id}
                            data-inbox-v6="scheduled-row"
                            className="flex items-center gap-2 rounded-control border border-hairline bg-canvas px-2.5 py-1.5 text-xs"
                          >
                            <span className="shrink-0 font-semibold text-ink">
                              {/* INBOX-21: 予約時刻は日本時間で出す。端末の時間帯でずらさない。 */}
                              {formatJstScheduledAt(row.scheduledAt)}
                              {row.status === 'sending' && '（送信中）'}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-ink-secondary" title={row.content}>
                              {row.content}
                            </span>
                            <input
                              type="datetime-local"
                              aria-label="予約時刻を変更(日本時間)"
                              title="日本時間で指定します"
                              defaultValue={isoToJstDatetimeLocal(row.scheduledAt)}
                              disabled={row.status !== 'scheduled'}
                              onChange={(e) => {
                                if (e.target.value) void handleReschedule(row.id, e.target.value)
                              }}
                              className="w-40 shrink-0 rounded-control border border-hairline bg-canvas px-1.5 py-0.5 text-xs disabled:opacity-40"
                            />
                            <button
                              type="button"
                              onClick={() => void handleCancelScheduled(row.id)}
                              disabled={row.status !== 'scheduled'}
                              className="shrink-0 text-ink-faint hover:text-danger disabled:opacity-40"
                            >
                              取消
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/*
                  INBOX-32: 送る前に何を添付したかを見せる。
                  小さい画像・ファイル名・大きさ・外す/変更/大きく見る。
                  この添付は今開いている会話にだけ結びつく(INBOX-23)。
                */}
                {pendingImage && pendingImage.mode === 'line-image' && (
                  <div
                    data-inbox-v6="image-attachment-preview"
                    className="mb-2 flex items-center gap-2 rounded-lg border border-hairline bg-canvas-sunken px-3 py-2"
                  >
                    <button
                      type="button"
                      onClick={() => setImagePreviewOpen(true)}
                      title="画像を大きく見る"
                      aria-label="添付した画像を大きく見る"
                      className="shrink-0"
                    >
                      <img
                        src={pendingImage.previewImageUrl}
                        alt={pendingImageMeta?.name ?? '添付した画像'}
                        className="h-10 w-10 rounded-md border border-hairline object-cover"
                      />
                    </button>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="text-ink block truncate font-semibold" title={pendingImageMeta?.name}>
                        {pendingImageMeta?.name ?? '画像'}
                      </span>
                      <span className="text-ink-faint">
                        {pendingImageMeta ? formatByteSize(pendingImageMeta.size) : ''}
                        {pendingImageMeta ? ' ・ 添付済み' : '添付済み'}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageUploading}
                      className="text-action shrink-0 whitespace-nowrap text-xs font-semibold"
                    >
                      変更
                    </button>
                    <button
                      type="button"
                      onClick={clearPendingImage}
                      className="text-ink-faint hover:text-danger shrink-0 whitespace-nowrap text-xs"
                    >
                      外す
                    </button>
                  </div>
                )}

                <div className="rounded-[10px] border border-[#D0D5DD] bg-canvas p-2 focus-within:border-[#06C755] focus-within:ring-2 focus-within:ring-[#06C755]/15">
                  {/* 中段 */}
                  {/*
                    INBOX-20: この入力欄に textareaRef を付ける。
                    外れていると自動拡張と「引用を選んだら入力へ戻る」が
                    動かなかった。
                  */}
                  <textarea
                  ref={textareaRef}
                  value={messageContent}
                  onChange={(e) => setMessageContent(e.target.value)}
                  onKeyDown={handleKeyDown}
                  onCompositionStart={() => { isComposingRef.current = true }}
                  onCompositionEnd={() => { isComposingRef.current = false }}
                  rows={3}
                  placeholder="メッセージを入力"
                  aria-label="メッセージを入力"
                  aria-invalid={messageOverLimit}
                  className="w-full resize-none border-0 px-1 py-1 text-sm outline-none"
                  />

                  <p className="mt-1 flex items-center justify-between gap-2 text-xs">
                    {/* INBOX-29: 残りを送る前に見せる。超えたら送らせない。 */}
                    <span className={messageOverLimit ? 'text-danger font-semibold' : 'text-ink-faint'}>
                      {messageLength.toLocaleString()} / {MESSAGE_MAX_LENGTH.toLocaleString()}
                      {messageOverLimit ? ' ・ 文字数が上限を超えています' : ''}
                    </span>
                    <span className="text-ink-faint shrink-0">
                      {sendMode === 'enter' ? 'Shift + Enter で改行' : 'Enter で改行'}
                    </span>
                  </p>

                  {/* 下段 */}
                  {/*
                    U009: 画像案内・予約・送信が同じ行に詰まると 390px で
                    「送信」が送／信に割れていた。行自体を折り返せるようにし、
                    長い画像エラーが出ても右の操作を圧迫しない。
                  */}
                  <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                  {/*
                    画像はここから。以前は「送信の設定」の中に投入枠を出しっぱなし
                    にしていて、入力欄が縦に伸びてトークが読めなかった。
                    アイコンを押すとファイルを選ぶ窓が開く。
                  */}
                  <span className="flex min-w-0 items-center gap-2">
                    <input
                      ref={imageInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        // 同じ画像をもう一度選べるように値を戻す。
                        e.target.value = ''
                        if (file) void handlePickImage(file)
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      disabled={imageUploading}
                      title="画像を選ぶ"
                      aria-label="画像を選ぶ"
                      className="rounded-md px-2 py-1 text-sm text-[#667085] hover:bg-[#F2F4F7] disabled:opacity-50"
                    >
                      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 16V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2m0 0 4-4a2 2 0 0 1 3 0l5 5M14 10h.01" />
                      </svg>
                    </button>
                    {/*
                      INBOX-31: 状態を分けて伝える。
                      - 読み込み中 …「画像を読み込み中」(まだ何も送っていない)
                      - 準備失敗 …「添付できませんでした。選び直してください」
                      - 添付済み … INBOX-32 のプレビュー行で見せる
                    */}
                    <span
                      className={`min-w-0 truncate text-xs ${imageError ? 'text-danger' : 'text-ink-faint'}`}
                      title={imageError || '画像は JPEG / PNG、1枚 1MB まで'}
                    >
                      {imageError
                        ? imageError
                        : imageUploading
                          ? '画像を読み込み中…'
                          : '画像は JPEG / PNG、1枚 1MB まで'}
                    </span>
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-2">
                    <Button
                      size="field"
                      data-inbox-v6="schedule-toggle"
                      onClick={() => setShowSchedulePanel((v) => !v)}
                      aria-expanded={showSchedulePanel}
                    >
                      予約{scheduledSends.length > 0 ? `(${scheduledSends.length})` : ''}
                    </Button>
                    <button
                      onClick={handleSendMessage}
                      disabled={sending || messageOverLimit || (!messageContent.trim() && !pendingImage)}
                      className="shrink-0 whitespace-nowrap rounded-lg bg-accent-deep px-5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-deep/90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {sending ? '送信中...' : '送信'}
                    </button>
                  </span>

                  <TemplatePicker
                    open={showTemplatePicker}
                    onClose={() => setShowTemplatePicker(false)}
                    chatId={selectedChatId}
                    onPick={(content) =>
                      // 入力済みの文があれば消さずに続ける。書きかけを失わせない。
                      setMessageContent((prev) => (prev.trim() ? `${prev}\n${content}` : content))
                    }
                  />
                  </div>
                </div>
              </div>

              {/* INBOX-32: 添付画像を大きく確かめる窓。背景か Esc 相当の閉じるで戻る。 */}
              {imagePreviewOpen && pendingImage && pendingImage.mode === 'line-image' && typeof document !== 'undefined' && createPortal(
                <div
                  role="dialog"
                  aria-modal="true"
                  aria-label="添付した画像の確認"
                  className="fixed inset-0 z-[100] flex items-center justify-center bg-[#101828]/60 p-4"
                  onClick={() => setImagePreviewOpen(false)}
                >
                  <div
                    className="w-full max-w-2xl rounded-[14px] border border-[#E5E7EB] bg-canvas p-4 shadow-2xl"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <img
                      src={pendingImage.originalContentUrl}
                      alt={pendingImageMeta?.name ?? '添付した画像'}
                      className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md object-contain"
                    />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-ink-faint min-w-0 truncate text-xs" title={pendingImageMeta?.name}>
                        {pendingImageMeta?.name ?? '画像'}
                        {pendingImageMeta ? ` ・ ${formatByteSize(pendingImageMeta.size)}` : ''}
                      </p>
                      <button
                        type="button"
                        onClick={() => setImagePreviewOpen(false)}
                        className="shrink-0 rounded-lg border border-[#E5E7EB] bg-canvas px-4 py-2 text-sm font-semibold text-[#667085] hover:bg-[#F7F8F6]"
                      >
                        閉じる
                      </button>
                    </div>
                  </div>
                </div>,
                document.body,
              )}
            </>
          ) : null}
        </div>

        {/*
          友だち詳細。3列に収まる幅（1536px〜）では右列として常設し、
          それより狭い幅ではトークの上に重ねるドロワーにする(#982)。
          以前は `hidden xl:block` だけで、1280px未満では開閉ボタンを
          押しても何も出ず、1280〜1536pxでは `xl:min-w-xl` と固定幅の
          積み上げで右に切れていた。

          friendId は **現在の選択** を優先する。chatDetail の読み込み中は
          一覧にある chat.friendId を使い、読み込み後は同じ会話の
          chatDetail.friendId を使う。会話IDと友だちIDは別物なので混同しない。
        */}
        {/*
          友だち詳細。メールでも出したいが、メールのスレッドは友だちに
          紐づいていない（support_email_threads は customer_email しか
          持たない）。メールアドレスから友だちを引く口が要る。
          docs/v025-open-questions.md に残している。

          いまはメールを開いているときは案内を出す。空の枠を出すより、
          なぜ出ないかが分かる方がよい。
        */}
        {showFriendInfo && (selectedChatId || selectedThreadId) && (
          <>
            {/*
              1536px 未満ではトークの上に重ねるドロワー。背景（暗幕）を
              押しても閉じる。モバイルヘッダー(z-50)より上に置く。
              1536px 以上では右列として常設するので暗幕は CSS で消す。
            */}
            <div
              aria-hidden="true"
              onMouseDown={() => setShowFriendInfo(false)}
              className="bg-scrim fixed inset-0 z-[60] 2xl:hidden"
            />
            <aside
              ref={customerPanelRef}
              data-inbox-v4="customer-panel"
              role={wideInfoPanel ? undefined : 'dialog'}
              aria-modal={wideInfoPanel ? undefined : true}
              aria-label="顧客情報"
              tabIndex={-1}
              className="fixed inset-y-0 right-0 z-[70] h-full w-[340px] max-w-full shrink-0 overflow-hidden bg-canvas shadow-2xl focus:outline-none 2xl:relative 2xl:z-auto 2xl:w-[300px] 2xl:shadow-none"
            >
            {/*
              重なりの中にも閉じるボタンを置く。上部のボタンだけだと、
              重なりが上部を覆っている画面幅で閉じられなくなる。
              実際そうなっていた。
            */}
            <button
              type="button"
              onClick={() => setShowFriendInfo(false)}
              aria-label="顧客情報を閉じる"
              className="absolute top-[17px] right-3 z-10 inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#E5E7EB] bg-canvas text-[#667085] hover:bg-[#F7F8F6]"
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
            {selectedThreadId ? (
              /*
                メールの相手は友だちに結びついていない。
                以前は「紐づいていません」の1行だけで、なぜなのか・
                どうすればよいのかが分からなかった。誰との話かと、
                いま何ができるかを出す。
              */
              (() => {
                const mail = emailItems.find((e) => e.threadId === selectedThreadId)
                return (
                  <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
                    <div className="min-h-[66px] border-b border-[#E5E7EB] px-4 py-3 pr-20">
                      <p className="text-ink text-sm font-bold">顧客情報</p>
                      <p className="text-ink-faint mt-0.5 truncate text-micro">メールの相手を確認できます</p>
                    </div>

                    <div className="flex-1 overflow-y-auto divide-y divide-[#E5E7EB]">
                      <section className="flex flex-col items-center px-5 py-5 text-center">
                        <div className="bg-canvas-sunken border-hairline flex h-14 w-14 items-center justify-center rounded-full border">
                          <span className="text-ink-secondary text-[11px] font-bold">MAIL</span>
                        </div>
                        <p className="text-ink mt-2 max-w-full truncate text-sm font-bold">{mail?.customerName ?? '—'}</p>
                        <p className="text-ink-faint mt-0.5 max-w-full break-all text-[11px]">
                          {mail?.customerIdentifier ?? 'メールアドレス未登録'}
                        </p>
                      </section>

                      <section className="px-5 py-4">
                        <p className="text-ink text-xs font-bold">基本情報</p>
                        <dl className="mt-2 space-y-2 text-xs">
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-ink-faint shrink-0">名前</dt>
                            <dd className="text-ink-secondary min-w-0 truncate text-right">{mail?.customerName ?? '未登録'}</dd>
                          </div>
                          <div className="flex items-start justify-between gap-3">
                            <dt className="text-ink-faint shrink-0">メール</dt>
                            <dd className="text-ink-secondary min-w-0 break-all text-right">{mail?.customerIdentifier ?? '未登録'}</dd>
                          </div>
                        </dl>
                      </section>

                      <section className="px-5 py-4">
                        <p className="text-ink text-xs font-bold">LINE友だちとの連携</p>
                        <p className="text-ink-faint mt-2 text-xs leading-relaxed">
                          このメールアドレスは、まだLINEの友だちと結びついていません。
                        </p>
                        <Link href="/friends" className="text-action mt-2 inline-flex text-xs font-semibold hover:underline">
                          友だち一覧で確認する
                        </Link>
                      </section>

                    </div>
                  </div>
                )
              })()
            ) : (
            <FriendInfoSidebar
              friendId={activeFriendId}
              operatorName={
                chatDetail?.operatorId
                  ? operators.find((operator) => operator.id === chatDetail.operatorId)?.name ?? null
                  : null
              }
              chatStatus={
                chatDetail && chatDetail.id === selectedChatId
                  ? { status: chatDetail.status, notes: chatDetail.notes }
                  : undefined
              }
            />
            )}
            </aside>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * 受信箱（設計 `V2 2-1 受信箱`）。
 *
 * 設計に上部タブは無い。チャネル（すべて / LINE / メール）は
 * 画面内の絞り込みチップとして扱う。タブにすると「LINEの受信箱」と
 * 「メールの受信箱」が別物に見えるが、実際は1つの受信箱で、
 * 出どころが違うだけ。設計が1画面にまとめているのはそのため。
 *
 * ただし中身の作りが LINE とメールで大きく違うので、いまは
 * チップで表示を切り替える形にしている。将来1つの一覧に混ぜるときも、
 * 画面の入口は変わらない。
 */
// 受信箱のチャネル。
//
// /api/support/inbox は channel を 'all' | 'line' | 'email' で受け取り、
// どちらの出どころも同じ形（id / channel / customerName / preview /
// lastIncomingAt）で返す。つまり1つの一覧に混ぜられる。
const CHANNELS = [
  { key: 'all', label: 'すべて' },
  { key: 'line', label: 'LINE' },
  { key: 'email', label: 'メール' },
] as const

function ChatsPageHost() {
  const params = useSearchParams()
  // すべて / LINE / メール。既定はすべて。
  // 出どころを気にせず「返信を待っている人」を見たいのが普通なので、
  // 最初から絞った状態で出さない。
  const raw = params.get('channel')
  const channel: 'all' | 'line' | 'email' =
    raw === 'line' || raw === 'email' ? raw : 'all'

  return (
    <div className="space-y-3">
      {/*
        1つの受信箱。LINEもメールも同じ一覧に並び、同じ場所で開く。

        以前はメールを下に別ブロックで積んでいたが、返信を待っている人を
        2か所で探すことになっていた。設計 `V2 2-1 受信箱` の一覧も
        「✉ 定期便の解約について」のように1本に混ざっている。
      */}
      <ChatsPageInner channel={channel} />

    </div>
  )
}

export default function ChatsPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <ChatsPageHost />
    </Suspense>
  )
}
