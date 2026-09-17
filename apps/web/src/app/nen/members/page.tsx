'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import PageHeader from '@/components/shared/page-header'
import { Tabs } from '@/components/shared/tabs'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import FeedingTab from './feeding-tab'
import LifetimeTab from './lifetime-tab'
import MembersTab from './members-tab'
import RankSettingsTab from './rank-settings-tab'

export type MemberTab = 'members' | 'ranks' | 'lifetime' | 'feeding'
export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 然-NEN- 会員。★V6 37-1（`IqL2Z`）会員一覧／37-1-A（`p7xHl`）ランク設定／37-1-B（`Vt65m`）ライフタイム。
 *
 * L 一覧型: 1行目（タブ）→ 数値カード帯 → 案内帯 → 一覧操作 → 表。
 * 「給与量」タブ：主食のカロリー表（マイページ「今日の目安」の元。★V6 37-2）。
 * 「ECとの照合」タブは既存の「会員のつき合わせ」（23-1-A）へつなぐ。
 *
 * 言葉：お客様に見える「ポイント」は使わず「マイル」。通年（1〜12月の購入額）／ライフタイム（累計）／マイル残高。
 */
export default function NenMembersPage() {
  return (
    <Suspense fallback={null}>
      <MembersInner />
    </Suspense>
  )
}

function MembersInner() {
  usePageTitle('会員')
  const router = useRouter()
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const tabParam = params.get('tab')
  const tab: MemberTab = tabParam === 'ranks' ? 'ranks' : tabParam === 'lifetime' ? 'lifetime' : tabParam === 'feeding' ? 'feeding' : 'members'

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [settings, setSettings] = useState<NenRankSettingsData | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    setStatus('loading')
    try {
      const res = await nenRanksApi.settings(selectedAccountId)
      if (!res.success) throw new Error(res.error)
      setSettings(res.data)
      setStatus('ready')
    } catch (caught) {
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  const changeTab = (next: MemberTab) => router.replace(next === 'members' ? '/nen/members' : `/nen/members?tab=${next}`)

  return (
    <div data-design-node="IqL2Z" className="flex flex-col gap-4">
      <PageHeader breadcrumb={[{ label: '専用機能' }, { label: '会員' }]} title="会員" description="" />
      <div data-design="Tabs" data-design-node="AG3tX">
        <Tabs
          items={[
            { label: '会員一覧', count: settings?.kpis.members, current: tab === 'members', onClick: () => changeTab('members') },
            { label: 'ランク設定', current: tab === 'ranks', onClick: () => changeTab('ranks') },
            { label: 'ライフタイム', current: tab === 'lifetime', onClick: () => changeTab('lifetime') },
            { label: '給与量', current: tab === 'feeding', onClick: () => changeTab('feeding') },
            { label: 'ECとの照合', href: '/ec-commerce/identity-candidates' },
          ]}
        />
      </div>

      {!selectedAccountId ? null : tab === 'ranks' ? (
        <RankSettingsTab accountId={selectedAccountId} status={status} settings={settings} onSaved={setSettings} onRetry={() => void load()} />
      ) : tab === 'lifetime' ? (
        <LifetimeTab accountId={selectedAccountId} status={status} settings={settings} onSaved={setSettings} onRetry={() => void load()} />
      ) : tab === 'feeding' ? (
        <FeedingTab accountId={selectedAccountId} />
      ) : (
        <MembersTab accountId={selectedAccountId} settingsStatus={status} settings={settings} />
      )}
    </div>
  )
}
