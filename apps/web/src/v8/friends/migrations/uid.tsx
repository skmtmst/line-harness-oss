'use client'

/*
 * ★V8 UID移行（Pencil `Z0jHp` 要確認の判断・`L48eY` 本移行と照合の完了）。/friends/migrations?tab=uid（`&run=` で履歴を選ぶ）。
 *
 * 判断・実行・切り戻しの口は今と同じ（use-uid-migration：行ごとの判断・実行と切り戻しは確認窓の確定だけ・
 * owner と作成者の決まり・結果不明のときの読み直し）。今の入口 /accounts?tab=migration はそのまま。
 * 見せ方：頭（← 友だちへ・タブ）→ 5つの段 → 判断中なら数4つと「要確認の判断」、終わったら結果の帯と「照合の結果」
 * → 移行の履歴 → 新しい移行の登録（開いて使う）。
 */
import { useState } from 'react'
import { Check, CheckCheck, CircleCheck, Download, Plus, Undo2 } from 'lucide-react'
import type { UidMigrationItem, UidMigrationRun } from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame } from '@/components/templates/page-frame'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import KpiCard from '@/components/shared/kpi-card'
import ListState from '@/components/shared/list-state'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { FriendsSectionHead } from '../shared/head'
import { slashDateTime } from '../duplicates/words'
import { csvExportLine } from '../list/csv-export'
import { ExecuteConfirmDialog, MigrationItemDialog, RollbackConfirmDialog, runStatusView } from './uid-dialogs'
import { classLabel, decisionLabel, formatMappingBytes, ITEM_PAGE_SIZE, MIGRATION_STEPS, useUidMigration, type ItemClassification } from './use-uid-migration'
import styles from './migrations.module.css'

const PRE_EXECUTE = ['dry_run', 'review', 'ready']

/** 長い UID は頭4字…末3字で見せる（全文は title）。 */
function shortUid(uid: string): string {
  return uid.length > 10 ? `${uid.slice(0, 4)}…${uid.slice(-3)}` : uid
}

function historyBadge(run: UidMigrationRun): { tone: 'ok' | 'muted' | 'danger' | 'warn'; label: string } {
  if (run.status === 'completed') return { tone: 'ok', label: '本移行済み' }
  if (run.status === 'rolled_back') return { tone: 'muted', label: '切り戻し済み' }
  if (run.status === 'failed') return { tone: 'danger', label: run.counts.applied > 0 ? '一部失敗' : '失敗' }
  if (run.status === 'executing') return { tone: 'warn', label: '実行中' }
  if (run.status === 'ready') return { tone: 'ok', label: '確認完了' }
  return { tone: 'muted', label: 'テスト移行' }
}

const TONE_CLASS = { ok: styles.pillOk, muted: styles.pillMuted, danger: styles.pillDanger, warn: styles.pillWarn }

export default function UidMigrationV8({ initialRunId }: { initialRunId: string | null }) {
  usePageTitle('UID移行')
  const m = useUidMigration(initialRunId)
  const [registerOpen, setRegisterOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const active = m.active

  const executeBlockedReason = m.me
    ? m.me.role !== 'owner'
      ? '本移行の実行はownerの権限が必要です。'
      : m.me.id === active?.createdBy
        ? 'この移行はあなたが作成したため、別のownerが実行してください。'
        : null
    : null
  const rollbackBlockedReason = m.me && m.me.role !== 'owner' ? '切り戻しはownerの権限が必要です。' : null
  const canDecideItems = !m.me || ['owner', 'admin'].includes(m.me.role)
  const currentStep = !active
    ? 0
    : active.status === 'completed' || active.status === 'rolled_back'
      ? MIGRATION_STEPS.length
      : active.status === 'ready' || active.status === 'executing' || active.status === 'failed' || m.unresolved === 0
        ? 4
        : 3
  const reviewing = Boolean(active && !['completed', 'rolled_back'].includes(active.status))
  const decisionsLocked = !active || !['review', 'ready', 'failed'].includes(active.status)
  const accountName = (id: string) => m.accounts.find((account) => account.id === id)?.name ?? (id.endsWith('-old') ? '旧アカウント' : id)

  /* 頭の「表示中をCSVで書き出す」：いま出ている対応表（このページ）を CSV にする。 */
  const exportItems = () => {
    if (!active?.items?.length) return
    const header = ['移行元uid', '移行先uid', '一致', 'どうするか']
    const rows = active.items.map((item) => [item.oldUid, item.newUid ?? '', classLabel[item.classification], decisionLabel[item.decision]])
    const csv = [header, ...rows].map((row) => csvExportLine(row)).join('\n')
    const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `uid-migration-${active.id}.csv`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  /* 「要確認をまとめて結び付ける」：このページの要確認・未判断・移行先ありの行を1行ずつ結び付ける（まとめての口は無い）。 */
  const bulkTargets: UidMigrationItem[] = (active?.items ?? []).filter((item) => item.classification === 'review' && item.decision === 'pending' && item.newUid)
  const runBulkLink = async () => {
    for (const item of bulkTargets) {
      await m.decide(item, 'link')
    }
    setBulkOpen(false)
  }

  const register = (
    <section className={styles.card} aria-labelledby="uid-register">
      <div className={styles.cardHead}>
        <h3 id="uid-register" className={styles.cardTitle}>移行の登録</h3>
        <p className={styles.cardSub}>移行元と移行先・対応表のCSVを選び、まずテスト移行で照合します。本移行まで、既存ユーザー・配信・シナリオには影響しません。</p>
      </div>
      <div className={styles.pair}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>移行元</span>
          <Select aria-label="移行元アカウント" size="full" value={m.fromAccountId} onChange={m.setFromAccountId} options={[{ value: '', label: '移行元アカウントを選択' }, ...m.accounts.map((account) => ({ value: account.id, label: account.name }))]} />
        </div>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>移行先</span>
          <Select aria-label="移行先アカウント" size="full" value={m.toAccountId} onChange={m.setToAccountId} options={[{ value: '', label: '移行先アカウントを選択' }, ...m.accounts.map((account) => ({ value: account.id, label: account.name }))]} />
        </div>
      </div>
      <div className={styles.field}>
        <span className={styles.fieldLabel}>利用目的</span>
        <TextField value={m.purpose} onChange={(event) => m.setPurpose(event.target.value)} aria-label="利用目的" />
      </div>
      <FileDropzone title="対応表のCSVをここに置く" hint="old_uid・new_uid 列のCSVを選びます" accept=".csv,text/csv" chooseLabel="CSVをアップロード" onFiles={(files) => void m.onUidFile(files)} />
      {m.file ? (
        <AttachmentRow name={m.file.name} meta={`${formatNumber(m.mappings.length)}行・${formatMappingBytes(m.file.size)}`} onRemove={() => { m.setFile(null); m.setMappings([]); m.setMessage(null) }} />
      ) : <p className={styles.small}>ファイルは未選択です</p>}
      <div className={styles.cardFoot}>
        {canDecideItems ? (
          <Button variant="primary" disabled={m.busy} onClick={() => void m.createDryRun()} busy={m.busy} busyLabel="確認中…">テスト移行を実行</Button>
        ) : <p className={styles.small}>移行の登録はowner/adminが行います。</p>}
      </div>
    </section>
  )

  let body
  if (m.status === 'loading') {
    body = <ListState kind="loading" title="UID移行を読み込んでいます" description="移行履歴とアカウントを確認しています。" />
  } else if (m.status === 'error') {
    body = <ListState kind="error" title="UID移行を表示できませんでした" description="登録した移行履歴は消えていません。" onRetry={() => void m.load()} />
  } else {
    const statusView = active ? runStatusView(active, m.unresolved) : null
    const total = active?.itemTotal ?? active?.items?.length ?? 0
    const pageCount = Math.max(1, Math.ceil(total / ITEM_PAGE_SIZE))
    body = (
      <>
        <ol className={styles.steps} aria-label="移行の手順">
          {MIGRATION_STEPS.map((step, index) => {
            const done = index < currentStep
            const current = index === currentStep
            return (
              <li key={step} className={done ? `${styles.step} ${styles.stepDone}` : current ? `${styles.step} ${styles.stepCurrent}` : styles.step} aria-current={current ? 'step' : undefined}>
                <span className={styles.stepDot} aria-hidden="true">{done ? <Check size={12} /> : index + 1}</span>
                <span className={styles.stepLabel}>{step}</span>
              </li>
            )
          })}
        </ol>

        {m.message ? <p role="status" className={styles.message}>{m.message}</p> : null}

        {!active ? register : null}

        {active && reviewing ? (
          <>
            <div className={styles.cards4} role="group" aria-label="照合の内訳">
              {([
                ['auto', '自動で一致', active.counts.auto, 'そのまま引き継ぐ'],
                ['review', '要確認', active.counts.review, 'いまここで決める'],
                ['unmatched', '一致しない', active.counts.unmatched, '新しく作るか除く'],
                ['conflict', '競合', active.counts.conflict, '同じ先に2人'],
              ] as const).map(([key, title, value, detail]) => (
                <KpiCard key={key} presentation="card" icon={null} title={title} value={value} unit="人" detail={detail} className={styles.result} />
              ))}
            </div>

            <section className={styles.card} aria-labelledby="uid-review">
              <div className={styles.cardHead}>
                <h3 id="uid-review" className={styles.cardTitle}>要確認の判断</h3>
                <p className={styles.cardSub}>{`1人ずつ、どう引き継ぐかを決めます。テスト移行までは実データを変えません（${statusView?.badgeLabel ?? ''}）`}</p>
              </div>
              <div className={styles.toolRow}>
                <div role="group" aria-label="分類で絞り込む" className={styles.chipRow}>
                  {([
                    ['review', `要確認 ${formatNumber(active.counts.review)}`],
                    ['conflict', `競合 ${formatNumber(active.counts.conflict)}`],
                    ['unmatched', `一致しない ${formatNumber(active.counts.unmatched)}`],
                  ] as Array<[ItemClassification, string]>).map(([value, label]) => (
                    <button key={value} type="button" aria-pressed={m.classification === value} className={m.classification === value ? `${styles.chip} ${styles.chipOn}` : styles.chip} onClick={() => m.onFilterChange(active.id, m.classification === value ? '' : value, m.pendingOnly)}>
                      {label}
                    </button>
                  ))}
                  <button type="button" aria-pressed={m.pendingOnly} className={m.pendingOnly ? `${styles.chip} ${styles.chipOn}` : styles.chip} onClick={() => m.onFilterChange(active.id, m.classification, !m.pendingOnly)}>
                    {`未判断 ${m.unresolved == null ? '—' : formatNumber(m.unresolved)}`}
                  </button>
                </div>
                <span className={styles.spacer} />
                {canDecideItems && !decisionsLocked && bulkTargets.length > 0 ? (
                  <button type="button" className={styles.textButton} disabled={m.busy || m.detailBusy} onClick={() => setBulkOpen(true)}>
                    <CheckCheck size={16} aria-hidden="true" />
                    要確認をまとめて「結び付ける」
                  </button>
                ) : null}
              </div>
              {(active.items?.length ?? 0) === 0 ? (
                <ListState kind="empty" title="対応表に結果がありません" description="絞り込みを変えるか、別のCSVを選んでテスト移行してください。" />
              ) : (
                <DataTable className={styles.table}>
                  <colgroup>
                    <col className={styles.colUid} />
                    <col />
                    <col className={styles.colKind} />
                    <col className={styles.colDecide} />
                  </colgroup>
                  <thead>
                    <TableHeadRow>
                      <Th className={styles.th}>移行元 uid</Th>
                      <Th className={styles.th}>移行先 uid</Th>
                      <Th className={styles.th}>一致</Th>
                      <Th className={styles.th}>どうするか</Th>
                    </TableHeadRow>
                  </thead>
                  <tbody>
                    {active.items?.map((item) => (
                      <Tr key={item.id} className={`${styles.row} ${styles.rowTall}`}>
                        <Td className={styles.td}>
                          <button type="button" className={`${styles.mono} ${styles.uidButton}`} title={`${item.oldUid}（詳細を見る）`} onClick={() => { m.setDetailError(null); m.setDetailItem(item) }}>
                            {shortUid(item.oldUid)}
                          </button>
                        </Td>
                        <Td className={styles.td}>
                          <span className={styles.mono} title={[item.newUid, item.candidateName, item.conflictReason].filter(Boolean).join(' ／ ') || undefined}>{item.newUid ? shortUid(item.newUid) : '—'}</span>
                        </Td>
                        <Td className={styles.td}>
                          <span className={`${styles.pill} ${item.classification === 'auto' ? styles.pillOk : item.classification === 'conflict' ? styles.pillDanger : item.classification === 'unmatched' ? styles.pillMuted : styles.pillWarn}`}>
                            {item.classification === 'unmatched' ? '一致しない' : classLabel[item.classification]}
                          </span>
                        </Td>
                        <Td className={styles.td}>
                          {decisionsLocked || !canDecideItems ? (
                            <span className={styles.small}>{decisionLabel[item.decision]}</span>
                          ) : (
                            <Select
                              aria-label={`${item.oldUid} の引き継ぎ方`}
                              size="full"
                              disabled={m.busy || m.detailBusy}
                              value={item.decision === 'pending' ? '' : item.decision}
                              onChange={(value) => { if (value) void m.decide(item, value as 'link' | 'create' | 'exclude') }}
                              options={[
                                { value: '', label: '選んでください' },
                                ...(item.newUid ? [{ value: 'link', label: '結び付ける' }, { value: 'create', label: '新しく作る' }] : []),
                                { value: 'exclude', label: '除く' },
                              ]}
                            />
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </tbody>
                </DataTable>
              )}
              {pageCount > 1 ? (
                <div className={styles.pagerRow}>
                  <span className={styles.small}>{`${formatNumber(total)}件中 ${formatNumber(m.page * ITEM_PAGE_SIZE + 1)}〜${formatNumber(Math.min((m.page + 1) * ITEM_PAGE_SIZE, total))}件`}</span>
                  <Pagination page={m.page + 1} pageCount={pageCount} onPageChange={(next) => m.onPageChange(active.id, next - 1)} disabled={m.busy || m.detailBusy} />
                </div>
              ) : null}
            </section>
          </>
        ) : null}

        {active && !reviewing ? (
          <>
            <div className={active.status === 'completed' ? `${styles.band} ${styles.bandDone}` : styles.band} role="note">
              <CircleCheck size={18} aria-hidden="true" />
              <span>
                <span className={styles.bandTitle}>{active.status === 'completed' ? '本移行と照合が終わりました' : statusView?.badgeLabel}</span>
                <span className={styles.bandText}>
                  {active.status === 'completed'
                    ? `${formatNumber(active.counts.applied)}人を引き継ぎました。必要ならこの履歴から切り戻せます。`
                    : statusView?.description}
                </span>
              </span>
            </div>
            <section className={styles.card} aria-labelledby="uid-result">
              <h3 id="uid-result" className={styles.cardTitle}>照合の結果</h3>
              <ul className={styles.lines}>
                <li className={styles.line}><span>引き継いだ</span><span className={styles.lineGood}>{`${formatNumber(active.counts.applied)}人`}</span></li>
                <li className={styles.line}><span>一致先なし（CSVで書き出す・取り込むで作る）</span><span className={styles.lineValue}>{`${formatNumber(active.counts.unmatched)}人`}</span></li>
                <li className={styles.line}><span>除いた</span><span className={styles.lineValue}>{`${formatNumber(active.decisionCounts?.exclude ?? 0)}人`}</span></li>
                <li className={styles.line}><span>失敗</span><span className={styles.lineValue}>{`${formatNumber(active.counts.failed)}人`}</span></li>
              </ul>
            </section>
          </>
        ) : null}

        <section className={styles.card} aria-labelledby="uid-history">
          <div className={styles.cardHeadRow}>
            <h3 id="uid-history" className={styles.cardTitle}>移行の履歴</h3>
            {active ? (
              <button type="button" className={styles.textButton} aria-expanded={registerOpen} onClick={() => setRegisterOpen((open) => !open)}>
                <Plus size={16} aria-hidden="true" />
                新しい移行を登録
              </button>
            ) : null}
          </div>
          {m.runs.length === 0 ? (
            <ListState kind="empty" title="移行履歴はまだありません" />
          ) : (
            <DataTable className={styles.table}>
              <colgroup>
                <col className={styles.colDate} />
                <col />
                <col className={styles.colRunState} />
                <col className={styles.colAction} />
              </colgroup>
              <thead>
                <TableHeadRow>
                  <Th className={`${styles.th} ${styles.thHistory}`}>日時</Th>
                  <Th className={`${styles.th} ${styles.thHistory}`}>移行元 → 移行先</Th>
                  <Th className={`${styles.th} ${styles.thHistory}`}>状態</Th>
                  <Th className={`${styles.th} ${styles.thHistory}`}><span className="sr-only">操作</span></Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {m.runs.map((run) => {
                  const badge = historyBadge(run)
                  return (
                    <Tr key={run.id} className={`${styles.row} ${styles.rowRun}`} selected={active?.id === run.id || undefined}>
                      <Td className={styles.td}>{slashDateTime(run.createdAt)}</Td>
                      <Td className={styles.td}>
                        <button type="button" className={styles.runButton} aria-current={active?.id === run.id ? 'true' : undefined} title={`${run.purpose} ・ ${formatNumber(run.counts.total)}件`} onClick={() => m.selectRun(run.id)}>
                          {`${accountName(run.fromAccountId)} → ${accountName(run.toAccountId)}`}
                        </button>
                      </Td>
                      <Td className={styles.td}><span className={`${styles.pill} ${TONE_CLASS[badge.tone]}`}>{badge.label}</span></Td>
                      <Td className={styles.td}>
                        {run.rollbackable === true && !rollbackBlockedReason ? (
                          <button type="button" className={styles.textButton} disabled={m.busy || m.detailBusy} onClick={() => { m.selectRun(run.id); m.setRollbackError(null); m.setRollbackConflicts([]); m.setConfirmRollback(true) }}>
                            <Undo2 size={16} aria-hidden="true" />
                            切り戻す
                          </button>
                        ) : run.rollbackable === true ? (
                          <span className={styles.small} title={rollbackBlockedReason ?? undefined}>ownerのみ</span>
                        ) : <span className={styles.faint}>—</span>}
                      </Td>
                    </Tr>
                  )
                })}
              </tbody>
            </DataTable>
          )}
        </section>

        {active && registerOpen ? register : null}

        {active && reviewing ? (
          <div className={styles.footer}>
            <div className={styles.footerBar}>
              <span />
              <div className={styles.footerCenter}>
                <Button href="/friends">キャンセル</Button>
                {executeBlockedReason ? (
                  <span className={styles.small}>{executeBlockedReason}</span>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    disabled={active.status !== 'ready' || m.busy || m.detailBusy}
                    title={active.status !== 'ready' ? '要確認をすべて決めると進めます' : undefined}
                    onClick={() => { m.setExecuteError(null); m.setConfirmExecute(true) }}
                  >
                    本移行へ進む
                  </Button>
                )}
              </div>
              <span />
            </div>
          </div>
        ) : null}
      </>
    )
  }

  return (
    <PageFrame kind="list" boardId={active && !reviewing ? 'L48eY' : 'Z0jHp'}>
      <FriendsSectionHead
        current="uid-migration"
        description="友だち情報と配信停止の状態を、新しいLINEアカウントへ引き継ぎます"
        action={(
          <Button type="button" variant="secondary" onClick={exportItems} disabled={!active?.items?.length} title="表示中の対応表をCSVにします">
            <Download size={14} aria-hidden="true" />
            表示中をCSVで書き出す
          </Button>
        )}
      />
      <div className={styles.body}>{body}</div>

      <MigrationItemDialog detailItem={m.detailItem} active={active} me={m.me} busy={m.busy} detailError={m.detailError} onClose={() => { m.setDetailItem(null); m.setDetailError(null) }} decide={(item, decision) => void m.decide(item, decision)} />
      <ExecuteConfirmDialog active={active} accounts={m.accounts} me={m.me} busy={m.busy} open={m.confirmExecute} error={m.executeError} canRun={m.canRunExecute} onConfirm={() => void m.execute()} onCancel={() => { if (!m.busy) m.setConfirmExecute(false) }} />
      <RollbackConfirmDialog active={active} me={m.me} busy={m.busy} open={m.confirmRollback} error={m.rollbackError} conflicts={m.rollbackConflicts} canRun={m.canRunRollback} onConfirm={() => void m.rollback()} onCancel={() => { if (!m.busy) { m.setConfirmRollback(false); m.setRollbackConflicts([]) } }} />
      <ConfirmDialog
        open={bulkOpen}
        title="要確認をまとめて結び付けます"
        description={`このページの要確認・未判断で移行先のある ${formatNumber(bulkTargets.length)} 行を「結び付ける」にします。1行ずつ保存します。本移行まで実データは変わりません。`}
        confirmLabel="結び付ける"
        busy={m.busy}
        onConfirm={() => void runBulkLink()}
        onCancel={() => { if (!m.busy) setBulkOpen(false) }}
      />
    </PageFrame>
  )
}
