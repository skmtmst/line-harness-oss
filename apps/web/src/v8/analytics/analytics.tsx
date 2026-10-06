'use client'

/*
 * ★V8 分析（Pencil：友だちの増減 `ws9wt`・1152 `eEhYU`・閲覧のみ `L4Uov`・
 * 配信の反応 `yvOtn`・経路と成果 `PFe9c`・URLクリック `iK4cQ`・成果地点ごとの
 * レポート `AzrZq`・ファネル `DkRDE`・クロス分析 `u5CuB8`・使われ方 `N8ZrUl`・
 * 保存した分析 `bglah`）。
 *
 * 型（ListPage）に、板の頭・二段の切り替え（組／見かた）・閲覧のみの帯・
 * 見かたごとの数の帯と本文を渡す。まだ一から作り直していない見かたは、
 * 入口（app/analytics/page.tsx）が今の中身を `renderLegacy` で渡す。
 *
 * 受け付ける URL・呼ぶ口・権限は今の画面と同じ（BEHAVIOR.md）。
 */
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Download, Eye, Plus } from 'lucide-react'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { AnalyticsExportContextV8, type ExportAction } from './parts'
import FriendsV8 from './friends'
import ReactionsV8 from './reactions'
import RoutesV8 from './routes'
import UrlClicksV8 from './url-clicks'
import ConversionReportV8 from './conversion-report'
import UsageV8 from './usage'
import styles from './analytics.module.css'

export const ANALYTICS_TABS = ['friends', 'reactions', 'routes', 'usage', 'cross', 'funnel', 'url-clicks', 'saved'] as const
export type AnalyticsTabV8 = (typeof ANALYTICS_TABS)[number] | 'conversion-report'

/** 絵の二段：上は組（ふだん見る・深く見る・見直す）、下はその組の見かた。 */
const GROUPS: Array<{ label: string; tabs: Array<{ key: string; label: string }> }> = [
  { label: 'ふだん見る', tabs: [{ key: 'friends', label: '友だちの増減' }, { key: 'reactions', label: '配信の反応' }, { key: 'routes', label: '経路と成果' }, { key: 'url-clicks', label: 'URLクリック' }] },
  { label: '深く見る', tabs: [{ key: 'funnel', label: 'ファネル' }, { key: 'cross', label: 'クロス分析' }] },
  { label: '見直す', tabs: [{ key: 'usage', label: '使われ方' }, { key: 'saved', label: '保存した分析' }] },
]
/** 成果地点ごとのレポートは「経路と成果」の中の1つの見かた（AzrZq はタブが経路と成果）。 */
const tabOwner = (tab: string) => tab === 'conversion-report' ? 'routes' : tab
const hrefOf = (key: string) => `/analytics?tab=${key}`

const BOARD: Record<string, string> = {
  reactions: 'yvOtn', routes: 'PFe9c', usage: 'N8ZrUl', cross: 'u5CuB8', funnel: 'DkRDE',
  'url-clicks': 'iK4cQ', saved: 'bglah', 'conversion-report': 'AzrZq',
}

export type LegacyTabContext = {
  tab: AnalyticsTabV8
  accountId: string
  canManage: boolean
  registerExport: (action: ExportAction | null) => void
  onSavedCountChange: (count: number | null) => void
}

function readTab(params: URLSearchParams): AnalyticsTabV8 {
  if (params.get('view') === 'conversion-report') return 'conversion-report'
  const raw = params.get('tab')
  // 旧キー clicks（Search Console 側の以前の表記）は URL クリックへ寄せる。知らない値は先頭へ。
  const key = raw === 'clicks' ? 'url-clicks' : raw
  return (ANALYTICS_TABS as readonly string[]).includes(key ?? '') ? key as AnalyticsTabV8 : 'friends'
}

function Navigation({ active, savedCount }: { active: AnalyticsTabV8; savedCount: number | null }) {
  const owner = tabOwner(active)
  const group = GROUPS.find((item) => item.tabs.some((tab) => tab.key === owner)) ?? GROUPS[0]
  return <div className={styles.navigation}>
    <nav aria-label="分析の組" className={styles.groups}>
      {GROUPS.map((item) => <Link key={item.label} href={hrefOf(item.tabs[0].key)} className={styles.group} aria-current={item === group ? 'true' : undefined}>{item.label}</Link>)}
    </nav>
    <nav aria-label="分析の見かた" className={styles.tabs}>
      {group.tabs.map((item) => <Link key={item.key} href={hrefOf(item.key)} className={styles.tab} aria-current={item.key === owner ? 'page' : undefined}>
        {item.key === 'saved' && savedCount != null ? `${item.label} ${savedCount}` : item.label}
      </Link>)}
    </nav>
  </div>
}

function AnalyticsInnerV8({ renderLegacy }: { renderLegacy?: (context: LegacyTabContext) => ReactNode }) {
  const params = useSearchParams()
  const tab = readTab(params)
  usePageTitle('分析')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const role = useStaffRole()
  // 役割が分かるまでは今の画面と同じく変える操作を出さない（owner・admin だけ）。
  const canManage = canManageRole(role)
  const readOnly = role !== null && !canManage
  const narrow = useNarrowViewport(1351)
  const scope = `${selectedAccountId}:${tab}`
  const [exportAction, setExportAction] = useState<(ExportAction & { scope: string }) | null>(null)
  const registerExport = useCallback((action: ExportAction | null) => setExportAction(action ? { ...action, scope } : null), [scope])
  const [savedCount, setSavedCount] = useState<number | null>(null)
  useEffect(() => { setSavedCount(null) }, [selectedAccountId])

  if (accountLoading) return <div className={styles.waiting}>分析を読み込んでいます</div>
  if (!selectedAccountId) return <div className={styles.waiting}>LINE公式アカウントを選んでください</div>

  const board = tab === 'friends' ? (readOnly ? 'L4Uov' : narrow ? 'eEhYU' : 'ws9wt') : BOARD[tab]
  const exportReady = exportAction !== null && exportAction.scope === scope && !exportAction.disabled
  const actions = <>
    <Button variant="secondary" className={readOnly ? undefined : styles.csvButton} disabled={!exportReady} onClick={() => exportAction?.scope === scope && exportAction.onClick()}><Download size={15} aria-hidden="true" />CSV で書き出す</Button>
    {/* 閲覧のみの人には作るボタンを置かない（オーナー決定 2026-10-06）。 */}
    {readOnly ? null : <Button variant="primary" href="/analytics/reports/new"><Plus size={15} aria-hidden="true" />レポートを作る</Button>}
  </>
  const tabs = <>
    <Navigation active={tab} savedCount={savedCount} />
    {readOnly ? <div className={styles.viewerBand} role="status"><Eye size={16} aria-hidden="true" /><span>閲覧のみで見ています。変える操作は管理者に頼んでください。</span></div> : null}
  </>
  const content = tab === 'friends' ? <FriendsV8 key={selectedAccountId} accountId={selectedAccountId} />
    : tab === 'reactions' ? <ReactionsV8 key={selectedAccountId} accountId={selectedAccountId} />
    : tab === 'routes' ? <RoutesV8 key={selectedAccountId} accountId={selectedAccountId} />
    : tab === 'conversion-report' ? <ConversionReportV8 key={selectedAccountId} accountId={selectedAccountId} />
    : tab === 'usage' ? <UsageV8 key={selectedAccountId} accountId={selectedAccountId} />
    : tab === 'url-clicks' ? <UrlClicksV8 key={selectedAccountId} accountId={selectedAccountId} />
    : <div className={styles.legacy}>{renderLegacy?.({ tab, accountId: selectedAccountId, canManage, registerExport, onSavedCountChange: setSavedCount })}</div>

  return <AnalyticsExportContextV8.Provider value={registerExport}>
    <ListPage
      boardId={board}
      title="分析"
      description={<span className={styles.description}>友だちの増減・配信の反応・経路と成果を、期間を決めて見ます。気になる見かたは保存して、レポートで毎週届けられます。</span>}
      actions={actions}
      tabs={tabs}
    >
      {content}
    </ListPage>
  </AnalyticsExportContextV8.Provider>
}

export default function AnalyticsV8({ renderLegacy }: { renderLegacy?: (context: LegacyTabContext) => ReactNode }) {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return <Suspense fallback={<div className={styles.waiting}>読み込み中...</div>}><AnalyticsInnerV8 renderLegacy={renderLegacy} /></Suspense>
}
