'use client'

/*
 * ★V8 運用状態（Pencil：健全性チェック `Y4LkX1`・更新履歴 `I2V65v`・緊急コントロール `OHwbU`）。
 *
 * 外側（型・中のメニュー）とタブ、健全性チェックはここで描く。更新履歴と緊急コントロールは
 * 今の部品を入口（app/emergency/page.tsx）から差し込む。動き（手動確認の連打止め N-458・
 * アカウント一覧の失敗を黙らせない #518）は今の画面と同じ。動きの一覧は同じ場所の BEHAVIOR.md。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import Link from 'next/link'
import { RefreshCw } from 'lucide-react'
import type { LineAccount } from '@line-crm/shared'
import Button from '@/components/shared/button'
import { useMergedTab } from '@/components/layout/merged-tabs'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import type { OperationSeverity } from '@/lib/operation-status'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { SbSettingsScreen } from '../sb-frame/settings-screen'
import { HealthPanelV8 } from './health'
import styles from './screen.module.css'

/** 板 Y4LkX1 の並び。健全性チェック・更新履歴・緊急コントロール。 */
const TABS = [
  { key: 'health', label: '健全性チェック' },
  { key: 'history', label: '更新履歴' },
  { key: 'control', label: '緊急コントロール' },
]
const TAB_HREF: Record<string, string> = {
  health: '/emergency',
  history: '/emergency?tab=history',
  control: '/emergency?tab=control',
}

export type EmergencyControlHandle = { openStop: () => void }

export default function EmergencyScreen({
  renderHistory,
  renderControl,
}: {
  renderHistory?: () => ReactNode
  renderControl?: (accounts: LineAccount[], controlRef: RefObject<EmergencyControlHandle | null>) => ReactNode
}) {
  const tab = useMergedTab(TABS)
  const { selectedAccountId } = useAccount()
  const staffRole = useStaffRole()
  const canManage = staffRole ? canManageRole(staffRole) : true
  const [, setSeverity] = useState<OperationSeverity>('unknown')
  const [manualRunRequest, setManualRunRequest] = useState(0)
  /* 手動確認の連打・同時実行を止める（N-458）。終わったら外す。 */
  const [manualBusy, setManualBusy] = useState(false)
  const manualRunLock = useRef(false)
  const requestManualRun = useCallback(() => {
    if (manualRunLock.current) return
    manualRunLock.current = true
    setManualBusy(true)
    setManualRunRequest((current) => current + 1)
  }, [])
  const settleManualRun = useCallback(() => {
    manualRunLock.current = false
    setManualBusy(false)
  }, [])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [accountsFailed, setAccountsFailed] = useState(false)
  /* 対象アカウント欄の元。失敗しても黙らせない（#518 9）。 */
  const loadAccounts = useCallback(() => {
    setAccountsFailed(false)
    api.health.accounts()
      .then((response) => {
        if (response.success) setAccounts(response.data)
        else setAccountsFailed(true)
      })
      .catch(() => setAccountsFailed(true))
  }, [])
  useEffect(() => { loadAccounts() }, [loadAccounts])
  const controlRef = useRef<EmergencyControlHandle | null>(null)

  const actions = tab === 'health'
    ? <Button variant="secondary" type="button" onClick={requestManualRun} disabled={!selectedAccountId || manualBusy}>
        <RefreshCw className={styles.btnIcon} aria-hidden="true" />{manualBusy ? '確認中…' : 'いますぐ確かめる'}
      </Button>
    : tab === 'control' && canManage
      ? <Button variant="danger" type="button" onClick={() => controlRef.current?.openStop()}>緊急停止する</Button>
      : undefined
  const description = tab === 'health'
    ? `musubo とつながる先が動いているかを、9 つの項目を5分ごとに自動で確かめます。おかしいときはここから止められます。`
    : tab === 'control'
      ? '止める配信を選び、理由を入力して緊急停止します。'
      : 'エラー、緊急停止、システム更新、設定変更を時間順に確認できます。'

  return (
    <SbSettingsScreen
      boardId={tab === 'health' ? 'Y4LkX1' : tab === 'history' ? 'I2V65v' : 'OHwbU'}
      layout="narrow-nav"
      title="運用状態"
      description={description}
      actions={actions}
    >
      <nav className={styles.tabs} aria-label="運用状態の中の切り替え">
        {TABS.map((item) => (
          <Link key={item.key} href={TAB_HREF[item.key]} className={styles.tab} aria-current={tab === item.key ? 'page' : undefined}>{item.label}</Link>
        ))}
      </nav>
      {accountsFailed ? (
        <div className={styles.warnBand} role="alert">
          <p>アカウント一覧を読み込めませんでした。個別のアカウントを選べず、全体が対象になります。</p>
          <button type="button" onClick={() => loadAccounts()} className={styles.inlineLink}>もう一度読む</button>
        </div>
      ) : null}
      {tab === 'health' ? (
        <HealthPanelV8
          accountId={selectedAccountId}
          manualRunRequest={manualRunRequest}
          onSeverity={setSeverity}
          onManualRunSettled={settleManualRun}
          accountCount={accountsFailed ? null : accounts.length}
          canManage={canManage}
        />
      ) : null}
      {tab === 'control' ? renderControl?.(accounts, controlRef) : null}
      {tab === 'history' ? renderHistory?.() : null}
    </SbSettingsScreen>
  )
}
