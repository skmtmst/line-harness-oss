'use client'

/*
 * ★V8 オートメーションの見本（Pencil `c7dxp`・`/automations?tab=templates`）。
 *
 * 2026-10-07 src/v8 に一から書いた（今の V8 は 8%）。データの口・下書きを作る動き・権限・失敗時の扱いは
 * 今までの V8（app/automations/templates-v8.tsx）と同じ（BEHAVIOR.md）。違いは見せ方だけ——
 * 型（ListPage）に、タブ・数の帯（ルールの一覧と同じ）・きっかけの札の段・4列のカード・注記を渡す。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, CircleDot, FileWarning, Filter, LayoutTemplate, ListChecks, RefreshCw, Star } from 'lucide-react'
import { api, fetchApi, type AutomationListItem, type AutomationTemplateSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import FilterChip from '@/components/shared/filter-chip'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import {
  AUTOMATIONS_DESCRIPTION,
  AutomationBand,
  AutomationTabs,
  ViewerBand,
  automationTabHref,
  useAutomationManage,
  useAutomationTabCounts,
  type BandCell,
} from './shell'
import styles from './templates.module.css'

type ApiResponse<T> = { success: true; data: T } | { success: false; error: string }
type LoadStatus = 'loading' | 'ready' | 'error'

/** 札に出すきっかけの数（絵は「すべて」＋6つ。残りは「すべて」から見る）。 */
const MAX_TRIGGER_CHIPS = 6

/** きっかけの言い方（口は「友だちになったとき」。絵は「友だちになった」）。 */
export function templateTriggerText(label: string): string {
  return label.replace(/とき(?=（|$)/, '')
}

/** 札の分け方：かっこの補足を外したきっかけ（「注文が確定した（初回）」→「注文が確定した」）。 */
export function templateTriggerGroup(label: string): string {
  return templateTriggerText(label).replace(/（[^）]*）$/, '').trim()
}

/** 札にするきっかけ：先に出てきた順に6つまで。 */
export function templateTriggerChips(items: Pick<AutomationTemplateSummary, 'triggerLabel'>[]): string[] {
  const groups: string[] = []
  for (const item of items) {
    const group = templateTriggerGroup(item.triggerLabel)
    if (group && !groups.includes(group)) groups.push(group)
  }
  return groups.slice(0, MAX_TRIGGER_CHIPS)
}

export default function AutomationTemplatesV8() {
  usePageTitle('見本から作る')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const router = useRouter()
  const { selectedAccountId, loading: accountLoading } = useAccount()
  /* 閲覧のみには「この見本で下書きを作る」「見本から作る」を置かない（2026-10-06 オーナー決定）。 */
  const canManage = useAutomationManage()
  const canEdit = canManage !== false
  const viewerOnly = canManage === false

  const [items, setItems] = useState<AutomationTemplateSummary[]>([])
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [rules, setRules] = useState<AutomationListItem[] | null>(null)
  const [summary, setSummary] = useState<{ executionCount30d: number; failureCount30d: number } | null>(null)
  const [skipped, setSkipped] = useState<number | null>(null)
  const [trigger, setTrigger] = useState('')
  const [creating, setCreating] = useState<string | null>(null)
  const [actionError, setActionError] = useState('')
  const operationKeysRef = useRef<Record<string, string>>({})
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const requestId = ++requestRef.current
    if (!selectedAccountId) {
      setItems([])
      setStatus('ready')
      return
    }
    setStatus('loading')
    setActionError('')
    try {
      const [templatesRes, listRes, runsRes] = await Promise.all([
        api.automations.templates(selectedAccountId),
        api.automations.list({ accountId: selectedAccountId }).catch(() => null),
        fetchApi<ApiResponse<{ summary: { skipped: number } }>>(
          `/api/automation-runs?lineAccountId=${encodeURIComponent(selectedAccountId)}&limit=1`,
        ).catch(() => null),
      ])
      if (requestId !== requestRef.current) return
      if (!templatesRes.success) throw new Error(templatesRes.error)
      setItems(templatesRes.data)
      setRules(listRes && listRes.success ? listRes.data : null)
      setSummary(listRes && listRes.success ? listRes.summary ?? null : null)
      setSkipped(runsRes && runsRes.success ? runsRes.data.summary.skipped : null)
      setStatus('ready')
    } catch {
      if (requestId !== requestRef.current) return
      setItems([])
      setStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void load()
    return () => { requestRef.current += 1 }
  }, [accountLoading, load])
  useEffect(() => { setTrigger('') }, [selectedAccountId])

  const tabCounts = useAutomationTabCounts(rules ? rules.length : null)
  const chips = useMemo(() => templateTriggerChips(items), [items])
  const visible = useMemo(
    () => (trigger ? items.filter((item) => templateTriggerGroup(item.triggerLabel) === trigger) : items),
    [items, trigger],
  )

  const create = async (item: AutomationTemplateSummary) => {
    if (!selectedAccountId || creating || !canEdit) return
    setCreating(item.key)
    setActionError('')
    // 同じ操作のやり直しだけが同じ鍵を使う（別の新規作成は別の鍵）。
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

  /* ===== 数の帯（ルールの一覧と同じ4つ） ===== */
  const activeCount = rules ? rules.filter((rule) => rule.isActive).length : 0
  const stoppedCount = rules ? rules.length - activeCount : 0
  const neverRunCount = rules ? rules.filter((rule) => rule.isActive && rule.executionCount30d === 0).length : 0
  const cells: BandCell[] = [
    { key: 'rules', title: 'ルール', icon: <ListChecks size={13} aria-hidden="true" />, value: rules ? rules.length : null, unit: '件', detail: rules ? `動いている ${activeCount}・止めている ${stoppedCount}` : '—' },
    { key: 'runs', title: '今月動いた', icon: <Activity size={13} aria-hidden="true" />, value: summary?.executionCount30d ?? null, unit: '回', detail: 'この30日に動いた回数' },
    { key: 'failed', title: '失敗', icon: <FileWarning size={13} aria-hidden="true" />, value: summary?.failureCount30d ?? null, unit: '件', detail: '「動いた記録」からやり直せます' },
    { key: 'skipped', title: '条件に外れた', icon: <Filter size={13} aria-hidden="true" />, value: skipped, unit: '回', detail: rules ? `だれにも当たらないルール ${neverRunCount}` : '—' },
  ]

  /* ===== 本文 ===== */
  let body: ReactNode
  if (accountLoading || status === 'loading') {
    body = <ListState kind="loading" title="見本を読み込んでいます" />
  } else if (!selectedAccountId) {
    body = <ListState kind="empty" title="LINE公式アカウントを選んでください" description="見本から作る下書きは、選んだアカウントだけに保存します。" />
  } else if (status === 'error') {
    body = (
      <ListState
        kind="error"
        title="見本を表示できませんでした"
        description="まだ下書きは作っていません。再読み込みしてから選んでください。"
        action={<Button variant="secondary" onClick={() => void load()}>見本を再読み込み</Button>}
      />
    )
  } else {
    body = (
      <>
        <div className={styles.tools}>
          <span className={styles.toolsLabel}>きっかけ</span>
          <div role="group" aria-label="きっかけで絞り込む" className={styles.chips}>
            <FilterChip selected={trigger === ''} onChange={() => setTrigger('')} icon={<CircleDot size={13} aria-hidden="true" />}>
              {`すべて ${items.length}`}
            </FilterChip>
            {chips.map((chip) => (
              <FilterChip
                key={chip}
                selected={trigger === chip}
                onChange={(selected) => setTrigger(selected ? chip : '')}
                icon={<Star size={13} aria-hidden="true" />}
              >
                {chip}
              </FilterChip>
            ))}
          </div>
          <span className={styles.spacer} aria-hidden="true" />
          <Button variant="secondary" onClick={() => void load()}>
            <RefreshCw size={15} aria-hidden="true" />見本を再読み込み
          </Button>
        </div>
        {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
        {visible.length === 0 ? (
          <ListState kind="empty" title="条件に合う見本はありません" description="きっかけの札を外すと、すべて出ます。" />
        ) : (
          <ul className={styles.grid} aria-label="見本">
            {visible.map((item) => {
              const triggerText = templateTriggerText(item.triggerLabel)
              return (
                <li key={item.key} className={styles.card}>
                  <h2 className={styles.cardTitle} title={item.name}>{item.name}</h2>
                  <dl className={styles.facts}>
                    <div className={styles.fact}>
                      <dt>きっかけ</dt>
                      <dd title={triggerText}>{triggerText}</dd>
                    </div>
                    <div className={styles.fact}>
                      <dt>すること</dt>
                      <dd title={item.actionLabel}>{item.actionLabel}</dd>
                    </div>
                  </dl>
                  <span className={styles.cardSpacer} aria-hidden="true" />
                  {canEdit ? (
                    <Button
                      variant="secondary"
                      className={styles.cardButton}
                      disabled={creating !== null}
                      busy={creating === item.key}
                      busyLabel="下書きを作っています…"
                      onClick={() => void create(item)}
                    >
                      この見本で下書きを作る
                    </Button>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
        <p className={styles.note}>実行まで確認できた見本だけを、ここへ表示します。見本に実データは入っていません。見本から作る下書きは、選んだアカウントだけに保存します。</p>
      </>
    )
  }

  return (
    <ListPage
      boardId="c7dxp"
      headingSize="regular"
      title="オートメーション"
      description={AUTOMATIONS_DESCRIPTION}
      actions={canEdit
        ? <Button href={automationTabHref('templates')}><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button>
        : null}
      tabs={<AutomationTabs active="templates" counts={tabCounts} />}
      stats={<>
        {viewerOnly ? <ViewerBand /> : null}
        <AutomationBand label="ルールの数の帯" cells={cells} />
      </>}
    >
      <div className={styles.body}>{body}</div>
    </ListPage>
  )
}
