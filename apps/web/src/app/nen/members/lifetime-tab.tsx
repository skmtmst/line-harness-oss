'use client'

import { useEffect, useState } from 'react'
import Button from '@/components/shared/button'
import Chip from '@/components/shared/chip'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import { DeleteAction } from '@/components/shared/row-actions'
import StickyBar from '@/components/shared/sticky-bar'
import SummaryCard from '@/components/shared/summary-card'
import KpiCollapse from '@/components/ui/kpi-collapse'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { nenRanksApi, type NenRankSettingsData } from '@/lib/nen-ranks-api'
import type { LoadStatus } from './page'
import { yen } from './rank-view'

type Draft = { id: string | null; threshold: string; title: string; notify: boolean; reachedCount: number }

/**
 * ライフタイムタブ。★V6 37-1-B（`Vt65m`）。
 *
 * ライフタイムは累計購入額。減らず、年が変わっても戻らない。
 * 節目（金額・称号・到達時のLINE通知）を持ち、特典は「未設定」のまま置ける（Masato の決定 2026-09-16）。
 */
export default function LifetimeTab({
  accountId,
  status,
  settings,
  onSaved,
  onRetry,
}: {
  accountId: string
  status: LoadStatus
  settings: NenRankSettingsData | null
  onSaved: (next: NenRankSettingsData) => void
  onRetry: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const fromSettings = (next: NenRankSettingsData): Draft[] =>
    next.milestones.map((m) => ({ id: m.id, threshold: String(m.thresholdYen), title: m.title, notify: m.notifyOnReach, reachedCount: m.reachedCount }))

  useEffect(() => {
    if (!settings || dirty) return
    setDrafts(fromSettings(settings))
  }, [settings, dirty])

  const update = (index: number, patch: Partial<Draft>) => {
    setDrafts((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    setDirty(true)
    setNotice('')
  }

  const save = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await nenRanksApi.saveMilestones(accountId, drafts.map((row) => ({
        id: row.id, thresholdYen: Number(row.threshold.replace(/[,，]/g, '')), title: row.title.trim(), notifyOnReach: row.notify,
      })))
      if (!res.success) throw new Error(res.error)
      setDirty(false)
      onSaved(res.data)
      setNotice(res.data.sync?.status === 'synced' ? '節目を保存し、ECへ同期しました。' : '節目を保存しました。ECへの同期は失敗したので、ランク設定の「もう一度同期」で送り直せます。')
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : '保存できませんでした。もう一度お試しください。')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading' && !settings) return <ListState kind="loading" title="ライフタイムを読み込んでいます" />
  if (status === 'forbidden') return <ListState kind="forbidden" />
  if (status === 'error' || !settings) return <ListState kind="error" title="ライフタイムを読み込めませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />

  const sorted = [...settings.milestones].sort((a, b) => a.thresholdYen - b.thresholdYen)
  const first = sorted[0]
  const second = sorted[1]
  const top = sorted.at(-1)

  return (
    <>
      <KpiCollapse data-design="KPIs" data-design-node="lr93j" gridClassName="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard variant="v6" title="ライフタイム 合計" value={settings.kpis.lifetimeTotalYen} unit="円" detail="LINE連携済みの会員の累計" />
        <SummaryCard variant="v6" title={first ? `${yen(first.thresholdYen)} 到達` : '節目 到達'} value={first ? first.reachedCount : null} unit="人" detail={first ? first.title : '節目がありません'} />
        <SummaryCard variant="v6" title={second ? `${yen(second.thresholdYen)} 到達` : '節目 到達'} value={second ? second.reachedCount : null} unit="人" detail={second ? second.title : '—'} />
        <SummaryCard variant="v6" title={top && top !== second ? `${yen(top.thresholdYen)} 到達` : '最上位'} value={top && top !== second ? top.reachedCount : null} unit="人" detail={top && top !== second ? top.title : '—'} />
      </KpiCollapse>

      <div data-design="Note" data-design-node="oLPs8">
        <NoteBar tone="info">
          ライフタイムはこれまでの購入額の累計です。減らず、年が変わっても戻りません。節目ごとの特典は、決まってからここで設定できます。
        </NoteBar>
      </div>

      {notice ? <p className="text-label text-accent-deep" role="status">{notice}</p> : null}
      {error ? <p className="text-label text-status-danger" role="alert">{error}</p> : null}

      <section data-design="Table" data-design-node="USBTi">
        <DataTable>
          <thead>
            <TableHeadRow>
              <Th className="w-52">節目（累計）</Th>
              <Th className="w-56">称号</Th>
              <Th>特典</Th>
              <Th className="w-28" align="right">到達した人</Th>
              <Th className="w-44">到達時のLINE通知</Th>
              <Th className="w-14" align="right"><span className="sr-only">削除</span></Th>
            </TableHeadRow>
          </thead>
          <tbody>
            {drafts.map((row, index) => (
              <Tr key={row.id ?? `new-${index}`}>
                <Td>
                  <span className="flex items-center gap-2">
                    <TextField aria-label={`節目 ${index + 1}`} inputMode="numeric" value={row.threshold} onChange={(event) => update(index, { threshold: event.target.value })} />
                    <span className="shrink-0 text-caption font-semibold text-ink-faint">円</span>
                  </span>
                </Td>
                <Td><TextField aria-label={`称号 ${index + 1}`} value={row.title} maxLength={30} onChange={(event) => update(index, { title: event.target.value })} /></Td>
                <Td>
                  <span className="flex items-center gap-2.5">
                    <Chip tone="neutral">未設定</Chip>
                    <span className="text-label text-ink-faint">限定グッズは決まり次第ここで設定します</span>
                  </span>
                </Td>
                <Td align="right"><span className="text-label font-semibold tabular-nums text-ink">{row.reachedCount.toLocaleString('ja-JP')}人</span></Td>
                <Td>
                  <Toggle checked={row.notify} onChange={(checked) => update(index, { notify: checked })} label={row.notify ? '通知する' : '通知しない'} />
                </Td>
                <Td align="right"><DeleteAction label={`${row.title || 'この節目'}を削除する`} onClick={() => { setDrafts((current) => current.filter((_, i) => i !== index)); setDirty(true) }} /></Td>
              </Tr>
            ))}
            <Tr>
              <Td colSpan={6}>
                <button
                  type="button"
                  className="text-label font-semibold text-accent-deep"
                  disabled={drafts.length >= 12}
                  onClick={() => { setDrafts((current) => [...current, { id: null, threshold: '', title: '', notify: true, reachedCount: 0 }]); setDirty(true) }}
                >
                  ＋ 節目を追加
                </button>
              </Td>
            </Tr>
          </tbody>
        </DataTable>
      </section>

      <StickyBar
        status={dirty ? '保存していない変更があります' : undefined}
        actions={(
          <>
            <Button variant="secondary" onClick={() => { setDirty(false); setError(''); setDrafts(fromSettings(settings)) }} disabled={busy || !dirty}>キャンセル</Button>
            <Button variant="primary" onClick={() => void save()} disabled={busy || !dirty}>保存してECへ同期</Button>
          </>
        )}
      />
    </>
  )
}
