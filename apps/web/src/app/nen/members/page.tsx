'use client'
import { useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { ApiError } from '@/lib/api'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import MembersPageV8 from '@/v8/nen-members/members'



export type MemberTab = 'members' | 'ranks' | 'lifetime'

export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'


/**
 * 然-NEN- 会員。★管理画面 37-1（`IqL2Z`）会員一覧／37-1-A（`p7xHl`）ランク設定／37-1-B（`Vt65m`）ライフタイム。
 *
 * L 一覧型: 1行目（タブ）→ 数値カード帯 → 案内帯 → 一覧操作 → 表。
 * 主食のカロリー表は「マイペット › 主食のカロリー」（★管理画面 37-3-A、/nen/pets?tab=feeding）へ移した。
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
      /*
       * 形の違う応答は置かない。そのまま置くと `settings.kpis.members` で
       * 画面ごと落ちる（全ルート監査 A1、2026-09-25）。
       */
      const settingsData = res.data as { kpis?: unknown; ranks?: unknown } | null
      if (typeof settingsData !== 'object' || settingsData === null
        || typeof settingsData.kpis !== 'object' || settingsData.kpis === null
        || !Array.isArray(settingsData.ranks)) {
        throw new Error('invalid_nen_settings')
      }
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
      <MembersPageV8
        accountId={selectedAccountId}
        tab={tab}
        status={status}
        settings={settings}
        onRetry={() => void load()}
        onSaved={handleSaved}
        onChangeTab={changeTab}
      />
    )
}
