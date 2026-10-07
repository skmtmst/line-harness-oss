'use client'

/*
 * ★V8 オートメーションの外枠（Pencil「★V8 画面の地図」のオートメーションの行）。
 * 板：ルール `LWQXd`・1152 `En14p`・閲覧のみ `nH9L8`・共通アクション `LnGNw`・動いた記録 `g98F9`。
 *
 * どのタブも「題・説明・右上の操作 → タブ（件数つき）→ 数の帯」が同じ。
 * 枠と見出しは型（ListPage）が持つ。ここはタブ・閲覧のみの帯・タブの件数を読む口だけ。
 * v7 の画面（app/automations/page.tsx の v7 の枝）は触らない。データの口は同じ。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Eye } from 'lucide-react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { useStaffRole } from '@/lib/staff-role'
import {
  canExportAutomationRuns,
  canManageAutomationRole,
  canOperateAutomationRun,
} from '@/components/automations/use-can-manage'
import { Tabs } from '@/components/shared/tabs'
import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'
import styles from './shell.module.css'

export type AutomationTabKey = 'rules' | 'common-actions' | 'runs' | 'templates'

/** オートメーションの説明（全タブ共通の題の下）。 */
export const AUTOMATIONS_DESCRIPTION = '「〇〇したら △△する」を決めておくと、友だちの動きに合わせて自動で動きます。'

/** 変える権限が無い人への一言（今の V8 と同じ言い方）。 */
export const READONLY_REASON = '閲覧のみのため、この操作はできません'

function readPermissionKeys(): string[] {
  try {
    const raw = window.localStorage.getItem('lh_staff_permissions')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : []
  } catch {
    return []
  }
}

/*
 * ルールを変えられるか。役割はサーバ（/api/staff/me）から読む（手元の保存値は書き換えられる）。
 * staff は権限キー `/automations` を持つときだけ変えられる（サーバの requireAutomationPermission と同じ条件）。
 * 役割が読めるまでは null（呼ぶ側は今までどおり操作を出す。最後の守りはサーバの 403）。
 */
export function useAutomationManage(): boolean | null {
  const role = useStaffRole()
  if (role === null) return null
  return canManageAutomationRole(role, typeof window === 'undefined' ? [] : readPermissionKeys())
}

/*
 * 動いた記録の操作（もう一度やる・取りやめる＝automation.run.retry、CSV＝automation.run.export）。
 * 役割はサーバから読む。読めるまでは null（今までどおり出す）。
 */
export function useAutomationRunManage(): { canOperate: boolean; canExport: boolean } | null {
  const role = useStaffRole()
  if (role === null) return null
  const keys = typeof window === 'undefined' ? [] : readPermissionKeys()
  return { canOperate: canOperateAutomationRun(role, keys), canExport: canExportAutomationRuns(role, keys) }
}

/** タブの行き先（今の V8・v7 と同じ URL。動いた記録・共通アクションは今の道のまま）。 */
export function automationTabHref(key: AutomationTabKey): string {
  if (key === 'common-actions') return '/common-actions'
  if (key === 'runs') return '/automations/runs'
  if (key === 'templates') return '/automations?tab=templates'
  return '/automations'
}

/*
 * タブ（絵の並び：ルール 6・共通アクション 6・動いた記録・見本 12）。
 * 件数は読めたときだけ付ける（読めないときは数を出さない。0 にしない）。
 */
export function AutomationTabs({ active, counts }: { active: AutomationTabKey; counts: AutomationTabCounts }) {
  const label = (base: string, count: number | null) => (count === null ? base : `${base} ${count}`)
  const items: Array<{ key: AutomationTabKey; label: string }> = [
    { key: 'rules', label: label('ルール', counts.rules) },
    { key: 'common-actions', label: label('共通アクション', counts.commonActions) },
    { key: 'runs', label: '動いた記録' },
    { key: 'templates', label: label('見本', counts.templates) },
  ]
  return (
    <div className={styles.tabs}>
      <Tabs
        label="オートメーションの種類"
        items={items.map((item) => ({ label: item.label, href: automationTabHref(item.key), current: item.key === active }))}
      />
    </div>
  )
}

/** 閲覧のみの帯（`nH9L8`：タブの下・数の帯の上。薄い青の地・目の印）。 */
export function ViewerBand() {
  return (
    <div className={styles.viewerRow}>
      <div className={styles.viewerBand} role="status">
        <Eye size={16} aria-hidden="true" />
        <span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span>
      </div>
    </div>
  )
}

export interface BandCell {
  key: string
  title: string
  icon: ReactNode
  /** 読めない数は null（「—」と出す。0 にしない）。 */
  value: number | null
  unit: string
  detail: ReactNode
}

/** 数の帯（タブの直下・4つのマス）。どのタブも同じ形。 */
export function AutomationBand({ cells, label }: { cells: BandCell[]; label: string }) {
  return (
    <div className={styles.stats}>
      <KpiBand aria-label={label} data-design="KPIs">
        {cells.map((cell) => (
          <KpiCard
            key={cell.key}
            presentation="band"
            title={cell.title}
            icon={cell.icon}
            value={cell.value}
            unit={cell.value === null ? '' : cell.unit}
            detail={cell.detail}
          />
        ))}
      </KpiBand>
    </div>
  )
}

export interface AutomationTabCounts {
  rules: number | null
  commonActions: number | null
  templates: number | null
}

/*
 * タブの件数を読む口（ルールの一覧・共通アクションの一覧・見本の一覧）。
 * ルールの数は一覧を読む画面が持っているときは渡してもらう（同じ口を2回読まない）。
 */
export function useAutomationTabCounts(rulesFromPage?: number | null): AutomationTabCounts {
  const { selectedAccountId } = useAccount()
  const generationRef = useRef(0)
  const [rules, setRules] = useState<number | null>(null)
  const [commonActions, setCommonActions] = useState<number | null>(null)
  const [templates, setTemplates] = useState<number | null>(null)
  const needRules = rulesFromPage === undefined

  const load = useCallback(async () => {
    const generation = ++generationRef.current
    setRules(null)
    setCommonActions(null)
    setTemplates(null)
    if (!selectedAccountId) return
    const [rulesResult, commonResult, templatesResult] = await Promise.allSettled([
      needRules ? api.automations.list({ accountId: selectedAccountId }) : Promise.resolve(null),
      api.commonActions.list({ accountId: selectedAccountId }),
      api.automations.templates(selectedAccountId),
    ])
    if (generationRef.current !== generation) return
    if (rulesResult.status === 'fulfilled' && rulesResult.value && rulesResult.value.success) setRules(rulesResult.value.data.length)
    if (commonResult.status === 'fulfilled' && commonResult.value.success) setCommonActions(commonResult.value.data.length)
    if (templatesResult.status === 'fulfilled' && templatesResult.value.success) setTemplates(templatesResult.value.data.length)
  }, [selectedAccountId, needRules])

  useEffect(() => { void load() }, [load])

  return { rules: needRules ? rules : rulesFromPage ?? null, commonActions, templates }
}
