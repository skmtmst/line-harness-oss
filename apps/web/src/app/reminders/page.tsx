'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { ReminderTriggerType, Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import ListToolbar from '@/components/shared/list-toolbar'

interface Reminder {
  id: string
  name: string
  description: string | null
  isActive: boolean
  triggerType?: ReminderTriggerType
  triggerOffsetMinutes?: number | null
  sendAtTime?: string | null
  targetTagId?: string | null
  createdAt: string
  updatedAt: string
}

interface ReminderStep {
  id: string
  reminderId: string
  offsetMinutes: number
  messageType: string
  messageContent: string
  createdAt: string
}

interface ReminderWithSteps extends Reminder {
  steps: ReminderStep[]
}

interface CreateFormState {
  name: string
  description: string
  triggerType: ReminderTriggerType
  sendAtTime: string
  triggerOffsetMinutes: string
  targetTagId: string
}

const EMPTY_CREATE_FORM: CreateFormState = {
  name: '',
  description: '',
  triggerType: 'manual',
  sendAtTime: '',
  triggerOffsetMinutes: '',
  targetTagId: '',
}

const TRIGGER_LABELS: Record<ReminderTriggerType, string> = {
  manual: '手動で対象を登録',
  booking: '予約が入ったとき',
  event: 'イベントに申し込まれたとき',
  friend_field: '友だち情報欄の日付',
}

interface StepFormState {
  offsetMinutes: number
  messageType: string
  messageContent: string
}

function formatOffset(minutes: number): string {
  const abs = Math.abs(minutes)
  const sign = minutes < 0 ? '' : '+'
  if (abs === 0) return '基準時刻'
  if (abs < 60) return `${sign}${minutes}分`
  if (abs % 1440 === 0) {
    const days = abs / 1440
    return minutes < 0 ? `${days}日前` : `${days}日後`
  }
  if (abs % 60 === 0) {
    const hours = abs / 60
    return minutes < 0 ? `${hours}時間前` : `${hours}時間後`
  }
  const hours = Math.floor(abs / 60)
  const mins = abs % 60
  const prefix = minutes < 0 ? '-' : '+'
  return `${prefix}${hours}時間${mins}分`
}

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  flex: 'Flex',
}

export default function RemindersPage() {
  const { selectedAccountId } = useAccount()
  const [reminders, setReminders] = useState<Reminder[]>([])
  // 名前の絞り込み（設計 `Body` の検索）。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState<CreateFormState>(EMPTY_CREATE_FORM)
  const [tags, setTags] = useState<Tag[]>([])
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Expanded card state
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedData, setExpandedData] = useState<ReminderWithSteps | null>(null)
  const [expandLoading, setExpandLoading] = useState(false)

  // Step form state
  const [showStepForm, setShowStepForm] = useState(false)
  const [stepForm, setStepForm] = useState<StepFormState>({
    offsetMinutes: -60,
    messageType: 'text',
    messageContent: '',
  })
  const [stepSaving, setStepSaving] = useState(false)
  const [stepFormError, setStepFormError] = useState('')

  const loadReminders = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [res, tagRes] = await Promise.all([
        api.reminders.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
      ])
      if (tagRes.success) setTags(tagRes.data)
      if (res.success) {
        setReminders(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('リマインダーの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadReminders()
  }, [loadReminders])

  const loadDetail = useCallback(async (id: string) => {
    setExpandLoading(true)
    try {
      const res = await api.reminders.get(id)
      if (res.success) {
        setExpandedData(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('詳細の読み込みに失敗しました')
    } finally {
      setExpandLoading(false)
    }
  }, [])

  const handleExpand = (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      setExpandedData(null)
      setShowStepForm(false)
      return
    }
    setExpandedId(id)
    setExpandedData(null)
    setShowStepForm(false)
    setStepFormError('')
    loadDetail(id)
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.reminders.update(id, { isActive: !current })
      loadReminders()
      if (expandedId === id && expandedData) {
        setExpandedData({ ...expandedData, isActive: !current })
      }
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このリマインダーを削除してもよいですか？')) return
    try {
      await api.reminders.delete(id)
      if (expandedId === id) {
        setExpandedId(null)
        setExpandedData(null)
      }
      loadReminders()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleAddStep = async () => {
    if (!expandedId) return
    if (!stepForm.messageContent.trim()) {
      setStepFormError('メッセージ内容を入力してください')
      return
    }
    setStepSaving(true)
    setStepFormError('')
    try {
      const res = await api.reminders.addStep(expandedId, {
        offsetMinutes: stepForm.offsetMinutes,
        messageType: stepForm.messageType,
        messageContent: stepForm.messageContent,
      })
      if (res.success) {
        setShowStepForm(false)
        setStepForm({ offsetMinutes: -60, messageType: 'text', messageContent: '' })
        loadDetail(expandedId)
      } else {
        setStepFormError(res.error)
      }
    } catch {
      setStepFormError('ステップの追加に失敗しました')
    } finally {
      setStepSaving(false)
    }
  }

  const handleDeleteStep = async (stepId: string) => {
    if (!expandedId) return
    if (!confirm('このステップを削除してもよいですか？')) return
    try {
      await api.reminders.deleteStep(expandedId, stepId)
      loadDetail(expandedId)
    } catch {
      setError('ステップの削除に失敗しました')
    }
  }

  return (
    <div>
      <div data-design="Head">
      <Header
        title="リマインダ"
        description="ゴール日時までのカウントダウン配信を作ります。誕生日や次回お届け日など、友だち情報欄の日付を起点にできます。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              disabled
              title="準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
            <button
              disabled
              title="準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              並び替え
            </button>
            <button
              disabled
              title="準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              フォルダを追加
            </button>
          <Link
            href="/reminders/new"
            className="bg-accent text-on-accent hover:bg-accent-hover rounded-control inline-flex min-h-[44px] items-center px-4 py-2 text-sm font-medium transition-colors"
          >
            + 新規リマインダー
          </Link>
          </div>
        }
      />
      </div>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      <div data-design="KPIs">
      <ListKpis
        build={(s) => [
            { title: 'リマインダ', value: s.reminders.total, unit: '件', detail: `稼働中 ${s.reminders.active}` },
            { title: '配信待ち', value: s.reminders.waiting, unit: '人', detail: '登録済みで未完了' },
            { title: '稼働中', value: s.reminders.active, unit: '件', detail: '止めているものを除く' },
            // 設計の4枚目。source='reminder'（028）で数えられる。
            { title: '今月の配信', value: s.reminders.sentThisMonth, unit: '通', detail: '今月ぶん' },
        ]}
      />
      </div>

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">
      <ListToolbar
        folders={['すべて', '01_誕生日', '02_定期便', '未分類']}
        searchPlaceholder="リマインダ名で検索"
        searchValue={nameQuery}
        onSearchChange={setNameQuery}
        sortLabel="配信待ちが多い順"
      />


      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/*
        作る入口は /reminders/new に1つだけ。ここにも同じフォームがあったが、
        項目が食い違っていた（こちらにはタグの絞り込みが無く、あちらには
        起点の選び方があった）。**両方の項目は /reminders/new が持っている。**
        入口が2つあると、片方だけ直したときに食い違ったまま気づけない。
      */}

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-canvas rounded-lg border border-hairline p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-canvas-sunken rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-canvas-sunken rounded w-24" />
                <div className="h-3 bg-canvas-sunken rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : reminders.length === 0 ? (
        <div className="bg-canvas rounded-lg shadow-sm border border-hairline p-12 text-center">
          <p className="text-ink-faint">リマインダーがありません。「新規リマインダー」から作成してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {reminders
            .filter((r) =>
              nameQuery.trim() === ''
                ? true
                : r.name.toLowerCase().includes(nameQuery.trim().toLowerCase()),
            )
            .map((reminder) => {
            const isExpanded = expandedId === reminder.id

            return (
              <div
                key={reminder.id}
                className={`bg-canvas rounded-lg shadow-sm border border-hairline transition-all ${isExpanded ? 'md:col-span-2 xl:col-span-3' : ''}`}
              >
                {/* Card header */}
                <div
                  className="p-5 cursor-pointer hover:bg-canvas-sunken transition-colors"
                  onClick={() => handleExpand(reminder.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-ink truncate">{reminder.name}</h3>
                      {reminder.description && (
                        <p className="text-xs text-ink-faint mt-1 line-clamp-2">{reminder.description}</p>
                      )}
                      {/* 自動で動くものだけ印を出す。手動は既定なので、
                          全件に「手動」と並べると自動のものが埋もれる。 */}
                      {reminder.triggerType && reminder.triggerType !== 'manual' && (
                        <span className="bg-accent-soft text-success rounded-pill mt-2 inline-flex items-center px-2 py-0.5 text-[11px] font-medium">
                          {TRIGGER_LABELS[reminder.triggerType]}
                          {reminder.sendAtTime && ` ・${reminder.sendAtTime}`}
                        </span>
                      )}
                    </div>
                    <span
                      className={`ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium shrink-0 ${
                        reminder.isActive
                          ? 'bg-green-100 text-green-700'
                          : 'bg-canvas-sunken text-ink-faint'
                      }`}
                    >
                      {reminder.isActive ? '有効' : '無効'}
                    </span>
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-ink-faint">
                    <span>作成日: {new Date(reminder.createdAt).toLocaleDateString('ja-JP')}</span>
                    <span className="flex items-center gap-1">
                      {isExpanded ? '▲ 閉じる' : '▼ 詳細'}
                    </span>
                  </div>
                </div>

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-t border-hairline p-5">
                    {/* Actions */}
                    <div className="flex flex-wrap items-center gap-2 mb-4">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleActive(reminder.id, reminder.isActive) }}
                        className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-md transition-colors ${
                          reminder.isActive
                            ? 'bg-canvas-sunken text-ink-secondary hover:bg-hairline'
                            : 'text-white hover:opacity-90'
                        }`}
                        style={!reminder.isActive ? { backgroundColor: 'var(--color-accent)' } : undefined}
                      >
                        {reminder.isActive ? '無効にする' : '有効にする'}
                      </button>
                      <Link
                        href={`/reminders/edit?id=${reminder.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="border-hairline text-ink-secondary hover:bg-canvas-sunken inline-flex min-h-[44px] items-center rounded-md border px-3 py-1.5 text-xs font-medium transition-colors"
                      >
                        編集
                      </Link>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(reminder.id) }}
                        className="px-3 py-1.5 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                      >
                        削除
                      </button>
                    </div>

                    {/* Steps */}
                    {expandLoading ? (
                      <div className="space-y-2 animate-pulse">
                        <div className="h-3 bg-gray-200 rounded w-32" />
                        <div className="h-10 bg-canvas-sunken rounded" />
                        <div className="h-10 bg-canvas-sunken rounded" />
                      </div>
                    ) : expandedData ? (
                      <div>
                        <div className="flex items-center justify-between mb-3">
                          <h4 className="text-xs font-semibold text-ink-secondary">
                            ステップ ({expandedData.steps.length}件)
                          </h4>
                          <button
                            onClick={() => { setShowStepForm(true); setStepFormError('') }}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-white rounded-md transition-opacity hover:opacity-90"
                            style={{ backgroundColor: 'var(--color-accent)' }}
                          >
                            + ステップ追加
                          </button>
                        </div>

                        {expandedData.steps.length === 0 ? (
                          <p className="text-xs text-ink-faint py-4 text-center">ステップがありません。「ステップ追加」から作成してください。</p>
                        ) : (
                          <div className="space-y-2">
                            {expandedData.steps
                              .sort((a, b) => a.offsetMinutes - b.offsetMinutes)
                              .map((step) => (
                                <div
                                  key={step.id}
                                  className="flex items-start justify-between bg-canvas-sunken rounded-lg p-3 border border-hairline"
                                >
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-info-bg text-info">
                                        {formatOffset(step.offsetMinutes)}
                                      </span>
                                      <span className="text-xs text-ink-faint">
                                        {messageTypeLabels[step.messageType] ?? step.messageType}
                                      </span>
                                    </div>
                                    <p className="text-xs text-ink-secondary whitespace-pre-wrap break-words line-clamp-3">
                                      {step.messageContent}
                                    </p>
                                  </div>
                                  <button
                                    onClick={() => handleDeleteStep(step.id)}
                                    className="ml-2 shrink-0 min-h-[44px] min-w-[44px] text-xs text-red-400 hover:text-red-600 transition-colors"
                                  >
                                    削除
                                  </button>
                                </div>
                              ))}
                          </div>
                        )}

                        {/* Add step form */}
                        {showStepForm && (
                          <div className="mt-4 bg-canvas border border-hairline rounded-lg p-4">
                            <h5 className="text-xs font-semibold text-ink-secondary mb-3">ステップを追加</h5>
                            <div className="space-y-3 max-w-lg">
                              <div>
                                <label className="block text-xs font-medium text-ink-secondary mb-1">オフセット (分)</label>
                                <input
                                  type="number"
                                  className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                                  placeholder="例: -60 (1時間前), +30 (30分後)"
                                  value={stepForm.offsetMinutes}
                                  onChange={(e) => setStepForm({ ...stepForm, offsetMinutes: Number(e.target.value) })}
                                />
                                <p className="text-xs text-ink-faint mt-1">
                                  現在の値: {formatOffset(stepForm.offsetMinutes)}
                                </p>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージタイプ</label>
                                <select
                                  className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-canvas"
                                  value={stepForm.messageType}
                                  onChange={(e) => setStepForm({ ...stepForm, messageType: e.target.value })}
                                >
                                  <option value="text">テキスト</option>
                                  <option value="image">画像</option>
                                  <option value="flex">Flex</option>
                                </select>
                              </div>
                              <div>
                                <label className="block text-xs font-medium text-ink-secondary mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
                                <textarea
                                  className="w-full border border-hairline rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                                  rows={3}
                                  placeholder="メッセージ内容を入力"
                                  value={stepForm.messageContent}
                                  onChange={(e) => setStepForm({ ...stepForm, messageContent: e.target.value })}
                                />
                              </div>

                              {stepFormError && <p className="text-xs text-red-600">{stepFormError}</p>}

                              <div className="flex gap-2">
                                <button
                                  onClick={handleAddStep}
                                  disabled={stepSaving}
                                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                                  style={{ backgroundColor: 'var(--color-accent)' }}
                                >
                                  {stepSaving ? '追加中...' : '追加'}
                                </button>
                                <button
                                  onClick={() => { setShowStepForm(false); setStepFormError('') }}
                                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-lg transition-colors"
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
      </div>
    </div>
  )
}
