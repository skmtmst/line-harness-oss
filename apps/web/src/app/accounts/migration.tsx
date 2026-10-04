'use client'

import type { LineAccount } from '@line-crm/shared'
import type { UidMigrationItem } from '@/lib/api'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Breadcrumb from '@/components/shared/breadcrumb'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import FileDropzone, { AttachmentRow } from '@/components/shared/file-drop'
import ListState from '@/components/shared/list-state'
import Select from '@/components/shared/select'
import Notice from '@/components/shared/notice'
import StatusBadge, { type StatusBadgeTone } from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import { ActionCell, DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import Pagination from '@/components/shared/pagination'
import ListRange from '@/components/ui/list-range'
import { TextField } from '@/components/shared/text-field'
import MergedTabs from '@/components/layout/merged-tabs'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { FRIENDS_MERGED_TABS } from '@/app/friends/friends-tabs'
import { formatDateTime, formatNumber } from '@/lib/format'
import UidMigrationV8 from './uid-migration-v8'
import {
  classLabel,
  decisionLabel,
  formatMappingBytes,
  ITEM_CLASSIFICATIONS,
  ITEM_PAGE_SIZE,
  MIGRATION_STEPS as STEPS,
  parseUidCsv,
  splitUidCsvLine,
  useUidMigration,
  type ItemClassification,
  type UidMigrationDetail,
} from './use-uid-migration'

// 契約テスト（migration-contract.test.ts）がこのファイルから読むため再公開する。
export { parseUidCsv, splitUidCsvLine }

interface RunStatusView {
  heading: string
  description: string
  badgeTone: StatusBadgeTone
  badgeLabel: string
}

/**
 * FRIEND-15: 見出し・説明・バッジ・操作は run.status だけで決める。
 * 完了した履歴へ「実データはまだ変更していません」と出さない。
 */
export function runStatusView(run: UidMigrationDetail, unresolved: number | null): RunStatusView {
  switch (run.status) {
    case 'completed':
      return {
        heading: '移行の状態',
        description: '本移行と照合が完了しています。必要な場合はこの履歴から切り戻せます。',
        badgeTone: 'success',
        badgeLabel: '本移行済み',
      }
    case 'rolled_back':
      return {
        heading: '移行の状態',
        description: '切り戻し済みです。反映した内容は移行前の状態へ戻しています。',
        badgeTone: 'neutral',
        badgeLabel: '切り戻し済み',
      }
    case 'executing':
      return {
        heading: '移行の状態',
        description: '本移行を実行しています。結果が出るまで操作をお待ちください。',
        badgeTone: 'info',
        badgeLabel: '実行中',
      }
    case 'failed':
      return run.counts.applied > 0
        ? {
            heading: '移行の状態',
            description: `一部だけ反映されました（反映 ${formatNumber(run.counts.applied)} 件・失敗 ${formatNumber(run.counts.failed)} 件）。失敗した行を確認して再実行するか、反映済みの分だけ切り戻せます。`,
            badgeTone: 'danger',
            badgeLabel: '一部失敗',
          }
        : {
            heading: '移行の状態',
            description: '本移行は失敗しました。実データは変更されていません。',
            badgeTone: 'danger',
            badgeLabel: '失敗',
          }
    default:
      return {
        heading: 'テスト移行の状態',
        description: '実データはまだ変更していません。',
        badgeTone: unresolved === 0 ? 'success' : 'warning',
        badgeLabel: unresolved === 0 ? '確認完了' : `要確認 ${unresolved ?? '—'}件`,
      }
  }
}

export default function AccountMigration() {
  usePageTitle('UID移行')
  const m = useUidMigration()
  const theme = useAdminTheme()
  if (theme === 'v8') return <UidMigrationV8 m={m} />
  return <AccountMigrationV7 m={m} />
}

function AccountMigrationV7({ m }: { m: ReturnType<typeof useUidMigration> }) {
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
    message,
    setMessage,
    page,
    setPage,
    classification,
    setClassification,
    pendingOnly,
    setPendingOnly,
    detailBusy,
    me,
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

  if (status === 'loading') return <ListState kind="loading" title="UID移行を読み込んでいます" description="移行履歴とアカウントを確認しています。" />
  if (status === 'error') return <ListState kind="error" title="UID移行を表示できませんでした" description="登録した移行履歴は消えていません。" action={<Button onClick={() => void load()}>再読み込み</Button>} />

  return (
    <div data-design-node="vtBCu" className="flex flex-col gap-4">
      {/*
        カード同士の縦の間隔はこの親の gap-4（16px）だけで作る。
        子ごとの mb/mt で間隔を作らない（0に潰れる箇所が出るため）。
      */}
      {/*
        #984 LAY-14: 主タブは友だち一覧側と同じ定義・同じ部品・同じ選択色。
        手書き nav（選択が青の別実装）はやめる。
        右端の「移行履歴」は下の履歴節へ飛ぶだけの補助リンクで、
        同じ節が画面内に常に見えるため置かない（重複を出さない）。
        「CSVで書き出す・取り込む」は別画面への導線なので残す。
      */}
      <div data-design="V6Tabs">
        <MergedTabs
          basePath="/friends"
          tabs={FRIENDS_MERGED_TABS}
          active="uid-migration"
          actions={(
            <Button href="/friends/migrations">CSVで書き出す・取り込む</Button>
          )}
        />
      </div>
      {/* 現在地：UID移行は友だちのタブ。左メニューの選択も友だち（lib/menu.ts）。 */}
      <div>
        <Breadcrumb items={[{ label: '友だち', href: '/friends' }, { label: 'UID移行' }]} />
      </div>

      {/*
        #985 CHK-06: 5段階は実データから現在位置を出す。以前は先頭だけ
        常に✓で、テスト移行・要確認・本移行のあとも進まなかった。
        狭い幅では5列に押し込まず「現在 n/5」＋全手順の展開にする。
      */}
      {(() => {
        const currentStep = !active
          ? 0
          : active.status === 'completed' || active.status === 'rolled_back'
            ? STEPS.length
            : active.status === 'ready' || active.status === 'executing' || active.status === 'failed' || unresolved === 0
              ? 4
              : 3
        return (
          <div className="bg-canvas rounded-card border-hairline border">
            <div className="px-4 py-3 sm:hidden">
              <p className="text-action text-xs font-medium">
                {currentStep >= STEPS.length ? 'すべて完了' : `現在 ${currentStep + 1}/${STEPS.length}`}
              </p>
              <p className="text-ink mt-1 text-sm font-semibold">
                {currentStep >= STEPS.length ? '本移行と照合まで済んでいます' : STEPS[currentStep]}
              </p>
              <details className="mt-2">
                <summary className="text-action cursor-pointer text-xs font-semibold">全手順を見る</summary>
                <ol className="mt-2 space-y-1">
                  {STEPS.map((step, index) => (
                    <li key={step} className={`text-xs ${index < currentStep ? 'text-success font-semibold' : index === currentStep ? 'text-action font-medium' : 'text-ink-faint'}`}>
                      {index < currentStep ? '✓' : index === currentStep ? '▶' : `${index + 1}.`}　{step}
                    </li>
                  ))}
                </ol>
              </details>
            </div>
            <div className="hidden sm:grid sm:grid-cols-5">
              {STEPS.map((step, index) => <div key={step} className="border-hairline border-r px-3 py-3 last:border-r-0">
                <p className={`text-xs font-medium ${index < currentStep ? 'text-success' : index === currentStep ? 'text-action' : 'text-ink-faint'}`}>{index < currentStep ? '✓' : index === currentStep ? '▶' : index + 1}　STEP {index + 1}</p>
                <p className="text-ink mt-1 text-sm font-semibold">{step}</p>
              </div>)}
            </div>
          </div>
        )
      })()}

      {/*
        FRIEND-15: 「実データはまだ変更していません」の案内は、本移行前の
        履歴にだけ出す。完了・一部失敗・切り戻し済みの履歴で出すと、
        実行前後の判断を誤らせる。
      */}
      {(!active || ['dry_run', 'review', 'ready'].includes(active.status)) && (
        <Notice tone="info" message="本移行まで、既存ユーザー・配信・シナリオには影響しません。" className="mb-4" />
      )}
      {/*
        #984 LAY-13: 段組みと寸法をそろえる。
        1段目「移行元 → 移行先」は同幅の2欄（狭い幅では1列）、
        2段目は全幅の利用目的、3段目はCSVとファイル状態、最後は操作行。
        ラベルと入力の間は8px、入力の高さは40pxでそろえる。
        移行元・移行先の選び欄は欄いっぱいに広げる（部品の size="full" を使う）。
      */}
      <section data-selects-wide className="bg-canvas rounded-card border-hairline border p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-ink-secondary block min-w-0 flex-1 text-xs font-semibold">
            <span className="mb-2 block">移行元</span>
            <Select aria-label="移行元アカウント" value={fromAccountId} onChange={(value) => setFromAccountId(value)} options={[{ value: '', label: '移行元アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} size="full" />
          </label>
          <span aria-hidden="true" className="text-ink-faint hidden h-10 items-center sm:flex">→</span>
          <label className="text-ink-secondary block min-w-0 flex-1 text-xs font-semibold">
            <span className="mb-2 block">移行先</span>
            <Select aria-label="移行先アカウント" value={toAccountId} onChange={(value) => setToAccountId(value)} options={[{ value: '', label: '移行先アカウントを選択' }, ...accounts.map((account) => ({ value: account.id, label: account.name }))]} size="full" />
          </label>
        </div>
        <label className="text-ink-secondary mt-3 block text-xs font-semibold">
          <span className="mb-2 block">利用目的</span>
          {/* 共通の入力欄（高さ40px・タッチ端末は44pxと16px文字を部品側が持つ）。 */}
          <TextField value={purpose} onChange={(event) => setPurpose(event.target.value)} />
        </label>
        {/*
          テスト移行は1回のAPI呼び出しで、途中の割合を測れない。
          実測できない進みは出さない（Progress は足さない）。
        */}
        <FileDropzone
          title="対応表のCSVをここに置く"
          hint="old_uid・new_uid 列のCSVを選びます"
          accept=".csv,text/csv"
          chooseLabel="CSVをアップロード"
          onFiles={(files) => void onUidFile(files)}
          className="mt-4"
        />
        <div className="mt-2">
          {file ? (
            <AttachmentRow
              name={file.name}
              meta={`${formatNumber(mappings.length)}行・${formatMappingBytes(file.size)}`}
              onRemove={() => { setFile(null); setMappings([]); setMessage(null) }}
            />
          ) : (
            <p className="text-ink-secondary text-sm">ファイルは未選択です</p>
          )}
        </div>
        <div className="mt-4">
          <Button variant="primary" disabled={busy} onClick={() => void createDryRun()} busy={busy} busyLabel="確認中…">テスト移行を実行</Button>
        </div>
        {message && <p role="status" className="text-ink-secondary mt-3 text-sm">{message}</p>}
      </section>

      {active ? <ActiveMigration
        active={active}
        unresolved={unresolved}
        page={page}
        classification={classification}
        pendingOnly={pendingOnly}
        busy={busy}
        detailBusy={detailBusy}
        executeBlockedReason={
          me
            ? me.role !== 'owner'
              ? '本移行の実行はownerの権限が必要です。'
              : me.id === active.createdBy
                ? 'この移行はあなたが作成したため、別のownerが実行してください。'
                : null
            : null
        }
        rollbackBlockedReason={
          me && me.role !== 'owner' ? '切り戻しはownerの権限が必要です。' : null
        }
        onShowDetail={(item) => { setDetailError(null); setDetailItem(item) }}
        onRequestExecute={() => { setExecuteError(null); setConfirmExecute(true) }}
        onRequestRollback={() => { setRollbackError(null); setRollbackConflicts([]); setConfirmRollback(true) }}
        onFilterChange={(nextClassification, nextPendingOnly) => onFilterChange(active.id, nextClassification, nextPendingOnly)}
        onPageChange={(nextPage) => onPageChange(active.id, nextPage)}
      /> : (
        <section className="bg-canvas rounded-card border-hairline overflow-hidden border">
          {/*
            空の案内も、ほかと同じカード（白地・枠・角丸）の中に出す。
            灰色の地だけの枠をカードの間に直接置くと、下の履歴カードと
            境目が重なって見える。履歴カードと同じく見出し＋空の1枚にする。
          */}
          <div className="border-hairline border-b px-4 py-3"><h2 className="text-ink text-sm font-bold">テスト移行の結果</h2></div>
          <ListState kind="empty" title="テスト移行はまだありません" description="移行元・移行先と対応表を選び、まず確認だけ実行してください。" />
        </section>
      )}

      {/*
        FRIEND-14: 「詳細を見る」は読み取り専用。開くだけでは更新APIを
        呼ばない。保存はダイアログ内の「この組合せを承認」「除外する」だけ。
      */}
      <MigrationItemDialog
        detailItem={detailItem}
        active={active}
        me={me}
        busy={busy}
        detailError={detailError}
        onClose={() => { setDetailItem(null); setDetailError(null) }}
        decide={(item, decision) => void decide(item, decision)}
      />

      {/*
        FRIEND-33: 実行ボタンはこの確認画面を開くだけで書込みはしない。
        対象・件数・権限・復旧条件を示し、確定ボタンだけが execute を呼ぶ。
        権限が無いことが分かっている場合は確定ボタン自体を出さない。
      */}
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

      {/*
        FRIEND-36: 完了・一部失敗の履歴から、確認付きで切り戻しへ進める。
        対象件数・制約（移行後の変更がある行は止まる）・権限を明示する。
      */}
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

      <MigrationHistorySection runs={runs} onSelect={selectRun} />
      {/* #984 LAY-13: 移行元・移行先の選び欄は欄いっぱいに広げる（部品の size="full" を使う）。 */}
    </div>
  )
}

/** 行の「詳細を見る」で開く読み取り専用ダイアログ。v7/v8 で共用する。 */
export function MigrationItemDialog({
  detailItem,
  active,
  me,
  busy,
  detailError,
  onClose,
  decide,
}: {
  detailItem: UidMigrationItem | null
  active: UidMigrationDetail | null
  me: { id: string; role: string } | null
  busy: boolean
  detailError: string | null
  onClose: () => void
  decide: (item: UidMigrationItem, decision: 'link' | 'create' | 'exclude') => void
}) {
  return (
    <Dialog
      open={detailItem !== null}
      title="移行内容の確認"
      description="内容の確認だけでは保存されません。承認・除外は下のボタンで確定します。"
      busy={busy}
      error={detailError ?? undefined}
      onCancel={() => { if (!busy) onClose() }}
      footer={detailItem ? (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {active && !['review', 'ready', 'failed'].includes(active.status) ? (
            <span className="text-ink-faint text-xs">この移行の状態では判断を変更できません。</span>
          ) : me && !['owner', 'admin'].includes(me.role) ? (
            <span className="text-ink-faint text-xs">判断の保存はowner/adminが行います。</span>
          ) : (<>
            {detailItem.decision !== 'exclude' && (
              <Button type="button" disabled={busy} onClick={() => decide(detailItem, 'exclude')}>除外する</Button>
            )}
            {detailItem.newUid && detailItem.decision !== 'link' && (
              <Button type="button" variant="primary" disabled={busy} onClick={() => decide(detailItem, 'link')}>この組合せを承認</Button>
            )}
          </>)}
        </div>
      ) : undefined}
    >
      {detailItem && (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <div><dt className="text-ink-faint text-xs">旧UID</dt><dd className="text-ink break-all">{detailItem.oldUid}</dd></div>
          <div><dt className="text-ink-faint text-xs">新UID</dt><dd className="text-ink break-all">{detailItem.newUid ?? '—'}</dd></div>
          <div><dt className="text-ink-faint text-xs">候補ユーザー</dt><dd className="text-ink">{detailItem.candidateName ?? '候補なし'}</dd></div>
          <div><dt className="text-ink-faint text-xs">一致根拠</dt><dd className="text-ink">{({ same_provider: '同一提供者', line_login: 'LINEログイン', signed_customer_id: '署名済み顧客ID', verified_contact: '確認済み連絡先', operator_csv: '運用者のCSV', manual: '手作業' } as const)[detailItem.evidenceType]}</dd></div>
          <div><dt className="text-ink-faint text-xs">分類</dt><dd className="text-ink">{classLabel[detailItem.classification]}</dd></div>
          <div><dt className="text-ink-faint text-xs">競合内容</dt><dd className="text-ink">{detailItem.conflictReason ?? '—'}</dd></div>
          <div><dt className="text-ink-faint text-xs">現在の判断</dt><dd className="text-ink font-semibold">{decisionLabel[detailItem.decision]}</dd></div>
          <div><dt className="text-ink-faint text-xs">実行結果</dt><dd className="text-ink">{({ pending: '未実行', applied: '反映済み', skipped: '除外', failed: '失敗', rolled_back: '切り戻し済み' } as const)[detailItem.result]}{detailItem.errorMessage ? `（${detailItem.errorMessage}）` : ''}</dd></div>
        </dl>
      )}
    </Dialog>
  )
}

/** 本移行の実行確認（v7/v8 共用）。確定ボタンだけが execute を呼ぶ。 */
export function ExecuteConfirmDialog({
  active,
  accounts,
  me,
  busy,
  open,
  error,
  canRun,
  onConfirm,
  onCancel,
}: {
  active: UidMigrationDetail | null
  accounts: LineAccount[]
  me: { id: string; role: string } | null
  busy: boolean
  open: boolean
  error: string | null
  canRun: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!active) return null
  return (
    <ConfirmDialog
      open={open}
      title="本移行を実行します"
      description="実行すると友だちと統合ユーザーの紐付けが実際に変わります。内容を確認してから確定してください。"
      confirmLabel="本移行を実行"
      busy={busy}
      error={error ?? undefined}
      onConfirm={canRun ? onConfirm : undefined}
      onCancel={onCancel}
    >
      <ul className="text-ink list-disc space-y-1 pl-5 text-sm">
        <li>対象：{accounts.find((account) => account.id === active.fromAccountId)?.name ?? active.fromAccountId} → {accounts.find((account) => account.id === active.toAccountId)?.name ?? active.toAccountId}</li>
        <li>結び付け {active.decisionCounts?.link ?? '—'} 件・除外 {active.decisionCounts?.exclude ?? '—'} 件・新規作成の判断 {active.decisionCounts?.create ?? '—'} 件（自動反映できない行は失敗として記録されます）</li>
        <li>実行権限：ownerのみ。テスト移行を作成した本人は実行できません。</li>
        <li>復旧：実行後、この履歴から反映済みの分だけ切り戻せます。移行後に別の変更があった行は切り戻しを止めて表示します。</li>
      </ul>
      {me && me.role !== 'owner' && <p className="text-danger mt-2 text-sm font-semibold">本移行の実行はownerの権限が必要です。</p>}
      {me && me.role === 'owner' && me.id === active.createdBy && <p className="text-danger mt-2 text-sm font-semibold">この移行はあなたが作成したため、別のownerが実行してください。</p>}
    </ConfirmDialog>
  )
}

/** 切り戻しの確認（v7/v8 共用）。 */
export function RollbackConfirmDialog({
  active,
  me,
  busy,
  open,
  error,
  conflicts,
  canRun,
  onConfirm,
  onCancel,
}: {
  active: UidMigrationDetail | null
  me: { id: string; role: string } | null
  busy: boolean
  open: boolean
  error: string | null
  conflicts: Array<{ itemId: string; oldUid: string; reason: string }>
  canRun: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  if (!active) return null
  return (
    <ConfirmDialog
      open={open}
      title="この移行を切り戻します"
      description={`反映した ${formatNumber(active.counts.applied)} 件を移行前の紐付けに戻します。移行後に別の変更があった行は切り戻さず、競合として表示します。`}
      confirmLabel="切り戻す"
      destructive
      busy={busy}
      error={error ?? undefined}
      onConfirm={canRun ? onConfirm : undefined}
      onCancel={onCancel}
    >
      <ul className="text-ink list-disc space-y-1 pl-5 text-sm">
        <li>対象：この履歴で反映済みの {formatNumber(active.counts.applied)} 行だけです。失敗・除外の行は変更しません。</li>
        <li>制約：移行後に統合ユーザーへ別の変更があった行は切り戻せません。</li>
        <li>実行権限：ownerのみ。</li>
      </ul>
      {conflicts.length > 0 && (
        <ul className="text-danger mt-2 list-disc space-y-1 pl-5 text-sm">
          {conflicts.map((conflict) => <li key={conflict.itemId}>{conflict.oldUid}：{conflict.reason}</li>)}
        </ul>
      )}
      {me && me.role !== 'owner' && <p className="text-danger mt-2 text-sm font-semibold">切り戻しはownerの権限が必要です。</p>}
    </ConfirmDialog>
  )
}

/** 履歴一覧（v7 ではカード内の行ボタン）。v8 では表で使い回す。 */
export function MigrationHistorySection({ runs, onSelect }: { runs: UidMigrationDetail[] | import('@/lib/api').UidMigrationRun[]; onSelect: (runId: string) => void }) {
  return (
    <section id="migration-history" className="bg-canvas rounded-card border-hairline border"><div className="border-hairline border-b px-4 py-3"><h2 className="text-ink text-sm font-bold">移行履歴</h2></div>{runs.length === 0 ? <ListState kind="empty" title="移行履歴はまだありません" /> : <div className="divide-hairline divide-y">{runs.map((run) => {
      /*
        FRIEND-15: 履歴の状態表示も run.status だけで決める。
        一部失敗と完了を同じ「反映ずみ」で出さない。
      */
      const badge: { tone: StatusBadgeTone; label: string } =
        run.status === 'completed' ? { tone: 'success', label: '本移行済み' }
          : run.status === 'rolled_back' ? { tone: 'neutral', label: '切り戻し済み' }
            : run.status === 'failed' ? { tone: 'danger', label: run.counts.applied > 0 ? '一部失敗' : '失敗' }
              : run.status === 'executing' ? { tone: 'info', label: '実行中' }
                : run.status === 'ready' ? { tone: 'success', label: '確認完了' }
                  : { tone: 'neutral', label: '確認中' }
      return <button key={run.id} className="hover:bg-canvas-sunken flex w-full items-center justify-between px-4 py-3 text-left" onClick={() => onSelect(run.id)}><span><span className="text-ink block text-sm font-semibold">{run.purpose}</span><span className="text-ink-faint text-xs">{formatDateTime(run.createdAt)} ・ {formatNumber(run.counts.total)}件</span></span><StatusBadge tone={badge.tone}>{badge.label}</StatusBadge></button>
    })}</div>}</section>
  )
}

function ActiveMigration({
  active,
  unresolved,
  page,
  classification,
  pendingOnly,
  busy,
  detailBusy,
  executeBlockedReason,
  rollbackBlockedReason,
  onShowDetail,
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
  /** FRIEND-16: 別の対応表を読み込んでいる間は判断・実行・切り戻しを止める。 */
  detailBusy: boolean
  executeBlockedReason: string | null
  rollbackBlockedReason: string | null
  onShowDetail: (item: UidMigrationItem) => void
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
  {/* 中のカード同士も親の gap-4（16px）でそろえる。mb-6（24px）は作らない。 */}
  return (<div className="flex flex-col gap-4">
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <KpiCard variant="v6" title="読み込み" value={active.counts.total} unit="件" detail="" help="対応表の全件です" />
      <KpiCard variant="v6" title="自動一致" value={active.counts.auto} unit="件" detail={active.counts.total ? `${Math.round(active.counts.auto / active.counts.total * 1000) / 10}%` : '0%'} />
      <KpiCard variant="v6" title="要確認・競合" value={active.counts.review + active.counts.conflict} unit="件" detail="すべて判断が必要" />
      <KpiCard variant="v6" title="未一致" value={active.counts.unmatched} unit="件" detail="除外（新規作成は取り込みで）" />
    </div>
    <div className="bg-canvas rounded-card border-hairline overflow-hidden border">
      {/*
        FRIEND-15: 見出し・説明・バッジは run.status で連動させる。
        完了履歴へ「実データはまだ変更していません」は出さない。
      */}
      <div className="border-hairline flex items-center justify-between border-b px-4 py-3"><div><h2 className="text-ink text-sm font-bold">{statusView.heading}</h2><p className="text-ink-faint text-xs">{statusView.description}</p></div><StatusBadge tone={statusView.badgeTone}>{statusView.badgeLabel}</StatusBadge></div>
      {detailBusy && <p role="status" className="text-ink-faint border-hairline border-b px-4 py-2 text-xs">対応表を読み込んでいます…</p>}
      <div className="border-hairline flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Select aria-label="分類で絞り込む" value={classification} onChange={(value) => onFilterChange(value as '' | ItemClassification, pendingOnly)} options={[{ value: '', label: 'すべての分類' }, ...ITEM_CLASSIFICATIONS.map((value) => ({ value, label: classLabel[value] }))]} size="standard" />
        <Checkbox checked={pendingOnly} onCheckedChange={(checked) => onFilterChange(classification, checked)}>未判断のみ</Checkbox>
        <span className="text-ink-faint ml-auto text-xs">全 {formatNumber(total)} 件</span>
      </div>
      {(active.items?.length ?? 0) === 0 ? <ListState kind="empty" title="対応表に結果がありません" description="絞り込みを変えるか、別のCSVを選んでテスト移行してください。" /> : <DataTable className="rounded-none border-0">
        <thead><TableHeadRow><Th className="w-1/6">旧UID</Th><Th className="w-1/6">候補ユーザー</Th><Th className="w-1/6">一致根拠</Th><Th>競合内容</Th><Th className="w-1/12">判断</Th><Th className="w-1/6">操作</Th></TableHeadRow></thead>
        <tbody>{active.items?.map((item) => <Tr key={item.id} className="align-top">
          <Td className="truncate text-sm" title={item.oldUid}>{item.oldUid}</Td><Td className="text-sm">{item.candidateName ?? '候補なし'}</Td>
          <Td><StatusBadge tone={item.classification === 'auto' ? 'success' : item.classification === 'unmatched' ? 'neutral' : 'warning'}>{classLabel[item.classification]}</StatusBadge></Td>
          <Td className="text-ink-secondary text-sm">{item.conflictReason ?? '—'}</Td><Td className="text-sm">{item.decision === 'pending' ? '要確認' : decisionLabel[item.decision]}</Td>
          {/*
            FRIEND-14: 「詳細を見る」は読み取り専用のダイアログを開くだけ。
            以前の「移行内容を確認」はクリックした時点で結び付けを保存して
            いたため、読むつもりの操作が書き込みになっていた。
          */}
          <ActionCell><div className="flex flex-wrap items-center gap-2">
            {/* #641: 行操作は共通の枠つきボタン */}
            <Button type="button" variant="secondary" disabled={busy || detailBusy} onClick={() => onShowDetail(item)}>開く</Button>
            {!item.newUid && <span className="text-ink-faint text-xs">一致先なし（新規作成は「CSVで書き出す・取り込む」で行ってください）</span>}
          </div></ActionCell>
        </Tr>)}</tbody>
      </DataTable>}
      {showPager && <div className="border-hairline flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        {/* 0始まりの page を1始まりに直して渡す。読み込み中は Pagination ごと止める。 */}
        <ListRange total={total} first={from} last={to} />
        <Pagination page={page + 1} pageCount={Math.max(1, Math.ceil(total / ITEM_PAGE_SIZE))} onPageChange={(next) => onPageChange(next - 1)} disabled={busy || detailBusy} />
      </div>}
    </div>
    {/*
      FRIEND-33/36: 「本移行を実行」「この移行を切り戻す」はどちらも
      確認ダイアログを開くだけで、ここでは書き込まない。
      権限が無いなら理由を文字で示す（押せるのに失敗する形にしない）。
    */}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-ink-secondary text-sm">
        {active.status === 'ready'
          ? '競合をすべて判断すると、本移行へ進めます。本移行は別のownerによる確認が必要です。'
          : active.status === 'failed'
            ? '失敗した行の判断を直して再実行するか、反映済みの分だけ切り戻せます。'
            : active.status === 'completed'
              ? '反映済みの内容は、この履歴から切り戻せます。'
              : active.status === 'rolled_back'
                ? 'この移行は切り戻し済みです。'
                : '要確認の行をすべて判断すると、本移行へ進めます。'}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {active.rollbackable && (
          rollbackBlockedReason
            ? <span className="text-ink-faint text-xs">{rollbackBlockedReason}</span>
            : <Button type="button" variant="danger" disabled={busy || detailBusy} onClick={onRequestRollback}>この移行を切り戻す</Button>
        )}
        {active.status === 'ready' && (<>
          {executeBlockedReason && <span className="text-ink-faint text-xs">{executeBlockedReason}</span>}
          {/*
            FRIEND-33: 権限が無いときもボタンは押せる。確認画面で
            「なぜ実行できないか」と対象・件数を読めるようにし、
            確定ボタンだけを出さない。
          */}
          <Button type="button" variant="primary" disabled={busy || detailBusy} onClick={onRequestExecute}>本移行を実行</Button>
        </>)}
      </div>
    </div>
  </div>)
}
