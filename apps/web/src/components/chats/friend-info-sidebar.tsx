'use client'

import { useState, useEffect } from 'react'
import { api, type MileageHistoryItem, type MileageSummary } from '@/lib/api'

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
  status: 'unread' | 'in_progress' | 'resolved' | null
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
  { key: 'names', label: '名前' },
  { key: 'mileage', label: 'マイル' },
  { key: 'support', label: '対応・メモ' },
  { key: 'tags', label: 'タグ' },
  { key: 'starred', label: '★つき情報' },
  { key: 'richMenu', label: 'リッチメニュー' },
  { key: 'metadata', label: '友だち情報' },
  { key: 'forms', label: 'フォーム回答' },
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
  resolved: { label: '対応済', className: 'bg-success-bg text-success' },
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
      const raw = localStorage.getItem('chat.friendInfoSections')
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
      localStorage.setItem('chat.friendInfoSections', JSON.stringify({ order: sectionOrder, hidden: hiddenSections }))
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
      <div className="relative min-h-[66px] border-b border-[#E5E7EB] bg-white px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[#1F2937]">顧客情報</h3>
            <p className="mt-0.5 text-[10px] text-[#98A2B3]">対応に必要な情報をまとめて確認できます</p>
          </div>
          <button
            type="button"
            onClick={() => setShowSettings((current) => !current)}
            aria-expanded={showSettings}
            className="mr-14 rounded-lg border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-semibold text-[#667085] hover:bg-[#F7F8F6]"
          >
            表示項目
          </button>
        </div>
        {showSettings && (
          <div className="bg-canvas border-hairline absolute top-[calc(100%+6px)] right-2 z-30 w-64 rounded-card border p-3 shadow-xl">
            <p className="text-ink text-xs font-bold">表示・並び順</p>
            <div className="mt-2 space-y-1.5">
              {sectionOrder.map((key, index) => {
                const label = DETAIL_SECTIONS.find((item) => item.key === key)?.label ?? key
                const visible = !hiddenSections.includes(key)
                return (
                  <div key={key} className="border-hairline flex items-center gap-2 rounded-control border px-2 py-1.5">
                    <label className="flex min-w-0 flex-1 items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={visible}
                        onChange={() => setHiddenSections((current) => (
                          visible ? [...current, key] : current.filter((item) => item !== key)
                        ))}
                      />
                      <span className="truncate">{label}</span>
                    </label>
                    <button
                      type="button"
                      disabled={index === 0}
                      onClick={() => moveSection(key, -1)}
                      className="text-accent text-[10px] disabled:opacity-30"
                    >
                      上へ
                    </button>
                    <button
                      type="button"
                      disabled={index === sectionOrder.length - 1}
                      onClick={() => moveSection(key, 1)}
                      className="text-accent text-[10px] disabled:opacity-30"
                    >
                      下へ
                    </button>
                  </div>
                )
              })}
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
            {/* Profile Header */}
            <div style={sectionStyle('profile')} className={`${sectionVisibility('profile')} p-4 flex items-start gap-3`}>
              {friend.pictureUrl ? (
                <img src={friend.pictureUrl} alt="" className="w-12 h-12 rounded-full flex-shrink-0" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                  <span className="text-gray-500 text-base">{(friend.displayName || '?').charAt(0)}</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gray-900 truncate">{friend.displayName || '名前なし'}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  登録日: {formatDate(friend.createdAt)}
                </p>
                {!friend.isFollowing && (
                  <span className="inline-block mt-1 px-1.5 py-0 rounded text-[10px] font-medium bg-gray-100 text-gray-500">
                    ブロック済
                  </span>
                )}
              </div>
            </div>

            {/*
              名前（設計 `友だち詳細` の「名前」）。
              LINEの表示名と、こちらで付けた本名は別物。取り違えると
              別人に送ってしまうので、両方を並べて出す。
            */}
            <div style={sectionStyle('names')} className={`${sectionVisibility('names')} p-4 space-y-2`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">名前</h4>
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
            </div>

            {/* Harness Mileage — canonical user identity across LINE accounts */}
            <div style={sectionStyle('mileage')} className={`${sectionVisibility('mileage')} p-4`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-2">マイル</h4>
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
            <div style={sectionStyle('support')} className={`${sectionVisibility('support')} p-4 space-y-2`}>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1.5">対応</h4>
              <div className="flex justify-between items-center">
                <span className="text-[11px] text-gray-500">対応マーク</span>
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
            <div style={sectionStyle('tags')} className={`${sectionVisibility('tags')} p-4`}>
              <div className="mb-1.5 flex items-center justify-between">
                <h4 className="text-[11px] font-medium text-gray-500">タグ</h4>
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
