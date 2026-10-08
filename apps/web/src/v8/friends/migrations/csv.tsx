'use client'

/*
 * ★V8 CSVで書き出す・取り込む（Pencil `T9gblG`）。/friends/migrations。
 *
 * 手順・API は今と同じ（書き出しを作る → 取り込みは「まず確認だけ」→ 内訳を見て反映）。
 * 見せ方：頭（← 友だちへ・タブ）→ 案内 → 書き出す／取り込むの2枚 → 確認の結果 → 履歴。
 * 確認の結果は、確認する前も場所と5つの区分を出しておく（数は「—」）。
 */
import { Download, FileSearch, Info } from 'lucide-react'
import { formatNumber } from '@/lib/format'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import HelpTip from '@/components/shared/help-tip'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { FriendsSectionHead } from '../shared/head'
import { slashDateTime } from '../duplicates/words'
import { csvExportLine } from '../list/csv-export'
import { formatImportBytes, JOB_STATUS_LABELS, MANAGE_FORBIDDEN, useFriendMigrations } from './use-friend-migrations'
import styles from './migrations.module.css'

const COLUMN_CHOICES = [
  ['basic', '基本（LINEユーザーID・表示名・本名・登録日）', false],
  ['tags_fields', 'タグ・友だち情報（まだ書き出せません）', true],
  ['support', '対応状況・対応マーク・担当者（まだ書き出せません）', true],
] as const

export default function CsvMigrationsV8() {
  usePageTitle('友だち')
  const m = useFriendMigrations()
  const reflectable = m.summary ? m.summary.add + m.summary.update : 0
  const blocked = m.summary ? m.summary.conflict + m.summary.error > 0 : true

  /* 頭の「表示中をCSVで書き出す」：いま出ている履歴の表を CSV にする（友だちの情報は含まない）。 */
  const exportHistory = () => {
    const header = ['日時', '種類', '対象', '件数', 'した人', '状態']
    const rows = m.jobs.map((job) => [
      slashDateTime(job.created_at),
      job.kind === 'export' ? '書き出し' : '取り込み',
      m.accounts.find((account) => account.id === job.line_account_id)?.name ?? '',
      String(job.row_count ?? job.total_count ?? ''),
      job.created_by_name,
      JOB_STATUS_LABELS[job.status] ?? '確認中',
    ])
    const csv = [header, ...rows].map((row) => csvExportLine(row)).join('\n')
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `friend-migration-history-${new Date().toISOString().slice(0, 10)}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const body = m.status === 'loading' ? (
    <ListState kind="loading" title="書き出し・取り込みを読み込んでいます" />
  ) : m.status === 'forbidden' ? (
    <ListState kind="forbidden" title="書き出し・取り込みを見る権限がありません" description="見るには権限が要ります。オーナーか管理者の方に確認してください。" />
  ) : m.status === 'error' ? (
    <ListState kind="error" title="書き出し・取り込みを表示できませんでした" description="履歴は消えていません。" onRetry={() => void m.load()} />
  ) : (
    <>
      <p className={styles.band}>
        <Info size={16} aria-hidden="true" />
        <span>書き出しても友だちの情報は変わりません。取り込みは、まず確認だけをします（追加・更新・変更なし・競合・エラーの内訳）。</span>
      </p>

      <div className={styles.pair}>
        <section className={styles.card} aria-labelledby="csv-export-title">
          <h3 id="csv-export-title" className={styles.cardTitle}>CSVで書き出す</h3>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>アカウント</span>
            <Select
              aria-label="書き出すLINEアカウント"
              size="full"
              value={m.accountId}
              onChange={m.setAccountId}
              options={[{ value: '', label: 'アカウントを選択' }, ...m.accounts.map((account) => ({ value: account.id, label: account.name }))]}
            />
          </div>
          <fieldset className={styles.fieldset}>
            <legend className={styles.fieldLabel}>
              書き出す項目
              <HelpTip label="書き出す項目の説明">基本はLINEユーザーID・LINE表示名・本名・システム表示名・登録日の5列です。この5列はそのまま取り込めます。タグ・友だち情報、対応情報はまだ書き出せません。</HelpTip>
            </legend>
            {COLUMN_CHOICES.filter(([value]) => value !== 'support').map(([value, label, unavailable]) => (
              <Checkbox key={value} checked={m.columns.includes(value)} onCheckedChange={() => m.toggleColumn(value)} disabled={unavailable}>
                {label}
              </Checkbox>
            ))}
          </fieldset>
          <p className={styles.small} title="Shift_JISの書き出しはまだ使えません">文字コード：UTF-8</p>
          {m.manageLocked ? <p className={styles.small}>{MANAGE_FORBIDDEN}</p> : null}
          <div className={styles.cardFoot}>
            {m.exportResult ? (
              <a className={styles.link} href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}${m.exportResult.downloadUrl}`}>
                {`CSVをダウンロード（${m.exportResult.rowCount ?? '—'}件）`}
              </a>
            ) : null}
            {/* 変えられない人には押せないボタンを置かない（理由は上の1行）。 */}
            {m.manageLocked ? null : (
              <Button variant="primary" disabled={m.busy} busy={m.busy && !m.summary} onClick={() => void m.createExport()} title="件数が多いときは、できあがったらお知らせします。ダウンロードできる期間は7日です。">
                <Download size={14} aria-hidden="true" />
                書き出しを作る
              </Button>
            )}
          </div>
        </section>

        <section className={styles.card} aria-labelledby="csv-import-title">
          <h3 id="csv-import-title" className={styles.cardTitle}>CSVを取り込む</h3>
          <FileDropzone
            className={styles.drop}
            title="ここにCSVを置く"
            hint="このシステムから書き出したUTF-8のCSV・5MBまで"
            accept=".csv,text/csv"
            onFiles={(files) => void m.onPickFile(files[0] ?? null)}
          />
          {m.file ? (
            <AttachmentRow name={m.file.name} meta={`${formatNumber(m.rows.length)}行・${formatImportBytes(m.file.size)}`} onRemove={() => void m.onPickFile(null)} />
          ) : null}
          <p className={styles.small}>同じファイルをもう一度入れても、二重には反映しません。</p>
          {m.manageLocked ? <p className={styles.small}>{MANAGE_FORBIDDEN}</p> : null}
          <div className={styles.cardFoot}>
            {m.manageLocked ? null : (
              <Button variant="primary" disabled={m.busy || !m.file} onClick={() => void m.previewImport()}>
                <FileSearch size={14} aria-hidden="true" />
                まず確認だけする
              </Button>
            )}
          </div>
        </section>
      </div>

      {m.message ? <p role="status" className={styles.message}>{m.message}</p> : null}

      <section className={styles.card} aria-labelledby="csv-result-title">
        <div className={styles.cardHead}>
          <h3 id="csv-result-title" className={styles.cardTitle}>{m.summary && m.file ? `確認の結果：${m.file.name}` : '確認の結果'}</h3>
          <p className={styles.cardSub}>{m.summary ? 'まだ友だち情報は変えていません' : 'CSVを選んで「まず確認だけする」を押すと、ここに内訳が出ます'}</p>
        </div>
        <div className={styles.results}>
          {([
            ['add', '追加', '人', ''],
            ['update', '更新', '人', ''],
            ['unchanged', '変更なし', '人', ''],
            ['conflict', '競合', '人', '同じIDで値が違う'],
            ['error', 'エラー', '行', '直して再確認'],
          ] as const).map(([key, title, unit, detail]) => {
            const value = m.summary ? m.summary[key] : null
            return (
              <KpiCard
                key={key}
                presentation="card"
                icon={null}
                title={title}
                value={value}
                unit={value == null ? '' : unit}
                detail={detail || null}
                className={styles.result}
              />
            )
          })}
        </div>
        <div className={styles.resultActions}>
          {m.summary && m.importId ? (
            <>
              <Button type="button" variant="secondary" onClick={m.cancelImport} disabled={m.busy}>取り込みをやめる</Button>
              <Button type="button" variant="primary" disabled={blocked || m.busy} busy={m.busy} busyLabel="反映中…" onClick={() => void m.executeImport()}>
                {`確認した内容を反映（${formatNumber(reflectable)}人）`}
              </Button>
            </>
          ) : (
            <p className={styles.small}>{m.summary ? '競合・エラーのある行を直して、もう一度「まず確認だけする」からやり直してください。' : '反映は、確認の結果を見てからです。'}</p>
          )}
        </div>
      </section>

      <section className={styles.card} aria-labelledby="csv-history-title">
        <h3 id="csv-history-title" className={styles.cardTitle}>
          書き出し・取り込みの履歴
          <HelpTip label="状態の札の意味">反映ずみは反映が終わったもの、確認までは確認待ち、期限切れは確認の期限が過ぎたものです。</HelpTip>
        </h3>
        {m.jobs.length === 0 ? (
          <ListState kind="empty" title="履歴はまだありません" description="書き出しまたは取り込みを実行すると、ここに残ります。" />
        ) : (
          <DataTable className={styles.table}>
            <colgroup>
              <col className={styles.colDate} />
              <col className={styles.colKind} />
              <col className={styles.colKind} />
              <col />
              <col className={styles.colState} />
            </colgroup>
            <thead>
              <TableHeadRow>
                <Th className={styles.th}>日時</Th>
                <Th className={styles.th}>種類</Th>
                <Th className={styles.th}>件数</Th>
                <Th className={styles.th}>した人</Th>
                <Th className={styles.th}>状態</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {m.jobs.map((job) => {
                const account = m.accounts.find((item) => item.id === job.line_account_id)?.name
                const count = job.row_count ?? job.total_count ?? null
                const downloadable = job.kind === 'export' && job.status === 'completed' && (!job.expires_at || job.expires_at > new Date().toISOString())
                return (
                  <Tr key={`${job.kind}-${job.id}`} className={styles.row}>
                    <Td className={styles.td}>{slashDateTime(job.created_at)}</Td>
                    <Td className={styles.td}><span title={account ? `対象：${account}` : undefined}>{job.kind === 'export' ? '書き出し' : '取り込み'}</span></Td>
                    <Td className={styles.td}>{count == null ? '—' : formatNumber(count)}</Td>
                    <Td className={styles.td}>{job.created_by_name}</Td>
                    <Td className={styles.td}>
                      <span className={styles.stateCell}>
                        <span className={`${styles.pill} ${job.status === 'completed' ? styles.pillOk : job.status === 'previewed' ? styles.pillWarn : styles.pillMuted}`}>
                          {JOB_STATUS_LABELS[job.status] ?? '確認中'}
                        </span>
                        {downloadable ? (
                          <a className={styles.link} href={`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/friends/exports/${job.id}/download`}>CSVをダウンロード</a>
                        ) : null}
                      </span>
                    </Td>
                  </Tr>
                )
              })}
            </tbody>
          </DataTable>
        )}
      </section>
    </>
  )

  return (
    <PageFrame kind="list" boardId="T9gblG">
      <FriendsSectionHead
        current="csv"
        description="友だち情報をCSVで書き出し、確かめてから取り込みます"
        action={(
          <Button type="button" variant="secondary" onClick={exportHistory} disabled={m.jobs.length === 0} title="下の「書き出し・取り込みの履歴」をCSVにします">
            <Download size={14} aria-hidden="true" />
            表示中をCSVで書き出す
          </Button>
        )}
      />
      <div className={styles.body}>{body}</div>
    </PageFrame>
  )
}
