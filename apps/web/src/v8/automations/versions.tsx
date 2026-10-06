'use client'

/*
 * ★V8 共通アクションの版と使われている場所（Pencil `ziSgL`）。
 *
 * 2026-10-06 オーナー決定で src/v8 に一から書いた。データの口・動きは今までの V8
 * （app/common-actions/common-action-versions-v8.tsx）と同じ（版の履歴・公開・前の版から新版・
 * 利用先の版切り替え・月次集計・読めないときの扱い）。違いは見せ方だけ——
 * 型（DetailPage）に、戻る道・題・説明・右上の操作・4つの数のマス・版の履歴・呼び出し元の表を渡す。
 */
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { BookOpen, GitBranch, History, Link2, Pencil, Upload, Zap } from 'lucide-react'
import { api, ApiError, type CommonActionDetail, type CommonActionStep, type CommonActionSummary } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useManualHref } from '@/lib/use-manual-href'
import { formatNumber } from '@/lib/format'
import { DetailPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import KpiCard from '@/components/shared/kpi-card'
import kpiStyles from '@/components/shared/kpi-card.module.css'
import { DataTable, TableHeadRow, Th, Tr, Td } from '@/components/shared/table'
import { useAutomationManage } from './shell'
import { describeVersionChanges } from './version-diff'
import styles from './versions.module.css'

/** 利用先の種類（今の画面と同じ言葉）。 */
const CONSUMER_LABELS: Record<string, string> = {
  scenario: 'シナリオ',
  automation: 'オートメーション',
  auto_reply: '自動応答',
  broadcast: '一斉配信',
  reminder: 'リマインダ',
  form: '回答フォーム',
  rich_menu: 'リッチメニュー',
  entry_route: '流入リンク',
}

/** 処理の短い名前（版の履歴の1行：「タグ → 待つ 1日 → メッセージ「お礼」」）。 */
const STEP_SHORT: Record<string, string> = {
  add_tag: 'タグ', remove_tag: 'タグを外す', set_metadata: '友だち情報を書く',
  start_scenario: 'シナリオ', stop_scenario: 'シナリオを止める', resume_scenario: 'シナリオを再開',
  send_message: 'メッセージ', send_webhook: '外部連携', switch_rich_menu: 'メニュー切替',
  remove_rich_menu: 'メニューを外す', common_action: '共通アクション', branch: '条件で分ける',
  notify_staff: '担当へ知らせる', add_mileage: 'マイル',
}

function waitText(params: Record<string, unknown>): string {
  const minutes = params.durationMinutes ?? params.minutes
  if (typeof minutes !== 'number' || !Number.isFinite(minutes)) return '待つ'
  if (minutes % 1440 === 0) return `待つ ${minutes / 1440}日`
  if (minutes % 60 === 0) return `待つ ${minutes / 60}時間`
  return `待つ ${minutes}分`
}

/** 版の処理の並びを1行にする。 */
export function stepChain(actions: CommonActionStep[]): string {
  if (actions.length === 0) return '処理はありません'
  return actions.map((step) => {
    if (step.type === 'wait') return waitText(step.params)
    const base = STEP_SHORT[step.type] ?? '処理'
    const name = typeof step.params.templateName === 'string' ? step.params.templateName : ''
    return step.type === 'send_message' && name ? `${base}「${name}」` : base
  }).join(' → ')
}

/** 「オートメーション 3・シナリオ 1」。 */
export function consumerBreakdown(bindings: Array<{ consumerType: string }>): string {
  if (bindings.length === 0) return 'まだどこからも呼ばれていません'
  const counts = new Map<string, number>()
  for (const binding of bindings) counts.set(binding.consumerType, (counts.get(binding.consumerType) ?? 0) + 1)
  return [...counts].map(([kind, count]) => `${CONSUMER_LABELS[kind] ?? 'ほか'} ${count}`).join('・')
}

/** 「9/24」（日本時間）。 */
function monthDay(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric' }).formatToParts(date)
  return `${parts.find((part) => part.type === 'month')?.value ?? ''}/${parts.find((part) => part.type === 'day')?.value ?? ''}`
}

function VersionsInner() {
  usePageTitle('版と使われている場所')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: 'オートメーション', href: '/automations' }])
  const canManage = useAutomationManage()
  const canEdit = canManage !== false
  const manualHref = useManualHref('/common-actions/versions')
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<CommonActionDetail | null>(null)
  const [summary, setSummary] = useState<CommonActionSummary | null>(null)
  const [summaryError, setSummaryError] = useState('')
  const [summaryRetrying, setSummaryRetrying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [loadFailure, setLoadFailure] = useState<'missing' | 'forbidden' | 'error' | null>(null)
  const [pendingBindingId, setPendingBindingId] = useState<string | null>(null)
  const [dialogError, setDialogError] = useState('')
  const requestSeq = useRef(0)
  const lastTargetKey = useRef('')

  /* 月次の件数は一覧の口から読む（版の口には無い）。読めなくても版と利用先は出す。 */
  const readSummary = useCallback(async (my: number) => {
    if (!selectedAccountId) return
    try {
      const listResponse = await api.commonActions.list({ accountId: selectedAccountId })
      if (requestSeq.current !== my) return
      if (listResponse.success) {
        setSummary(listResponse.data.find((item) => item.id === id) ?? null)
        setSummaryError('')
      } else {
        setSummary(null)
        setSummaryError(listResponse.error || '月次件数を読み込めませんでした。通信の状態を確認してください。')
      }
    } catch {
      if (requestSeq.current !== my) return
      setSummary(null)
      setSummaryError('月次件数を読み込めませんでした。通信の状態を確認してください。')
    }
  }, [id, selectedAccountId])

  const reloadSummary = async () => {
    const my = ++requestSeq.current
    setSummaryRetrying(true)
    await readSummary(my)
    if (requestSeq.current === my) setSummaryRetrying(false)
  }

  const load = useCallback(async () => {
    if (!selectedAccountId || !id) {
      setDetail(null); setSummary(null); setSummaryError(''); setLoading(false)
      return
    }
    const targetKey = `${selectedAccountId}\u0000${id}`
    if (lastTargetKey.current !== targetKey) {
      lastTargetKey.current = targetKey
      setDetail(null); setSummary(null); setSummaryError(''); setPendingBindingId(null)
    }
    const my = ++requestSeq.current
    setLoading(true)
    setError('')
    setLoadFailure(null)
    try {
      const response = await api.commonActions.get(id, selectedAccountId)
      if (requestSeq.current !== my) return
      if (response.success) setDetail(response.data)
      else { setDetail(null); setError(response.error); setLoadFailure('error') }
    } catch (caught) {
      if (requestSeq.current !== my) return
      setDetail(null)
      if (caught instanceof ApiError && caught.status === 404) {
        setError('この共通アクションは削除されたか、別のLINEアカウントのものです。')
        setLoadFailure('missing')
      } else if (caught instanceof ApiError && caught.status === 403) {
        setError('この共通アクションを表示する権限がありません。')
        setLoadFailure('forbidden')
      } else {
        setError(caught instanceof Error && caught.message && !caught.message.startsWith('API error:')
          ? caught.message
          : '版と利用先を読み込めませんでした。通信の状態を確認してください。')
        setLoadFailure('error')
      }
    }
    await readSummary(my)
    if (requestSeq.current === my) setLoading(false)
  }, [id, selectedAccountId, readSummary])

  useEffect(() => { if (!accountLoading) void load() }, [accountLoading, load])

  const published = useMemo(() => detail?.versions.find((version) => version.id === detail.currentPublishedVersionId) ?? null, [detail])
  const draft = useMemo(() => detail?.versions.find((version) => version.id === detail.currentDraftVersionId) ?? null, [detail])
  const pendingBinding = useMemo(() => detail?.bindings.find((binding) => binding.id === pendingBindingId) ?? null, [detail, pendingBindingId])
  const pendingVersion = useMemo(() => detail?.versions.find((version) => version.id === pendingBinding?.versionId) ?? null, [detail, pendingBinding])
  /* 版は新しい順（下書き → いまの版 → 古い版）。 */
  const versions = useMemo(() => [...(detail?.versions ?? [])].sort((a, b) => b.versionNumber - a.versionNumber), [detail])

  const run = async (key: string, task: () => Promise<unknown>): Promise<true | string> => {
    if (working) return '操作を実行できませんでした'
    if (!selectedAccountId) {
      setError('LINEアカウントを選び直してください。')
      return 'LINEアカウントを選び直してください。'
    }
    setWorking(key)
    setError('')
    try {
      await task()
      await load()
      return true
    } catch (caught) {
      const message = caught instanceof ApiError || caught instanceof Error ? caught.message : '操作を完了できませんでした'
      setError(message)
      return message
    } finally {
      setWorking('')
    }
  }

  if (!id) {
    return <TargetMissing kind="unspecified" title="版を確認する共通アクションが指定されていません" description="一覧から共通アクションを選び直してください。" backHref="/common-actions" backLabel="共通アクション一覧へ戻る" />
  }
  if (loading && !detail) return <ListState kind="loading" title="版と利用先を読み込んでいます" />
  if (!selectedAccountId && !detail) {
    return <ListState kind="empty" title="LINE公式アカウントを選んでください" description="選ぶと版と利用先を確認できます。" action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>} />
  }
  if (!detail && loadFailure === 'missing') {
    return <TargetMissing kind="not-found" title="この共通アクションは見つかりません" description="削除されたか、別のLINEアカウントのものです。一覧から選び直してください。" backHref="/common-actions" backLabel="共通アクション一覧へ戻る" />
  }
  if (!detail && loadFailure === 'forbidden') {
    return <ListState kind="forbidden" title="この共通アクションを表示する権限がありません" description="権限のある人に確認するか、別のLINEアカウントを選んでください。" action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>} />
  }
  if (!detail) {
    return <TargetMissing kind="error" title="版と利用先を読み込めませんでした" description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。" onRetry={() => void load()} />
  }

  const outdatedCount = detail.bindings.filter((binding) => binding.hasNewerVersion).length
  const editHref = `/common-actions/edit?id=${encodeURIComponent(detail.id)}`

  return (
    <DetailPage
      boardId="ziSgL"
      headingSize="regular"
      identity={<Link href="/common-actions" className={styles.back}>← 共通アクション一覧へ戻る</Link>}
      title={`${detail.name}（版と使われている場所）`}
      description="公開した版は書き換えられません。公開しても、呼び出し元は自動で変わりません。使う場所ごとに新しい版へ更新します。"
      actions={<>
        {manualHref ? <Button href={manualHref}><BookOpen size={15} aria-hidden="true" />マニュアル</Button> : null}
        {canEdit && draft ? (
          <Button href={editHref}><Pencil size={15} aria-hidden="true" />下書きの中身を編集</Button>
        ) : canEdit && published ? (
          <Button
            disabled={Boolean(working)}
            onClick={() => void run('draft', () => api.commonActions.createDraft(detail.id, selectedAccountId!, published.id))}
          >
            <Pencil size={15} aria-hidden="true" />前の版から新版を作る
          </Button>
        ) : null}
      </>}
    >
      <div className={styles.body}>
      {summaryError ? (
        <div className={styles.errorBand} role="alert">
          <span>月次件数を読み込めませんでした。版と利用先は表示しています。</span>
          <Button variant="secondary" disabled={summaryRetrying} onClick={() => void reloadSummary()}>月次件数をもう一度読み込む</Button>
        </div>
      ) : null}

      <div className={`${kpiStyles.strip} ${styles.cards}`}>
        <KpiCard presentation="cell" title="いまの版" icon={<GitBranch size={13} aria-hidden="true" />} value={null} valueText={published ? `v${published.versionNumber}` : '—'} unit="" detail={published?.publishedAt ? `${monthDay(published.publishedAt)} 公開` : 'まだ公開していません'} />
        <KpiCard presentation="cell" title="呼び出し元" icon={<Link2 size={13} aria-hidden="true" />} value={detail.bindings.length} unit="か所" detail={consumerBreakdown(detail.bindings)} />
        <KpiCard presentation="cell" title="古い版のまま" icon={<History size={13} aria-hidden="true" />} value={outdatedCount} unit="か所" detail={outdatedCount > 0 ? '新版あり' : 'すべて最新の版です'} />
        <KpiCard presentation="cell" title="今月 動いた回数" icon={<Zap size={13} aria-hidden="true" />} value={summary?.executionCountThisMonth ?? null} unit="回" detail={`失敗 ${summary ? formatNumber(summary.failureCountThisMonth) : '—'}`} />
      </div>

      {error ? <p className={styles.errorText} role="alert">{error}</p> : null}

      <section className={styles.historyCard} aria-labelledby="versions-history-title">
        <h2 id="versions-history-title" className={styles.cardTitle}>版の履歴</h2>
        <p className={styles.cardLead}>公開しても、使っている所は今の版のまま。使う所ごとに新しい版へ切り替えます。</p>
        <ul className={styles.versionList}>
          {versions.map((version) => {
            const isDraft = version.status === 'draft'
            const isCurrent = version.id === detail.currentPublishedVersionId
            const label = isDraft ? '下書き' : isCurrent ? '公開中' : '古い版'
            return (
              <li key={version.id} className={styles.versionRow}>
                <span className={styles.versionName}>{`v${version.versionNumber}`}</span>
                <span className={styles.pill} data-tone={isCurrent ? 'active' : 'neutral'}>
                  <span className={styles.pillDot} aria-hidden="true" />
                  {label}
                </span>
                <span className={styles.versionChain} title={stepChain(version.actions)}>{stepChain(version.actions)}</span>
                {!canEdit ? null : isDraft ? (
                  <Button
                    variant="primary"
                    disabled={Boolean(working)}
                    onClick={() => void run(`publish:${version.id}`, () => api.commonActions.publish(detail.id, selectedAccountId!, version.id, version.draftRevision))
                      .then((result) => {
                        if (result !== true) void (async () => { await load(); setError((current) => current || result) })()
                      })}
                  >
                    <Upload size={15} aria-hidden="true" />公開する
                  </Button>
                ) : (
                  /* 下書きがある間は新しい版を作れない（サーバも draft_exists で断る）。押せない理由を添える。 */
                  <Button
                    disabled={Boolean(working) || Boolean(draft)}
                    title={draft ? '下書きを公開すると、この版から新しい版を作れます' : undefined}
                    onClick={() => void run(`copy:${version.id}`, () => api.commonActions.createDraft(detail.id, selectedAccountId!, version.id))}
                  >
                    この版から新しい版
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </section>

      <section className={styles.usage} aria-labelledby="versions-usage-title">
        <h2 id="versions-usage-title" className={styles.usageTitle}>どこから呼ばれているか</h2>
        {detail.bindings.length === 0 ? (
          <p className={styles.cardLead}>まだどこからも呼ばれていません。</p>
        ) : (
          <div className={styles.tableBox}>
            <DataTable className={styles.table}>
              <thead>
                <TableHeadRow className={styles.headRow} data-table-layout="columns">
                  <Th className={styles.colWhere}>利用先</Th>
                  <Th className={styles.colPinned}>固定中の版</Th>
                  <Th className={styles.colNum} align="right">実行中</Th>
                  <Th className={styles.colNum} align="right">待機中</Th>
                  <Th className={styles.colState}>状態</Th>
                  <Th className={styles.colOps}>操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {detail.bindings.map((binding) => (
                  <Tr key={binding.id} className={styles.row} data-table-layout="columns">
                    <Td className={styles.colWhere}>
                      <span className={styles.where} title={binding.consumerPath || '全体'}>{binding.consumerPath || '全体'}</span>
                      <span className={styles.whereSub}>{CONSUMER_LABELS[binding.consumerType] ?? binding.consumerType}</span>
                    </Td>
                    <Td className={styles.colPinned}><span className={styles.cell}>{`v${binding.versionNumber}`}</span></Td>
                    <Td className={styles.colNum}>
                      <span className={styles.cell} title={binding.runningCount === null ? '未取得' : undefined}>{binding.runningCount ?? '—'}</span>
                      {binding.olderRunningCount ? <span className={styles.whereSub}>{`旧版 ${binding.olderRunningCount}`}</span> : null}
                    </Td>
                    <Td className={styles.colNum}>
                      <span className={styles.cell} title={binding.waitingCount === null ? '未取得' : undefined}>{binding.waitingCount ?? '—'}</span>
                      {binding.olderWaitingCount ? <span className={styles.whereSub}>{`旧版 ${binding.olderWaitingCount}`}</span> : null}
                    </Td>
                    <Td className={styles.colState}>
                      <span className={styles.pill} data-tone={binding.hasNewerVersion ? 'info' : 'active'}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {binding.hasNewerVersion ? '新版あり' : '最新'}
                      </span>
                    </Td>
                    <Td className={styles.colOps}>
                      {canEdit && binding.hasNewerVersion && published ? (
                        <Button disabled={Boolean(working)} onClick={() => { setPendingBindingId(binding.id); setDialogError('') }}>
                          {`v${published.versionNumber} へ更新する`}
                        </Button>
                      ) : <span className={styles.cellMuted}>—</span>}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        )}
      </section>
      <p className={styles.footBox}>更新しても、実行中・待機中の処理は変えず、次に始まる処理から新版を使います。</p>
      </div>

      <Dialog
        open={Boolean(pendingBinding && published)}
        title={`この利用先をv${published?.versionNumber ?? ''}へ更新しますか`}
        description="実行中・待機中の処理は変えず、次に始まる処理から新版を使います。"
        confirmLabel={`v${published?.versionNumber ?? ''}へ更新`}
        busy={working.startsWith('binding:')}
        onCancel={() => { setPendingBindingId(null); setDialogError('') }}
        onConfirm={() => {
          if (!pendingBinding || !published || !selectedAccountId) return
          setDialogError('')
          void run(`binding:${pendingBinding.id}`, () => api.commonActions.updateBinding(detail.id, selectedAccountId, {
            bindingId: pendingBinding.id,
            versionId: published.id,
            expectedVersionId: pendingBinding.versionId,
          })).then((result) => {
            if (result === true) { setPendingBindingId(null); setDialogError('') }
            else { setDialogError(result); void load() }
          })
        }}
      >
        <div className={styles.compare}>
          <section>
            <p className={styles.compareLabel}>現在の版</p>
            <p className={styles.compareValue}>{`v${pendingBinding?.versionNumber ?? '—'}・${pendingVersion?.actions.length ?? '—'}個の処理`}</p>
            <p className={styles.cardLead}>{pendingVersion ? stepChain(pendingVersion.actions) : '未取得'}</p>
          </section>
          <section>
            <p className={styles.compareLabel}>更新後</p>
            <p className={styles.compareValue}>{`v${published?.versionNumber ?? '—'}・${published?.actions.length ?? '—'}個の処理`}</p>
            <p className={styles.cardLead}>{published ? stepChain(published.actions) : '未取得'}</p>
          </section>
        </div>
        {pendingVersion && published ? (
          <section>
            <p className={styles.compareLabel}>変わった点</p>
            <ul className={styles.changeList}>
              {describeVersionChanges(pendingVersion.actions, published.actions).map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>
        ) : null}
        <p className={styles.cardLead}>
          {`影響：実行中 ${pendingBinding?.runningCount ?? '—'}件、待機中 ${pendingBinding?.waitingCount ?? '—'}件は現在の版のまま完了します。`}
        </p>
        {dialogError ? <p className={styles.errorText} role="alert">{dialogError}</p> : null}
      </Dialog>
    </DetailPage>
  )
}

export default function CommonActionVersionsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="版と利用先を読み込んでいます" />}>
      <VersionsInner />
    </Suspense>
  )
}
