'use client'

/*
 * ★V8 UID移行（Pencil `Z0jHp` 要確認の判断・`L48eY` 本移行の完了・
 * `sdbsQ` 板5）。
 *
 * v7 と同じ判断・実行・切り戻しの仕組み（use-uid-migration.ts）を使い、
 * 見た目だけを V8 に積み替える。
 *
 * - 5つの段を横のステッパーで示す（Z0jHp 上部）
 * - 分類ごとの人数を4枚の数カードで出す（自動一致／要確認／一致しない／競合）
 * - 要確認の行は「どうするか」の選び欄で1行ずつ確定する（保存は行ごと。
 *   まとめて保存のAPIは無い）
 * - 完了した履歴は L48eY の形（結果の帯＋照合の結果＋履歴）
 * - 「本移行を実行」「切り戻す」は確認ダイアログを開くだけ（FRIEND-33/36）
 */
import type { UidMigrationItem, UidMigrationRun } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import ListState from '@/components/shared/list-state'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import Pagination from '@/components/shared/pagination'
import Select from '@/components/shared/select'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import ListRange from '@/components/ui/list-range'
import { formatDateTime, formatNumber } from '@/lib/format'
import { FriendsManageNavV8 } from '@/app/friends/friends-nav-v8'
import { runStatusView, ExecuteConfirmDialog, MigrationItemDialog, RollbackConfirmDialog } from './migration'
import {
  classLabel,
  formatMappingBytes,
  ITEM_CLASSIFICATIONS,
  ITEM_PAGE_SIZE,
  MIGRATION_STEPS,
  type ItemClassification,
  type UidMigrationDetail,
  type UidMigrationState,
} from './use-uid-migration'
import styles from '@/app/friends/friends-v8.module.css'

const PRE_EXECUTE_STATUSES = ['dry_run', 'review', 'ready']

export default function UidMigrationV8({ m }: { m: UidMigrationState }) {
  const {
    accounts,
    runs,
    active,
    status,
    fromAccountId,
    setFromAccountId,
    toAccountId,
    setToAccountId,
    purpose,
    setPurpose,
    file,
    setFile,
    mappings,
    setMappings,
    busy,
    detailBusy,
    me,
    message,
    setMessage,
    page,
    classification,
    pendingOnly,
    detailItem,
    setDetailItem,
    detailError,
    setDetailError,
    confirmExecute,
    setConfirmExecute,
    executeError,
    setExecuteError,
    confirmRollback,
    setConfirmRollback,
    rollbackError,
    setRollbackError,
    rollbackConflicts,
    setRollbackConflicts,
    load,
    onUidFile,
    createDryRun,
    decide,
    unresolved,
    canRunExecute,
    canRunRollback,
    execute,
    rollback,
    selectRun,
    onFilterChange,
    onPageChange,
  } = m

  if (status === 'loading') {
    return (
      <div aria-busy="true" aria-label="UID移行を読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true">
              <Skeleton width="12ch" height="1.5em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="0.9em" />
              <Skeleton width="100%" height="2.5em" />
              <Skeleton width="100%" height="2.5em" />
            </div>
          )}
        />
      </div>
    )
  }
  if (status === 'error') {
    return <ListState kind="error" title="UID移行を表示できませんでした" description="登録した移行履歴は消えていません。" action={<Button onClick={() => void load()}>再読み込み</Button>} />
  }

  const executeBlockedReason = me
    ? me.role !== 'owner'
      ? '本移行の実行はownerの権限が必要です。'
      : me.id === active?.createdBy
        ? 'この移行はあなたが作成したため、別のownerが実行してください。'
        : null
    : null
  const rollbackBlockedReason = me && me.role !== 'owner' ? '切り戻しはownerの権限が必要です。' : null
  const canDecideItems = !me || ['owner', 'admin'].includes(me.role)

  const currentStep = !active
    ? 0
    : active.status === 'completed' || active.status === 'rolled_back'
      ? MIGRATION_STEPS.length
      : active.status === 'ready' || active.status === 'executing' || active.status === 'failed' || unresolved === 0
        ? 4
        : 3

  const showDecisionBoard = active && !['completed', 'rolled_back'].includes(active.status)

  return (
    <div className={styles.board} data-design-node="Z0jHp">
      <FriendsManageNavV8 current="UID移行" />

      <div className={styles.head}>
        <div className={styles.headText}>
          <h2 className={styles.headTitle}>UID移行</h2>
          <p className={styles.headDescription}>
            別のLINEアカウントから友だちを引っ越します。照合してから本移行します。
          </p>
        </div>
      </div>

      {/* 5つの段（Z0jHp 上部の段送り）。 */}
      <ol className={styles.stepper} aria-label="移行の手順">
        {MIGRATION_STEPS.map((step, index) => {
          const done = index < currentStep
          const current = index === currentStep
          return (
            <li key={step} className={[styles.step, done ? styles.stepDone : '', current ? styles.stepCurrent : ''].filter(Boolean).join(' ')} aria-current={current ? 'step' : undefined}>
              <span className={styles.stepDot} aria-hidden="true">{done ? '✓' : index + 1}</span>
              <span className={styles.stepLabel}>{step}</span>
            </li>
          )
        })}
      </ol>

      {/* FRIEND-15: 「まだ変更していません」は本移行前の履歴だけに出す。 */}
      {(!active || PRE_EXECUTE_STATUSES.includes(active.status)) && (
        <div className={styles.infoBand} role="note">
          <p>本移行まで、既存ユーザー・配信・シナリオには影響しません。</p>
        </div>
      )}

      {/* 移行の登録（いつでも新しいテスト移行を始められる）。 */}
      <section className={styles.section} aria-labelledby="uid-register">
        <div className={styles.sectionHead}>
          <h3 id="uid-register" className={styles.sectionTitle}>移行の登録</h3>
          <p className={styles.sectionDesc}>移行元と移行先・対応表のCSVを選び、まずテスト移行で照合します。</p>
        </div>
        <div className={styles.duoCards}>
          <div className={styles.fieldStack}>
            <span className={styles.fieldLabel}>移行元</span>
            <Select aria-label="移行元アカウント" value={fromAccountId} onChange={(value) => setFromAccountId(value)} options={[{ value: '', label: '移行元アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} size="full" />
          </div>
          <div className={styles.fieldStack}>
            <span className={styles.fieldLabel}>移行先</span>
            <Select aria-label="移行先アカウント" value={toAccountId} onChange={(value) => setToAccountId(value)} options={[{ value: '', label: '移行先アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} size="full" />
          </div>
        </div>
        <div className={styles.fieldStack} style={{ marginTop: 12 }}>
          <span className={styles.fieldLabel}>利用目的</span>
          <TextField value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </div>
        <div style={{ marginTop: 12 }}>
          <FileDropzone
            title="対応表のCSVをここに置く"
            hint="old_uid・new_uid 列のCSVを選びます"
            accept=".csv,text/csv"
            chooseLabel="CSVをアップロード"
            onFiles={(files) => void onUidFile(files)}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          {file ? (
            <AttachmentRow
              name={file.name}
              meta={`${formatNumber(mappings.length)}行・${formatMappingBytes(file.size)}`}
              onRemove={() => { setFile(null); setMappings([]); setMessage(null) }}
            />
          ) : (
            <p className={styles.sectionDesc}>ファイルは未選択です</p>
          )}
        </div>
        <div style={{ marginTop: 12 }}>
          <Button variant="primary" disabled={busy} onClick={() => void createDryRun()} busy={busy} busyLabel="確認中…">テスト移行を実行</Button>
        </div>
        {message && <p role="status" className={styles.sectionDesc} style={{ marginTop: 8 }}>{message}</p>}
      </section>

      {active && showDecisionBoard && (
        <MigrationReviewBoard
          active={active}
          unresolved={unresolved}
          page={page}
          classification={classification}
          pendingOnly={pendingOnly}
          busy={busy}
          detailBusy={detailBusy}
          canDecide={canDecideItems}
          executeBlockedReason={executeBlockedReason}
          rollbackBlockedReason={rollbackBlockedReason}
          onShowDetail={(item) => { setDetailError(null); setDetailItem(item) }}
          onDecide={(item, decision) => void decide(item, decision)}
          onRequestExecute={() => { setExecuteError(null); setConfirmExecute(true) }}
          onRequestRollback={() => { setRollbackError(null); setRollbackConflicts([]); setConfirmRollback(true) }}
          onFilterChange={(nextClassification, nextPendingOnly) => onFilterChange(active.id, nextClassification, nextPendingOnly)}
          onPageChange={(nextPage) => onPageChange(active.id, nextPage)}
        />
      )}

      {active && !showDecisionBoard && (
        <MigrationResultBoard active={active} rollbackBlockedReason={rollbackBlockedReason} busy={busy} detailBusy={detailBusy} onRequestRollback={() => { setRollbackError(null); setRollbackConflicts([]); setConfirmRollback(true) }} />
      )}

      {!active && (
        <section className={styles.section}>
          <div className={styles.sectionHead}>
            <h3 className={styles.sectionTitle}>テスト移行の結果</h3>
          </div>
          <ListState kind="empty" title="テスト移行はまだありません" description="移行元・移行先と対応表を選び、まず確認だけ実行してください。" />
        </section>
      )}

      {/* L48eY: 移行の履歴（日時｜移行元 → 移行先｜状態｜切り戻す）。 */}
      <section className={styles.section} aria-labelledby="uid-history">
        <div className={styles.sectionHead}>
          <h3 id="uid-history" className={styles.sectionTitle}>移行の履歴</h3>
          <p className={styles.sectionDesc}>これまでの移行です。選ぶと対応表と結果を見直せます。</p>
        </div>
        {runs.length === 0 ? (
          <ListState kind="empty" title="移行履歴はまだありません" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>移行元 → 移行先</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <HistoryRow
                    key={run.id}
                    run={run}
                    accountName={(id) => accounts.find((account) => account.id === id)?.name ?? id}
                    isActive={active?.id === run.id}
                    onSelect={() => selectRun(run.id)}
                    onRollback={run.rollbackable && !rollbackBlockedReason
                      ? () => { selectRun(run.id); setRollbackError(null); setRollbackConflicts([]); setConfirmRollback(true) }
                      : null}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <MigrationItemDialog
        detailItem={detailItem}
        active={active}
        me={me}
        busy={busy}
        detailError={detailError}
        onClose={() => { setDetailItem(null); setDetailError(null) }}
        decide={(item, decision) => void decide(item, decision)}
      />
      <ExecuteConfirmDialog
        active={active}
        accounts={accounts}
        me={me}
        busy={busy}
        open={confirmExecute}
        error={executeError}
        canRun={canRunExecute}
        onConfirm={() => void execute()}
        onCancel={() => { if (!busy) setConfirmExecute(false) }}
      />
      <RollbackConfirmDialog
        active={active}
        me={me}
        busy={busy}
        open={confirmRollback}
        error={rollbackError}
        conflicts={rollbackConflicts}
        canRun={canRunRollback}
        onConfirm={() => void rollback()}
        onCancel={() => { if (!busy) { setConfirmRollback(false); setRollbackConflicts([]) } }}
      />
    </div>
  )
}

function historyBadge(run: UidMigrationRun): { tone: StatusBadgeTone; label: string } {
  if (run.status === 'completed') return { tone: 'success', label: '本移行済み' }
  if (run.status === 'rolled_back') return { tone: 'neutral', label: '切り戻し済み' }
  if (run.status === 'failed') return { tone: 'danger', label: run.counts.applied > 0 ? '一部失敗' : '失敗' }
  if (run.status === 'executing') return { tone: 'info', label: '実行中' }
  if (run.status === 'ready') return { tone: 'success', label: '確認完了' }
  return { tone: 'neutral', label: '確認中' }
}

function HistoryRow({
  run,
  accountName,
  isActive,
  onSelect,
  onRollback,
}: {
  run: UidMigrationRun
  accountName: (id: string) => string
  isActive: boolean
  onSelect: () => void
  onRollback: (() => void) | null
}) {
  const badge = historyBadge(run)
  return (
    <tr>
      <td className={styles.nowrap}>{formatDateTime(run.createdAt)}</td>
      <td>
        <button type="button" className={styles.linkAction} onClick={onSelect} aria-current={isActive ? 'true' : undefined}>
          {accountName(run.fromAccountId)} → {accountName(run.toAccountId)}
        </button>
        <span className={styles.pairCellSub}>{run.purpose} ・ {formatNumber(run.counts.total)}件</span>
      </td>
      <td><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></td>
      <td>
        {run.rollbackable
          ? onRollback
            ? <button type="button" className={styles.linkAction} onClick={onRollback}>切り戻す</button>
            : <span className={styles.pairCellSub}>切り戻しはownerのみ</span>
          : <span className={styles.pairCellSub}>—</span>}
      </td>
    </tr>
  )
}

/** Z0jHp: 判断する帯。分類カード＋対応表＋下の追従帯。 */
function MigrationReviewBoard({
  active,
  unresolved,
  page,
  classification,
  pendingOnly,
  busy,
  detailBusy,
  canDecide,
  executeBlockedReason,
  rollbackBlockedReason,
  onShowDetail,
  onDecide,
  onRequestExecute,
  onRequestRollback,
  onFilterChange,
  onPageChange,
}: {
  active: UidMigrationDetail
  unresolved: number | null
  page: number
  classification: '' | ItemClassification
  pendingOnly: boolean
  busy: boolean
  detailBusy: boolean
  canDecide: boolean
  executeBlockedReason: string | null
  rollbackBlockedReason: string | null
  onShowDetail: (item: UidMigrationItem) => void
  onDecide: (item: UidMigrationItem, decision: 'link' | 'create' | 'exclude') => void
  onRequestExecute: () => void
  onRequestRollback: () => void
  onFilterChange: (classification: '' | ItemClassification, pendingOnly: boolean) => void
  onPageChange: (page: number) => void
}) {
  const total = active.itemTotal ?? active.items?.length ?? 0
  const showPager = page > 0 || total > ITEM_PAGE_SIZE
  const from = total === 0 ? 0 : page * ITEM_PAGE_SIZE + 1
  const to = Math.min((page + 1) * ITEM_PAGE_SIZE, total)
  const statusView = runStatusView(active, unresolved)
  const decisionsLocked = !['review', 'ready', 'failed'].includes(active.status)

  return (
    <>
      {/* Z0jHp: 自動で一致／要確認／一致しない／競合 の4枚。 */}
      <div className={styles.kpis} role="group" aria-label="照合の内訳">
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>自動で一致</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.auto)}<span className={styles.kpiUnit}>人</span></p>
          <p className={styles.kpiDetail}>そのまま引き継ぐ</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>要確認</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.review)}<span className={styles.kpiUnit}>人</span></p>
          <p className={styles.kpiDetail}>いまここで決める</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>一致しない</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.unmatched)}<span className={styles.kpiUnit}>人</span></p>
          <p className={styles.kpiDetail}>新しく作るか除く</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>競合</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.conflict)}<span className={styles.kpiUnit}>人</span></p>
          <p className={styles.kpiDetail}>同じ先に2人いる</p>
        </div>
      </div>

      <section className={styles.section} aria-labelledby="uid-review">
        <div className={styles.sectionHead}>
          <h3 id="uid-review" className={styles.sectionTitle}>要確認の判断</h3>
          <p className={styles.sectionDesc}>{statusView.description}</p>
          <StatusBadge tone={statusView.badgeTone}>{statusView.badgeLabel}</StatusBadge>
        </div>
        <div className={styles.toolbar}>
          <Select aria-label="分類で絞り込む" value={classification} onChange={(value) => onFilterChange(value as '' | ItemClassification, pendingOnly)} options={[{ value: '', label: 'すべての分類' }, ...ITEM_CLASSIFICATIONS.map((value) => ({ value, label: classLabel[value] }))]} size="standard" />
          <Checkbox checked={pendingOnly} onCheckedChange={(checked) => onFilterChange(classification, checked)}>未判断のみ</Checkbox>
          <span className={styles.toolbarSpacer} />
          <span className={styles.toolbarCount}>全 {formatNumber(total)} 件{detailBusy ? '・読み込み中…' : ''}</span>
        </div>
        {detailBusy && <p role="status" className={styles.sectionDesc}>対応表を読み込んでいます…</p>}
        {(active.items?.length ?? 0) === 0 ? (
          <ListState kind="empty" title="対応表に結果がありません" description="絞り込みを変えるか、別のCSVを選んでテスト移行してください。" />
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>移行元 uid</th>
                  <th>移行先 uid</th>
                  <th>一致</th>
                  <th>どうするか</th>
                </tr>
              </thead>
              <tbody>
                {active.items?.map((item) => (
                  <tr key={item.id}>
                    <td className={`${styles.nowrap} ${styles.mono}`} title={item.oldUid}>{item.oldUid}</td>
                    <td>
                      <span className={styles.mono}>{item.newUid ?? '—'}</span>
                      {item.candidateName && <span className={styles.pairCellSub}>{item.candidateName}</span>}
                      {item.conflictReason && <span className={styles.pairCellSub}>{item.conflictReason}</span>}
                    </td>
                    <td>
                      <StatusBadge tone={item.classification === 'auto' ? 'success' : item.classification === 'unmatched' ? 'neutral' : 'warning'}>
                        {classLabel[item.classification]}
                      </StatusBadge>
                    </td>
                    <td>
                      <div className={styles.chips}>
                        {/*
                          FRIEND-14: 行の選び欄は選んだ時点で保存する
                          （一覧の各行が「どうするか」を持つ Z0jHp の形）。
                          まとめて保存のAPIは無いので行ごとの保存のままにする。
                        */}
                        {decisionsLocked || !canDecide ? (
                          <span className={styles.pairCellSub}>{item.decision === 'pending' ? '未判断' : item.decision === 'link' ? '結び付ける' : item.decision === 'create' ? '新しく作る' : '除く'}</span>
                        ) : (
                          <Select
                            aria-label={`${item.oldUid} の引き継ぎ方`}
                            size="standard"
                            disabled={busy || detailBusy}
                            value={item.decision === 'pending' ? '' : item.decision}
                            onChange={(value) => { if (value) onDecide(item, value as 'link' | 'create' | 'exclude') }}
                            options={[
                              { value: '', label: '選んでください' },
                              ...(item.newUid ? [{ value: 'link', label: '結び付ける' }, { value: 'create', label: '新しく作る' }] : []),
                              { value: 'exclude', label: '除く' },
                            ]}
                          />
                        )}
                        <button type="button" className={styles.linkAction} disabled={busy || detailBusy} onClick={() => onShowDetail(item)}>詳細</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {showPager && (
          <div className={styles.pagerRow}>
            <ListRange total={total} first={from} last={to} />
            <Pagination page={page + 1} pageCount={Math.max(1, Math.ceil(total / ITEM_PAGE_SIZE))} onPageChange={(next) => onPageChange(next - 1)} disabled={busy || detailBusy} />
          </div>
        )}
      </section>

      {/*
        Z0jHp 下の追従帯：左に「切り戻す」（使えるときだけ）、中央に
        一覧へ戻る・本移行へ進む。実行は確認ダイアログが開くだけ。
      */}
      <StickyBar
        destructive={
          active.rollbackable
            ? rollbackBlockedReason
              ? <span className={styles.pairCellSub}>{rollbackBlockedReason}</span>
              : <Button type="button" variant="danger" disabled={busy || detailBusy} onClick={onRequestRollback}>この移行を切り戻す</Button>
            : undefined
        }
        status={unresolved !== null && unresolved > 0 ? `要確認 ${formatNumber(unresolved)} 件` : undefined}
        actions={
          <>
            <Button type="button" href="/friends">友だち一覧へ戻る</Button>
            {active.status === 'ready' && (
              <Button type="button" variant="primary" disabled={busy || detailBusy} onClick={onRequestExecute}>
                本移行へ進む
              </Button>
            )}
          </>
        }
      />
      {executeBlockedReason && active.status === 'ready' && (
        <p className={styles.sectionDesc} role="note">{executeBlockedReason}</p>
      )}
    </>
  )
}

/** L48eY: 本移行と照合が終わった履歴。結果の帯＋照合の内訳。 */
function MigrationResultBoard({
  active,
  rollbackBlockedReason,
  busy,
  detailBusy,
  onRequestRollback,
}: {
  active: UidMigrationDetail
  rollbackBlockedReason: string | null
  busy: boolean
  detailBusy: boolean
  onRequestRollback: () => void
}) {
  const statusView = runStatusView(active, null)
  const isCompleted = active.status === 'completed'
  return (
    <>
      <div className={isCompleted ? styles.infoBand : styles.errorBand} role={isCompleted ? 'note' : 'alert'}>
        <p>
          {isCompleted
            ? `本移行と照合が終わりました。${formatNumber(active.counts.applied)} 人を引き継ぎました。必要ならこの履歴から切り戻せます。`
            : statusView.description}
        </p>
      </div>
      <div className={styles.kpis} role="group" aria-label="照合の結果">
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>引き継いだ</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.applied)}<span className={styles.kpiUnit}>人</span></p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>一致先なし</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.unmatched)}<span className={styles.kpiUnit}>人</span></p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>除いた</p>
          <p className={styles.kpiValue}>{formatNumber(active.decisionCounts?.exclude ?? 0)}<span className={styles.kpiUnit}>人</span></p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>失敗</p>
          <p className={styles.kpiValue}>{formatNumber(active.counts.failed)}<span className={styles.kpiUnit}>人</span></p>
        </div>
      </div>
      {active.rollbackable && (
        <div className={styles.cardCenter}>
          {rollbackBlockedReason
            ? <p className={styles.sectionDesc}>{rollbackBlockedReason}</p>
            : <Button type="button" variant="danger" disabled={busy || detailBusy} onClick={onRequestRollback}>この移行を切り戻す</Button>}
        </div>
      )}
    </>
  )
}
