'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import { petAnimalTypeLabel, type NenHealthSummaryData } from '@/lib/nen-pets-api'
import type { SummaryStatus } from './page'
import './print.css'

const SKIN_LABELS: Record<string, string> = { normal: '問題なし', itchy: 'かゆそう', red: '赤み', other: 'その他' }
const TEAR_LABELS: Record<string, string> = { normal: '問題なし', mild: '少し気になる', concern: '気になる' }

function countText(counts: Record<string, number>, labels: Record<string, string>): string {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])
  return entries.length ? entries.map(([key, n]) => `${labels[key] ?? key} ${n}回`).join('・') : '—'
}

function md(date: string): string {
  return date.slice(5).replace('-', '/')
}

/**
 * 「30日のまとめ」右パネル。★V6 37-4（`mtoCA`）行の操作から開く。
 * 診察時に獣医師へ見せる前提なので、記録の事実（数値・回数・メモ）だけを並べ、判断は書かない。
 */
export default function SummaryDrawer({
  open,
  status,
  summary,
  onClose,
  onRetry,
  onPrint,
}: {
  open: boolean
  status: SummaryStatus
  summary: NenHealthSummaryData | null
  onClose: () => void
  onRetry: () => void
  onPrint: () => void
}) {
  const ready = status === 'ready' && summary !== null
  const s = summary?.summary
  return (
    <Drawer
      open={open}
      title="30日のまとめ"
      description={summary ? `${summary.pet.callName || summary.pet.name}（${petAnimalTypeLabel(summary.pet.animalType)}${summary.pet.breed ? `・${summary.pet.breed}` : ''}・${summary.pet.ageLabel}）／飼い主 ${summary.owner.name}` : undefined}
      onClose={onClose}
      footer={ready ? <Button type="button" variant="primary" onClick={onPrint}>印刷・PDFに保存</Button> : undefined}
    >
      {status === 'loading' ? (
        <ListState kind="loading" title="まとめを作っています" />
      ) : status === 'error' || !summary || !s ? (
        <ListState kind="error" title="まとめを作れませんでした" description="通信の状態を確認して、もう一度お試しください。" onRetry={onRetry} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="grid grid-cols-2 gap-3">
            <div className="rounded-card border border-hairline bg-canvas p-3">
              <dt className="text-micro text-ink-faint">記録</dt>
              <dd className="text-label font-semibold text-ink">{s.records}件／{s.days}日</dd>
            </div>
            <div className="rounded-card border border-hairline bg-canvas p-3">
              <dt className="text-micro text-ink-faint">体重</dt>
              <dd className="text-label font-semibold text-ink">{s.weight ? `${s.weight.first}kg → ${s.weight.last}kg` : '—'}</dd>
              <dd className="text-micro text-ink-faint">{s.weight ? `最小 ${s.weight.min}・最大 ${s.weight.max}` : '記録なし'}</dd>
            </div>
            <div className="rounded-card border border-hairline bg-canvas p-3">
              <dt className="text-micro text-ink-faint">心拍数（平均）</dt>
              <dd className="text-label font-semibold text-ink">{s.heartRateAvg == null ? '—' : `${s.heartRateAvg}回／分`}</dd>
            </div>
            <div className="rounded-card border border-hairline bg-canvas p-3">
              <dt className="text-micro text-ink-faint">呼吸数（平均）</dt>
              <dd className="text-label font-semibold text-ink">{s.respiratoryRateAvg == null ? '—' : `${s.respiratoryRateAvg}回／分`}</dd>
            </div>
          </dl>
          <dl className="flex flex-col gap-2">
            <div className="flex flex-col gap-1 border-t border-hairline pt-2"><dt className="text-micro text-ink-faint">便</dt><dd className="text-caption text-ink">{countText(s.stool, summary.labels.stool)}</dd></div>
            <div className="flex flex-col gap-1 border-t border-hairline pt-2"><dt className="text-micro text-ink-faint">食いつき</dt><dd className="text-caption text-ink">{countText(s.appetite, summary.labels.appetite)}</dd></div>
            <div className="flex flex-col gap-1 border-t border-hairline pt-2"><dt className="text-micro text-ink-faint">皮膚</dt><dd className="text-caption text-ink">{countText(s.skin, SKIN_LABELS)}</dd></div>
            <div className="flex flex-col gap-1 border-t border-hairline pt-2"><dt className="text-micro text-ink-faint">涙やけ</dt><dd className="text-caption text-ink">{countText(s.tearStain, TEAR_LABELS)}</dd></div>
          </dl>
          <section>
            <h3 className="text-label font-bold text-ink">メモ</h3>
            {s.notes.length === 0 ? (
              <p className="mt-1 text-caption text-ink-faint">メモはありません</p>
            ) : (
              <ul className="mt-1 flex flex-col gap-1">
                {s.notes.map((note) => (
                  <li key={note.loggedOn} className="text-caption text-ink"><span className="tabular-nums text-ink-faint">{md(note.loggedOn)}</span> {note.note}</li>
                ))}
              </ul>
            )}
          </section>
          <p className="text-micro text-ink-faint">お客様がマイページで付けた記録をまとめたものです。診断や治療の判断は含みません。</p>
        </div>
      )}
    </Drawer>
  )
}

/**
 * 印刷面。「獣医師向けPDFを書き出す」＝ブラウザの印刷（PDFに保存）。
 * 画面には出ず（`display: none`）、印刷時だけこの面が紙になる。body 直下へ描く。
 */
export function SummarySheet({ summary }: { summary: NenHealthSummaryData }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  const s = summary.summary
  // #999 DEEP-24: 「その他」を犬へ変換して印刷しない（共通の動物種別ラベル）。
  const kind = petAnimalTypeLabel(summary.pet.animalType)
  return createPortal(
    <div data-print-sheet="" aria-hidden="true">
      <p><strong>健康日記 30日のまとめ</strong></p>
      <p>{summary.pet.callName || summary.pet.name}（{kind}{summary.pet.breed ? `・${summary.pet.breed}` : ''}・{summary.pet.ageLabel}）／飼い主 {summary.owner.name}／作成 {summary.generatedAt.slice(0, 10)}</p>
      <p>
        記録 {s.records}件／{s.days}日。
        体重 {s.weight ? `${s.weight.first}kg → ${s.weight.last}kg（最小 ${s.weight.min}・最大 ${s.weight.max}）` : '記録なし'}。
        心拍数 平均 {s.heartRateAvg == null ? '—' : `${s.heartRateAvg}回／分`}。呼吸数 平均 {s.respiratoryRateAvg == null ? '—' : `${s.respiratoryRateAvg}回／分`}。
      </p>
      <p>便：{countText(s.stool, summary.labels.stool)}／食いつき：{countText(s.appetite, summary.labels.appetite)}／皮膚：{countText(s.skin, SKIN_LABELS)}／涙やけ：{countText(s.tearStain, TEAR_LABELS)}</p>
      <table>
        <tbody>
          <tr><td>日付</td><td>体重</td><td>心拍</td><td>呼吸</td><td>便</td><td>食いつき</td><td>皮膚</td><td>涙やけ</td></tr>
          {s.logs.map((log) => (
            <tr key={log.loggedOn}>
              <td>{log.loggedOn}</td>
              <td>{log.weightKg == null ? '' : `${log.weightKg}kg`}</td>
              <td>{log.heartRateBpm ?? ''}</td>
              <td>{log.respiratoryRateBpm ?? ''}</td>
              <td>{summary.labels.stool[log.stool] ?? log.stool}</td>
              <td>{summary.labels.appetite[log.appetite] ?? log.appetite}</td>
              <td>{log.skin ? SKIN_LABELS[log.skin] ?? log.skin : ''}</td>
              <td>{log.tearStain ? TEAR_LABELS[log.tearStain] ?? log.tearStain : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {s.notes.length ? (
        <>
          <p>メモ</p>
          <ul>{s.notes.map((note) => <li key={note.loggedOn}>{note.loggedOn}：{note.note}</li>)}</ul>
        </>
      ) : null}
      <p>お客様がマイページで付けた記録をまとめたものです。診断や治療の判断は含みません。</p>
    </div>,
    document.body,
  )
}
