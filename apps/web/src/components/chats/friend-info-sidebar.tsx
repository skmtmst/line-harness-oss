'use client'

import { useCallback, useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api, type FriendUpcoming, type MileageHistoryItem, type MileageSummary } from '@/lib/api'
import type { FriendField } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { GripVertical, X } from 'lucide-react'

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
}

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

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const statusLabels: Record<NonNullable<ChatStatusInfo['status']>, { label: string; className: string }> = {
  unread: { label: '未対応', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
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
  if (!value) return <span className="text-gray-400">{empty}</span>
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

export default function FriendInfoSidebar({ friendId, chatStatus, operatorName }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
   * 「完了」が画面外へ出て届かなかった。
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

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white">
      <div className="relative flex min-h-[66px] items-center border-b border-[#E5E7EB] bg-white px-4">
        <div className="flex w-full items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-bold text-[#1F2937]">顧客情報</h3>
          </div>
          <button
            type="button"
            ref={settingsButtonRef}
            onClick={() => {
              if (!showSettings) updateSettingsPanelPos()
              setShowSettings(!showSettings)
            }}
            aria-expanded={showSettings}
            className="mr-14 inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-white px-3 text-[11px] font-semibold text-[#667085] hover:bg-[#F7F8F6]"
          >
            表示項目
          </button>
        </div>
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
                <p className="text-ink text-xs font-bold">右パネルの表示項目</p>
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
                    {/*
                      素の `<input type="checkbox">` を土台にする。見た目だけの
                      `<button>` にすると、読み上げで「入／切」が伝わらない。
                    */}
                    <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={visible}
                        aria-label={`${group.label}を表示`}
                        onChange={() => setHiddenSections((current) => (
                          visible
                            ? [...new Set([...current, ...group.sections])]
                            : current.filter((item) => !group.sections.includes(item))
                        ))}
                        className="peer sr-only"
                      />
                      {/*
                        軌道と丸は**どちらも input の兄弟**にする。入れ子にすると
                        `peer-checked:` は兄弟にしか効かないので、丸が動かない。
                      */}
                      <span className="rounded-pill bg-step-idle peer-checked:bg-accent peer-focus-visible:ring-accent/40 absolute inset-0 transition-colors peer-focus-visible:ring-2" />
                      <span className="bg-canvas peer-checked:translate-x-4 absolute left-0.5 h-4 w-4 rounded-full transition-transform" />
                    </label>
                  </div>
                )
              })}
            </div>
            {/*
              **全部隠すと右パネルが空になり、何を隠したのかも画面から読めない。**
              戻す道をここに置く。スクロール領域の外に固定して、低い画面でも
              「初期状態に戻す」「完了」へ届くようにする(#982 LAY-03)。
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
                完了
              </Button>
            </div>
          </div>
        , document.body) : null}
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 space-y-3 animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-gray-200" />
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-20" />
              </div>
            </div>
          </div>
        ) : error ? (
          /* INBOX-08: 失敗は文字だけにせず、その場で再試行できるようにする。 */
          <div className="space-y-2 p-4">
            <p className="text-xs text-red-600">{error}</p>
            <button
              type="button"
              onClick={() => setFriendRetry((key) => key + 1)}
              className="border-hairline text-ink-secondary hover:bg-canvas-sunken rounded-control inline-flex items-center border px-3 py-1.5 text-xs font-semibold"
            >
              再試行する
            </button>
          </div>
        ) : friend ? (
          <div className="flex flex-col divide-y divide-[#E5E7EB]">
            {/* Profile Header — V4は相手・対応・担当をひとまとまりにする。 */}
            <div style={sectionStyle('profile')} className={`${sectionVisibility('profile')} flex flex-col items-center px-5 py-5 text-center`}>
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="h-14 w-14 flex-shrink-0 rounded-full object-cover" />
              ) : (
                <div className="bg-action text-on-action flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full">
                  <span className="text-lg font-bold">{(friend.displayName || '?').charAt(0)}</span>
                </div>
              )}
              <ExpandableText
                value={friend.displayName}
                empty="名前なし"
                className="text-ink mt-2 max-w-full text-sm font-bold"
              />
              <p className="text-ink-faint mt-0.5 text-[11px]">LINE表示名</p>
              <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
                {chatStatus?.status && statusLabels[chatStatus.status] ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${statusLabels[chatStatus.status].className}`}>
                    {statusLabels[chatStatus.status].label}
                  </span>
                ) : (
                  <span className="bg-canvas-sunken text-ink-faint rounded-full px-2 py-1 text-[11px] font-semibold">未設定</span>
                )}
                <span
                  className="bg-canvas-sunken text-ink-secondary max-w-[130px] truncate rounded-full px-2 py-1 text-[11px] font-semibold"
                  title={operatorName ?? undefined}
                >
                  {operatorName || '未割り当て'}
                </span>
              </div>
              {!friend.isFollowing && (
                <span className="bg-canvas-sunken text-ink-faint mt-2 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium">
                  ブロック済
                </span>
              )}
              <a
                href={`/friends/detail?id=${friend.id}`}
                className="border-hairline text-action mt-3 inline-flex items-center rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-[#F7F8F6]"
              >
                友だち詳細
              </a>
            </div>

            {/*
              名前（設計 `友だち詳細` の「名前」）。
              LINEの表示名と、こちらで付けた本名は別物。取り違えると
              別人に送ってしまうので、両方を並べて出す。
            */}
            <div style={sectionStyle('names')} className={`${sectionVisibility('names')} space-y-2 px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">基本情報</h4>
              <div className="flex justify-between items-center gap-2">
                <span className="text-[11px] text-gray-500 shrink-0">本名</span>
                <ExpandableText value={friend.realName} className="text-xs text-gray-700" />
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-[11px] text-gray-500 shrink-0">システム表示名</span>
                <ExpandableText value={friend.systemDisplayName} className="text-xs text-gray-700" />
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-[11px] text-gray-500">登録日</span>
                <span className="truncate text-xs text-gray-700">{formatDate(friend.createdAt)}</span>
              </div>
            </div>

            {/* Harness Mileage — canonical user identity across LINE accounts */}
            <div style={sectionStyle('mileage')} className={`${sectionVisibility('mileage')} px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">マイル</h4>
              {mileage.kind === 'loading' ? (
                <div className="h-24 animate-pulse rounded-xl bg-gray-100" />
              ) : mileage.kind === 'error' ? (
                /* INBOX-08: 失敗と未登録を分け、その場で再試行できる。 */
                <div className="space-y-1.5">
                  <p className="text-[11px] text-danger">マイルを読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setMileageRetry((key) => key + 1)}
                    className="text-action text-[11px] font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : (
                <div className="border-hairline bg-canvas rounded-control border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-ink-faint text-[10px] font-semibold">{mileage.summary.programName}</p>
                      <p className="text-ink mt-0.5 text-xl font-bold tabular-nums">
                        {mileage.summary.available.toLocaleString('ja-JP')}
                        <span className="text-ink-faint ml-1 text-[11px] font-semibold">mile</span>
                      </p>
                      <p className="text-ink-faint text-[10px]">利用可能</p>
                    </div>
                    {mileage.summary.pending > 0 && (
                      <span className="bg-canvas-sunken text-ink-secondary rounded-full px-2 py-1 text-[10px] font-medium">
                        確定待ち {mileage.summary.pending.toLocaleString('ja-JP')}
                      </span>
                    )}
                  </div>

                  {mileage.history.length > 0 ? (
                    <div className="border-hairline mt-3 space-y-1.5 border-t pt-2.5">
                      {mileage.history.slice(0, 3).map((item) => (
                        <div key={item.id} className="flex items-center justify-between gap-2 text-[10px]">
                          <span className="text-ink-faint min-w-0 truncate">{item.reason}</span>
                          <span className={`shrink-0 font-semibold tabular-nums ${item.amount > 0 ? 'text-success' : 'text-ink-secondary'}`}>
                            {item.amount > 0 ? '+' : ''}{item.amount.toLocaleString('ja-JP')}
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-ink-faint border-hairline mt-3 border-t pt-2.5 text-[10px]">
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
            <div style={sectionStyle('support')} className={`${sectionVisibility('support')} space-y-2 px-5 py-4`}>
              <h4 className="text-ink mb-2 text-xs font-bold">次の対応</h4>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-500">対応状況</span>
                {chatStatus?.status && statusLabels[chatStatus.status] ? (
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusLabels[chatStatus.status].className}`}>
                    {statusLabels[chatStatus.status].label}
                  </span>
                ) : (
                  <span className="text-xs text-gray-400">未設定</span>
                )}
              </div>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-500">担当者</span>
                <span className="text-xs text-gray-700">{operatorName || <span className="text-gray-400">未割り当て</span>}</span>
              </div>
              <div>
                <span className="text-[11px] text-gray-500">個別メモ</span>
                <p className="text-xs text-gray-700 whitespace-pre-wrap break-words mt-1">
                  {chatStatus?.notes || <span className="text-gray-400">まだありません</span>}
                </p>
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

            {/* Tags */}
            <div style={sectionStyle('tags')} className={`${sectionVisibility('tags')} px-5 py-4`}>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-ink text-xs font-bold">タグ</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-accent-deep text-[11px] hover:underline">
                  ＋ 追加
                </a>
              </div>
              {friend.tags.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">タグなし</p>
              ) : (
                /*
                  INBOX-35: タグ名はパネル幅以内に収める。長い名前は
                  押して広げられる（ExpandableText）ので、
                  切れたまま読めない状態にしない。
                */
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex max-w-full items-center rounded px-2 py-0.5 text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      <ExpandableText value={tag.name} className="max-w-full text-inherit" />
                    </span>
                  ))}
                </div>
              )}
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
                <h4 className="text-[11px] font-medium text-gray-500">★つき友だち情報</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-accent-deep text-[11px] hover:underline">
                  すべて見る
                </a>
              </div>
              {friendFields.kind === 'loading' ? (
                <div className="h-10 animate-pulse rounded-lg bg-canvas-sunken" />
              ) : friendFields.kind === 'error' ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-danger">項目を読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setFieldsRetry((key) => key + 1)}
                    className="text-action text-[11px] font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : (() => {
                const starred = friendFields.items.filter((field) => field.isStarred)
                if (starred.length === 0) {
                  return (
                    <p className="text-[11px] text-gray-400">
                      ★を付けた項目はまだありません。友だち詳細の「情報」で項目へ★を付けると、ここへ出ます。
                    </p>
                  )
                }
                return (
                  <dl className="space-y-1.5 text-xs">
                    {starred.map((field) => (
                      <div key={field.id}>
                        <dt className="text-[10px] text-gray-400 break-words">{field.name}</dt>
                        <dd className="mt-0.5 text-gray-700">
                          <ExpandableText value={field.value ?? null} empty="未登録" className="text-xs text-gray-700" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                )
              })()}
            </div>

            {/* Rich Menu */}
            <div style={sectionStyle('richMenu')} className={`${sectionVisibility('richMenu')} p-4`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">リッチメニュー</h4>
              <p className="text-[11px] text-gray-500 mb-1">現在の設定</p>
              {richMenu.kind === 'loading' ? (
                <p className="text-[11px] text-gray-400 italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                /* INBOX-08: 失敗と未設定を分け、その場で再試行できる。 */
                <div className="space-y-1.5">
                  <p className="text-[11px] text-danger">リッチメニューを読み込めませんでした</p>
                  <button
                    type="button"
                    onClick={() => setRichMenuRetry((key) => key + 1)}
                    className="text-action text-[11px] font-semibold underline underline-offset-2"
                  >
                    再試行する
                  </button>
                </div>
              ) : richMenu.id === null ? (
                <p className="text-[11px] text-gray-400 italic">未設定</p>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-gray-700">{richMenu.name ?? '(名前なし)'}</span>
                  {richMenu.isDefault && (
                    <span className="px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                      デフォルト
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Metadata custom fields */}
            <div style={sectionStyle('metadata')} className={`${sectionVisibility('metadata')} p-4`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-2">友だち情報</h4>
              {/* 設計は追加日と流入元を必ず出す。どちらも既に持っている値。 */}
              <dl className="mb-2 space-y-1 text-xs">
                <div className="flex justify-between gap-2">
                  <dt className="text-[11px] text-gray-500 shrink-0">追加日</dt>
                  <dd className="text-gray-700">{formatDate(friend.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[11px] text-gray-500 shrink-0">流入元</dt>
                  {/*
                    INBOX-06: 友だち詳細と同じ firstTrackedLinkName を出す。
                    計測できなかった人・経路が消えた人は null → 「不明」。
                    取得自体の失敗は上のエラー節で再試行できる。
                  */}
                  <dd className="min-w-0 text-gray-700">
                    {friend.firstTrackedLinkName ? (
                      <ExpandableText value={friend.firstTrackedLinkName} className="text-xs text-gray-700" />
                    ) : (
                      <span className="text-gray-400">不明</span>
                    )}
                  </dd>
                </div>
              </dl>
              {(() => {
                /*
                  INBOX-07: `_` 始まりの制御用キーは業務表示から外し、
                  項目名は内部キーではなく定義済みの表示名へ写す。
                */
                const entries = Object.entries(friend.metadata ?? {})
                  .map(([key, value]) => ({ key, label: metadataLabel(key), value }))
                  .filter((entry): entry is { key: string; label: string; value: unknown } => entry.label !== null)
                if (entries.length === 0) {
                  return <p className="text-[11px] text-gray-400 italic">まだ登録がありません</p>
                }
                return (
                  <dl className="space-y-2 text-xs">
                    {entries.map((entry) => (
                      <div key={entry.key}>
                        <dt className="text-[10px] text-gray-400 break-words">{entry.label}</dt>
                        <dd className="text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{renderValue(entry.value)}</dd>
                      </div>
                    ))}
                  </dl>
                )
              })()}
            </div>

            {/* Form answers — save_to_metadata の設定に関係なく回答履歴を表示 */}
            <div style={sectionStyle('forms')} className={`${sectionVisibility('forms')} p-4`}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h4 className="text-[11px] font-medium text-gray-500">フォーム回答</h4>
                {/*
                  INBOX-17: 取得するのは最新10件まで。続きがあるか、全部で
                  何件あるかを黙らせない。10件を超える分は友だち詳細へ誘導する。
                */}
                {typeof friend.formSubmissionTotal === 'number' && friend.formSubmissionTotal > 0 && (
                  <span className="text-[10px] text-gray-400">
                    全{friend.formSubmissionTotal}件中 {friend.formSubmissions.length}件を表示
                  </span>
                )}
              </div>
              {!friend.formSubmissions || friend.formSubmissions.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">回答はまだありません</p>
              ) : (
                <div>
                <div className="space-y-3">
                  {friend.formSubmissions.map((submission) => {
                    const labels = new Map(submission.fields.map((field) => [field.name, field.label]))
                    const answers = Object.entries(submission.data).filter(([key]) => !key.startsWith('_'))
                    return (
                      <div key={submission.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-xs font-medium text-gray-700 break-words">{submission.formName}</p>
                          <time className="shrink-0 text-[10px] text-gray-400">
                            {formatDate(submission.createdAt)}
                          </time>
                        </div>
                        <dl className="mt-2 space-y-2">
                          {answers.map(([key, value]) => (
                            <div key={key}>
                              <dt className="text-[10px] text-gray-400">{labels.get(key) ?? key}</dt>
                              <dd className="mt-0.5 whitespace-pre-wrap break-words text-xs text-gray-700">
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
                    className="text-action mt-3 inline-flex text-[11px] font-semibold hover:underline"
                  >
                    残り{friend.formSubmissionTotal - friend.formSubmissions.length}件は友だち詳細で見る
                  </a>
                )}
                </div>
              )}
            </div>

            {/*
              編集導線は将来追加予定 (現在の /friends は ?id= をハンドルしないため、
              リンク先が機能しない → Codex review で指摘済 → 代わりに削除。
              編集 UI が出来たら復活させる)。
            */}
          </div>
        ) : (
          <div className="p-4 text-xs text-gray-400">友だち情報がありません</div>
        )}
      </div>
    </div>
  )
}
