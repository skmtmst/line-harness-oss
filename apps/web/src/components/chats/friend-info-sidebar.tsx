'use client'

import { useState, useEffect } from 'react'
import { api, type MileageHistoryItem, type MileageSummary } from '@/lib/api'
import Button from '@/components/shared/button'

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

/** Render a metadata value safely as text. Objects/arrays → JSON, primitives → as-is. */
function renderValue(value: unknown): string {
  if (value === null || value === undefined) return '-'
  if (typeof value === 'string') return value || '-'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch {
    return '[unparseable]'
  }
}

export default function FriendInfoSidebar({ friendId, chatStatus, operatorName }: Props) {
  const [friend, setFriend] = useState<FriendDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [sectionOrder, setSectionOrder] = useState<DetailSectionKey[]>(DETAIL_SECTIONS.map((item) => item.key))
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

  const moveSection = (key: DetailSectionKey, delta: -1 | 1) => {
    setSectionOrder((current) => {
      const index = current.indexOf(key)
      const nextIndex = index + delta
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
  }

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
        setError((res as { error?: string }).error ?? '友だち情報を取得できませんでした')
      }
    }).catch((err) => {
      if (cancelled) return
      setError(err instanceof Error ? err.message : String(err))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [friendId])

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
  }, [friendId])

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
  }, [friendId])

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
            onClick={() => setShowSettings((current) => !current)}
            aria-expanded={showSettings}
            className="mr-14 inline-flex h-8 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-[#E5E7EB] bg-white px-3 text-[11px] font-semibold text-[#667085] hover:bg-[#F7F8F6]"
          >
            表示項目
          </button>
        </div>
        {showSettings && (
          /*
            設計 `Xi4x9`「右パネルの表示項目」。**掴んで動かす形は入れていない。**
            掴む操作はキーボードだけでは使えないので、代わりに「上へ／下へ」を
            置いた。出し入れの中身は設計と同じ。
          */
          <div
            data-inbox-v6="detail-sections-panel"
            className="bg-canvas border-hairline rounded-panel shadow-float absolute top-[calc(100%+6px)] right-2 z-30 w-[320px] border p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-ink text-xs font-bold">右パネルの表示項目</p>
                <p className="text-ink-faint text-micro mt-0.5">スイッチで表示切替・上へ／下へで順番変更</p>
              </div>
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                aria-label="表示項目を閉じる"
                className="text-ink-faint hover:bg-canvas-sunken rounded-control -mt-1 -mr-1 flex h-7 w-7 shrink-0 items-center justify-center"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              {sectionOrder.map((key, index) => {
                const label = DETAIL_SECTIONS.find((item) => item.key === key)?.label ?? key
                const visible = !hiddenSections.includes(key)
                return (
                  <div key={key} className="border-hairline rounded-control flex items-center gap-2 border px-2 py-1.5">
                    <span className="flex shrink-0 flex-col">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveSection(key, -1)}
                        aria-label={`${label}を上へ`}
                        className="text-ink-faint hover:text-ink text-nano leading-3 disabled:opacity-30"
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        disabled={index === sectionOrder.length - 1}
                        onClick={() => moveSection(key, 1)}
                        aria-label={`${label}を下へ`}
                        className="text-ink-faint hover:text-ink text-nano leading-3 disabled:opacity-30"
                      >
                        ▼
                      </button>
                    </span>
                    <span className="text-ink min-w-0 flex-1 truncate text-xs">{label}</span>
                    {/*
                      素の `<input type="checkbox">` を土台にする。見た目だけの
                      `<button>` にすると、読み上げで「入／切」が伝わらない。
                    */}
                    <label className="relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        role="switch"
                        checked={visible}
                        aria-label={`${label}を表示`}
                        onChange={() => setHiddenSections((current) => (
                          visible ? [...current, key] : current.filter((item) => item !== key)
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
              戻す道をここに置く。
            */}
            <div className="mt-3 flex items-center justify-between gap-2">
              {/* 設計 `Xi4x9` の2つは h36。共通ボタンと同値なので部品を使う。 */}
              <Button
                onClick={() => {
                  setSectionOrder(DETAIL_SECTIONS.map((item) => item.key))
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
        )}
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
          <div className="p-4 text-xs text-red-600">{error}</div>
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
              <p className="text-ink mt-2 max-w-full truncate text-sm font-bold">{friend.displayName || '名前なし'}</p>
              <p className="text-ink-faint mt-0.5 text-[11px]">LINE表示名</p>
              <div className="mt-3 flex max-w-full items-center justify-center gap-1.5">
                {chatStatus?.status && statusLabels[chatStatus.status] ? (
                  <span className={`inline-flex items-center rounded-full px-2 py-1 text-[11px] font-semibold ${statusLabels[chatStatus.status].className}`}>
                    {statusLabels[chatStatus.status].label}
                  </span>
                ) : (
                  <span className="bg-canvas-sunken text-ink-faint rounded-full px-2 py-1 text-[11px] font-semibold">未設定</span>
                )}
                <span className="bg-canvas-sunken text-ink-secondary max-w-[130px] truncate rounded-full px-2 py-1 text-[11px] font-semibold">
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
                <span className="text-xs text-gray-700 truncate">
                  {friend.realName || <span className="text-gray-400">未登録</span>}
                </span>
              </div>
              <div className="flex justify-between items-center gap-2">
                <span className="text-[11px] text-gray-500 shrink-0">システム表示名</span>
                <span className="text-xs text-gray-700 truncate">
                  {friend.systemDisplayName || <span className="text-gray-400">未登録</span>}
                </span>
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
                <p className="text-[11px] text-red-500 italic">マイルの取得に失敗しました</p>
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
            </div>

            {/* Tags */}
            <div style={sectionStyle('tags')} className={`${sectionVisibility('tags')} px-5 py-4`}>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-ink text-xs font-bold">タグ</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-accent text-[11px] hover:underline">
                  ＋ 追加
                </a>
              </div>
              {friend.tags.length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">タグなし</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {friend.tags.map((tag) => (
                    <span
                      key={tag.id}
                      className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium"
                      style={{
                        backgroundColor: `${tag.color}20`,
                        color: tag.color,
                      }}
                    >
                      {tag.name}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/*
              ★つき友だち情報（設計 `友だち詳細`）。
              friend_fields に「よく見る印」がまだ無いので、いまは
              登録されている情報の先頭3件を出す。印が入ったら差し替える。
              docs/v025-open-questions.md に残している。
            */}
            <div style={sectionStyle('starred')} className={`${sectionVisibility('starred')} p-4`}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-[11px] font-medium text-gray-500">★つき友だち情報</h4>
                <a href={`/friends/detail?id=${friend.id}`} className="text-accent text-[11px] hover:underline">
                  すべて見る
                </a>
              </div>
              {!friend.metadata || Object.keys(friend.metadata).length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">まだ登録がありません</p>
              ) : (
                <dl className="space-y-1.5 text-xs">
                  {Object.entries(friend.metadata).slice(0, 3).map(([key, value]) => (
                    <div key={key} className="flex justify-between gap-2">
                      <dt className="text-[11px] text-gray-500 shrink-0">{key}</dt>
                      <dd className="text-gray-700 truncate">{renderValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>

            {/* Rich Menu */}
            <div style={sectionStyle('richMenu')} className={`${sectionVisibility('richMenu')} p-4`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">リッチメニュー</h4>
              <p className="text-[11px] text-gray-500 mb-1">現在の設定</p>
              {richMenu.kind === 'loading' ? (
                <p className="text-[11px] text-gray-400 italic">読み込み中...</p>
              ) : richMenu.kind === 'error' ? (
                <p className="text-[11px] text-red-500 italic">取得に失敗しました</p>
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
                  <dt className="text-[11px] text-gray-500">追加日</dt>
                  <dd className="text-gray-700">{formatDate(friend.createdAt)}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-[11px] text-gray-500">流入元</dt>
                  <dd className="text-gray-700">
                    {/*
                      流入経路の名前を友だち詳細で返す口がまだ無い。
                      friends.first_tracked_link_id はあるが、この経路では
                      引いていない。欄だけ出して、入ったら繋ぐ。
                      docs/v025-open-questions.md に残す。
                    */}
                    <span className="text-gray-400">不明</span>
                  </dd>
                </div>
              </dl>
              {!friend.metadata || Object.keys(friend.metadata).length === 0 ? (
                <p className="text-[11px] text-gray-400 italic">まだ登録がありません</p>
              ) : (
                <div>
                <dl className="space-y-2 text-xs">
                  {Object.entries(friend.metadata).map(([key, value]) => (
                    <div key={key}>
                      <dt className="text-[10px] text-gray-400 uppercase tracking-wide">{key}</dt>
                      <dd className="text-gray-700 mt-0.5 whitespace-pre-wrap break-words">{renderValue(value)}</dd>
                    </div>
                  ))}
                </dl>
                </div>
              )}
            </div>

            {/* Form answers — save_to_metadata の設定に関係なく回答履歴を表示 */}
            <div style={sectionStyle('forms')} className={`${sectionVisibility('forms')} p-4`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-2">フォーム回答</h4>
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
