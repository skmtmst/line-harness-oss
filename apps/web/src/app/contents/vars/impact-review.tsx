'use client'

import type { CommonVarChangeImpact } from '@line-crm/shared'
import Link from 'next/link'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import SummaryCard from '@/components/shared/summary-card'
import { TableHeadRow, Th } from '@/components/shared/table'
import { characterCountText } from './change-impact'

const KIND_LABELS: Record<string, string> = {
  template: 'テンプレート',
  broadcast: '一斉配信',
  scenario: 'シナリオ',
  reminder: 'リマインダ',
  auto_reply: '自動応答',
  form: '回答フォーム',
  automation: 'オートメーション',
  friend_add: '友だち追加時の配信',
  common_action: '共通アクション',
}

export function impactBreakdown(impact: CommonVarChangeImpact): string {
  const values = Object.entries(impact.byKind)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${KIND_LABELS[kind] ?? kind}${count.toLocaleString('ja-JP')}`)
  return values.length > 0 ? values.join('・') : '種類別の内訳はありません'
}

export function urgentImpactCount(impact: CommonVarChangeImpact): number | null {
  const items = impact.items.filter((item) => item.changesOnSave)
  if (items.some((item) => item.status === '使われています')) return null
  return items.filter((item) => /予約中|公開中/.test(item.status)).length
}

export function overLimitCount(impact: CommonVarChangeImpact): number {
  return impact.items.filter((item) => item.exceedsCharacterLimit).length
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function impactCsv(impact: CommonVarChangeImpact): string {
  return [
    ['どこ', '種類', 'いまの文', '変わったあとの文', '状態'],
    ...impact.items.filter((item) => item.changesOnSave).map((item) => [
      item.name,
      item.kindLabel,
      item.currentPreview,
      item.nextPreview ?? '未取得',
      item.status,
    ]),
  ].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

export default function ImpactReview({
  impact,
  busy,
  onBack,
  onSave,
}: {
  impact: CommonVarChangeImpact
  busy: boolean
  onBack: () => void
  onSave: () => void
}) {
  const rows = impact.items.filter((item) => item.changesOnSave)
  const urgent = urgentImpactCount(impact)
  const overLimit = overLimitCount(impact)

  const exportCsv = () => {
    const url = URL.createObjectURL(
      new Blob([`\uFEFF${impactCsv(impact)}`], { type: 'text/csv;charset=utf-8' }),
    )
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'common-information-impact.csv'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div data-design-node="uNBlA">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <nav className="text-ink-faint text-xs">
          <Link href="/contents/vars" className="text-info hover:underline">共通情報</Link>
          <span className="mx-1.5">›</span>
          <button type="button" onClick={onBack} className="text-info hover:underline">{impact.variable.name}</button>
          <span className="mx-1.5">›</span>
          <span>変える前に影響を見る</span>
        </nav>
        <Button type="button" onClick={exportCsv} disabled={rows.length === 0}>この一覧をCSVで</Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard
          title="変わる場所"
          value={impact.blockingTotal}
          unit="か所"
          detail={impactBreakdown(impact)}
          variant="v6"
        />
        <SummaryCard
          title="すぐ効くもの"
          value={urgent}
          unit="件"
          detail={urgent === null
            ? '予約中・公開中の内訳は未取得です'
            : '予約中の配信・公開中のフォーム'}
          badgeTone="neutral"
          variant="v6"
        />
        <SummaryCard
          title="文字数が上限を超えるもの"
          value={overLimit}
          unit="件"
          detail={overLimit > 0 ? '送信前に直す必要があります' : '上限を超える文はありません'}
          badgeTone={overLimit > 0 ? 'danger' : 'neutral'}
          variant="v6"
        />
        <SummaryCard
          title="送信済みの文"
          value={impact.historicalTotal}
          unit="件"
          detail="変わりません。過去に送った文はそのときの値のままです"
          variant="v6"
        />
      </div>

      <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
        <table className="w-full table-fixed">
          <thead>
            <TableHeadRow className="bg-canvas-sunken border-hairline border-b">
              <Th className="w-48 px-3 py-3">どこ</Th>
              <Th className="w-28 px-3 py-3">種類</Th>
              <Th className="px-3 py-3">いまの文</Th>
              <Th className="px-3 py-3">変わったあとの文</Th>
              <Th className="w-32 px-3 py-3">状態</Th>
              <Th align="right" className="w-16 px-3 py-3">操作</Th>
            </TableHeadRow>
          </thead>
          <tbody className="divide-hairline divide-y">
            {rows.map((item) => (
              <tr key={`${item.kind}-${item.href}-${item.name}`}>
                <td className="px-3 py-3">
                  <p className="text-ink truncate text-sm font-semibold" title={item.name}>{item.name}</p>
                  <p className="text-ink-faint text-xs">{item.kindLabel}</p>
                </td>
                <td className="text-ink-secondary px-3 py-3 text-sm">{item.kindLabel}</td>
                <td className="text-ink-secondary px-3 py-3 text-xs break-words">{item.currentPreview}</td>
                <td className={item.exceedsCharacterLimit ? 'text-danger px-3 py-3 text-xs break-words' : 'text-ink px-3 py-3 text-xs break-words'}>
                  {item.nextPreview ?? '—（未取得）'}
                  {item.exceedsCharacterLimit ? <span className="mt-1 block font-semibold">{characterCountText(item)}</span> : null}
                </td>
                <td className="text-ink-secondary px-3 py-3 text-xs">{item.status}</td>
                <td className="px-3 py-3 text-right"><Link href={item.href} className="text-action text-sm font-semibold">…</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-ink-faint mt-3 text-xs">
        {impact.blockingTotal.toLocaleString('ja-JP')}か所中 1〜{Math.min(rows.length, 6).toLocaleString('ja-JP')}件を表示
      </p>

      <StickyBar
        status={overLimit > 0
          ? `文字数が上限を超えるものが ${overLimit.toLocaleString('ja-JP')}件あります。先に直してください。`
          : '保存を止める問題は見つかりませんでした。'}
        actions={(
          <>
            <Button type="button" onClick={onBack}>編集に戻る</Button>
            <Button type="button" variant="primary" disabled={busy || !impact.canSave} onClick={onSave}>
              {busy ? '保存中…' : 'このまま保存する'}
            </Button>
          </>
        )}
      />
    </div>
  )
}
