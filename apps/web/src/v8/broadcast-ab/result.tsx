'use client'

import KpiBand from '@/components/shared/kpi-band'
import KpiCard from '@/components/shared/kpi-card'

import { useCallback, useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { notifySaved } from '@/components/shared/toast'
import { describeApiFailure } from '@/components/shared/api-error-message'
import { formatNumber } from '@/lib/format'
import { broadcastAbApi, type AbResult, type AbStatus, type AbVariantResult } from './api'
import { METRIC_WORD, hm, mdwhm } from './model'
import styles from './ab.module.css'

/*
 * 一斉配信の詳細・概要の区画「A/B の結果」（★V8 n4kwM 勝ちが決まった・Eoi7q 決められない。要件 G1 AB-03〜AB-07・AB-22・AB-25）。
 * 決められないときは［A を送る］［B を送る］［送らずに終える］。送る前に確かめの窓（取り消せません）。閲覧のみ・代理ログインには出さない。
 */

/** 詳細の頭の札（状態を分ける：試し中・選んでください・残りへ送信中・送信済み）。 */
export function abStatusDefinition(result: AbResult | null): { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' } | null {
  if (!result) return null
  const map: Record<AbStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' } | null> = {
    draft: null,
    testing: { label: '試し中', tone: 'info' },
    decided: result.remainder.sentAt ? { label: '送信済み', tone: 'success' } : { label: '残りへ送信中', tone: 'info' },
    undecided: { label: '選んでください', tone: 'warning' },
    finished: { label: '送信済み', tone: 'success' },
    expired: { label: '期限切れ', tone: 'neutral' },
  }
  return map[result.status]
}

export function useAbResult(broadcastId: string | null) {
  const [result, setResult] = useState<AbResult | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'none' | 'error'>('idle')
  const load = useCallback(async () => {
    if (!broadcastId) return
    setState('loading')
    try {
      const res = await broadcastAbApi.result(broadcastId)
      if (!res.success) throw new Error('ab result failed')
      /* A/B を使っていない配信は区画を出さない（口は 404 か data:null）。 */
      if (!res.data) { setResult(null); setState('none'); return }
      setResult(res.data)
      setState('ready')
    } catch (caught) {
      /* A/B を使っていない配信は 404。区画を出さない。 */
      if ((caught as { status?: number })?.status === 404) { setResult(null); setState('none'); return }
      setState('error')
    }
  }, [broadcastId])
  useEffect(() => { void load() }, [load])
  return { result, state, reload: load }
}

const pct = (value: number | null) => (value === null ? '—（取得待ち）' : `${(value * 100).toFixed(1)}%`)
const count = (value: number | null, unit: string) => (value === null ? '—（取得待ち）' : `${formatNumber(value)} ${unit}`)

function Variant({ variant, winner, metric }: { variant: AbVariantResult; winner: boolean; metric: AbResult['metric'] }) {
  return (
    <div className={styles.variant} data-winner={winner || undefined}>
      <div className={styles.variantHead}>
        <span className={styles.variantTitle} title={variant.label ?? undefined}>{`${variant.key} 案${variant.label ? `：${variant.label}` : ''}`}</span>
        {winner ? <StatusBadge tone="success" dot>勝ち</StatusBadge> : null}
      </div>
      <KpiBand maxColumns={2}>
        <KpiCard detail="" presentation="band" title="送った" value={variant.sent} unit="人" />
        <KpiCard detail="" presentation="band" title="クリック率" valueText={pct(variant.clickRate)} value={null} unit="" />
        <KpiCard detail="" presentation="band" title={metric === 'purchase' ? '購入' : '予約'} valueText={metric === 'purchase' ? count(variant.purchases, '件') : count(variant.bookings, '件')} value={null} unit="" />
      </KpiBand>
    </div>
  )
}

export default function BroadcastAbResult({ broadcastId, ab, canSend }: { broadcastId: string; ab: ReturnType<typeof useAbResult>; canSend: boolean }) {
  const [choose, setChoose] = useState<'A' | 'B' | 'none' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [key, setKey] = useState('')
  if (ab.state === 'none' || ab.state === 'idle') return null
  const result = ab.result
  const open = (variant: 'A' | 'B' | 'none') => { setError(''); setKey(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `ab-${Date.now()}`); setChoose(variant) }
  const run = async () => {
    if (!choose || !result) return
    setBusy(true)
    setError('')
    try {
      const res = await broadcastAbApi.choose(broadcastId, choose, result.remainder.count, key)
      if (!res.success) throw new Error('choose failed')
      notifySaved(choose === 'none' ? '送らずに終えました' : `残りの人へ ${choose} 案を送ります`)
      setChoose(null)
      await ab.reload()
    } catch (caught) {
      /* 409：ほかの人がもう選んだ・自動で決まった。読み直して今の状態を出す。 */
      setError(describeApiFailure(caught, '送る操作'))
      await ab.reload()
    } finally {
      setBusy(false)
    }
  }
  const metricLine = result ? `勝ちの決め方：${METRIC_WORD[result.metric]} ・ ${result.status === 'undecided' ? `${result.decideAfterMinutes / 60} 時間たっても差が小さく決められない` : `${result.decideAfterMinutes / 60} 時間で決めた`}` : ''
  const winner = result?.winner ? result.variants.find((variant) => variant.key === result.winner) : null
  return (
    <section className={styles.resultCard} aria-labelledby="ab-result-title" data-design-node={result?.status === 'undecided' ? 'Eoi7q' : 'n4kwM'}>
      <div className={styles.settingsHead}>
        <h3 id="ab-result-title" className={styles.title}>A/B の結果</h3>
        <HelpTip label="A/B の結果の説明">試しの数は送れた人で数えます。購入の数が EC から届いていないときは「取得待ち」と出し、0 とは数えません。勝ちは確からしさ 95% 以上・差が 1 ポイント以上のときだけ決めます。</HelpTip>
        <span className={styles.spacer} />
        {result ? <span className={styles.note}>{metricLine}</span> : null}
      </div>
      {result?.testMode ? <p className={styles.note}>今は試しの送信です（本物の LINE には送っていません）。</p> : null}
      {ab.state === 'error' ? (
        <Notice tone="danger" action={<Button onClick={() => void ab.reload()}>もう一度試す</Button>}>結果を読めませんでした。</Notice>
      ) : !result ? <p className={styles.note} role="status">読み込んでいます…</p> : (
        <>
          {result.status === 'testing' && result.variants.every((variant) => variant.sent === 0) ? (
            <p className={styles.note}>{`まだ結果がありません（${result.decideAt ? hm(new Date(result.decideAt)) : '—'} に決まります）`}</p>
          ) : (
            <div className={styles.variants}>
              {result.variants.map((variant) => <Variant key={variant.key} variant={variant} metric={result.metric} winner={result.winner === variant.key} />)}
            </div>
          )}
          {result.status === 'decided' || result.status === 'finished' ? (
            winner ? (
              <p className={styles.doneBand}><Check aria-hidden="true" className={styles.infoIcon} />{`${result.fallback ? '決められなかったため A 案を送りました' : `${winner.key} 案が勝ちました（${METRIC_WORD[result.metric]}${result.metric === 'click' ? `率 ${pct(winner.clickRate)}` : ''}）`}。残りの ${formatNumber(result.remainder.count)} 人へ ${result.remainder.sentAt ? `${hm(new Date(result.remainder.sentAt))} に送りました` : `${result.remainder.scheduledAt ? hm(new Date(result.remainder.scheduledAt)) : '—'} に送ります`}。`}</p>
            ) : <p className={styles.note}>送らずに終えました。</p>
          ) : result.status === 'undecided' ? (
            <div className={styles.chooseBand}>
              <span className={styles.chooseText}>{`残りの ${formatNumber(result.remainder.count)} 人へ送る案を選んでください。${mdwhm(result.chooseUntil)} までに選ばなければ、送らずに終えます。`}</span>
              {canSend ? <>
                <Button onClick={() => open('A')}>A を送る</Button>
                <Button onClick={() => open('B')}>B を送る</Button>
                <Button variant="text" onClick={() => open('none')}>送らずに終える</Button>
              </> : null}
            </div>
          ) : result.status === 'expired' ? (
            <p className={styles.note}>期限までに選ばれなかったため、送らずに終えました。</p>
          ) : result.status === 'testing' ? (
            <p className={styles.note}>{`試し中です。${result.decideAt ? hm(new Date(result.decideAt)) : '—'} に勝ちを決めます。`}</p>
          ) : null}
        </>
      )}
      <ConfirmDialog
        open={choose !== null}
        title={choose === 'none' ? '送らずに終えますか？' : `残りの人へ ${choose} 案を送りますか？`}
        description={choose === 'none'
          ? `残りの ${formatNumber(result?.remainder.count ?? 0)} 人には送りません。終えたあとは戻せません。`
          : `残りの ${formatNumber(result?.remainder.count ?? 0)} 人へ ${choose} 案を送ります。送信は取り消せません。`}
        confirmLabel={choose === 'none' ? '送らずに終える' : `${formatNumber(result?.remainder.count ?? 0)} 人に送る`}
        busy={busy}
        busyLabel="送っています…"
        error={error || undefined}
        onCancel={() => { if (!busy) setChoose(null) }}
        onConfirm={() => void run()}
      />
    </section>
  )
}
