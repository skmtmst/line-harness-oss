'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import PageHeader from '@/components/shared/page-header'
import ListState from '@/components/shared/list-state'
import ScrollableTabs from '@/components/layout/scrollable-tabs'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import LifetimeTab from './lifetime-tab'
import MembersTab from './members-tab'
import RankSettingsTab from './rank-settings-tab'

export type MemberTab = 'members' | 'ranks' | 'lifetime'
export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

/**
 * 然-NEN- 会員。★V6 37-1（`IqL2Z`）会員一覧／37-1-A（`p7xHl`）ランク設定／37-1-B（`Vt65m`）ライフタイム。
 *
 * L 一覧型: 1行目（タブ）→ 数値カード帯 → 案内帯 → 一覧操作 → 表。
 * 主食のカロリー表は「マイペット › 主食のカロリー」（★V6 37-3-A、/nen/pets?tab=feeding）へ移した。
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
  const tab: MemberTab = tabParam === 'ranks' ? 'ranks' : tabParam === 'lifetime' ? 'lifetime' : 'members'

  const [status, setStatus] = useState<LoadStatus>('loading')
  /*
   * 設定は「どのアカウントのものか」を一緒に持つ対象スナップショット（DEEP-21）。
   * 遅れて届いたAの応答や、切替前に始めたAの保存応答が、Bの画面へ混ざらないようにする。
   */
  const [snapshot, setSnapshot] = useState<{ accountId: string; data: NenRankSettingsData } | null>(null)
  /** 要求世代。アカウント切替後に届いた古い応答を捨てる。 */
  const generationRef = useRef(0)
  /** 表示中のアカウント。切替の瞬間に読み込み表示へ戻す。 */
  const [viewAccountId, setViewAccountId] = useState(selectedAccountId)

  if (viewAccountId !== selectedAccountId) {
    setViewAccountId(selectedAccountId)
    setStatus('loading')
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) return
    const generation = ++generationRef.current
    const account = selectedAccountId
    setStatus('loading')
    try {
      const res = await nenRanksApi.settings(account)
      if (!res.success) throw new Error(res.error)
      // 新しい要求が出ている＝アカウント切替済み。古い応答は捨てる。
      if (generationRef.current !== generation) return
      setSnapshot({ accountId: account, data: res.data })
      setStatus('ready')
    } catch (caught) {
      if (generationRef.current !== generation) return
      setStatus(caught instanceof ApiError && caught.status === 403 ? 'forbidden' : 'error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    void load()
  }, [load])

  /*
   * 保存応答は、いま持っているスナップショットと同じアカウントのものだけ反映する。
   * 切替後に届いたAの保存結果をBの画面へ置かない（新しい側は load が取り直す）。
   */
  const handleSaved = useCallback((forAccountId: string, next: NenRankSettingsData) => {
    setSnapshot((current) => (current && current.accountId === forAccountId ? { accountId: forAccountId, data: next } : current))
  }, [])

  const changeTab = (next: MemberTab) => router.replace(next === 'members' ? '/nen/members' : `/nen/members?tab=${next}`)

  // 選択中アカウントの設定だけを下のタブへ渡す。別アカウントのものは渡さない。
  const settings = snapshot && snapshot.accountId === selectedAccountId ? snapshot.data : null

  return (
    <div data-design-node="IqL2Z" className="flex flex-col gap-4">
      <PageHeader breadcrumb={[{ label: '専用機能' }, { label: '会員' }]} title="会員" description="" />
      <div data-design="Tabs" data-design-node="AG3tX">
        {/* U091: 右にはみ出すタブへ届くよう、横スクロール＋端の送りボタン付き。 */}
        <ScrollableTabs
          items={[
            { label: '会員一覧', count: settings?.kpis.members, current: tab === 'members', onClick: () => changeTab('members') },
            { label: 'ランク設定', current: tab === 'ranks', onClick: () => changeTab('ranks') },
            { label: 'ライフタイム', current: tab === 'lifetime', onClick: () => changeTab('lifetime') },
            { label: 'ECとの照合', href: '/ec-commerce/identity-candidates' },
          ]}
        />
      </div>

      {/*
        アカウント未選択で真っ白にしない。一覧系と同じく「選んでください」の
        案内を出す（`/nen-members` やマイル明細と同じ形）。
      */}
      {!selectedAccountId ? (
        <ListState
          kind="empty"
          title="LINEアカウントを選んでください"
          description="上のバーから、会員を見るLINEアカウントを選びます。"
        />
      ) : tab === 'ranks' ? (
        <RankSettingsTab accountId={selectedAccountId} status={status} settings={settings} onSaved={handleSaved} onRetry={() => void load()} />
      ) : tab === 'lifetime' ? (
        <LifetimeTab accountId={selectedAccountId} status={status} settings={settings} onSaved={handleSaved} onRetry={() => void load()} />
      ) : (
        <MembersTab accountId={selectedAccountId} settingsStatus={status} settings={settings} />
      )}
    </div>
  )
}
