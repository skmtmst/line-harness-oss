'use client'

/*
 * ★V8 統括 一括配信の詳細（提案 E-9 `xOXuY`「⑤ 送った結果」）。
 *
 * 店ごとの送った・成功・失敗・状態と、失敗した店へのやり直し（retry）。予約中・送っている間は止める（stop）、
 * 送る前（下書き）・予約中は取り消す（cancel）。下書きは店ごとの確かめを見て、そのまま送れる（send）。
 * 送った LINE は取り消せない。動きは BEHAVIOR.md。
 */
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Ban, CirclePause, RotateCcw, Send } from 'lucide-react'
import type { HqBroadcastRun } from '@line-crm/shared'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import StatusBadge from '@/components/shared/status-badge'
import { RowActions } from '@/components/shared/row-actions'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { notifyToast } from '@/components/shared/toast'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ApiError } from '@/lib/api'
import { hqBroadcastsApi } from '@/lib/hq-broadcasts-api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { type ResultTarget, canRetry, failedCount, jpDateTime, preflightBadge, resultBadge, runBadge, sendTotals } from './model'
import styles from './detail.module.css'

const n = (value: number) => value.toLocaleString('ja-JP')

type Ask = { kind: 'send' | 'stop' | 'cancel' | 'retry-all' } | { kind: 'retry'; target: ResultTarget }

function errorText(caught: unknown, fallback: string): string {
  if (caught instanceof ApiError) {
    if (caught.status === 409) return caught.message || 'ほかの人が先に操作しました。読み直してください。'
    if (caught.status === 403) return '統括全体の編集権限がある人だけが操作できます。'
    if (caught.message) return caught.message
  }
  return fallback
}

/** ⑤ 送った結果（店ごと）。 */
export function ResultCard({ run, canManage, onRetry, onRetryAll }: {
  run: HqBroadcastRun
  canManage: boolean
  onRetry: (t: ResultTarget) => void
  onRetryAll: () => void
}) {
  const sentTo = run.targets.filter((t) => !t.excluded)
  const success = sentTo.reduce((sum, t) => sum + (t.successCount ?? 0), 0)
  const failed = sentTo.reduce((sum, t) => sum + failedCount(t), 0)
  const retryable = run.targets.filter((t) => canRetry(run, t))
  return (
    <section className={styles.card} aria-labelledby="hq-bc-result">
      <div className={styles.cardHead}>
        <div className={styles.cardText}>
          <h2 id="hq-bc-result" className={styles.cardTitle}>⑤ 送った結果</h2>
          <p className={styles.cardSub}>{`${jpDateTime(run.scheduledAt)} ・ ${n(sentTo.length)}店に送信 ・ 成功 ${n(success)}人 ・ 失敗 ${n(failed)}人`}</p>
        </div>
        {canManage && retryable.length > 0 ? (
          <Button onClick={onRetryAll}><RotateCcw size={15} aria-hidden="true" />失敗した店にやり直す</Button>
        ) : null}
      </div>
      <DataTable className={styles.table} data-design="hq-broadcast-result">
        <thead>
          <TableHeadRow className={styles.headRow}>
            <Th className={styles.colStore}>店</Th>
            <Th className={styles.colNum}>送った</Th>
            <Th className={styles.colNum}>成功</Th>
            <Th className={styles.colFail}>失敗</Th>
            <Th className={styles.colState}>状態</Th>
            <Th className={styles.colMenu}><span className="sr-only">操作</span></Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {run.targets.map((t) => {
            const badge = resultBadge(t)
            const off = t.excluded || t.status === 'excluded'
            const fail = failedCount(t)
            return (
              <Tr key={t.accountId} className={styles.row}>
                <Td className={styles.colStore}><span className={styles.store} title={t.accountName}>{t.accountName}</span></Td>
                <Td className={styles.colNum}><span className={styles.num}>{off ? '—' : n(t.totalCount ?? 0)}</span></Td>
                <Td className={styles.colNum}><span className={styles.num}>{off ? '—' : n(t.successCount ?? 0)}</span></Td>
                <Td className={styles.colFail}><span className={off ? styles.faint : fail > 0 ? styles.numStrong : styles.faint}>{off ? '—' : n(fail)}</span></Td>
                <Td className={styles.colState}><StatusBadge tone={badge.tone} title={t.blockedReasons.join('・') || undefined}>{badge.label}</StatusBadge></Td>
                <Td className={styles.colMenu}>
                  {canManage && canRetry(run, t) ? (
                    <RowActions subjectName={t.accountName} menuItems={[{ id: 'retry', label: 'この店にやり直す', onSelect: () => onRetry(t) }]} />
                  ) : null}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </section>
  )
}

/** 下書き（送る前）の店ごとの確かめ。preflight の結果（固定した対象に入っている）を出す。 */
function PreparedCard({ run }: { run: HqBroadcastRun }) {
  const totals = sendTotals(run.targets)
  return (
    <section className={styles.card} aria-labelledby="hq-bc-prepared">
      <div className={styles.cardHead}>
        <div className={styles.cardText}>
          <h2 id="hq-bc-prepared" className={styles.cardTitle}>送る前の確かめ</h2>
          <p className={styles.cardSub}>{`送る：${n(totals.sendStores)}店・${n(totals.sendPeople)}人 ・ 外す：${n(totals.skipStores)}店・${n(totals.skipPeople)}人`}</p>
        </div>
      </div>
      <DataTable className={styles.table} data-design="hq-broadcast-prepared">
        <thead>
          <TableHeadRow className={styles.headRow}>
            <Th className={styles.colStore}>店</Th>
            <Th className={styles.colNum}>送る人数</Th>
            <Th className={styles.colNum}>送信枠の残り</Th>
            <Th className={styles.colState}>確かめ</Th>
            <Th className={styles.colFail}>送るか</Th>
          </TableHeadRow>
        </thead>
        <tbody>
          {run.targets.map((t) => {
            const badge = preflightBadge(t)
            const go = !t.excluded && t.blockedReasons.length === 0
            return (
              <Tr key={t.accountId} className={styles.row}>
                <Td className={styles.colStore}><span className={styles.store} title={t.accountName}>{t.accountName}</span></Td>
                <Td className={styles.colNum}><span className={styles.num}>{t.audienceCount === null ? '—' : `${n(t.audienceCount)}人`}</span></Td>
                <Td className={styles.colNum}><span className={styles.faint}>{t.remaining === null ? '—' : `${n(t.remaining)}通`}</span></Td>
                <Td className={styles.colState}><StatusBadge tone={badge.tone} title={t.blockedReasons.join('・') || undefined}>{badge.label}</StatusBadge></Td>
                <Td className={styles.colFail}><StatusBadge tone={go ? 'success' : 'neutral'}>{go ? '送る' : '外す'}</StatusBadge></Td>
              </Tr>
            )
          })}
        </tbody>
      </DataTable>
    </section>
  )
}

export default function HqBroadcastDetail() {
  usePageTitle('一括配信の詳細')
  usePageCrumbs([{ label: '一括配信', href: '/hq/broadcasts' }])
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const role = useStaffRole()
  const canManage = role === null || canManageRole(role)
  const [run, setRun] = useState<HqBroadcastRun | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!id) return
    try {
      const res = await hqBroadcastsApi.get(id)
      setRun(res.data); setLoadError(null)
    } catch (caught) {
      setLoadError(caught)
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  /* 送っている間は 15 秒ごとに読み直す（店ごとの数が増えていく）。 */
  useEffect(() => {
    if (!run || !run.targets.some((t) => t.status === 'sending' || t.status === 'scheduled')) return
    const timer = setInterval(() => { void load() }, 15_000)
    return () => clearInterval(timer)
  }, [run, load])

  const act = async () => {
    if (!run || !ask) return
    setBusy(true); setError('')
    try {
      if (ask.kind === 'send') {
        /* 送る直前にもう一度確かめる（下書きのあいだに枠・接続が変わる）。問題が出たら口が 409 で止める。 */
        await hqBroadcastsApi.preflight(run.id)
        await hqBroadcastsApi.send(run.id, run.version)
        notifyToast(run.scheduledAt ? '一括配信を予約しました' : '一括配信を送り始めました')
      } else if (ask.kind === 'stop') {
        await hqBroadcastsApi.stop(run.id, run.version)
        notifyToast('一括配信を止めました。まだ送っていない分は送りません')
      } else if (ask.kind === 'cancel') {
        await hqBroadcastsApi.cancel(run.id, run.version)
        notifyToast('一括配信を取り消しました')
      } else if (ask.kind === 'retry') {
        await hqBroadcastsApi.retry(run.id, ask.target.accountId, ask.target.version)
        notifyToast(`${ask.target.accountName}にやり直しています`)
      } else {
        const targets = run.targets.filter((t) => canRetry(run, t))
        const failures: string[] = []
        for (const t of targets) {
          try { await hqBroadcastsApi.retry(run.id, t.accountId, t.version) } catch { failures.push(t.accountName) }
        }
        if (failures.length) setError(`やり直せなかった店があります：${failures.join('・')}。読み直してから、店ごとに「…」でやり直してください。`)
        else notifyToast(`${n(targets.length)}店にやり直しています`)
      }
      setAsk(null)
      await load()
    } catch (caught) {
      setAsk(null)
      setError(errorText(caught, '操作できませんでした。もう一度お試しください。'))
      await load()
    } finally {
      setBusy(false)
    }
  }

  let body
  if (!id) body = <Notice tone="warn">一括配信が選ばれていません。一括配信の一覧から開いてください。</Notice>
  else if (loadError && !run) body = <ListState kind="error" error={loadError} onRetry={() => void load()} />
  else if (!run) body = <ListState kind="loading" />
  else body = run.status === 'prepared'
    ? <PreparedCard run={run} />
    : <ResultCard run={run} canManage={canManage} onRetry={(t) => setAsk({ kind: 'retry', target: t })} onRetryAll={() => setAsk({ kind: 'retry-all' })} />

  const badge = run ? runBadge(run) : null
  /* 全体の状態は送ったあとも scheduled のまま（口の作り）。止める・取り消すは、まだ送っている・予約中の店があるときだけ。 */
  const live = !!run && run.status !== 'cancelled' && run.targets.some((t) => !t.excluded && (t.status === 'scheduled' || t.status === 'sending'))
  const totals = run ? sendTotals(run.targets) : null

  const confirmText: Record<Ask['kind'], { title: string; description: string; label: string }> = {
    send: { title: `${n(totals?.sendStores ?? 0)}店に送ります`, description: `${n(totals?.sendPeople ?? 0)}人に送ります。送った LINE は取り消せません。`, label: '送る' },
    stop: { title: '一括配信を止めます', description: 'まだ送っていない店・人には送りません。送った LINE は取り消せません。止めたあと、店ごとにやり直せます。', label: '止める' },
    cancel: { title: '一括配信を取り消します', description: '取り消すと、どの店にも送らず、やり直しもできません。送った LINE は取り消せません。', label: '取り消す' },
    retry: { title: 'この店にやり直します', description: '一時的に失敗した人と、止める前に送れなかった人にだけ送ります。届いた人には二重に送りません。', label: 'やり直す' },
    'retry-all': { title: '失敗した店にやり直します', description: '一時的に失敗した人と、止める前に送れなかった人にだけ送ります。届いた人には二重に送りません。', label: 'やり直す' },
  }

  return (
    <>
      <PageFrame kind="detail" boardId="xOXuY">
        <PageHeading
          headingSize="compact"
          title={run?.title ?? '一括配信'}
          description={run ? `${run.scheduledAt ? jpDateTime(run.scheduledAt) : 'すぐ送る'} ・ ${n(run.targets.filter((t) => !t.excluded).length)}店` : undefined}
          identity={badge ? <StatusBadge tone={badge.tone}>{badge.label}</StatusBadge> : undefined}
          actions={canManage && run ? (
            <>
              {run.status === 'prepared' || (live && run.status !== 'stopped') ? (
                <Button variant="danger" onClick={() => setAsk({ kind: 'cancel' })}><Ban size={15} aria-hidden="true" />取り消す</Button>
              ) : null}
              {live && run.status !== 'stopped' ? (
                <Button onClick={() => setAsk({ kind: 'stop' })}><CirclePause size={15} aria-hidden="true" />止める</Button>
              ) : null}
              {run.status === 'prepared' ? (
                <Button variant="primary" onClick={() => setAsk({ kind: 'send' })} disabled={(totals?.sendStores ?? 0) === 0} title={(totals?.sendStores ?? 0) === 0 ? '送れる店がありません' : undefined}>
                  <Send size={15} aria-hidden="true" />{`${n(totals?.sendStores ?? 0)}店に送る`}
                </Button>
              ) : null}
            </>
          ) : undefined}
        />
        <div className={styles.body}>
          {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
          {body}
        </div>
      </PageFrame>
      {ask ? (
        <ConfirmDialog
          open
          title={confirmText[ask.kind].title}
          description={confirmText[ask.kind].description}
          confirmLabel={confirmText[ask.kind].label}
          destructive={ask.kind === 'cancel' || ask.kind === 'stop'}
          warning={ask.kind === 'send'}
          busy={busy}
          onConfirm={() => void act()}
          onCancel={() => setAsk(null)}
        />
      ) : null}
    </>
  )
}
