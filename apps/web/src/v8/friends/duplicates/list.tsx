'use client'

/*
 * ★V8 重複検出（Pencil `hn6Y8`、1152 は `G9C4Uw`、状態の見本帳は `SXCb3`）。/friends?tab=duplicates。
 *
 * データの口は今と同じ（/api/duplicates/stats・/api/identity-candidates・再検出）。
 * 見せ方：頭（← 友だちへ・タブ・表示中をCSVで書き出す）→ 案内の帯 → 数4つ →
 * 探す・状態の札・見直した時刻・もう一度見直す → 重複の候補（比べて決める）→ アカウントごとの重なり。
 */
import Link from 'next/link'
import { Download, Info, RotateCw } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import SearchField from '@/components/shared/search-field'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { loadFailureCopy, isForbidden } from '@/components/shared/api-error-message'
import { FriendsSectionHead } from '../shared/head'
import { csvExportLine } from '../list/csv-export'
import { CANDIDATE_PAGE_SIZE, useDuplicatesData } from './use-duplicates-data'
import { CONFIDENCE_WORD, STATUS_FILTERS, STATUS_WORD, confidenceTone, slashDateTime, statusTone } from './words'
import styles from './list.module.css'

export default function DuplicatesListV8() {
  usePageTitle('友だち')
  const d = useDuplicatesData()
  /* 1152 の板（G9C4Uw）は探す欄が狭いので、案内の文を短くする（メールでも探せるのは同じ）。 */
  const narrow = useNarrowViewport()

  const pageCount = Math.max(1, Math.ceil(d.candidateTotal / CANDIDATE_PAGE_SIZE))
  const filtering = !d.unfilteredCandidates
  const counts = d.statusCounts

  const exportVisible = () => {
    const header = ['候補A', '候補B', '確からしさ', '一致した根拠', 'アカウント', '状態', '最終更新']
    const rows = d.candidates.map((candidate) => [
      candidate.left.label,
      candidate.right.label,
      CONFIDENCE_WORD[candidate.confidence.label] ?? candidate.confidence.label,
      candidate.evidenceSummary.join('・'),
      [candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' ／ '),
      STATUS_WORD[candidate.status] ?? candidate.status,
      slashDateTime(candidate.reviewedAt ?? candidate.detectedAt),
    ])
    const csv = [header, ...rows].map((row) => csvExportLine(row)).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `duplicates-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const kpis = [
    {
      key: 'candidates', title: '重複の候補',
      valueText: counts !== null ? `${formatNumber(Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0))}` : d.duplicateTotalText.replace(/組$/, ''),
      unit: '組',
      detail: counts !== null ? `未確認 ${formatNumber(counts.pending ?? 0)}` : d.duplicateDetail,
      help: counts !== null ? `保留 ${formatNumber(counts.deferred ?? 0)}・別人 ${formatNumber(counts.different ?? 0)} を含みます。` : undefined,
    },
    {
      key: 'linked', title: '結び付けた',
      valueText: counts !== null ? formatNumber(counts.linked ?? 0) : '—',
      unit: '組',
      detail: counts !== null ? 'これまで' : '読み込めませんでした',
      help: '統合ユーザーに結び付けた組の数です。',
    },
    {
      key: 'deliveries', title: '重なって届いた配信',
      valueText: '—',
      unit: '',
      detail: '配信実績の接続を待っています',
      help: d.data
        ? `配信の実績を接続したあと、同じ人に2通届いた分をここに出します。いまの見積りは1配信あたり ¥${formatNumber(d.data.wastedPerBroadcastYen)}（¥${formatNumber(d.data.msgUnitYen)}/通）です。`
        : '配信の実績を接続したあと、同じ人に2通届いた分をここに出します。',
    },
    {
      key: 'weak', title: '根拠が足りない',
      valueText: d.lowConfidenceCount !== null ? formatNumber(d.lowConfidenceCount) : '—',
      unit: '組',
      detail: d.lowConfidenceCount !== null ? '名前だけ一致' : '読み込めませんでした',
      help: '名前やプロフィール画像だけが一致していて、決め手が無い組です。',
    },
  ]

  const statsCopy = d.statsFailure ? loadFailureCopy(d.statsFailure, '集計') : null

  return (
    <PageFrame kind="list" boardId="hn6Y8">
      <FriendsSectionHead
        current="duplicates"
        description="同じ人が別のアカウント・別の友だちとして登録されていないかを見ます"
        action={(
          <Button type="button" variant="secondary" onClick={exportVisible} disabled={d.candidates.length === 0}>
            <Download size={14} aria-hidden="true" />
            表示中をCSVで書き出す
          </Button>
        )}
      />
      <div className={styles.body}>
        <p className={styles.band}>
          <Info size={16} aria-hidden="true" />
          <span>自動では結び付けません。確定済みID・連携UID・メール／電話の一致は強い根拠、名前やプロフィール画像だけの一致は参考です。結び付けても元の友だちと履歴は残ります。</span>
        </p>

        <div className={styles.cards}>
          {kpis.map((kpi) => (
            <KpiCard
              key={kpi.key}
              presentation="card"
              icon={null}
              title={kpi.title}
              value={null}
              valueText={kpi.valueText}
              unit={kpi.unit}
              detail={kpi.detail}
              help={kpi.help}
              className={styles.card}
            />
          ))}
        </div>

        {statsCopy && (!d.data || isForbidden(d.statsFailure)) ? (
          <p className={styles.notice} role="status">
            {`${statsCopy.title}。${statsCopy.description}候補一覧は取得済みの内容を表示しています。`}
            {statsCopy.retryable ? <button type="button" className={styles.linkButton} onClick={() => void d.load()}>もう一度</button> : null}
          </p>
        ) : d.error ? (
          <p className={styles.notice} role="status">
            {d.error}
            <button type="button" className={styles.linkButton} onClick={() => void d.load()}>もう一度</button>
          </p>
        ) : null}

        <div className={styles.tools}>
          <div className={styles.search}>
            <SearchField aria-label="名前・メール・電話で探す" value={d.query} onChange={d.setQuery} onClear={() => d.setQuery('')} placeholder={narrow ? '名前・電話で探す' : '名前・メール・電話で探す'} />
          </div>
          {/* 状態は1つだけ選ぶ札（選んだ札は墨の地に白い字・印なし）。 */}
          <div role="group" aria-label="状態で絞り込む" className={styles.chips}>
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.value || 'all'}
                type="button"
                aria-pressed={d.status === filter.value}
                className={d.status === filter.value ? `${styles.chip} ${styles.chipOn}` : styles.chip}
                onClick={() => d.setStatus(filter.value)}
              >
                {filter.label}
              </button>
            ))}
          </div>
          <span className={styles.spacer} />
          {d.data?.computedAt ? <span className={styles.reviewed}>{`${slashDateTime(d.data.computedAt)} に見直した`}</span> : null}
          <Button type="button" variant="secondary" onClick={() => void d.detect()} disabled={d.refreshing} busy={d.refreshing} busyLabel="見直し中…">
            <RotateCw size={14} aria-hidden="true" />
            もう一度見直す
          </Button>
        </div>

        <section className={styles.panel} aria-labelledby="dup-candidates-title">
          <h3 id="dup-candidates-title" className={styles.panelTitle}>重複の候補</h3>
          <DataTable className={styles.table}>
            <colgroup>
              <col />
              <col className={styles.colConfidence} />
              <col className={styles.colEvidence} />
              <col className={styles.colAccount} />
              <col className={styles.colStatus} />
              <col className={styles.colAction} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th className={styles.th}>候補</Th>
                <Th className={styles.th}>確からしさ</Th>
                <Th className={styles.th}>一致した根拠</Th>
                <Th className={styles.th}>アカウント</Th>
                <Th className={styles.th}>状態</Th>
                <Th className={styles.th}><span className="sr-only">操作</span></Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {d.candidateError ? (
                <tr><td colSpan={6} className={styles.stateCell}>
                  <ListState kind="error" title="重複の候補を読み込めませんでした" description="数の帯は「—」のまま、探す・絞り込みはそのまま使えます。" onRetry={() => void d.loadCandidates()} />
                </td></tr>
              ) : d.candidatesLoading && d.candidates.length === 0 ? (
                <tr><td colSpan={6} className={styles.stateCell}><ListState kind="loading" title="読み込んでいます" /></td></tr>
              ) : d.candidates.length === 0 ? (
                <tr><td colSpan={6} className={styles.stateCell}>
                  {filtering ? (
                    <div className={styles.empty}>
                      <ListState kind="empty" title="条件に合う候補はありません" description="「未確認」「保留」「結び付けた」「別人」や検索を外すと、すべて出ます" />
                      <Button type="button" variant="secondary" onClick={d.clearFilters}>条件を外す</Button>
                    </div>
                  ) : (
                    <div className={styles.empty}>
                      <ListState kind="empty" title="重複の候補はありません" description="同じ人が別の友だちとして登録されていそうなときに、ここに出ます。" />
                      <Button type="button" variant="secondary" onClick={() => void d.detect()}>もう一度見直す</Button>
                    </div>
                  )}
                </td></tr>
              ) : d.candidates.map((candidate) => {
                const href = `/friends/identity-candidates?id=${encodeURIComponent(candidate.id)}`
                const accounts = [candidate.left.lineAccountName, candidate.right.lineAccountName].filter(Boolean).join(' ／ ') || '—'
                const evidence = candidate.evidenceSummary.length ? candidate.evidenceSummary.join('・') : '根拠を確認'
                return (
                  <Tr key={candidate.id} className={styles.row}>
                    <Td className={styles.td}>
                      <Link href={href} className={styles.pair} title={`${candidate.left.label} ↔ ${candidate.right.label}`}>
                        {`${candidate.left.label} ↔ ${candidate.right.label}`}
                      </Link>
                    </Td>
                    <Td className={styles.td}>
                      <span className={confidenceTone(candidate.confidence.label) === 'ok' ? `${styles.pill} ${styles.pill_ok}` : `${styles.pill} ${styles.pill_muted}`}>
                        {CONFIDENCE_WORD[candidate.confidence.label] ?? candidate.confidence.label}
                      </span>
                    </Td>
                    <Td className={styles.td}><span className={styles.cellText} title={evidence}>{evidence}</span></Td>
                    <Td className={styles.td}><span className={styles.cellText} title={accounts}>{accounts}</span></Td>
                    <Td className={styles.td}>
                      <span
                        className={statusTone(candidate.status) === 'ok' ? `${styles.pill} ${styles.pill_ok}` : statusTone(candidate.status) === 'warn' ? `${styles.pill} ${styles.pill_warn}` : `${styles.pill} ${styles.pill_muted}`}
                        title={`最終更新 ${slashDateTime(candidate.reviewedAt ?? candidate.detectedAt)}`}
                      >
                        {STATUS_WORD[candidate.status] ?? candidate.status}
                      </span>
                    </Td>
                    <Td className={styles.tdAction}>
                      <Button href={href} variant="secondary">比べて決める</Button>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
          {d.candidateTotal > 0 && !d.candidateError ? (
            <div className={styles.pager}>
              <span className={styles.pagerCount}>{`${formatNumber(d.candidateTotal)}組`}</span>
              <Pagination page={d.page} pageCount={pageCount} onPageChange={d.setPage} disabled={d.candidatesLoading} ariaLabel="重複候補のページ" />
            </div>
          ) : null}
        </section>

        {d.data ? (
          <section className={styles.panel} aria-labelledby="dup-accounts-title">
            <div className={styles.panelHead}>
              <h3 id="dup-accounts-title" className={styles.panelTitle}>アカウントごとの重なり</h3>
              <p className={styles.panelSub}>どのアカウントに重複が偏っているか</p>
            </div>
            {d.data.perAccount.length === 0 ? (
              <p className={styles.panelSub}>アカウントが登録されていません。</p>
            ) : (
              <DataTable className={styles.table}>
                <colgroup>
                  <col />
                  <col className={styles.colNum} />
                  <col className={styles.colNum} />
                  <col className={styles.colNumLast} />
                </colgroup>
                <thead>
                  <TableHeadRow>
                    <Th className={styles.th}>アカウント</Th>
                    <Th className={styles.th}>友だち</Th>
                    <Th className={styles.th}>うち重複</Th>
                    <Th className={styles.th}>重複の割合</Th>
                  </TableHeadRow>
                </thead>
                <tbody>
                  {d.data.perAccount.map((row) => {
                    const rate = Math.round(row.dupRate * 100)
                    return (
                      <Tr key={row.accountId} className={styles.rowCompact}>
                        <Td className={styles.td}><span className={styles.cellText} title={row.accountName}>{row.accountName}</span></Td>
                        <Td className={styles.td}>{formatNumber(row.friends)}</Td>
                        <Td className={styles.td}>{formatNumber(row.dups)}</Td>
                        <Td className={styles.td}><span className={rate >= 10 ? styles.rateHigh : undefined}>{`${rate}%`}</span></Td>
                      </Tr>
                    )
                  })}
                </tbody>
              </DataTable>
            )}
          </section>
        ) : null}

        {d.data && d.data.perAccount.length >= 2 && d.data.pairwiseOverlap ? (
          <section className={styles.panel} aria-labelledby="dup-matrix-title">
            <div className={styles.panelHead}>
              <h3 id="dup-matrix-title" className={styles.panelTitle}>アカウント間 重複マトリクス</h3>
              <p className={styles.panelSub}>同じ人が両方にいる数</p>
            </div>
            <DataTable className={styles.table}>
              <thead>
                <TableHeadRow>
                  <Th className={styles.th}>行 ＼ 列</Th>
                  {d.data.perAccount.map((col) => <Th key={col.accountId} className={styles.th} title={col.accountName}>{col.accountName}</Th>)}
                </TableHeadRow>
              </thead>
              <tbody>
                {d.data.perAccount.map((row) => (
                  <Tr key={row.accountId} className={styles.rowCompact}>
                    <Td className={styles.td}><span className={styles.cellText} title={row.accountName}>{row.accountName}</span></Td>
                    {d.data!.perAccount.map((col) => {
                      if (row.accountId === col.accountId) return <Td key={col.accountId} className={styles.td}><span className={styles.faint}>—</span></Td>
                      const pair = d.data!.pairwiseOverlap!.find((p) => p.fromAccountId === row.accountId && p.toAccountId === col.accountId)
                      return <Td key={col.accountId} className={styles.td}>{formatNumber(pair?.overlap ?? 0)}</Td>
                    })}
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </section>
        ) : null}
      </div>
    </PageFrame>
  )
}
