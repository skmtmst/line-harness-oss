'use client'

/*
 * ★V8-B 健康日記 30日のまとめ（BVuYh）。一覧の上に右から出る引き出し（幅 600）。
 * 注意書き → 数（記録・体重・呼吸数・心拍数）→ 体重の30日の棒 → 記録の表 → 印刷・PDF に保存する。
 * 引き出しの枠は共通の Drawer。診察時に獣医師へ見せる前提なので、記録の事実だけを並べ、判断は書かない。
 * 印刷面（SummarySheet）は画面に出ず、印刷のときだけ紙になる（今の画面と同じ data-print-sheet）。
 */
import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Button from '@/components/shared/button'
import Drawer from '@/components/shared/drawer'
import ListState from '@/components/shared/list-state'
import { isForbiddenOrRateLimited } from '@/components/shared/api-error-message'
import { formatDay } from '@/lib/format'
import { petAnimalTypeLabel, type NenHealthSummaryData } from '@/lib/nen-pets-api'
import { SKIN_LABELS, TEAR_LABELS, countText, md } from './parts'
import styles from './health.module.css'

type Logs = NenHealthSummaryData['summary']['logs']

/** 記録の表の涙やけは列が狭いので短い言葉（絵 BVuYh）。印刷面は今までどおり長い言葉。 */
const TEAR_SHORT: Record<string, string> = { normal: 'なし', mild: '少し', concern: '気になる' }

/** 「こむぎ（犬・柴・4歳）・田中 明子さん・9/1〜9/30」。 */
function petLine(summary: NenHealthSummaryData): string {
  const kind = petAnimalTypeLabel(summary.pet.animalType)
  const parts = [kind, summary.pet.breed, summary.pet.ageLabel === '—' ? '' : summary.pet.ageLabel].filter(Boolean).join('・')
  const end = new Date(summary.generatedAt)
  const start = new Date(end.getTime() - (summary.summary.days - 1) * 86_400_000)
  const range = Number.isNaN(end.getTime()) ? '' : `・${start.getMonth() + 1}/${start.getDate()}〜${end.getMonth() + 1}/${end.getDate()}`
  return `${summary.pet.name || summary.pet.callName}（${parts}）・${summary.owner.name}さん${range}`
}

function signed(value: number, digits: number): string {
  const text = Math.abs(value).toFixed(digits)
  return value > 0 ? `+${text}` : value < 0 ? `−${text}` : text
}

export default function SummaryDrawerV8({
  status,
  summary,
  error,
  onClose,
  onRetry,
  onPrint,
}: {
  status: 'loading' | 'ready' | 'error'
  summary: NenHealthSummaryData | null
  error?: unknown
  onClose: () => void
  onRetry: () => void
  onPrint: () => void
}) {
  const s = summary?.summary
  const weightDelta = s?.weight ? s.weight.last - s.weight.first : null
  const weightPercent = s?.weight && s.weight.first !== 0 && weightDelta !== null ? Math.round((weightDelta / s.weight.first) * 100) : null
  const notes = new Map((s?.notes ?? []).map((note) => [note.loggedOn, note.note]))

  return (
    <Drawer
      open
      title="健康日記 30日のまとめ"
      description={status === 'ready' && summary ? petLine(summary) : 'まとめを作っています'}
      onClose={onClose}
    >
      <div className={styles.summaryBody} data-design-node="BVuYh">
        {status === 'loading' ? (
          <ListState kind="loading" title="まとめを作っています" />
        ) : status === 'error' || !summary || !s ? (
          <ListState
            kind="error"
            title="まとめを作れませんでした"
            description={isForbiddenOrRateLimited(error) ? undefined : '通信の状態を確認して、もう一度お試しください。'}
            error={error ?? undefined}
            onRetry={onRetry}
          />
        ) : (
          <>
            <p className={styles.summaryNote}>お客さまがマイページで付けた記録をまとめたものです。診断や治療の判断は含みません。</p>
            <dl className={styles.statGrid}>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>記録</dt>
                <dd className={styles.statValue}>{`${s.records} 日`}</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>体重</dt>
                <dd className={styles.statValue}>{s.weight ? `${s.weight.first} → ${s.weight.last} kg` : '—'}</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>呼吸数（平均）</dt>
                <dd className={styles.statValue}>{s.respiratoryRateAvg == null ? '—' : `${s.respiratoryRateAvg} 回／分`}</dd>
              </div>
              <div className={styles.statBox}>
                <dt className={styles.statLabel}>心拍数（平均）</dt>
                <dd className={styles.statValue}>{s.heartRateAvg == null ? '—' : `${s.heartRateAvg} 回／分`}</dd>
              </div>
            </dl>
            <section className={styles.chart} aria-label="体重の30日の推移">
              <div className={styles.chartHead}>
                <h3 className={styles.chartTitle}>体重</h3>
                {weightDelta !== null && weightPercent !== null ? (
                  <p className={styles.chartCaption}>{`30日で ${signed(weightDelta, 1)}kg（${signed(weightPercent, 0)}%）`}</p>
                ) : null}
              </div>
              <WeightChart30d logs={s.logs} generatedAt={summary.generatedAt} />
            </section>
            {s.logs.length > 0 ? (
              <div className={styles.logTable} role="table" aria-label="記録の表">
                <div className={styles.logHead} role="row">
                  <span className={styles.logDate} role="columnheader">日付</span>
                  <span className={styles.logWeight} role="columnheader">体重</span>
                  <span className={styles.logStool} role="columnheader">便</span>
                  <span className={styles.logStool} role="columnheader">食いつき</span>
                  <span className={styles.logSkin} role="columnheader">皮膚</span>
                  <span className={styles.logTear} role="columnheader">涙やけ</span>
                  <span className={styles.logMemo} role="columnheader">メモ</span>
                </div>
                {s.logs.map((log) => (
                  <div key={log.loggedOn} className={styles.logRow} role="row">
                    <span className={styles.logDate} role="cell">{md(log.loggedOn)}</span>
                    <span className={styles.logWeight} role="cell">{log.weightKg == null ? '—' : `${log.weightKg}kg`}</span>
                    <span className={styles.logStool} role="cell">{summary.labels.stool[log.stool] ?? log.stool}</span>
                    <span className={styles.logStool} role="cell">{summary.labels.appetite[log.appetite] ?? log.appetite}</span>
                    <span className={styles.logSkin} role="cell">{log.skin ? SKIN_LABELS[log.skin] ?? log.skin : '—'}</span>
                    <span className={styles.logTear} role="cell">{log.tearStain ? TEAR_SHORT[log.tearStain] ?? log.tearStain : '—'}</span>
                    <span className={styles.logMemo} role="cell">{notes.get(log.loggedOn) ?? '—'}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className={styles.summaryEmpty}>この30日の記録はありません。</p>
            )}
            <div className={styles.summaryFoot}>
              <Button type="button" onClick={onPrint} title="ブラウザの印刷で PDF に保存します">
                印刷・PDF に保存する
              </Button>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}

/**
 * 体重の30日の棒。記録のある日の体重だけ棒にし、無い日は薄い線。
 * 最小〜最大の幅で高さを4段に分ける（棒の高さは CSS の段の値）。
 */
function WeightChart30d({ logs, generatedAt }: { logs: Logs; generatedAt: string }) {
  const byDay = new Map<string, number>()
  for (const log of logs) {
    if (log.weightKg != null && !byDay.has(log.loggedOn)) byDay.set(log.loggedOn, log.weightKg)
  }
  const base = new Date(generatedAt)
  const end = Number.isNaN(base.getTime()) ? new Date() : base
  const days: Array<{ key: string; value: number | null }> = []
  for (let i = 29; i >= 0; i--) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    days.push({ key, value: byDay.get(key) ?? null })
  }
  const known = days.map((d) => d.value).filter((v): v is number => v != null)
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 0
  const label = known.length >= 2 ? `${known[0]}kg → ${known[known.length - 1]}kg` : known.length === 1 ? `${known[0]}kg` : '記録なし'
  return (
    <div className={styles.chartBars} role="img" aria-label={`体重の推移（30日）：${label}`} title={label}>
      {days.map((day) => day.value == null ? (
        <span key={day.key} className={styles.chartBarEmpty} />
      ) : (
        <span key={day.key} className={styles.chartBar} data-level={max === min ? 3 : 1 + Math.round(((day.value - min) / (max - min)) * 3)} title={`${md(day.key)} ${day.value}kg`} />
      ))}
    </div>
  )
}

/**
 * 印刷面。「獣医師向け PDF を書き出す」＝ブラウザの印刷（PDFに保存）。
 * 画面には出ず、印刷時だけこの面が紙になる。body 直下へ描く（今の画面と同じ data-print-sheet）。
 */
export function SummarySheet({ summary }: { summary: NenHealthSummaryData }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])
  if (!mounted) return null
  const s = summary.summary
  // #999 DEEP-24: 「その他」を犬へ変換して印刷しない（共通の動物種別ラベル）。
  const kind = petAnimalTypeLabel(summary.pet.animalType)
  return createPortal(
    <div data-print-sheet="" className={styles.printSheet} aria-hidden="true">
      <p><strong>健康日記 30日のまとめ</strong></p>
      <p>{summary.pet.callName || summary.pet.name}（{kind}{summary.pet.breed ? `・${summary.pet.breed}` : ''}・{summary.pet.ageLabel}）／飼い主 {summary.owner.name}／作成 {formatDay(summary.generatedAt)}</p>
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
