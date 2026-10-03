'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, fetchApi, type AutomationTemplateSummary } from '@/lib/api'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import MergedTabs from '@/components/layout/merged-tabs'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { useCanManageAutomations } from '@/components/automations/use-automation-permission'
import styles from './automations-v8.module.css'

/*
 * ★V8 オートメーション見本（板 `c7dxp`）。
 * 中身は見本の口（F-16 で12件）の実データ。絵の数は書かない。
 * v8 のときだけ出す枝。
 */

export default function AutomationTemplatesV8() {
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const canManage = useCanManageAutomations()
  usePageTitle('見本から作る')
  const [items, setItems] = useState<AutomationTemplateSummary[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [ruleCount, setRuleCount] = useState<number | null>(null)
  const [activeCount, setActiveCount] = useState<number | null>(null)
  const [stoppedCount, setStoppedCount] = useState<number | null>(null)
  const [exec30d, setExec30d] = useState<number | null>(null)
  const [fail30d, setFail30d] = useState<number | null>(null)
  const [skipped, setSkipped] = useState<number | null>(null)
  const [commonActionCount, setCommonActionCount] = useState<number | null>(null)
  const [triggerFilter, setTriggerFilter] = useState('すべて')
  const [creating, setCreating] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const operationKeysRef = useRef<Record<string, string>>({})

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setItems([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    setActionError('')
    try {
      const [templatesRes, listRes, commonRes, runsRes] = await Promise.all([
        api.automations.templates(selectedAccountId),
        api.automations.list({ accountId: selectedAccountId }).catch(() => null),
        api.commonActions.list({ accountId: selectedAccountId }).catch(() => null),
        fetchApi<ApiResponse<{ summary: { skipped: number } }>>(
          `/api/automation-runs?lineAccountId=${encodeURIComponent(selectedAccountId)}&limit=1`,
        ).catch(() => null),
      ])
      if (!templatesRes.success) throw new Error(templatesRes.error)
      setItems(templatesRes.data)
      if (listRes && listRes.success) {
        const rules = listRes.data as Array<{ isActive: boolean }>
        setRuleCount(rules.length)
        setActiveCount(rules.filter((rule) => rule.isActive).length)
        setStoppedCount(rules.filter((rule) => !rule.isActive).length)
        setExec30d(listRes.summary?.executionCount30d ?? null)
        setFail30d(listRes.summary?.failureCount30d ?? null)
      }
      setCommonActionCount(commonRes && commonRes.success ? commonRes.data.length : null)
      setSkipped(runsRes && runsRes.success ? runsRes.data.summary.skipped : null)
      setStatus('ready')
    } catch {
      setItems([])
      setStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
  }, [accountLoading, load])

  const triggerFilters = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) counts.set(item.triggerLabel, (counts.get(item.triggerLabel) ?? 0) + 1)
    return [{ label: 'すべて', count: items.length }, ...[...counts.entries()].map(([label, count]) => ({ label, count }))]
  }, [items])

  const visibleItems = useMemo(
    () => triggerFilter === 'すべて' ? items : items.filter((item) => item.triggerLabel === triggerFilter),
    [items, triggerFilter],
  )

  const create = async (item: AutomationTemplateSummary) => {
    if (!selectedAccountId || creating) return
    setCreating(item.key)
    setActionError('')
    const slot = `${selectedAccountId}:${item.key}`
    const operationKey = operationKeysRef.current[slot] ?? (operationKeysRef.current[slot] = crypto.randomUUID())
    try {
      const response = await api.automations.createDraftFromTemplate(item.key, selectedAccountId, operationKey)
      if (!response.success) throw new Error(response.error)
      delete operationKeysRef.current[slot]
      router.push(`/automations/drafts?id=${encodeURIComponent(response.data.id)}`)
    } catch {
      setActionError('下書きを作れませんでした。状態を読み直してから、もう一度お試しください。')
      setCreating(null)
    }
  }

  if (accountLoading) return <ListState kind="loading" title="見本を読み込んでいます" />
  if (!selectedAccountId) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="見本から作る下書きは、選んだアカウントだけに保存します。" />
  }

  const tabs = [
    { key: 'rules', label: `ルール ${ruleCount ?? '—'}`, href: '/automations' },
    { key: 'common-actions', label: `共通アクション ${commonActionCount ?? '—'}`, href: '/common-actions' },
    { key: 'runs', label: '動いた記録', href: '/automations/runs' },
    { key: 'templates', label: `見本 ${status === 'ready' ? items.length : '—'}` },
  ]

  return (
    <div className={styles.board} data-design-node="c7dxp">
      <div className={styles.head}>
        <div>
          <h1 className={styles.title}>オートメーション</h1>
          <p className={styles.lead}>「○○したら△△する」を決めておくと、友だちの動きに合わせて自動で動きます。</p>
        </div>
        <Button href="/automations?tab=templates" variant="secondary">見本から作る</Button>
      </div>

      <MergedTabs basePath="/automations" paramName="tab" tabs={tabs} active="templates" />

      {status === 'ready' ? (
        <div data-design="KPIs" className={`${kpiStyles.strip} ${styles.kpis}`}>
          <KpiCard title="ルール" value={ruleCount} unit="件" detail={`動いている ${activeCount ?? '—'}・止めている ${stoppedCount ?? '—'}`} />
          <KpiCard title="今月動いた" value={exec30d} unit="回" detail="この30日の実行回数です" />
          <KpiCard title="失敗" value={fail30d} unit="件" detail="「動いた記録」からやり直せます" />
          <KpiCard title="条件に外れた" value={skipped} unit="回" detail="だれにも当たらないまま終わった回数です" />
        </div>
      ) : null}

      {status === 'loading' ? <ListState kind="loading" title="見本を読み込んでいます" /> : null}
      {status === 'error' ? (
        <ListState
          kind="error"
          title="見本を表示できませんでした"
          description="まだ下書きは作っていません。再読み込みしてから選んでください。"
          action={<Button variant="secondary" onClick={() => void load()}>見本を再読み込み</Button>}
        />
      ) : null}

      {status === 'ready' ? (
        <>
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
          <div className={styles.toolbar}>
            <span className={styles.subLine}>きっかけ</span>
            {triggerFilters.map((filter) => (
              <FilterChip
                key={filter.label}
                selected={triggerFilter === filter.label}
                onChange={(selected) => setTriggerFilter(selected ? filter.label : 'すべて')}
              >
                {filter.label === 'すべて' ? `すべて ${filter.count}` : filter.label}
              </FilterChip>
            ))}
            <div className={styles.toolbarSpice}>
              <Button variant="secondary" onClick={() => void load()}>見本を再読み込み</Button>
            </div>
          </div>

          {visibleItems.length === 0 ? (
            <ListState kind="empty" title="条件に合う見本はありません" description="きっかけの絞り込みを変えてください。" />
          ) : null}

          <div className={styles.sampleGrid}>
            {visibleItems.map((item) => (
              <article key={item.key} className={styles.sampleCard}>
                <h2 className={styles.stepNo}>{item.name}</h2>
                <dl className={styles.sampleRows}>
                  <dt>きっかけ</dt>
                  <dd title={item.triggerLabel}>{item.triggerLabel}</dd>
                  <dt>すること</dt>
                  <dd title={item.actionLabel}>{item.actionLabel}</dd>
                </dl>
                <div className={styles.sampleButton}>
                  <Button
                    variant="secondary"
                    className="w-full justify-center"
                    disabled={creating !== null || canManage !== true}
                    onClick={() => void create(item)}
                  >
                    {canManage === false ? '閲覧のみ' : creating === item.key ? '下書きを作っています…' : 'この見本で下書きを作る'}
                  </Button>
                </div>
              </article>
            ))}
          </div>

          <p className={styles.footnote}>実行まで確認できた見本だけを、ここへ表示します。見本に実データは入っていません。見本から作る下書きは、選んだアカウントだけに保存します。</p>
        </>
      ) : null}
    </div>
  )
}
