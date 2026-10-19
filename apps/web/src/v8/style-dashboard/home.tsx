'use client'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useAccountStyle } from '@/hooks/use-account-style'
import ListState from '@/components/shared/list-state'
import { PageFrame, PageHeading, PageContent } from '@/components/templates/page-frame'
import { useAccount } from '@/contexts/account-context'
import type { IndustryStyle, UsageStyle } from './model'
import { DashboardV8 as StandardDashboard } from '@/v8/dashboard/index'

/*
 * ホーム（/）の入口。アカウントの使い方のスタイルで出し分ける。
 * 飲食・サロン・面談・教室は業種ダッシュボード、標準・ECは共通のダッシュボードに、それぞれ使うカードだけを出す。
 * スタイルは GET /api/dashboard/style（styleApi.get）の正本を読む。未取得・失敗は分け、端末に残った前の業種へ戻さない。
 */

const StyleDashboard = dynamic(() => import('./style-dashboard'), { ssr: false })

const INDUSTRY: readonly UsageStyle[] = ['restaurant', 'salon', 'consult', 'lesson']

export default function HomeDashboard() {
  const { selectedAccountId } = useAccount()
  const qrRequested = useSearchParams().has('qr')
  const profile = useAccountStyle(selectedAccountId)
  // 受信の確認から開くQRは、業種に関係なく既存のQR画面へつなぐ。
  if (qrRequested) return <StandardDashboard usageStyle={profile.data?.style === 'ec' ? 'ec' : 'standard'} />
  if (selectedAccountId && !profile.data) return <PageFrame kind="dashboard"><PageHeading title="ダッシュボード" /><PageContent layout="stats">
    {profile.error ? <ListState kind="error" title="使い方のスタイルを読み込めませんでした" error={profile.error} onRetry={profile.reload} /> : <ListState kind="loading" title="使い方のスタイルを確認しています" />}
  </PageContent></PageFrame>
  const style = profile.data?.style ?? 'standard'
  if (INDUSTRY.includes(style)) return <StyleDashboard key={style} style={style as IndustryStyle} />
  return <StandardDashboard key={selectedAccountId} usageStyle={style === 'ec' ? 'ec' : 'standard'} />
}
