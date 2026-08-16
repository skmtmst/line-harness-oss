'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import ScenarioList from '@/components/scenarios/scenario-list'
import ScenarioModePicker from '@/components/scenarios/scenario-mode-picker'
import CcPromptButton from '@/components/cc-prompt-button'

const ccPrompts = [
  {
    title: '新しいシナリオを作成',
    prompt: `新しいシナリオ配信を作成してください。
1. ターゲット: [対象を指定]
2. トリガー: 友だち追加 / タグ変更 / 手動
3. ステップ数: [希望数]
4. メッセージ内容の提案もお願いします
各ステップの配信間隔も含めて構成してください。`,
  },
  {
    title: 'シナリオの効果分析',
    prompt: `現在のシナリオ配信の効果を分析してください。
1. 各シナリオの配信実績を確認
2. ステップごとの離脱率を分析
3. 改善が必要なシナリオを特定
具体的な改善案を提示してください。`,
  },
]

type ScenarioWithCount = Scenario & { stepCount?: number }

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setScenarios(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) {
          setScenarios(res.data)
        } else {
          setError(res.error)
        }
      } catch {
        if (cancelled) return
        setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountLoading])

  const handleCreate = async (input: {
    name: string
    triggerType: ScenarioTriggerType
    triggerTagId: string | null
    deliveryMode: DeliveryMode
  }) => {
    const res = await api.scenarios.create({
      name: input.name,
      description: null,
      triggerType: input.triggerType,
      triggerTagId: input.triggerTagId,
      lineAccountId: selectedAccountId,
      isActive: true,
      deliveryMode: input.deliveryMode,
    })
    if (res.success) {
      router.push(`/scenarios/detail?id=${res.data.id}`)
    } else {
      throw new Error(res.error)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.scenarios.update(id, { isActive: !current })
      loadScenarios()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.scenarios.delete(id)
      loadScenarios()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <div data-design="Head">
      <Header
        title="シナリオ配信"
        description="配信のタイミングを指定して複数のメッセージを順に送ります。友だちの反応に応じて分岐もできます。作成しただけでは配信されません。"
        action={
          <button
            onClick={() => setPickerOpen(true)}
            className="bg-accent text-on-accent transition-colors hover:bg-accent-hover rounded-control px-4 py-2 min-h-[44px] text-sm font-medium"
          >
            + 新規シナリオ
          </button>
        }
      />
      </div>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      <div data-design="KPIs">
      <ListKpis
        build={(s) => [
            { title: 'シナリオ', value: s.scenarios.total, unit: '件', detail: `稼働中 ${s.scenarios.active}` },
            { title: '購読中', value: s.scenarios.subscribers, unit: '人', detail: '重複を含む' },
            {
              title: '読了済',
              value: s.scenarios.completed,
              unit: '人',
              detail:
                s.scenarios.subscribers + s.scenarios.completed > 0
                  ? `完了率 ${Math.round((s.scenarios.completed / (s.scenarios.subscribers + s.scenarios.completed)) * 100)}%`
                  : '—',
            },
            { title: '稼働中', value: s.scenarios.active, unit: '件', detail: '止めているものを除く' },
        ]}
      />
      </div>

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">

      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      <ScenarioModePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onCreate={handleCreate}
      />

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-canvas rounded-card border border-hairline p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-canvas-sunken rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-canvas-sunken rounded w-24" />
                <div className="h-3 bg-canvas-sunken rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScenarioList
          scenarios={scenarios}
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          loading={loading}
        />
      )}

      <CcPromptButton prompts={ccPrompts} />
      </div>
    </div>
  )
}
