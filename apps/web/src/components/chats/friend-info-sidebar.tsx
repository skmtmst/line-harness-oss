'use client'

import Avatar from '@/components/shared/avatar'
import { useCallback, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, ApiError, type FriendUpcoming, type MileageHistoryItem, type MileageSummary } from '@/lib/api'
import { tagTextColor } from '@/lib/presentation'
import type { FriendField, Tag } from '@line-crm/shared'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Select from '@/components/shared/select'
import { TextArea } from '@/components/shared/text-field'
import Combobox from '@/components/shared/combobox'
import { notifyToast } from '@/components/shared/toast'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import InlineEdit from '@/components/shared/inline-edit'
import { runOptimisticWithUndo } from '@/lib/undoable'
import PrepayBadgeV8 from '@/app/booking/prepay-badge-v8'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { GripVertical, X } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { useAdminTheme } from '@/lib/use-admin-theme'
import v8 from '@/v8/inbox-chat/customer-panel.module.css'
import chatV8 from '@/v8/inbox-chat/inbox-chat.module.css'

interface FriendDetail {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  metadata: Record<string, unknown>
  /** 100 で足した列。LINEの表示名とは別に、こちらで付けた名前。 */
  realName: string | null
  /** 社内での呼び名。表示名が本名と違うときに使う。 */
  systemDisplayName: string | null
  refCode: string | null
  /** N-036: 友だち詳細と同じ流入元名。無い・消えた経路は null。 */
  firstTrackedLinkName: string | null
  /** フォーム回答の総数。formSubmissions は最新10件までのため、続きの有無はこれで判別する。 */
  formSubmissionTotal?: number | null
  createdAt: string
  tags: Array<{ id: string; name: string; color: string }>
  formSubmissions: Array<{
    id: string
    formId: string
    formName: string
    fields: Array<{ name: string; label: string }>
    data: Record<string, unknown>
    createdAt: string
  }>
}

interface ChatStatusInfo {
  status: 'unread' | 'in_progress' | 'on_hold' | 'resolved' | null
  notes: string | null
}

interface Props {
  friendId: string | null
  /** 親 (ChatDetail) が持っている chat 側の情報 — status / notes */
  chatStatus?: ChatStatusInfo
  /** 担当者名 (ChatDetail で operatorId → name 変換済を渡す想定) */
  operatorName?: string | null
  /** A-2 その場で直すための会話 ID。無いときは表示のみ（従来どおり）。 */
  chatId?: string | null
  /** 同時編集の見分け札（chats.revision）。無いときは送らない。 */
  revision?: number
  /** 担当の選択肢。無いときは担当の変更欄を出さない。 */
  operators?: Array<{ id: string; name: string }>
  /** 現在の担当 ID。無いときは未割り当て扱い。 */
  operatorId?: string | null
  /** 開いているLINEアカウントの ID。前払いのみの印に使う。無いときは印を出さない。 */
  accountId?: string | null
  /** 保存が通ったあとに親へ知らせる（一覧の読み直しなど）。 */
  onChatChanged?: () => void
}

/** B-26 知らせの文に使う対応状況の名前（受信箱の状態の切り替えと同じ言葉）。 */
const STATUS_WORD: Record<NonNullable<ChatStatusInfo['status']>, string> = {
  unread: '未対応',
  in_progress: '対応中',
  on_hold: '保留',
  resolved: '対応済み',
}

const STATUS_OPTIONS: Array<{ value: NonNullable<ChatStatusInfo['status']>; label: string }> = [
  { value: 'unread', label: '未対応' },
  { value: 'in_progress', label: '対応中' },
  { value: 'on_hold', label: '保留' },
  { value: 'resolved', label: '対応済み' },
]

const DETAIL_SECTIONS = [
  { key: 'profile', label: 'プロフィール' },
  { key: 'names', label: '基本情報' },
  { key: 'tags', label: 'タグ' },
  { key: 'support', label: '次の対応' },
  { key: 'starred', label: '★つき情報' },
  { key: 'richMenu', label: 'リッチメニュー' },
  { key: 'metadata', label: '友だち情報' },
  { key: 'forms', label: 'フォーム回答' },
  { key: 'mileage', label: 'マイル' },
] as const
type DetailSectionKey = (typeof DETAIL_SECTIONS)[number]['key']

/*
 * `Xi4x9` に描かれた、運用者が選ぶ7つの表示単位。
 *
 * INBOX-04: スイッチの名前は、実際に消える節の見出しと同じ言葉にする。
 * 以前は「予約・EC」でリッチメニュー、「内部メモ」で友だち情報と
 * フォーム回答が隠れ、何が消えるか名前から読めなかった。
 */
const DETAIL_SETTING_GROUPS: Array<{
  key: string
  label: string
  sections: DetailSectionKey[]
}> = [
  { key: 'basic', label: 'プロフィール・基本情報', sections: ['profile', 'names'] },
  { key: 'tags', label: 'タグ', sections: ['tags'] },
  { key: 'assignment', label: '次の対応', sections: ['support'] },
  { key: 'next', label: '★つき友だち情報', sections: ['starred'] },
  { key: 'booking', label: 'リッチメニュー', sections: ['richMenu'] },
  { key: 'mileage', label: 'マイル', sections: ['mileage'] },
  { key: 'memo', label: '友だち情報・フォーム回答', sections: ['metadata', 'forms'] },
]

const DEFAULT_SECTION_ORDER = DETAIL_SETTING_GROUPS.flatMap((group) => group.sections)

/** ★V8 顔の下の「2025年8月14日に友だち追加」。日本時間の暦で書く。 */
function formatAddedDate(iso: string | null): string {
  if (!iso) return '友だち追加日は未登録'
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000)
  if (Number.isNaN(d.getTime())) return '友だち追加日は未登録'
  return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日に友だち追加`
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusLabels: Record<NonNullable<ChatStatusInfo['status']>, { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-status-danger-selected text-danger' },
  in_progress: { label: '対応中', className: 'bg-warning-bg text-warning' },
  on_hold: { label: '保留', className: 'bg-action-soft text-action' },
  resolved: { label: '対応済み', className: 'bg-success-bg text-success' },
}

/*
 * Render a metadata value safely as text.
 * INBOX-07: 配列やオブジェクトも生のJSONではなく読める形へ畳む。
 * 値の中身（URL・長文）はそのまま出し、枠の中で安全に折り返す。
 */
function renderValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) {
    const items = value.map((item) => renderValue(item)).filter((item) => item !== '-')
    return items.length > 0 ? items.join('、') : '-'
  }
  if (typeof value === 'object') {
    try {
      const entries = Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => `${key}: ${renderValue(item)}`)
      return entries.length > 0 ? entries.join('、') : '-'
    } catch {
      return '-'
    }
  }
  return String(value)
}

/**
 * 省略表示の名前や値。押すと(キーボードでも)全文へ広げられる。
 * 狭いサイドバーでは長い名前が切れるので、切れたまま読めない
 * 状態にしないためのもの(U008)。
 */
function ExpandableText({ value, className = '', empty = '未登録' }: {
  value: string | null
  className?: string
  empty?: string
}) {
  const [expanded, setExpanded] = useState(false)
  /*
   * ★V8：空の「未登録」はほかの値と同じ大きさ（13px）・普通の太さで、薄い色にする。
   * 大きさを付けないと親の 16px を継いで、値より大きく見えていた（オーナー指摘）。
   */
  if (!value) return <span className="text-ink-faint v8:text-label v8:font-normal">{empty}</span>
  return (
    <button
      type="button"
      title={value}
      aria-expanded={expanded}
      onClick={() => setExpanded((v) => !v)}
      className={`${className} min-w-0 text-left ${expanded ? 'whitespace-normal break-all' : 'truncate'}`}
    >
      {value}
    </button>
  )
}

/*
 * IDEA-02: 「次の予定」の行から詳細へ進む先。
 * kind ごとに専用の画面へ。個別相談は専用の一覧・詳細画面がまだ無いので、
 * 友だち詳細（相談の履歴が出る側）へ誘導する。
 */
function upcomingBookingHref(booking: NonNullable<FriendUpcoming['nextBooking']>, friendId: string): string {
  if (booking.kind === 'booking') return `/booking/bookings/detail?id=${booking.id}`
  if (booking.kind === 'event_booking') return `/events/bookings?id=${booking.id}`
  return `/friends/detail?id=${friendId}`
}

function upcomingDeliveryHref(delivery: NonNullable<FriendUpcoming['nextAutoDelivery']>): string {
  return delivery.kind === 'scenario'
    ? `/scenarios/detail?id=${delivery.id}`
    : `/reminders/detail?id=${delivery.id}`
}

export default function FriendInfoSidebar({ friendId, chatStatus, operatorName, chatId, revision, operators, operatorId, accountId, onChatChanged }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* 前払いのみの印を外せるのは店の管理者だけ（友だち詳細と同じ決まり）。 */
  const [canClearPrepay] = useState(() => typeof window === 'undefined' ? true : isOwnerOrAdmin())
  // A-2: その場で直したときの画面側の持ち直し（楽観更新）。親の chatDetail とは別に、
  // このパネル内での見た目だけを先に変える。保存が失敗したら戻す。
  const [localStatus, setLocalStatus] = useState<ChatStatusInfo['status'] | undefined>(undefined)
  const [localOperatorId, setLocalOperatorId] = useState<string | null | undefined>(undefined)
  const [localNotes, setLocalNotes] = useState<string | null | undefined>(undefined)
  const [localTags, setLocalTags] = useState<Array<{ id: string; name: string; color: string }> | undefined>(undefined)
  const effectiveStatus = localStatus !== undefined ? localStatus : chatStatus?.status
  const effectiveOperatorId = localOperatorId !== undefined ? localOperatorId : operatorId
  const effectiveNotes = localNotes !== undefined ? localNotes : chatStatus?.notes
  const effectiveTags = localTags ?? friend?.tags
  // 友だち・会話が切り替わったら持ち直しを捨てる。
  useEffect(() => {
    setLocalStatus(undefined)
    setLocalOperatorId(undefined)
    setLocalNotes(undefined)
    setLocalTags(undefined)
  }, [friendId, chatId])
  const isV8 = useAdminTheme() === 'v8'
  const [showSettings, setShowSettings] = useState(false)
  const [draggedGroupKey, setDraggedGroupKey] = useState<string | null>(null)
  const settingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [settingsPanelPos, setSettingsPanelPos] = useState<{
    top?: number
    bottom?: number
    left: number
    width: number
    maxHeight: number
  } | null>(null)

  /*
   * 「表示項目」パネルは、押したボタンの下へ開く(#982 LAY-03)。
   * 以前は `top:430px` 固定で、高さ700pxの画面では「初期状態に戻す」
   * 「閉じる」が画面外へ出て届かなかった。
   * 下に十分な空きがなければボタンの上へ開き、どちらにしても
   * 最大高さは 100dvh-32px（上下16px余白）までに収める。
   */
  const updateSettingsPanelPos = useCallback(() => {
    const button = settingsButtonRef.current
    if (!button || typeof window === 'undefined') return
    const rect = button.getBoundingClientRect()
    const margin = 16
    const gap = 8
    const width = Math.min(360, window.innerWidth - margin * 2)
    // 右端をボタンに合わせる。はみ出すときだけ左へ寄せる。
    const left = Math.min(Math.max(margin, rect.right - width), window.innerWidth - width - margin)
    const belowTop = rect.bottom + gap
    const belowRoom = window.innerHeight - belowTop - margin
    const aboveRoom = rect.top - gap - margin
    const capHeight = (room: number) => Math.max(100, Math.min(room, window.innerHeight - margin * 2))
    if (belowRoom >= 240 || belowRoom >= aboveRoom) {
      setSettingsPanelPos({ top: belowTop, left, width, maxHeight: capHeight(belowRoom) })
    } else {
      setSettingsPanelPos({ bottom: window.innerHeight - rect.top + gap, left, width, maxHeight: capHeight(aboveRoom) })
    }
  }, [])

  /*
   * 開いているあいだは Escape で閉じ、画面サイズやスクロールで
   * ボタンの位置が動いたら置き直す（パネルは画面基準の fixed のため
   * 追従しないとボタンから離れる）。
   */
  useEffect(() => {
    if (!showSettings) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowSettings(false)
    }
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', updateSettingsPanelPos)
    window.addEventListener('scroll', updateSettingsPanelPos, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', updateSettingsPanelPos)
      window.removeEventListener('scroll', updateSettingsPanelPos, true)
    }
  }, [showSettings, updateSettingsPanelPos])

  const [sectionOrder, setSectionOrder] = useState<DetailSectionKey[]>(DEFAULT_SECTION_ORDER)
  const [hiddenSections, setHiddenSections] = useState<DetailSectionKey[]>([])
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  type MileageState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; summary: MileageSummary; history: MileageHistoryItem[] }
  const [mileage, setMileage] = useState<MileageState>({ kind: 'loading' })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('chat.friendInfoSections.v4')
      if (raw) {
        const parsed = JSON.parse(raw) as { order?: DetailSectionKey[]; hidden?: DetailSectionKey[] }
        const valid = new Set(DETAIL_SECTIONS.map((item) => item.key))
        const order = (parsed.order ?? []).filter((key) => valid.has(key))
        for (const item of DETAIL_SECTIONS) if (!order.includes(item.key)) order.push(item.key)
        setSectionOrder(order)
        setHiddenSections((parsed.hidden ?? []).filter((key) => valid.has(key)))
      }
    } catch {
      // 保存値が壊れていても既定順で使える。
    } finally {
      setPrefsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!prefsLoaded) return
    try {
      localStorage.setItem('chat.friendInfoSections.v4', JSON.stringify({ order: sectionOrder, hidden: hiddenSections }))
    } catch {
      // 保存できないブラウザでは、この表示中だけ設定を保つ。
    }
  }, [hiddenSections, prefsLoaded, sectionOrder])

  const sectionStyle = (key: DetailSectionKey) => ({ order: sectionOrder.indexOf(key) })
  const sectionVisibility = (key: DetailSectionKey) => hiddenSections.includes(key) ? 'hidden' : ''

  const moveGroup = (groupKey: string, delta: -1 | 1) => {
    setSectionOrder((current) => {
      const groups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
        const aIndex = Math.min(...a.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        const bIndex = Math.min(...b.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        return aIndex - bIndex
      })
      const index = groups.findIndex((group) => group.key === groupKey)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= groups.length) return current
      ;[groups[index], groups[nextIndex]] = [groups[nextIndex], groups[index]]
      return groups.flatMap((group) => group.sections)
    })
  }

  const moveGroupBefore = (sourceKey: string, targetKey: string) => {
    if (sourceKey === targetKey) return
    setSectionOrder((current) => {
      const groups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
        const aIndex = Math.min(...a.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        const bIndex = Math.min(...b.sections.map((key) => current.indexOf(key)).filter((index) => index >= 0))
        return aIndex - bIndex
      })
      const sourceIndex = groups.findIndex((group) => group.key === sourceKey)
      if (sourceIndex < 0) return current
      const [source] = groups.splice(sourceIndex, 1)
      const targetIndex = groups.findIndex((group) => group.key === targetKey)
      if (targetIndex < 0) return current
      groups.splice(targetIndex, 0, source)
      return groups.flatMap((group) => group.sections)
    })
  }

  const orderedSettingGroups = [...DETAIL_SETTING_GROUPS].sort((a, b) => {
    const aIndex = Math.min(...a.sections.map((key) => sectionOrder.indexOf(key)).filter((index) => index >= 0))
    const bIndex = Math.min(...b.sections.map((key) => sectionOrder.indexOf(key)).filter((index) => index >= 0))
    return aIndex - bIndex
  })

  /*
   * INBOX-08: 各取得は「再試行」でこのパネル内からやり直せる。
   * retry キーを増やすと effect が再取得する。失敗のたびに画面移動や
   * 全体の再読込をさせない。
   */
  const [friendRetry, setFriendRetry] = useState(0)
  const [mileageRetry, setMileageRetry] = useState(0)
  const [richMenuRetry, setRichMenuRetry] = useState(0)
  const [fieldsRetry, setFieldsRetry] = useState(0)
  const [upcomingRetry, setUpcomingRetry] = useState(0)

  useEffect(() => {
    if (!friendId) {
      setFriend(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    api.friends.get(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setFriend(res.data as unknown as FriendDetail)
      } else {
        // 内部の例外文字列はそのまま出さない。利用者向けの短い理由にする。
        setError('友だち情報を取得できませんでした')
      }
    }).catch(() => {
      if (cancelled) return
      setError('友だち情報を取得できませんでした')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId, friendRetry])

  useEffect(() => {
    if (!friendId) {
      setMileage({ kind: 'loading' })
      return
    }
    let cancelled = false
    setMileage({ kind: 'loading' })
    api.friends.mileage(friendId, 10).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setMileage({ kind: 'data', ...res.data })
      } else {
        setMileage({ kind: 'error' })
      }
    }).catch(() => {
      if (!cancelled) setMileage({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId, mileageRetry])

  /*
   * INBOX-05/07: ★つき項目と、友だち情報の項目名（内部キーではなく
   * 画面に出す名前）は friend_fields の定義から取る。
   * 友だち詳細の「情報」欄と同じ口・同じ名前にそろえる。
   */
  type FriendFieldsState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; items: FriendField[] }
  const [friendFields, setFriendFields] = useState<FriendFieldsState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setFriendFields({ kind: 'loading' })
      return
    }
    let cancelled = false
    setFriendFields({ kind: 'loading' })
    api.friendFields.forFriend(friendId, { suppressFeatureDisabledEvent: true }).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setFriendFields({ kind: 'data', items: res.data.items })
      } else {
        setFriendFields({ kind: 'error' })
      }
    }).catch(() => {
      if (!cancelled) setFriendFields({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId, fieldsRetry])

  // リッチメニュー — loading / error / data を区別して、null=未設定 を取得失敗と
  // 混同しないようにする。Codex review (P3) の指摘で導入。
  type RichMenuState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; id: string | null; name: string | null; isDefault: boolean }
  const [richMenu, setRichMenu] = useState<RichMenuState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setRichMenu({ kind: 'loading' })
      return
    }
    let cancelled = false
    setRichMenu({ kind: 'loading' })
    api.friends.richMenu(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setRichMenu({ kind: 'data', ...res.data })
      } else {
        setRichMenu({ kind: 'error' })
      }
    }).catch(() => {
      if (cancelled) return
      setRichMenu({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId, richMenuRetry])

  /*
   * IDEA-02: 次回予約と次の確定した自動配信。
   * サーバーは確定した予定だけを返す（動的条件の将来配信は含まない）。
   * 「予定なし」(null) と「未取得」(error / *_Error) を分けて出し、
   * 失敗はこのパネル内の再試行でやり直せるようにする。
   */
  type UpcomingState =
    | { kind: 'loading' }
    | { kind: 'error' }
    | { kind: 'data'; data: FriendUpcoming }
  const [upcoming, setUpcoming] = useState<UpcomingState>({ kind: 'loading' })

  useEffect(() => {
    if (!friendId) {
      setUpcoming({ kind: 'loading' })
      return
    }
    let cancelled = false
    setUpcoming({ kind: 'loading' })
    api.friends.upcoming(friendId).then((res) => {
      if (cancelled) return
      if (res.success && res.data) {
        setUpcoming({ kind: 'data', data: res.data })
      } else {
        setUpcoming({ kind: 'error' })
      }
    }).catch(() => {
      if (!cancelled) setUpcoming({ kind: 'error' })
    })
    return () => { cancelled = true }
  }, [friendId, upcomingRetry])

  /*
   * A-2: 押した瞬間に画面を変えて裏で保存（lib/undoable の runOptimistic）。
   * 成功は白い知らせに「元に戻す」、失敗は戻して「もう一度」。
   * 知らせは notifyToast の白い板（黒にしない。オーナー決定 2026-10-04）。
   */
  const canEditChat = Boolean(chatId)
  const statusButtonRef = useRef<HTMLDivElement | null>(null)
  const tagSearchRef = useRef<HTMLInputElement | null>(null)
  const memoAreaRef = useRef<HTMLTextAreaElement | null>(null)

  /*
   * B-26（A-2 採用）：押した瞬間に変えて裏で保存し、白い知らせに［元に戻す］（5秒・乗せている間は止まる）。
   * 失敗したら画面を戻し、理由と［もう一度試す］。
   * 同時に直したとき：対応状況・担当は版（revision）を送らず、その項目だけを変える（ほかの人が直した
   * メモや担当を巻き戻さない）。タグは1つずつ付ける・外す（足し引き）。メモは最後に直した方を残す（下の queueMemoSave）。
   * 親（会話の頭）で変わったら、ここの持ち直しを捨てて親の値に合わせる。
   */
  useEffect(() => { setLocalStatus(undefined) }, [chatStatus?.status])
  useEffect(() => { setLocalOperatorId(undefined) }, [operatorId])
  useEffect(() => { setLocalNotes(undefined) }, [chatStatus?.notes])
  useEffect(() => { setLocalTags(undefined) }, [friend?.tags])
  const revisionRef = useRef<number | undefined>(revision)
  useEffect(() => { revisionRef.current = revision }, [chatId, revision])
  const noteRevision = (res: unknown) => {
    const next = (res as { data?: { revision?: unknown } } | undefined)?.data?.revision
    if (typeof next === 'number') revisionRef.current = next
  }
  const changed = useCallback((res: unknown) => {
    noteRevision(res)
    onChatChanged?.()
  }, [onChatChanged])

  const saveChatStatus = useCallback((next: NonNullable<ChatStatusInfo['status']>) => {
    if (!chatId) return
    const previous = effectiveStatus ?? null
    if (previous === next) return
    setLocalStatus(next)
    runOptimisticWithUndo({
      request: () => api.chats.update(chatId, { status: next }),
      revert: () => setLocalStatus(previous),
      reapply: () => setLocalStatus(next),
      successMessage: isV8 ? `対応状況を「${STATUS_WORD[next]}」にしました` : '',
      failureMessage: '対応状況を変えられませんでした。',
      retry: () => saveChatStatus(next),
      undoRequest: previous ? async () => {
        const res = await api.chats.update(chatId, { status: previous })
        changed(res)
        return res
      } : undefined,
      onSuccess: changed,
    })
  }, [chatId, effectiveStatus, changed, isV8])

  const saveAssignee = useCallback((nextOperatorId: string | null) => {
    if (!chatId) return
    const previous = effectiveOperatorId ?? null
    if (previous === nextOperatorId) return
    setLocalOperatorId(nextOperatorId)
    const nameOf = (id: string | null) => (id ? operators?.find((op) => op.id === id)?.name ?? '担当' : '未割り当て')
    runOptimisticWithUndo({
      request: () => api.chats.update(chatId, { operatorId: nextOperatorId }),
      revert: () => setLocalOperatorId(previous),
      reapply: () => setLocalOperatorId(nextOperatorId),
      successMessage: !isV8 ? '' : nextOperatorId ? `担当を${nameOf(nextOperatorId)}にしました` : '担当を外しました',
      failureMessage: '担当を変えられませんでした。',
      retry: () => saveAssignee(nextOperatorId),
      undoRequest: async () => {
        const res = await api.chats.update(chatId, { operatorId: previous })
        changed(res)
        return res
      },
      onSuccess: changed,
    })
  }, [chatId, effectiveOperatorId, operators, changed, isV8])

  /*
   * メモは書くのをやめて1秒で自動保存。最後に直した日時（版）で比べる：
   * 書き始めたあとにほかの人がメモを直していたら（版がずれて 409）、最新を読み直し、
   * - ほかの人が変えたのがメモ以外（対応状況など）なら、そのまま今の版で保存し直す
   * - メモも直されていたら、あとから直したこちらを残し、知らせの［元に戻す］で相手のメモに戻せる
   */
  const memoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const memoToastRef = useRef<{ dismiss: () => void } | null>(null)
  const [memoSaving, setMemoSaving] = useState(false)
  useEffect(() => {
    if (memoTimerRef.current) clearTimeout(memoTimerRef.current)
  }, [friendId, chatId, chatStatus?.notes])
  const queueMemoSave = useCallback((text: string) => {
    if (!chatId) return
    if (memoTimerRef.current) clearTimeout(memoTimerRef.current)
    memoTimerRef.current = setTimeout(() => {
      const previous = effectiveNotes ?? null
      const next = text.trim() || null
      if (next === previous) return
      setMemoSaving(true)
      setLocalNotes(next)
      memoToastRef.current?.dismiss()
      let overwritten: string | null | undefined
      const save = async () => {
        try {
          return await api.chats.update(chatId, { notes: next ?? '', ...(revisionRef.current !== undefined ? { revision: revisionRef.current } : {}) })
        } catch (error) {
          if (!(error instanceof ApiError) || error.code !== 'REVISION_CONFLICT') throw error
          const latest = await api.chats.get(chatId, { limit: 1 })
          if (!latest.success) throw error
          revisionRef.current = latest.data.revision
          const theirs = latest.data.notes ?? null
          if (theirs !== previous) overwritten = theirs
          return api.chats.update(chatId, { notes: next ?? '', revision: latest.data.revision })
        }
      }
      memoToastRef.current = runOptimisticWithUndo({
        request: save,
        revert: () => setLocalNotes(previous),
        reapply: () => setLocalNotes(next),
        successMessage: '',
        failureMessage: 'メモを保存できませんでした。',
        retry: () => queueMemoSave(text),
        undoRequest: async () => {
          const back = overwritten !== undefined ? overwritten : previous
          setLocalNotes(back)
          // 書く欄（手で書く欄なので値を持たない）にも戻した文を入れる。
          if (memoAreaRef.current) memoAreaRef.current.value = back ?? ''
          const res = await api.chats.update(chatId, { notes: back ?? '' })
          changed(res)
          return res
        },
        onSuccess: (res) => {
          setMemoSaving(false)
          changed(res)
        },
        onFailure: () => setMemoSaving(false),
        successMessageOf: () => !isV8 ? '' : overwritten !== undefined
          ? 'ほかの人が先にメモを直していました。あとから直したこの内容で保存しました'
          : 'メモを保存しました',
      })
    }, 1000)
  }, [chatId, effectiveNotes, changed, isV8])
  useEffect(() => () => {
    if (memoTimerRef.current) clearTimeout(memoTimerRef.current)
  }, [])

  // タグの候補と新規作成。↑↓Enter で選び、×で外す。1つずつ付ける・外す（足し引き）ので、
  // ほかの人が同じ時に付けた別のタグを消さない。
  const [tagQuery, setTagQuery] = useState('')
  const [tagOptions, setTagOptions] = useState<Tag[]>([])
  const [tagActive, setTagActive] = useState(0)
  const [tagSaving, setTagSaving] = useState(false)
  useEffect(() => {
    if (!friendId) return
    let cancelled = false
    api.tags.list().then((res) => {
      if (cancelled) return
      if (res.success && Array.isArray(res.data)) setTagOptions(res.data as Tag[])
    }).catch(() => {})
    return () => { cancelled = true }
  }, [friendId])
  const addTagById = useCallback((tagId: string, known?: { name: string; color: string }) => {
    if (!friendId || !tagId) return
    const target = known ?? tagOptions.find((t) => t.id === tagId)
    // 候補に無い ID は付けない（色は店が付けた値だけを使い、直書きしない）。
    if (!target) return
    const tag = { id: tagId, name: target.name, color: target.color }
    if ((effectiveTags ?? []).some((t) => t.id === tagId)) return
    setTagSaving(true)
    setLocalTags((now) => [...(now ?? effectiveTags ?? []), tag])
    const drop = () => setLocalTags((now) => (now ?? effectiveTags ?? []).filter((t) => t.id !== tagId))
    runOptimisticWithUndo({
      request: () => api.friends.addTag(friendId, tagId),
      revert: drop,
      reapply: () => setLocalTags((now) => [...(now ?? effectiveTags ?? []).filter((t) => t.id !== tagId), tag]),
      successMessage: isV8 ? `タグ「${tag.name}」を付けました` : '',
      failureMessage: `タグ「${tag.name}」を付けられませんでした。`,
      retry: () => addTagById(tagId, target),
      undoRequest: () => api.friends.removeTag(friendId, tagId),
      onSuccess: () => {
        setTagSaving(false)
        setTagQuery('')
      },
      onFailure: () => setTagSaving(false),
    })
  }, [friendId, effectiveTags, tagOptions, isV8])
  const removeTagById = useCallback((tagId: string) => {
    if (!friendId) return
    const tag = (effectiveTags ?? []).find((t) => t.id === tagId)
    if (!tag) return
    const putBack = () => setLocalTags((now) => [...(now ?? effectiveTags ?? []).filter((t) => t.id !== tagId), tag])
    setLocalTags((now) => (now ?? effectiveTags ?? []).filter((t) => t.id !== tagId))
    runOptimisticWithUndo({
      request: () => api.friends.removeTag(friendId, tagId),
      revert: putBack,
      reapply: () => setLocalTags((now) => (now ?? effectiveTags ?? []).filter((t) => t.id !== tagId)),
      successMessage: isV8 ? `タグ「${tag.name}」を外しました` : '',
      failureMessage: `タグ「${tag.name}」を外せませんでした。`,
      retry: () => removeTagById(tagId),
      undoRequest: () => api.friends.addTag(friendId, tagId),
    })
  }, [friendId, effectiveTags, isV8])

  // 購入（EC の直近3件と合計）。今ある口だけを使い、結びつきが無い人は「—」で出す。
  type PurchaseState =
    | { kind: 'loading' }
    | { kind: 'empty'; reason: string }
    | { kind: 'data'; total: number; count: number; items: Array<{ id: string; title: string; amount: number; at: string }> }
  const [purchase, setPurchase] = useState<PurchaseState>({ kind: 'loading' })
  const [purchaseRetry, setPurchaseRetry] = useState(0)
  useEffect(() => {
    if (!friendId) {
      setPurchase({ kind: 'empty', reason: 'no-friend' })
      return
    }
    let cancelled = false
    setPurchase({ kind: 'loading' })
    // 友だち名で EC の注文を3件まで探す（friend_id の絞り口が無いため）。
    // 名前が取れない・見つからないときは合計を出さず「—」にする（0にしない）。
    const name = friend?.displayName ?? friend?.realName ?? ''
    if (!name) {
      setPurchase({ kind: 'empty', reason: 'no-name' })
      return
    }
    const accountId = ''
    void purchaseRetry
    api.ecCommerce.orders({ lineAccountId: accountId, query: name, limit: 3 }).then((res: { success: boolean; data?: unknown }) => {
      if (cancelled) return
      if (!res.success || !res.data) {
        setPurchase({ kind: 'empty', reason: 'unavailable' })
        return
      }
      const list = (res.data as unknown as { orders?: Array<{ id: string; orderNumber?: string; total?: number; createdAt?: string }> }).orders ?? []
      if (list.length === 0) {
        setPurchase({ kind: 'empty', reason: 'none' })
        return
      }
      const items = list.slice(0, 3).map((o) => ({
        id: o.id,
        title: o.orderNumber ?? o.id,
        amount: typeof o.total === 'number' ? o.total : 0,
        at: o.createdAt ?? '',
      }))
      const total = items.reduce((sum, item) => sum + item.amount, 0)
      setPurchase({ kind: 'data', total, count: list.length, items })
    }).catch(() => {
      if (!cancelled) setPurchase({ kind: 'empty', reason: 'unavailable' })
    })
    return () => { cancelled = true }
  }, [friendId, friend?.displayName, friend?.realName, purchaseRetry])

  /*
   * キーボード T・M・S（書く欄に字があるときは効かない）。
   * T=タグを探す欄へ、M=メモ欄へ、S=対応状況のボタンへ。
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const key = event.key.toLowerCase()
      if (key === 't') {
        event.preventDefault()
        ;(tagSearchRef.current ?? document.getElementById('inbox-panel-tag'))?.focus()
      } else if (key === 'm') {
        event.preventDefault()
        memoAreaRef.current?.focus()
      } else if (key === 's') {
        event.preventDefault()
        statusButtonRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /*
   * 友だち情報（metadata）のキーを、画面に出す項目名へ写す対応表。
   * friend_fields.fieldKey → name と、フォームの項目 name → label の
   * 両方を持つ。どちらにも無い内部キー（`_` 始まり）は業務表示から外す。
   */
  const metadataLabel = (key: string): string | null => {
    if (key.startsWith('_')) return null
    const fromField = friendFields.kind === 'data'
      ? friendFields.items.find((field) => field.fieldKey === key)?.name
      : undefined
    if (fromField) return fromField
    const fromForm = (friend?.formSubmissions ?? [])
      .flatMap((submission) => submission.fields)
      .find((field) => field.name === key)?.label
    return fromForm ?? key
  }

  if (!friendId) return null

  const settingsButton = (
    <Button variant="secondary" className={isV8 ? 'shrink-0 items-center justify-center whitespace-nowrap' : 'mr-14 v7:h-8 shrink-0 items-center justify-center whitespace-nowrap px-3 text-micro text-ink-faint'} size={isV8 ? 'compact' : undefined} type="button" ref={settingsButtonRef} onClick={() => {
        if (!showSettings) updateSettingsPanelPos()
        setShowSettings(!showSettings)
      }} aria-expanded={showSettings}>
      表示項目
    </Button>
  )

  /*
   * 顧客情報の節（基本情報・マイル・次の対応・タグ・★つき・リッチメニュー・友だち情報・フォーム回答）。
   * v7 は今までどおり右の欄に線で並べ、★V8 は角丸の枠（顧客情報）の中に並べる。中身は同じ。
   */
  const renderDetailSections = (friend: FriendDetail) => (
    <>
            {/* 前払いのみの印（友だち詳細と同じ置き場所・顔の下）。前払いの人だけ出る。 */}
            {accountId && friendId ? (
              /* ★V8：前払いでない人は中身が空。空の帯（上下12＋線）を残さない（オーナー指摘）。 */
              <div className="border-hairline border-b px-5 py-3 v8:empty:hidden">
                <PrepayBadgeV8 accountId={accountId} friendId={friendId} canEdit={canClearPrepay} />
              </div>
            ) : null}

            {/*
              名前（設計 `友だち詳細` の「名前」）。
              LINEの表示名と、こちらで付けた本名は別物。取り違えると
              別人に送ってしまうので、両方を並べて出す。
            */}
            <div style={sectionStyle('names')} className={`${sectionVisibility('names')} space-y-2 px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">基本情報</h4>
              <div className="flex justify-between items-center gap-2">
                <span className="text-micro text-ink-faint shrink-0">本名</span>
                <ExpandableText value={friend.realName} className="text-xs text-ink-secondary v8:text-label" />
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-micro text-ink-faint shrink-0">システム表示名</span>
                <ExpandableText value={friend.systemDisplayName} className="text-xs text-ink-secondary v8:text-label" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-micro text-ink-faint">登録日</span>
                <span className="truncate text-xs text-ink-secondary v8:text-label">{formatDate(friend.createdAt)}</span>
              </div>
            </div>

            {/* Harness Mileage — canonical user identity across LINE accounts */}
            <div style={sectionStyle('mileage')} className={`${sectionVisibility('mileage')} px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">マイル</h4>
              {mileage.kind === 'loading' ? (
                <DelayedSkeleton loading skeleton={<div className="h-24 animate-pulse rounded-card bg-shell" />} />
              ) : mileage.kind === 'error' ? (
                /* INBOX-08: 失敗と未登録を分け、その場で再試行できる。 */
                <div className="space-y-1.5">
                  <p className="text-micro text-danger">マイルを読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setMileageRetry((key) => key + 1)}
                    className="text-action text-micro font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : (
                <div className="border-hairline bg-canvas rounded-control border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-ink-faint text-nano font-semibold">{mileage.summary.programName}</p>
                      <p className="text-ink mt-0.5 text-xl font-bold tabular-nums">
                        {formatNumber(mileage.summary.available)}
                        <span className="text-ink-faint ml-1 text-micro font-semibold">mile</span>
                      </p>
                      <p className="text-ink-faint text-nano">利用可能</p>
                    </div>
                    {mileage.summary.pending > 0 && (
                      <span className="bg-canvas-sunken text-ink-secondary rounded-pill px-2 py-1 text-nano font-medium">
                        確定待ち {formatNumber(mileage.summary.pending)}
                      </span>
                    )}
                  </div>

                  {mileage.history.length > 0 ? (
                    <div className="border-hairline mt-3 space-y-1.5 border-t pt-2.5">
                      {mileage.history.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-nano">
                          <span className="text-ink-faint min-w-0 truncate">{item.reason}</span>
                          <span className={`shrink-0 font-semibold tabular-nums ${item.amount > 0 ? 'text-success' : 'text-ink-secondary'}`}>
                            {item.amount > 0 ? '+' : ''}{formatNumber(item.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ink-faint border-hairline mt-3 border-t pt-2.5 text-nano">
                      まだマイル履歴はありません
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Status / Operator */}
            {/*
              対応（設計 `友だち詳細` の「対応」）。
              値が無くても節ごと出す。以前は空だと見出しごと消えていて、
              「この画面には対応の情報が無い」ように見えていた。
              設計は「未設定」「未割り当て」と書いて枠を残している。
            */}
            <div style={sectionStyle('support')} className={`${sectionVisibility('support')} space-y-3 px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">次の対応</h4>
              {/* ①対応状況（3つのボタン・1タップ）。押した瞬間に変えて裏で保存。 */}
              <div>
                <span className="text-micro text-ink-faint">対応状況（Sキー）</span>
                {canEditChat && isV8 ? (
                  /* ★V8 B-26：共通の選ぶ欄（会話の頭と同じ色の点）。選んだ瞬間に変えて裏で保存・知らせに元に戻す。保留も選べる。 */
                  <div ref={statusButtonRef} className={v8.editField}>
                    <Select
                      size="full"
                      aria-label="対応状況を変える"
                      icon={<span className={chatV8.ctlDot} data-status={effectiveStatus ?? 'unread'} />}
                      options={STATUS_OPTIONS}
                      value={effectiveStatus ?? 'unread'}
                      onChange={(next) => saveChatStatus(next as NonNullable<ChatStatusInfo['status']>)}
                    />
                  </div>
                ) : canEditChat ? (
                  <div ref={statusButtonRef} role="group" aria-label="対応状況を変える" className="mt-1.5 grid grid-cols-3 gap-1.5">
                    {([
                      { key: 'unread', label: '未対応' },
                      { key: 'in_progress', label: '対応中' },
                      { key: 'resolved', label: '対応済み' },
                    ] as const).map((item) => {
                      const active = effectiveStatus === item.key
                      return (
                        <Button variant="secondary"
                          key={item.key}
                          type="button"
                          aria-pressed={active}
                          onClick={() => saveChatStatus(item.key)}
                          style={{ minHeight: 0, height: 'auto', padding: 8, fontSize: 12, lineHeight: '16px', fontWeight: 600, borderColor: active ? 'var(--color-accent-deep)' : 'var(--color-hairline)', background: active ? 'var(--color-accent-soft)' : 'var(--color-canvas)', color: active ? 'var(--color-accent-deep)' : 'var(--color-ink-secondary)' }}
                        >
                          {item.label}
                        </Button>
                      )
                    })}
                  </div>
                ) : chatStatus?.status && statusLabels[chatStatus.status] ? (
                  <div className="mt-1.5">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-pill text-xs font-medium ${statusLabels[chatStatus.status].className}`}>
                      {statusLabels[chatStatus.status].label}
                    </span>
                  </div>
                ) : (
                  <p className="text-xs text-ink-faint mt-1.5">未設定</p>
                )}
              </div>
              {/* ②担当（選ぶ）。 */}
              <div>
                <label htmlFor="inbox-panel-assignee" className="text-micro text-ink-faint">担当者</label>
                {canEditChat && operators && isV8 ? (
                  /* ★V8 B-26：共通の選ぶ欄（選んだ行は ✓ だけ）。 */
                  <div className={v8.editField}>
                    <Select
                      id="inbox-panel-assignee"
                      size="full"
                      aria-label="担当者を変える"
                      value={effectiveOperatorId ?? ''}
                      onChange={(value) => saveAssignee(value || null)}
                      options={[{ value: '', label: '未割り当て' }, ...operators.map((op) => ({ value: op.id, label: op.name }))]}
                    />
                  </div>
                ) : canEditChat && operators ? (
                  <select
                    id="inbox-panel-assignee"
                    value={effectiveOperatorId ?? ''}
                    onChange={(event) => saveAssignee(event.target.value || null)}
                    className="border-hairline rounded-control text-ink mt-1.5 w-full border bg-canvas px-2 py-2 text-xs outline-none"
                  >
                    <option value="">未割り当て</option>
                    {operators.map((op) => (
                      <option key={op.id} value={op.id}>{op.name}</option>
                    ))}
                  </select>
                ) : (
                  <p className="text-xs text-ink-secondary mt-1.5">{operatorName || <span className="text-ink-faint">未割り当て</span>}</p>
                )}
              </div>
              {/* ④メモ（書くのをやめて1秒で自動保存）。 */}
              <div>
                <label htmlFor="inbox-panel-memo" className="text-micro text-ink-faint">メモ（Mキー）{memoSaving ? '・保存中…' : ''}</label>
                {canEditChat && isV8 ? (
                  /* ★V8 B-26：共通の複数行の入力欄。書くのをやめて1秒で保存し、知らせに元に戻す。 */
                  <div className={v8.editField}>
                    <TextArea
                      id="inbox-panel-memo"
                      ref={memoAreaRef}
                      key={chatId ?? ''}
                      defaultValue={effectiveNotes ?? ''}
                      onChange={(event) => queueMemoSave(event.target.value)}
                      placeholder="この人へのメモを書く"
                    />
                  </div>
                ) : canEditChat ? (
                  <textarea
                    id="inbox-panel-memo"
                    ref={memoAreaRef}
                    defaultValue={effectiveNotes ?? ''}
                    onChange={(event) => queueMemoSave(event.target.value)}
                    rows={3}
                    placeholder="この人へのメモを書く"
                    className="border-hairline rounded-control text-ink mt-1.5 w-full resize-y border bg-canvas px-2 py-2 text-xs outline-none"
                  />
                ) : (
                  <p className="text-xs text-ink-secondary whitespace-pre-wrap break-words mt-1.5">
                    {effectiveNotes || <span className="text-ink-faint">まだありません</span>}
                  </p>
                )}
              </div>
              {/*
                IDEA-02: 次回予約と次の確定した自動配信。
                「読み込めませんでした」(未取得) と「予定なし」は別の状態。
                値がある行は詳細画面へのリンクにする。
                色と文字サイズは生のTailwindではなくトークンで書く
                （raw-colors / design-debt の基準を増やさない）。
              */}
              <div className="space-y-1.5 border-t border-hairline pt-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-faint text-micro shrink-0">次回予約</span>
                  {upcoming.kind === 'loading' ? (
                    <span className="text-ink-faint text-caption">読み込み中…</span>
                  ) : upcoming.kind === 'error' || upcoming.data.nextBookingError ? (
                    <span className="text-danger text-micro">読み込めませんでした</span>
                  ) : upcoming.data.nextBooking ? (
                    <a
                      href={upcomingBookingHref(upcoming.data.nextBooking, friend.id)}
                      title={`${upcoming.data.nextBooking.title} ${formatDate(upcoming.data.nextBooking.startsAt)}`}
                      className="text-action text-caption min-w-0 truncate hover:underline"
                    >
                      {formatDate(upcoming.data.nextBooking.startsAt)} {upcoming.data.nextBooking.title}
                    </a>
                  ) : (
                    <span className="text-ink-faint text-caption">予定なし</span>
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-ink-faint text-micro shrink-0">次の自動配信</span>
                  {upcoming.kind === 'loading' ? (
                    <span className="text-ink-faint text-caption">読み込み中…</span>
                  ) : upcoming.kind === 'error' || upcoming.data.nextAutoDeliveryError ? (
                    <span className="text-danger text-micro">読み込めませんでした</span>
                  ) : upcoming.data.nextAutoDelivery ? (
                    <a
                      href={upcomingDeliveryHref(upcoming.data.nextAutoDelivery)}
                      title={`${upcoming.data.nextAutoDelivery.name} ${formatDate(upcoming.data.nextAutoDelivery.scheduledAt)}`}
                      className="text-action text-caption min-w-0 truncate hover:underline"
                    >
                      {formatDate(upcoming.data.nextAutoDelivery.scheduledAt)} {upcoming.data.nextAutoDelivery.name}
                    </a>
                  ) : (
                    <span className="text-ink-faint text-caption">予定なし</span>
                  )}
                </div>
                {/* 片方だけの失敗でもここからまとめて取り直せる(INBOX-08 と同じ型)。 */}
                {(upcoming.kind === 'error'
                  || (upcoming.kind === 'data' && (upcoming.data.nextBookingError || upcoming.data.nextAutoDeliveryError))) && (
                  <button
                    type="button"
                    onClick={() => setUpcomingRetry((key) => key + 1)}
                    className="text-action text-micro font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                )}
              </div>
            </div>

            {/* ③タグ（×で外す・＋で探して付ける・↑↓Enter・新しいタグも作れる）。 */}
            <div style={sectionStyle('tags')} className={`${sectionVisibility('tags')} px-5 py-4`}>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-ink text-xs font-bold">タグ（Tキー）</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-action text-micro hover:underline">
                  すべて見る
                </a>
              </div>
              <div className="flex flex-wrap gap-1">
                {(effectiveTags ?? []).map((tag) => (
                  <span
                    key={tag.id}
                    className="inline-flex max-w-full items-center gap-1 rounded-mini px-2 py-0.5 text-nano font-medium"
                    style={{
                      backgroundColor: `${tag.color}20`,
                      color: tagTextColor(tag.color),
                    }}
                  >
                    <ExpandableText value={tag.name} className="max-w-full text-inherit" />
                    {friendId ? (
                      <button
                        type="button"
                        aria-label={`${tag.name}を外す`}
                        onClick={() => removeTagById(tag.id)}
                        className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-pill hover:bg-canvas-sunken"
                      >
                        <X aria-hidden="true" size={12} />
                      </button>
                    ) : null}
                  </span>
                ))}
              </div>
              {(effectiveTags ?? []).length === 0 ? (
                <p className="text-micro text-ink-faint italic mt-1.5">タグなし</p>
              ) : null}
              {friendId && isV8 ? (
                /* ★V8 B-26：共通の候補つき入力。選ぶと付け、無ければ「＋ 新しく作る」で作って付ける。 */
                <div className={v8.editField}>
                  <Combobox
                    id="inbox-panel-tag"
                    aria-label="タグを探して付ける"
                    placeholder="タグを探して付ける"
                    value=""
                    options={tagOptions
                      .filter((t) => !(effectiveTags ?? []).some((own) => own.id === t.id))
                      .map((t) => ({ value: t.id, label: t.name }))}
                    onChange={(tagId) => { if (tagId) addTagById(tagId) }}
                    createLabel={(query) => `＋「${query}」を作って付ける`}
                    onCreate={(query) => {
                      const name = query.trim()
                      if (!name) return
                      setTagSaving(true)
                      api.tags.create({ name }).then((res) => {
                        if (res.success && res.data) {
                          const created = res.data as Tag
                          setTagOptions((prev) => [...prev, created])
                          addTagById(created.id, { name: created.name, color: created.color })
                        }
                      }).catch(() => {
                        notifyToast(`タグ「${name}」を作れませんでした。もう一度お試しください。`, { tone: 'error' })
                      }).finally(() => setTagSaving(false))
                    }}
                    loading={tagSaving}
                  />
                </div>
              ) : friendId ? (
                <div className="mt-2">
                  <input
                    ref={tagSearchRef}
                    type="text"
                    value={tagQuery}
                    onChange={(event) => {
                      setTagQuery(event.target.value)
                      setTagActive(0)
                    }}
                    onKeyDown={(event) => {
                      const q = tagQuery.trim().toLowerCase()
                      const attached = new Set((effectiveTags ?? []).map((t) => t.id))
                      const shown = tagOptions.filter((t) => !attached.has(t.id) && (!q || t.name.toLowerCase().includes(q)))
                      if (event.key === 'ArrowDown') {
                        event.preventDefault()
                        setTagActive((v) => Math.min(v + 1, Math.max(0, shown.length - 1)))
                      } else if (event.key === 'ArrowUp') {
                        event.preventDefault()
                        setTagActive((v) => Math.max(v - 1, 0))
                      } else if (event.key === 'Enter') {
                        event.preventDefault()
                        const picked = shown[tagActive]
                        if (picked) {
                          addTagById(picked.id)
                        } else if (tagQuery.trim()) {
                          // 新しいタグも作れる。
                          const name = tagQuery.trim()
                          setTagSaving(true)
                          api.tags.create({ name }).then((res) => {
                            if (res.success && res.data) {
                              const created = res.data as Tag
                              setTagOptions((prev) => [...prev, created])
                              addTagById(created.id)
                            }
                          }).catch(() => {}).finally(() => setTagSaving(false))
                        }
                      }
                    }}
                    placeholder="＋ 探して付ける・作る"
                    aria-label="タグを探して付ける"
                    className="border-hairline rounded-control text-ink w-full border bg-canvas px-2 py-2 text-xs outline-none"
                  />
                  {tagQuery.trim() ? (
                    <div role="listbox" aria-label="タグの候補" className="border-hairline rounded-control mt-1.5 max-h-40 overflow-y-auto border bg-canvas">
                      {(() => {
                        const q = tagQuery.trim().toLowerCase()
                        const attached = new Set((effectiveTags ?? []).map((t) => t.id))
                        const shown = tagOptions.filter((t) => !attached.has(t.id) && (!q || t.name.toLowerCase().includes(q))).slice(0, 8)
                        if (shown.length === 0) {
                          return <p className="text-ink-faint px-2 py-2 text-xs">Enterで「{tagQuery.trim()}」を作る</p>
                        }
                        return shown.map((t, i) => (
                          <button
                            key={t.id}
                            type="button"
                            role="option"
                            aria-selected={i === tagActive}
                            onClick={() => addTagById(t.id)}
                            className={`flex w-full items-center px-2 py-1.5 text-left text-xs ${i === tagActive ? 'bg-accent-soft text-accent-deep' : 'text-ink'}`}
                          >
                            {t.name}
                          </button>
                        ))
                      })()}
                    </div>
                  ) : null}
                  {tagSaving ? <p className="text-ink-faint mt-1 text-micro">保存中…</p> : null}
                </div>
              ) : null}
            </div>

            {/*
              ★つき友だち情報（設計 `友だち詳細`）。
              INBOX-05: 「友だち一覧に表示（★）」が付いた項目だけを出す。
              以前は登録順の先頭3件を出していたため、登録順で重要でない
              情報が並び、4件目以降の★項目は届かなかった。
              0件なら付け方への導線を出す。
            */}
            <div style={sectionStyle('starred')} className={`${sectionVisibility('starred')} p-4`}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-micro font-semibold text-ink-faint">★つき友だち情報</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-action text-micro hover:underline">
                  すべて見る
                </a>
              </div>
              {friendFields.kind === 'loading' ? (
                <DelayedSkeleton loading skeleton={<Skeleton className="block h-10 w-full rounded-control" />} />
              ) : friendFields.kind === 'error' ? (
                <div className="space-y-1.5">
                  <p className="text-micro text-danger">項目を読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setFieldsRetry((key) => key + 1)}
                    className="text-action text-micro font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : (() => {
                const starred = friendFields.items.filter((field) => field.isStarred)
                if (starred.length === 0) {
                  return (
                    <p className="text-micro text-ink-faint">
                      ★を付けた項目はまだありません。友だち詳細の「情報」で項目へ★を付けると、ここへ出ます。
                    </p>
                  )
                }
                return (
                  <dl className="space-y-1.5 text-xs">
                    {starred.map((field) => (
                      <div key={field.id}>
                        <dt className="text-nano text-ink-faint break-words">{field.name}</dt>
                        <dd className="mt-0.5 text-ink-secondary">
                          <ExpandableText value={field.value ?? null} empty="未登録" className="text-xs text-ink-secondary" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              })()}
            </div>

            {/* Rich Menu */}
            <div style={sectionStyle('richMenu')} className={`${sectionVisibility('richMenu')} p-4`}>
              <h4 className="text-micro font-semibold text-ink-faint mb-1.5">リッチメニュー</h4>
              <p className="text-micro text-ink-faint mb-1">現在の設定</p>
              {richMenu.kind === 'loading' ? (
                <p className="text-micro text-ink-faint italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                /* INBOX-08: 失敗と未設定を分け、その場で再試行できる。 */
                <div className="space-y-1.5">
                  <p className="text-micro text-danger">リッチメニューを読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setRichMenuRetry((key) => key + 1)}
                    className="text-action text-micro font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : richMenu.id === null ? (
                <p className="text-micro text-ink-faint italic">未設定</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-ink-secondary">{richMenu.name ?? '(名前なし)'}</span>
                  {richMenu.isDefault && (
                    <span className="px-1.5 py-0 rounded-mini text-nano font-medium bg-shell text-ink-faint">
                      デフォルト
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Metadata custom fields */}
            <div style={sectionStyle('metadata')} className={`${sectionVisibility('metadata')} p-4`}>
              <h4 className="text-micro font-semibold text-ink-faint mb-2">友だち情報</h4>
              {/* 設計は追加日と流入元を必ず出す。どちらも既に持っている値。 */}
              <dl className="mb-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-micro text-ink-faint shrink-0">追加日</dt>
                  <dd className="text-ink-secondary">{formatDate(friend.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-micro text-ink-faint shrink-0">流入元</dt>
                  {/*
                    INBOX-06: 友だち詳細と同じ firstTrackedLinkName を出す。
                    計測できなかった人・経路が消えた人は null → 「不明」。
                    取得自体の失敗は上のエラー節で再試行できる。
                  */}
                  <dd className="min-w-0 text-ink-secondary">
                    {friend.firstTrackedLinkName ? (
                      <ExpandableText value={friend.firstTrackedLinkName} className="text-xs text-ink-secondary" />
                    ) : (
                      <span className="text-ink-faint">不明</span>
                    )}
                  </dd>
                </div>
              </dl>
              {(() => {
                /*
                  ⑤友だち情報の欄（押すとその場で書き換え）。
                  INBOX-07: `_` 始まりの制御用キーは業務表示から外し、
                  項目名は内部キーではなく定義済みの表示名へ写す。
                  InlineEdit（ux-core）で Enter 保存・Esc やめる・失敗で戻す。
                */
                const entries = Object.entries(friend.metadata ?? {})
                  .map(([key, value]) => ({ key, label: metadataLabel(key), value }))
                  .filter((entry): entry is { key: string; label: string; value: unknown } => entry.label !== null)
                if (entries.length === 0) {
                  return <p className="text-micro text-ink-faint italic">まだ登録がありません</p>
                }
                return (
                  <dl className="space-y-2 text-xs">
                    {entries.map((entry) => (
                      <div key={entry.key}>
                        <dt className="text-nano text-ink-faint break-words">{entry.label}</dt>
                        <dd className="text-ink-secondary mt-0.5 break-words">
                          {friendId ? (
                            <InlineEdit
                              value={renderValue(entry.value)}
                              label={entry.label}
                              onSave={async (next) => {
                                const res = await api.friends.updateMetadata(friendId, { [entry.key]: next || null })
                                if (!res.success) throw new Error('failed')
                                setFriend((prev) => prev ? { ...prev, metadata: { ...prev.metadata, [entry.key]: next } } : prev)
                              }}
                            />
                          ) : (
                            <span className="whitespace-pre-wrap">{renderValue(entry.value)}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              })()}
            </div>

            {/* ⑥購入（EC の直近3件と合計）。数は実データ。無いときは「—」。★V8 は顧客情報の枠の最後に置き、見出しをほかの節とそろえる。 */}
            <div className="p-4" style={isV8 ? { order: DETAIL_SECTIONS.length } : undefined}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className={isV8 ? 'text-ink text-xs font-bold' : 'text-micro font-semibold text-ink-faint'}>購入</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-action text-micro hover:underline">
                  すべて見る
                </a>
              </div>
              {purchase.kind === 'loading' ? (
                <p className="text-micro text-ink-faint italic">読み込み中…</p>
              ) : purchase.kind === 'data' ? (
                <div className="space-y-1.5">
                  <p className="text-ink text-sm font-bold tabular-nums">
                    合計 {formatNumber(purchase.total)}<span className="text-ink-faint ml-1 text-micro font-semibold">円</span>
                  </p>
                  <ul className="space-y-1.5">
                    {purchase.items.map((item) => (
                      <li key={item.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="text-ink-secondary min-w-0 truncate">{item.title}</span>
                        <span className="text-ink shrink-0 font-semibold tabular-nums">{formatNumber(item.amount)}円</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : purchase.reason === 'none' ? (
                <p className="text-micro text-ink-faint italic">購入はまだありません</p>
              ) : purchase.reason === 'unavailable' ? (
                <div className="space-y-1.5">
                  <p className="text-micro text-danger">購入を読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setPurchaseRetry((key) => key + 1)}
                    className="text-action text-micro font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : (
                <p className="text-micro text-ink-faint italic">—</p>
              )}
            </div>

            {/* Form answers — save_to_metadata の設定に関係なく回答履歴を表示 */}
            <div style={sectionStyle('forms')} className={`${sectionVisibility('forms')} p-4`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-micro font-semibold text-ink-faint">フォーム回答</h4>
                {/*
                  INBOX-17: 取得するのは最新10件まで。続きがあるか、全部で
                  何件あるかを黙らせない。10件を超える分は友だち詳細へ誘導する。
                */}
                {typeof friend.formSubmissionTotal === 'number' && friend.formSubmissionTotal > 0 && (
                  <span className="text-nano text-ink-faint">
                    {formatNumber(friend.formSubmissionTotal)}件中 1〜{formatNumber(friend.formSubmissions.length)}件を表示
                  </span>
                )}
              </div>
              {!friend.formSubmissions || friend.formSubmissions.length === 0 ? (
                <p className="text-micro text-ink-faint italic">回答はまだありません</p>
              ) : (
                <div>
                <div className="space-y-3">
                  {friend.formSubmissions.map((submission) => {
                    const labels = new Map(submission.fields.map((field) => [field.name, field.label]))
                    const answers = Object.entries(submission.data).filter(([key]) => !key.startsWith('_'))
                    return (
                      <div key={submission.id} className="rounded-control border border-divider-soft bg-surface-pearl p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-ink-secondary break-words">{submission.formName}</p>
                          <time className="shrink-0 text-nano text-ink-faint">
                            {formatDate(submission.createdAt)}
                          </time>
                        </div>
                        <dl className="mt-2 space-y-2">
                          {answers.map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-nano text-ink-faint">{labels.get(key) ?? key}</dt>
                              <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-ink-secondary">
                                {renderValue(value)}
                              </dd>
                            </div>
                          ))}
                        </dl>
                      </div>
                    )
                  })}
                </div>
                {/*
                  10件を超える回答はこのパネルでは追い読みしない。
                  友だち詳細の回答一覧へ進む口を出す。
                */}
                {typeof friend.formSubmissionTotal === 'number'
                  && friend.formSubmissions.length < friend.formSubmissionTotal && (
                  <a
                    href={`/friends/detail?id=${friend.id}`}
                    className="text-action mt-3 inline-flex text-micro font-semibold hover:underline"
                  >
                    残り{friend.formSubmissionTotal - friend.formSubmissions.length}件は友だち詳細で見る
                  </a>
                )}
                </div>
              )}
            </div>

    </>
  )

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-canvas">
      {/*
        ★V8（M0393「その人の要点」）：右の列に「顧客情報 ［表示項目］ ×」の頭の段は無い。
        顔・名前から始まり、「表示項目」は「友だち詳細」の横に並べる（オーナー指摘）。
        v7 は今までどおり頭の段に置く。
      */}
      <div className={isV8 ? 'contents' : 'relative flex min-h-[66px] items-center border-b border-hairline bg-canvas px-4'}>
        {isV8 ? null : (
        <div className="flex w-full items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-ink">顧客情報</h3>
          </div>
          {settingsButton}
        </div>
        )}
        {showSettings && typeof document !== 'undefined' ? createPortal(
          <div
            data-inbox-v6="detail-sections-panel"
            role="dialog"
            aria-label="右パネルの表示項目"
            style={settingsPanelPos ?? { top: 16, left: 16, right: 16, maxHeight: 'calc(100dvh - 32px)' }}
            className="bg-canvas border-hairline rounded-panel shadow-float fixed z-[80] flex flex-col overflow-hidden border"
          >
            <div className="flex shrink-0 items-start justify-between gap-2 px-4 pt-4">
              <div className="min-w-0">
                <p className="text-ink text-xs font-medium">右パネルの表示項目</p>
                <p className="text-ink-faint text-micro mt-0.5">ドラッグで順番変更・スイッチで表示切替</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="表示項目を閉じる"
                className="text-ink-faint hover:bg-canvas-sunken rounded-control -mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            {/* 項目の並びはここだけがスクロールする。見出しと操作は常に画面内。 */}
            <div className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto px-4">
              {orderedSettingGroups.map((group, index) => {
                const visible = group.sections.every((key) => !hiddenSections.includes(key))
                return (
                  <div
                    key={group.key}
                    draggable
                    onDragStart={(event) => {
                      setDraggedGroupKey(group.key)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                    onDragEnd={() => setDraggedGroupKey(null)}
                    onDragOver={(event) => {
                      event.preventDefault()
                      event.dataTransfer.dropEffect = 'move'
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (draggedGroupKey) moveGroupBefore(draggedGroupKey, group.key)
                      setDraggedGroupKey(null)
                    }}
                    className="border-hairline rounded-control flex items-center gap-2 border px-2 py-1.5"
                  >
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveGroup(group.key, -1)}
                        aria-label={`${group.label}を上へ`}
                        className="text-ink-faint hover:text-ink rounded-mini disabled:opacity-30"
                      >
                        <GripVertical aria-hidden="true" size={15} />
                      </button>
                    </span>
                    <span className="text-ink min-w-0 flex-1 truncate text-xs">{group.label}</span>
                    {/* 共通の Checkbox（本物の input）。見た目だけの button にすると読み上げで「入／切」が伝わらない。 */}
                    <Checkbox
                      checked={visible}
                      aria-label={`${group.label}を表示`}
                      onCheckedChange={() => setHiddenSections((current) => (
                        visible
                          ? [...new Set([...current, ...group.sections])]
                          : current.filter((item) => !group.sections.includes(item))
                      ))}
                      className="shrink-0"
                    />
                  </div>
                )
              })}
            </div>
            {/*
              **全部隠すと右パネルが空になり、何を隠したのかも画面から読めない。**
              戻す道をここに置く。スクロール領域の外に固定して、低い画面でも
              「初期状態に戻す」「閉じる」へ届くようにする(#982 LAY-03)。
            */}
            <div className="mt-3 flex shrink-0 items-center justify-between gap-2 border-t border-hairline px-4 py-3">
              {/* 設計 `Xi4x9` の2つは h36。共通ボタンと同値なので部品を使う。 */}
              <Button
                onClick={() => {
                  setSectionOrder(DEFAULT_SECTION_ORDER)
                  setHiddenSections([])
                }}
              >
                初期状態に戻す
              </Button>
              <Button variant="primary" onClick={() => setShowSettings(false)}>
                閉じる
              </Button>
            </div>
          </div>
        , document.body) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <DelayedSkeleton
            loading
            skeleton={
              <div className="p-4 space-y-3 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-pill bg-shell-gray" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-shell-gray rounded-mini w-32" />
                    <div className="h-2 bg-shell rounded-mini w-20" />
                  </div>
                </div>
              </div>
            }
          />
        ) : error ? (
          /* INBOX-08: 失敗は文字だけにせず、その場で再試行できるようにする。 */
          <div className="space-y-2 p-4">
            <p className="text-xs text-danger">{error}</p>
            <Button variant="secondary" className="text-ink-secondary items-center px-3 py-1.5 text-xs h-auto whitespace-normal" type="button" onClick={() => setFriendRetry((key) => key + 1)}>
              再試行する
            </Button>
          </div>
        ) : friend ? (
          <div className={isV8 ? v8.body : 'flex flex-col divide-y divide-hairline'}>
            {/* Profile Header — V4は相手・対応・担当をひとまとまりにする。 */}
            {isV8 ? (
              <>
                {/*
                  ★V8（M0393 XqSvX「その人の要点」）：大きい丸の顔 → 名前 → 友だち追加日 →
                  タグ・シナリオ・購入・マイル → 顧客情報の節。顔と要点はいつも上（並べ替えの外）。
                  対応・担当の札は会話の頭にあるので、ここには重ねて出さない。
                */}
                <div style={{ order: -3 }} className={`${sectionVisibility('profile')} ${v8.person}`}>
                  <Avatar name={friend.displayName} src={friend.pictureUrl} size={52} />
                  <ExpandableText value={friend.displayName} empty="名前なし" className={v8.personName} />
                  <p className={v8.personSub}>{formatAddedDate(friend.createdAt)}</p>
                  {!friend.isFollowing ? <span className={v8.blocked}>ブロック済</span> : null}
                  <div className={v8.personActions}>
                    <Button variant="secondary" size="compact" href={`/friends/detail?id=${friend.id}`}>
                      友だち詳細
                    </Button>
                    {settingsButton}
                  </div>
                </div>
                <dl style={{ order: -2 }} className={v8.summary} data-inbox-v8="customer-summary">
                  <div className={v8.summaryRow}>
                    <dt>タグ</dt>
                    <dd title={(effectiveTags ?? []).map((t) => t.name).join('・')}>
                      {(effectiveTags ?? []).length > 0 ? (effectiveTags ?? []).map((t) => t.name).join('・') : <span className={v8.empty}>なし</span>}
                    </dd>
                  </div>
                  <div className={v8.summaryRow}>
                    <dt>シナリオ</dt>
                    <dd>
                      {upcoming.kind === 'data' && upcoming.data.nextAutoDelivery?.kind === 'scenario'
                        ? upcoming.data.nextAutoDelivery.name
                        : upcoming.kind === 'loading' ? <span className={v8.empty}>…</span> : <span className={v8.empty}>なし</span>}
                    </dd>
                  </div>
                  <div className={v8.summaryRow}>
                    <dt>購入</dt>
                    <dd>
                      {purchase.kind === 'data'
                        ? `${purchase.count}件・${formatNumber(purchase.total)}円`
                        : purchase.kind === 'loading' ? <span className={v8.empty}>…</span>
                        : purchase.reason === 'none' ? <span className={v8.empty}>0件</span> : <span className={v8.empty}>—</span>}
                    </dd>
                  </div>
                  <div className={v8.summaryRow}>
                    <dt>マイル</dt>
                    <dd>
                      {mileage.kind === 'data'
                        ? `${formatNumber(mileage.summary.available)} mile`
                        : mileage.kind === 'loading' ? <span className={v8.empty}>…</span> : <span className={v8.empty}>—</span>}
                    </dd>
                  </div>
                </dl>
                {/*
                  ★V8（M0393 XqSvX「顧客情報」）：節は角丸の枠の中に、見出し＋中身を線で区切って並べる。
                  上の要点（顔・名前・タグ・シナリオ・購入・マイル）とは線で切らず、枠で分ける。
                */}
                <section style={{ order: -1 }} className={v8.infoCard} data-inbox-v8="customer-info" aria-label="顧客情報">
                  <h3 className={v8.infoTitle}>顧客情報</h3>
                  <div className={v8.infoSections}>
                    {renderDetailSections(friend)}
                  </div>
                </section>
              </>
            ) : (
            <div style={sectionStyle('profile')} className={`${sectionVisibility('profile')} flex flex-col items-center px-5 py-5 text-center`}>
              <Avatar name={friend.displayName} src={friend.pictureUrl} size={56} />
              <ExpandableText
                value={friend.displayName}
                empty="名前なし"
                className="text-ink mt-2 max-w-full text-sm font-bold"
              />
              <p className="text-ink-faint mt-0.5 text-micro">LINE表示名</p>
              <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
                {chatStatus?.status && statusLabels[chatStatus.status] ? (
                  <span className={`inline-flex items-center rounded-pill px-2 py-1 text-micro font-semibold ${statusLabels[chatStatus.status].className}`}>
                    {statusLabels[chatStatus.status].label}
                  </span>
                ) : (
                  <span className="bg-canvas-sunken text-ink-faint rounded-pill px-2 py-1 text-micro font-semibold">未設定</span>
                )}
                <span
                  className="bg-canvas-sunken text-ink-secondary max-w-[130px] truncate rounded-pill px-2 py-1 text-micro font-semibold"
                  title={operatorName ?? undefined}
                >
                  {operatorName || '未割り当て'}
                </span>
              </div>
              {!friend.isFollowing && (
                <span className="bg-canvas-sunken text-ink-faint mt-2 inline-block rounded-mini px-1.5 py-0.5 text-nano font-medium">
                  ブロック済
                </span>
              )}
              <Button variant="secondary" className="text-action mt-3 items-center px-3 py-2 text-xs h-auto whitespace-normal" href={`/friends/detail?id=${friend.id}`}>
                友だち詳細
              </Button>
            </div>
            )}
            {isV8 ? null : renderDetailSections(friend)}
            {/*
              編集導線は将来追加予定 (現在の /friends は ?id= をハンドルしないため、
              リンク先が機能しない → Codex review で指摘済 → 代わりに削除。
              編集 UI が出来たら復活させる)。
            */}
          </div>
        ) : (
          <div className="p-4 text-xs text-ink-faint">友だち情報がありません</div>
        )}
      </div>
    </div>
  )
}
