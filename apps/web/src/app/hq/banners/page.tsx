'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import type { AccountWithStats } from '@/contexts/account-context'
import { useRouter, useSearchParams } from 'next/navigation'
import ReadonlyHeader from '@/app/hq/readonly-header-v8'
import '@/app/hq/readonly-v8.css'
import { api } from '@/lib/api'
import type { BannerPreset, BannerStats, BannerUsage } from '@/lib/hq-banners'
import { usePageTitle } from '@/components/shell/page-chrome'
import { BannerKpis, BannerNote, BannerTabs, type BannerTab } from '@/components/hq/banners/banner-shell'
import type { BannerChrome } from '@/components/hq/banners/banner-side-nav-v8'
import LibrarySection from '@/components/hq/banners/library-section'
import ProjectsSection from '@/components/hq/banners/projects-section'
import './hq-banners-v8.css'

/**
 * バナー生成。板 B9ZAr（一覧）・W5Wxr（ライブラリ）（V8 のみ）。
 *
 * 左に操作と「見る」案内、右に数値カード帯 → 案内帯 → タブ → 中身。
 * タブの切り替えは `?tab=` で、履歴を積まない（`docs/v6-common-rules.md` §2-2）。
 */
export default function HqBannersPage() {
  return (
    <Suspense fallback={null}>
      <BannersInner />
    </Suspense>
  )
}

function BannersInner() {
  usePageTitle('バナー生成')
  const router = useRouter()
  const params = useSearchParams()
  const tab: BannerTab = params.get('tab') === 'library' ? 'library' : 'projects'
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [stats, setStats] = useState<BannerStats | null>(null)
  const [usage, setUsage] = useState<BannerUsage | null>(null)
  const [presets, setPresets] = useState<BannerPreset[]>([])
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [chrome, setChrome] = useState<BannerChrome | null>(null)

  const loadSummary = useCallback(async () => {
    /*
     * 形の違う応答は置かない。そのまま置くと `stats.projects.active` で
     * 画面ごと落ちる（全ルート監査 A1、2026-09-25）。数値は「—」になる。
     */
    setSummaryLoading(true)
    const [presetRes, statsRes] = await Promise.allSettled([api.hqBanners.presets(), api.hqBanners.stats()])
    if (presetRes.status === 'fulfilled' && presetRes.value.success) {
      const data = presetRes.value.data as { presets?: unknown; usage?: BannerUsage | null }
      if (Array.isArray(data?.presets)) setPresets(data.presets as BannerPreset[])
      const usage = data?.usage
      setUsage(usage && typeof usage.month?.used === 'number' ? usage : null)
    }
    if (statsRes.status === 'fulfilled' && statsRes.value.success) {
      const data = statsRes.value.data as { projects?: { active?: unknown; archived?: unknown } } | null
      if (data && typeof data.projects?.active === 'number') setStats(statsRes.value.data)
    }
    setSummaryLoading(false)
  }, [])

  useEffect(() => {
    void loadSummary()
    void api.lineAccounts.list().then((res) => {
      if (res.success) setAccounts(res.data as AccountWithStats[])
    }).catch(() => {
      // アカウントが取れなくても一覧は使える。渡す先の一覧だけ空になる。
    })
  }, [loadSummary])

  /*
   * U044: projectId が無い生成物は「どのプロジェクトか分からない画像」に
   * 寄せ、詳細の特定を必須にしない（自由生成の画像が開けなくなる）。
   */
  const changeTab = (next: BannerTab) => {
    setChrome(null)
    router.replace(next === 'library' ? '/hq/banners?tab=library' : '/hq/banners')
  }

  return (
    <div data-design-node={tab === 'projects' ? 'B9ZAr' : 'W5Wxr'} className="flex flex-col gap-4">
      <ReadonlyHeader title="バナー生成" description="配信やリッチメニューに使う画像をAIで作り、各アカウントの登録メディアへ渡します。" />
      <div className="hq-banners-v8">
        <div className="hq-banners-v8__side">
          {chrome?.action}
          {chrome?.nav}
        </div>
        <div className="hq-banners-v8__main">
          <BannerKpis stats={stats} usage={usage} loading={summaryLoading} />
          <BannerNote />
          <BannerTabs current={tab} onChange={changeTab} />
          {tab === 'projects' ? (
            <ProjectsSection
              usage={usage}
              onChanged={() => void loadSummary()}
              onChrome={setChrome}
              archivedCount={stats?.projects.archived ?? null}
            />
          ) : (
            <LibrarySection presets={presets} accounts={accounts} onChanged={() => void loadSummary()} onChrome={setChrome} />
          )}
        </div>
      </div>
    </div>
  )
}
