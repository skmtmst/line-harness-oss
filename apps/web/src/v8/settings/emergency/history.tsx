'use client'

/*
 * ★V8 運用状態 更新履歴（板 I2V65v）。
 *
 * 並び（絵）：数のマス3つ（いまの版・この30日の更新・失敗した更新）→ 版の表（開始・版・どうやって・かかった時間・結果）→
 * 下の行に「自前でデプロイしている環境では…」と「手動アップデートガイドを開く」。
 * 止めた・戻した記録は緊急コントロール（OHwbU）の表で見る。
 * 版は更新履歴ファイル（release-log の要約）、どうやって・結果は配備の記録（運用の履歴の deployment）から引く。
 * 記録が無い値は「—」（0 や成功とは言わない）。
 */
import { useEffect, useMemo, useState } from 'react'
import { ExternalLink, GitBranch, RefreshCw, TriangleAlert } from 'lucide-react'
import Button from '@/components/shared/button'
import { GridTable, GridHeadRow, GridRow, GridCell } from '@/components/shared/grid-table'
import ListState from '@/components/shared/list-state'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import { MANUAL_UPDATE_GUIDE_URL } from '@/components/update/use-update-status'
import releaseLog from '@/generated/release-log-summary.json'
import { api, type OperationHistoryEntry } from '@/lib/api'
import styles from './history.module.css'

type Release = { version: string; released: string | null; entries: Array<{ text: string }> }
type Deployment = NonNullable<OperationHistoryEntry['deployment']>

const HISTORY_FETCH_LIMIT = 200
const DAY = 24 * 60 * 60 * 1000

/** 「10/1 23:58」。release-log の「2026-08-19 15:00」（日本時間・オフセット無し）もそのまま読む。 */
function shortWhen(value: string | null | undefined): string {
  if (!value) return '—'
  const plain = value.match(/^\d{4}-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/)
  if (plain && !/[zZ]|[+-]\d{2}:\d{2}$/.test(value)) return `${Number(plain[1])}/${Number(plain[2])} ${plain[3]}:${plain[4]}`
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = Object.fromEntries(new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date).map((p) => [p.type, p.value]))
  return `${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`
}

function toTime(value: string | null | undefined): number {
  if (!value) return NaN
  return Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value.replace(' ', 'T')}+09:00`)
}

/** 配備した人が仕組み（自動の配備）かどうか。 */
function isAutomatic(deployment: Deployment): boolean {
  return /github|actions|bot|auto|system/i.test(deployment.actor)
}

const RESULT: Record<Deployment['phase'], { label: string; tone: 'good' | 'warn' | 'danger' | 'muted' }> = {
  succeeded: { label: '成功', tone: 'good' },
  failed: { label: '失敗', tone: 'danger' },
  rolled_back: { label: '戻した', tone: 'warn' },
  queued: { label: '待っている', tone: 'muted' },
  deploying: { label: '入れている', tone: 'muted' },
  verifying: { label: '確かめている', tone: 'muted' },
}

/**
 * WEB195：配備の記録は1回の配備につき段階（待っている→入れている→確かめている→成功）ごとに1行ある。
 * 段階を別々の「更新」と数えない。配備ID ごとに、いちばん新しい段階（記録は新しい順）だけを残す。
 */
export function latestDeploymentPhases(deployments: Deployment[]): Deployment[] {
  const seen = new Set<string>()
  const latest: Deployment[] = []
  for (const deployment of deployments) {
    const key = deployment.deploymentId || `${deployment.version ?? ''}|${deployment.occurredAt}`
    if (seen.has(key)) continue
    seen.add(key)
    latest.push(deployment)
  }
  return latest
}

/** 配備の口を正にし、版の文書に無い配備も落とさない。文書だけの版も残す。 */
export function historyRows(releases: Release[], deployments: Deployment[]) {
  const latest = latestDeploymentPhases(deployments)
  const used = new Set<string>()
  const rows = latest.map((deployment) => {
    const version = deployment.version?.replace(/^v/, '') ?? '—'
    used.add(version)
    const release = releases.find((item) => item.version.replace(/^v/, '') === version)
      ?? { version, released: deployment.occurredAt, entries: [] }
    return { release, deployment: deployment as Deployment | null }
  })
  rows.push(...releases.filter((item) => !used.has(item.version.replace(/^v/, ''))).map((release) => ({ release, deployment: null })))
  return rows.sort((a, b) => (toTime(b.deployment?.occurredAt ?? b.release.released) || 0) - (toTime(a.deployment?.occurredAt ?? a.release.released) || 0)).slice(0, 10)
}

/** WEB194：表の「結果」。配備の記録が無い・読めないときに「反映済み（成功）」と言わない。 */
export function releaseResult(deployment: Deployment | null, historyState: 'loading' | 'ready' | 'error'): { label: string; tone: 'good' | 'warn' | 'danger' | 'muted' } {
  if (deployment) return RESULT[deployment.phase]
  if (historyState === 'error') return { label: '確認できません', tone: 'muted' }
  if (historyState === 'loading') return { label: '—', tone: 'muted' }
  return { label: '配備の記録なし', tone: 'muted' }
}

export default function UpdateHistoryV8() {
  const [history, setHistory] = useState<OperationHistoryEntry[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    api.operations.history(HISTORY_FETCH_LIMIT)
      .then((response) => {
        if (cancelled) return
        if (response.success && Array.isArray(response.data)) { setHistory(response.data); setState('ready') } else setState('error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [])

  const releases = useMemo(() => ((releaseLog as { releases?: Release[] }).releases ?? []).filter((item) => item.released), [])
  const deployments = useMemo(() => latestDeploymentPhases(history.flatMap((item) => (item.historyKind === 'deployment' && item.deployment ? [item.deployment] : []))), [history])

  const now = Date.now()
  const recent = deployments.filter((d) => now - toTime(d.occurredAt) <= 30 * DAY)
  const recentReleases = releases.filter((r) => now - toTime(r.released) <= 30 * DAY)
  const current = deployments.find((d) => d.phase === 'succeeded' && d.version)?.version?.replace(/^v/, '') ?? releases[0]?.version ?? null
  const currentAt = deployments.find((d) => d.phase === 'succeeded' && d.version)?.occurredAt ?? releases[0]?.released ?? null
  const auto = recent.filter(isAutomatic).length
  const failed = recent.filter((d) => d.phase === 'failed' || d.phase === 'rolled_back').length
  const ready = state === 'ready'

  const rows = historyRows(releases, deployments)

  return (
    <div className={styles.board}>
      <div className={styles.kpis} aria-label="更新の集計">
        <div className={styles.kpi}>
          <div className={styles.kpiHead}><span className={styles.kpiTile} aria-hidden="true"><GitBranch size={14} /></span><span className={styles.kpiLabel}>いまの版</span></div>
          <p className={styles.kpiValue}>{current ? `v${current}` : '—'}</p>
          <p className={styles.kpiDetail}>{currentAt ? `${shortWhen(currentAt)} に更新` : '更新の記録なし'}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}><span className={styles.kpiTile} aria-hidden="true"><RefreshCw size={14} /></span><span className={styles.kpiLabel}>この30日の更新</span></div>
          <p className={styles.kpiValue}>{ready ? Math.max(recent.length, recentReleases.length) : '—'}<span className={styles.kpiUnit}>回</span></p>
          <p className={styles.kpiDetail}>{ready ? (recent.length > 0 ? `自動 ${auto}・手動 ${recent.length - auto}` : '配備の記録なし（版の記録から）') : '読み込み中'}</p>
        </div>
        <div className={styles.kpi}>
          <div className={styles.kpiHead}><span className={styles.kpiTile} aria-hidden="true"><TriangleAlert size={14} /></span><span className={styles.kpiLabel}>失敗した更新</span></div>
          <p className={`${styles.kpiValue} ${failed > 0 ? styles.kpiValueDanger : ''}`}>{ready ? failed : '—'}<span className={styles.kpiUnit}>回</span></p>
          <p className={styles.kpiDetail}>この30日</p>
        </div>
      </div>

      {state === 'error' ? (
        <ListState kind="error" title="更新の記録を読み込めませんでした" description="版の一覧は出しています。どうやって・結果は読み直すと出ます。" />
      ) : null}

      {rows.length === 0 ? (
        <ListState kind="empty" title="更新の記録はまだありません" />
      ) : (
        <GridTable label="管理画面の更新" design={{ columns: 'var(--sett-history-columns)', gap: 'var(--tpl-rest3-uh-gap)', rowPadding: 'var(--tpl-rest3-uh-row-pad)', rowHeight: 'var(--tpl-rest3-uh-row-h)', headHeight: 'var(--tpl-rest3-uh-head-h)', fontSize: 'var(--tpl-rest3-em-body)', lineHeight: 'var(--tpl-rest3-em-td-lh)', headFontSize: 'var(--tpl-rest3-em-th)', headLineHeight: 'var(--tpl-rest3-em-th-lh)', headColor: 'var(--color-ink-faint)', headBackground: 'var(--color-surface-pearl)' }} className={styles.table}>
          <div role="rowgroup">
            <GridHeadRow>
              <GridCell role="columnheader">開始</GridCell>
              <GridCell role="columnheader">版</GridCell>
              <GridCell role="columnheader">どうやって</GridCell>
              <GridCell role="columnheader" className={styles.num}>かかった時間</GridCell>
              <GridCell role="columnheader">結果</GridCell>
            </GridHeadRow>
          </div>
          <div role="rowgroup">
            {rows.map(({ release, deployment }) => {
              const result = releaseResult(deployment, state)
              const title = `v${release.version} ${release.entries[0]?.text ?? ''}`.trim()
              return (
                <GridRow key={deployment?.deploymentId || `${release.version}|${deployment?.occurredAt ?? release.released}`}>
                  <GridCell role="cell" className={styles.cell}>{shortWhen(deployment?.occurredAt ?? release.released)}</GridCell>
                  <GridCell role="cell" className={`${styles.cell} ${styles.strong}`} title={title}>{title}</GridCell>
                  <GridCell role="cell" className={styles.cell}>{deployment ? (isAutomatic(deployment) ? '自動' : '手動') : '—'}</GridCell>
                  <GridCell role="cell" className={`${styles.cell} ${styles.num}`}>—</GridCell>
                  <GridCell role="cell" className={styles.judge}><StatusBadge tone={({ good: 'success', warn: 'warning', danger: 'danger', muted: 'neutral' } as Record<string, StatusBadgeTone>)[result.tone]}>{result.label}</StatusBadge></GridCell>
                </GridRow>
              )
            })}
          </div>
        </GridTable>
      )}

      <div className={styles.foot}>
        <p className={styles.footText}>自前でデプロイしている環境では、手動アップデートガイドの手順で更新します。</p>
        <Button external href={MANUAL_UPDATE_GUIDE_URL}  >手動アップデートガイドを開く</Button>
      </div>
    </div>
  )
}
