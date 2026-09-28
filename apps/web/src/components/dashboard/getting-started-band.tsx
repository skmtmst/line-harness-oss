'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

import { api } from '@/lib/api'
import {
  allDone,
  buildStepsFromApi,
  progressHeadline,
} from '@/app/getting-started/getting-started-view'

/**
 * ダッシュボードの「はじめの設定」の帯。設計 ★V6 34-1（`RAW35`）。台帳 #134。
 *
 * - 全部終わった、または本人が閉じたら出さない。
 * - 「閉じた」は本人単位の記憶。**完了判定には使わない**（要件 §15）——
 *   帯を閉じても順路画面ではいまの中身を数え続ける。
 * - 閉じる操作は右上の ×。「閉じる」ボタンを帯の中に別途置かない。
 */
export default function GettingStartedBand({ accountId }: { accountId: string | null }) {
  const [headline, setHeadline] = useState<string | null>(null)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let cancelled = false
    api.gettingStarted
      .get(accountId ?? undefined)
      .then((res) => {
        if (cancelled || !res.success) return
        const data = res.data
        if (data.dismissed) return
        const steps = buildStepsFromApi(data.steps)
        if (allDone(steps)) return
        setHeadline(progressHeadline(steps))
      })
      .catch(() => {
        // 帯が取れないことを理由にダッシュボードを止めない。出さないだけ。
      })
    return () => {
      cancelled = true
    }
  }, [accountId])

  if (!headline || hidden) return null

  return (
    <div
      role="note"
      className="border-info bg-info-bg relative flex items-center gap-3 rounded-card border px-4 py-3 pr-12"
    >
      <p className="text-info text-sm font-semibold">{headline}</p>
      {/*
        m22c: 行き先リンクは共通の見た目（カード見出しの行き先リンクと同じ
        13px/600の青文字＋→）にそろえる。枠付きボタンにすると、同じ画面の
        「受信箱を開く→」などと大きさ・太さ・色がずれる（自動点検 k=10）。
      */}
      <Link
        href="/getting-started"
        className="text-status-info inline-flex shrink-0 items-center gap-1 text-label font-semibold hover:underline"
      >
        順路を見る
        <span aria-hidden="true">→</span>
      </Link>
      <button
        type="button"
        aria-label="この案内を閉じる"
        className="text-info hover:bg-canvas absolute right-2 top-2 rounded-control p-1"
        onClick={() => {
          setHidden(true)
          // 閉じた日時は本人単位の記憶。失敗しても帯は閉じたままにする。
          void api.gettingStarted.dismiss().catch(() => undefined)
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  )
}
