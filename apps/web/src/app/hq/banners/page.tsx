'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState, type ReactNode } from 'react'
import { BannerKpis, BannerNote, BannerTabs, type BannerTab } from '@/components/hq/banners/banner-shell'
import LibrarySection from '@/components/hq/banners/library-section'
import ProjectsSection from '@/components/hq/banners/projects-section'
import UploadTargetDialog from '@/components/hq/banners/upload-target-dialog'
import { usePageTitle } from '@/components/shell/page-chrome'
import type { AccountWithStats } from '@/contexts/account-context'
import { api } from '@/lib/api'
import type { BannerPreset, BannerStats, BannerUsage } from '@/lib/hq-banners'

/**
 * 統括「バナー生成」。★V6 35-1 プロジェクト一覧（`aH6NX`）と 35-3 画像ライブラリ（`w3ZDsD`）。
 *
 * L 一覧型: タブ行 → 数値カード帯 → 案内帯 → 一覧本体（`docs/v6-common-rules.md` §1-3）。
 * タブは `?tab=library` で切り替える（§2-2）。画面名はトップバーだけに出す。
 */
export default function HqBannersPage() {
  return (
    <Suspense fallback={null}>
      <HqBannersInner />
    </Suspense>
  )
}

function HqBannersInner() {
  usePageTitle('バナー生成')
  const router = useRouter()
  const params = useSearchParams()
  const tab: BannerTab = params.get('tab') === 'library' ? 'library' : 'projects'

  const [presets, setPresets] = useState<BannerPreset[]>([])
  const [usage, setUsage] = useState<BannerUsage | null>(null)
  const [stats, setStats] = useState<BannerStats | null>(null)
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [projectActions, setProjectActions] = useState<ReactNode>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const loadSummary = useCallback(async () => {
    /*
     * 形の違う応答は置かない。そのまま置くと `stats.projects.active` で
     * 画面ごと落ちる（全ルート監査 A1、2026-09-25）。数値は「—」になる。
     */
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

  const changeTab = (next: BannerTab) => {
    router.replace(next === 'library' ? '/hq/banners?tab=library' : '/hq/banners')
  }

  return (
    <div data-design-node={tab === 'projects' ? 'aH6NX' : 'w3ZDsD'} className="flex flex-col gap-4">
      <BannerTabs
        current={tab}
        onChange={changeTab}
        actions={
          tab === 'projects' ? (
            projectActions
          ) : (
            <UploadTargetDialog.Trigger onClick={() => setUploadOpen(true)} />
          )
        }
      />
      <BannerKpis stats={stats} usage={usage} loading={summaryLoading} />
      <BannerNote />
      {tab === 'projects' ? (
        <ProjectsSection usage={usage} onChanged={() => void loadSummary()} headerActions={setProjectActions} />
      ) : (
        <LibrarySection presets={presets} accounts={accounts} onChanged={() => void loadSummary()} />
      )}
      <UploadTargetDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onPick={(projectId) => {
          setUploadOpen(false)
          router.push(`/hq/banners/project?id=${encodeURIComponent(projectId)}`)
        }}
      />
    </div>
  )
}
