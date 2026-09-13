'use client'

import type { ReactNode } from 'react'
import NoteBar from '@/components/shared/note-bar'
import SummaryCard from '@/components/shared/summary-card'
import { Tabs } from '@/components/shared/tabs'
import {
  nextMonthResetLabel,
  remainingPercent,
  type BannerStats,
  type BannerUsage,
} from '@/lib/hq-banners'

export type BannerTab = 'projects' | 'library'

/**
 * 35-1 / 35-3 の1行目。タブ（プロジェクト一覧／画像ライブラリ）と、右端の操作。
 * Pencil `jGeAF` / `bpdek`。タブの切り替えは `?tab=` で、Link にしない
 * （`docs/v6-common-rules.md` §2-2）。
 */
export function BannerTabs({
  current,
  onChange,
  actions,
}: {
  current: BannerTab
  onChange: (tab: BannerTab) => void
  actions?: ReactNode
}) {
  return (
    <div data-design-node={current === 'projects' ? 'jGeAF' : 'bpdek'}>
      <Tabs
        items={[
          { label: 'プロジェクト一覧', current: current === 'projects', onClick: () => onChange('projects') },
          { label: '画像ライブラリ', current: current === 'library', onClick: () => onChange('library') },
        ]}
        actions={actions}
      />
    </div>
  )
}

/**
 * 数値カード帯。Pencil `jT1tM` / `Y0IibP`。4枚とも同じ出どころ。
 * 数が取れないときは「—」（推測値で埋めない。§7-9）。
 */
export function BannerKpis({
  stats,
  usage,
  loading,
}: {
  stats: BannerStats | null
  usage: BannerUsage | null
  loading: boolean
}) {
  const percent = remainingPercent(usage)
  return (
    <div data-design-node="jT1tM" className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        variant="v6"
        title="プロジェクト"
        value={stats ? stats.projects.active : null}
        unit=""
        detail={stats ? `アーカイブ ${stats.projects.archived}` : '—'}
        loading={loading}
      />
      <SummaryCard
        variant="v6"
        title="今月の生成"
        value={usage ? usage.month.used : null}
        unit="枚"
        detail={usage ? `今日 ${usage.today.used}枚・1日の上限 ${usage.today.limit}枚` : '—'}
        loading={loading}
      />
      <SummaryCard
        variant="v6"
        title="今月の残り"
        value={usage ? usage.month.remaining : null}
        unit="枚"
        badge={percent === null ? undefined : `${percent}%`}
        badgeTone={percent !== null && percent <= 20 ? 'danger' : 'accent'}
        detail={usage ? `上限 ${usage.month.limit}枚・${nextMonthResetLabel()} に戻る` : '—'}
        loading={loading}
      />
      <SummaryCard
        variant="v6"
        title="店舗へ渡した画像"
        value={stats ? stats.deliveredImages : null}
        unit="枚"
        detail={stats ? `${stats.deliveredAccounts}店舗` : '—'}
        loading={loading}
      />
    </div>
  )
}

/** 案内帯。Pencil `Z59tV` / `LDu3x`。1画面に1本（§2-3）。 */
export function BannerNote() {
  return (
    <div data-design-node="Z59tV">
      <NoteBar tone="info">
        作った画像は統括の登録メディアに保存されます。店舗へ渡すと、その店舗の配信・リッチメニュー・回答フォームから選べるようになります。
      </NoteBar>
    </div>
  )
}
