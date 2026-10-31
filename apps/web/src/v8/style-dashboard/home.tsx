'use client'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useAccountStyle } from '@/hooks/use-account-style'
import StaleStyleNotice from '@/components/shared/stale-style-notice'
import PagePending from '@/components/templates/page-pending'
import { useAccount } from '@/contexts/account-context'
import type { IndustryStyle, UsageStyle } from './model'
import { DashboardV8 as StandardDashboard } from '@/v8/dashboard/index'

/*
 * ホーム（/）の入口。アカウントの使い方のスタイルで出し分ける。
 * 飲食・サロン・面談・教室は業種ダッシュボード、標準・ECは共通のダッシュボードに、それぞれ使うカードだけを出す。
 * スタイルは GET /api/dashboard/style（styleApi.get）の正本を読む。未取得・失敗は分け、端末に残った前の業種へ戻さない。
 */

/* 業種が分かるまでの同じ形。題は最初からダッシュボード、中身は骨組み。別の画面や別の題を出さない。 */
function HomeLoading({ error, onRetry }: { error?: unknown; onRetry?: () => void }) {
  return <PagePending variant="dashboard" stage="style" failed={Boolean(error)} error={error} errorTitle="使い方のスタイルを読み込めませんでした" onRetry={onRetry} />
}

const StyleDashboard = dynamic(() => import('./style-dashboard'), { ssr: false, loading: () => <HomeLoading /> })

const INDUSTRY: readonly UsageStyle[] = ['restaurant', 'salon', 'consult', 'lesson']

export default function HomeDashboard() {
  const { selectedAccountId, loading: accountsLoading, error: accountsError, accounts } = useAccount()
  const params = useSearchParams()
  const qrRequested = params.has('qr')
  const setupParam = params.get('setup')
  const setupRequested = setupParam === 'summary' || (setupParam !== null && /^\d+$/.test(setupParam))
  const profile = useAccountStyle(selectedAccountId)
  // QR・質問の再開は業種より先に既存の共通画面へ渡す。閉じると業種のホームへ戻る。
  if (qrRequested || setupRequested) return <StandardDashboard key={selectedAccountId} usageStyle={profile.data?.style === 'ec' ? 'ec' : 'standard'} accountStyle={profile.data?.style ?? null} />
  // 店が1件も無い時だけ共通画面へ。それ以外は業種が分かるまで読み込み中の同じ形。
  const noAccounts = !accountsLoading && !accountsError && accounts.length === 0
  if (!profile.data && !profile.error && !noAccounts) return <HomeLoading />
  if (profile.error && !profile.data) return <HomeLoading error={profile.error} onRetry={profile.reload} />
  const style = profile.data?.style ?? 'standard'
  const stale = profile.stale ? <StaleStyleNotice onRetry={profile.reload} /> : null
  if (INDUSTRY.includes(style)) return <>{stale}<StyleDashboard key={style} style={style as IndustryStyle} /></>
  return <>{stale}<StandardDashboard key={selectedAccountId} usageStyle={style === 'ec' ? 'ec' : 'standard'} accountStyle={style} /></>
}
