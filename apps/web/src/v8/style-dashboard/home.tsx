'use client'
import dynamic from 'next/dynamic'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useAccount } from '@/contexts/account-context'
import type { IndustryStyle, UsageStyle } from './model'
import StandardDashboard from '@/v8/dashboard/dashboard'

/*
 * ホーム（/）の入口。アカウントの使い方のスタイル（B-294）で出し分ける。
 * 飲食・サロン・面談・教室は業種ダッシュボード、それ以外（標準・EC・読めない）は今の標準のダッシュボード（変えない）。
 * スタイルは GET /api/dashboard/style（styleApi.get）。前に読んだスタイルを店ごとに覚えておき、次からは最初からその画面を出す（標準の画面が一瞬出ないように）。
 */

const StyleDashboard = dynamic(() => import('./style-dashboard'), { ssr: false })

const INDUSTRY: readonly UsageStyle[] = ['restaurant', 'salon', 'consult', 'lesson']
const storageKey = (accountId: string) => `lh_usage_style:${accountId}`

function remembered(accountId: string | null): UsageStyle {
  if (!accountId || typeof window === 'undefined') return 'standard'
  try {
    const value = window.localStorage.getItem(storageKey(accountId))
    return value && (INDUSTRY.includes(value as UsageStyle) || value === 'standard' || value === 'ec') ? (value as UsageStyle) : 'standard'
  } catch {
    return 'standard'
  }
}

export default function HomeDashboard() {
  const { selectedAccountId } = useAccount()
  const qrRequested = useSearchParams().has('qr')
  const [style, setStyle] = useState<UsageStyle>(() => remembered(selectedAccountId))
  useEffect(() => {
    if (!selectedAccountId) return
    let active = true
    setStyle(remembered(selectedAccountId))
    import('@/lib/api-styles')
      .then((m) => m.styleApi.get(selectedAccountId))
      .then((res) => {
        if (!active) return
        const next = res.data?.style ?? 'standard'
        setStyle(next)
        try { window.localStorage.setItem(storageKey(selectedAccountId), next) } catch { /* 覚えられなくても毎回読むだけ */ }
      })
      // 読めないときは前に読んだ表示（初めは標準）のまま。ホームを失敗の画面にはしない（標準のダッシュボードは変えない決まり）。
      .catch(() => {})
    return () => { active = false }
  }, [selectedAccountId])
  // 受信の確認から開くQRは、業種に関係なく既存のQR画面へつなぐ。
  if (qrRequested) return <StandardDashboard />
  if (INDUSTRY.includes(style)) return <StyleDashboard key={style} style={style as IndustryStyle} />
  return <StandardDashboard />
}
