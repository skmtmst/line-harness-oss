'use client'

import { sumBindingCount, usageSummaryDetail } from '../usage-summary'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, type CommonActionDetail, type CommonActionSummary, type CommonActionVersion } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import Notice from '@/components/shared/notice'
import TargetMissing from '@/components/shared/target-missing'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import KpiCard from '@/components/shared/kpi-card'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import { CommonActionVersionsV8 } from '../common-action-versions-v8'
import { useManualHref } from '@/lib/use-manual-href'

/* 監査 R468: 処理名と版の変わり方は version-diff.ts に集める。 */
import { ACTION_LABELS, describeVersionChanges, versionChangeLines, versionChangeSummary } from '../version-diff'
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'

const CONSUMER_LABELS: Record<string, string> = {
  scenario: 'シナリオ配信',
  form: '回答フォーム',
  auto_reply: '自動応答',
  rich_menu: 'リッチメニュー',
  automation: 'オートメーション',
}

function CommonActionVersionsInner() {
  // ★V7: 画面の題は上の帯だけ。本文の PageHeader は説明だけ残し、見出しは帯と同じ言葉にして隠す。
  usePageTitle('版と使われている場所')
  const canManage = useCanManageCommonActions()
  /* 監査 R128: 正本表に登録があるときだけ出す。無ければボタン自体を出さない。 */
  const manualHref = useManualHref('/common-actions/versions')
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<CommonActionDetail | null>(null)
  const [summary, setSummary] = useState<CommonActionSummary | null>(null)
  /* 監査 R586: 月次集計だけの失敗は詳細と分ける。版・利用先・履歴は残す。 */
  const [summaryError, setSummaryError] = useState('')
  const [summaryRetrying, setSummaryRetrying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  /** 取得の失敗の内訳（操作の失敗とは分ける）。 */
  const [loadFailure, setLoadFailure] = useState<'missing' | 'forbidden' | 'error' | null>(null)
  const [pendingBindingId, setPendingBindingId] = useState<string | null>(null)
  /* 監査 R467: 切替の失敗理由は操作中の確認窓内に出す。 */
  const [dialogError, setDialogError] = useState('')
  /*
   * 監査 R465: 取得の世代。対象（アカウント/ID）が変わったら旧詳細と
   * 操作をクリアし、遅い旧応答の成功・失敗を現在へ混ぜない。
   */
  const requestSeq = useRef(0)
  const lastTargetKey = useRef('')

  /* 監査 R586: 月次集計だけを取り直す。詳細は触らない。 */
  const reloadSummary = useCallback(async () => {
    if (!selectedAccountId || !id) return
    const my = ++requestSeq.current
    setSummaryRetrying(true)
    setSummaryError('')
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
    } finally {
      if (requestSeq.current === my) setSummaryRetrying(false)
    }
  }, [id, selectedAccountId])

  const load = useCallback(async () => {
    // U096: 対象が無いURLでは取りに行かない。案内は描画側で出す。
    if (!selectedAccountId || !id) {
      setDetail(null)
      setSummary(null)
      setSummaryError('')
      setLoading(false)
      return
    }
    const targetKey = `${selectedAccountId}\u0000${id}`
    if (lastTargetKey.current !== targetKey) {
      lastTargetKey.current = targetKey
      setDetail(null)
      setSummary(null)
      setSummaryError('')
      setPendingBindingId(null)
    }
    const my = ++requestSeq.current
    setLoading(true)
    setError('')
    setLoadFailure(null)
    setSummaryError('')
    // 監査 R586: 詳細と月次集計は別々に取り、片方の失敗でもう片方を捨てない。
    try {
      const response = await api.commonActions.get(id, selectedAccountId)
      if (requestSeq.current !== my) return
      if (response.success) setDetail(response.data)
      else {
        setDetail(null)
        setError(response.error)
        setLoadFailure('error')
      }
    } catch (caught) {
      if (requestSeq.current !== my) return
      setDetail(null)
      // U096: 生の `API error: 404` を主文にしない。原因別の言葉に写す。
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
      // 一覧だけの失敗は全体の失敗にしない。詳細の loadFailure は触らない。
      setSummaryError('月次件数を読み込めませんでした。通信の状態を確認してください。')
    } finally {
      if (requestSeq.current === my) setLoading(false)
    }
  }, [id, selectedAccountId])

  useEffect(() => {
    if (!accountLoading) void load()
  }, [accountLoading, load])

  const published = useMemo(
    () => detail?.versions.find((version) => version.id === detail.currentPublishedVersionId) ?? null,
    [detail],
  )
  const draft = useMemo(
    () => detail?.versions.find((version) => version.id === detail.currentDraftVersionId) ?? null,
    [detail],
  )
  const pendingBinding = useMemo(
    () => detail?.bindings.find((binding) => binding.id === pendingBindingId) ?? null,
    [detail, pendingBindingId],
  )
  const pendingVersion = useMemo(
    () => detail?.versions.find((version) => version.id === pendingBinding?.versionId) ?? null,
    [detail, pendingBinding],
  )
  /*
   * 監査 R469: 未取得（null）を含む合計は確定しない。0 に混ぜず「—」で出す。
   */
  const runningTotal = detail ? sumBindingCount(detail.bindings, 'runningCount') : null
  const waitingTotal = detail ? sumBindingCount(detail.bindings, 'waitingCount') : null
  const olderRunningTotal = detail ? sumBindingCount(detail.bindings, 'olderRunningCount') : null
  const olderWaitingTotal = detail ? sumBindingCount(detail.bindings, 'olderWaitingCount') : null

  const run = async (key: string, task: () => Promise<unknown>): Promise<true | string> => {
    if (working) return '操作を実行できませんでした'
    // 押下と実行の間に店が外れたら何もしない（#519 軽）。`selectedAccountId!` の3箇所を守る。
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

  // U096: 対象未指定を専用の案内にする。「アカウントを選んでください」と
  // 混ぜると、直すべきもの（選ぶ対象）が違って見える。
  if (!id) {
    return (
      <TargetMissing
        kind="unspecified"
        title="版を確認する共通アクションが指定されていません"
        description="一覧から共通アクションを選び直してください。"
        backHref="/common-actions"
        backLabel="共通アクション一覧へ戻る"
      />
    )
  }
  if (loading) {
    return <div className="border-hairline rounded-card border bg-canvas p-10 text-center text-sm text-ink-faint" aria-busy="true">版と利用先を読み込んでいます</div>
  }
  // 空の案内もカード（白地・枠・角丸）の中に出す。灰色の地だけにしない。
  if (!selectedAccountId && !detail) {
    return (
      <section className="bg-canvas rounded-card border-hairline border">
        <ListState
          kind="empty"
          title="LINE公式アカウントを選んでください"
          description="選ぶと版と利用先を確認できます。"
          action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>}
        />
      </section>
    )
  }
  if (!detail && loadFailure === 'missing') {
    return (
      <TargetMissing
        kind="not-found"
        title="この共通アクションは見つかりません"
        description="削除されたか、別のLINEアカウントのものです。一覧から選び直してください。"
        backHref="/common-actions"
        backLabel="共通アクション一覧へ戻る"
      />
    )
  }
  if (!detail && loadFailure === 'forbidden') {
    return (
      <ListState
        kind="forbidden"
        title="この共通アクションを表示する権限がありません"
        description="権限のある人に確認するか、別のLINEアカウントを選んでください。"
        action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>}
      />
    )
  }
  if (!detail) {
    return (
      <TargetMissing
        kind="error"
        title="版と利用先を読み込めませんでした"
        description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
        onRetry={() => void load()}
      />
    )
  }

  return (
    <div data-design-node="syWp4" className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[
          { label: '共通アクション', href: '/common-actions' },
          { label: detail.name },
          { label: '版と使われている場所' },
        ]}
        title="版と使われている場所"
        description={`「${detail.name}」の公開履歴と、版を固定している利用先を確認します。`}
        actions={(
          <>
            {canManage && draft ? (
              <Button href={`/common-actions/edit?id=${encodeURIComponent(detail.id)}`} variant="primary">下書きの中身を編集</Button>
            ) : canManage && published ? (
              <Button
                variant="primary"
                disabled={Boolean(working)}
                onClick={() => void run('draft', () => api.commonActions.createDraft(
                  detail.id,
                  selectedAccountId!,
                  published.id,
                ))}
              >
                前の版から新版を作る
              </Button>
            ) : null}
            {manualHref ? <Button href={manualHref}>マニュアル</Button> : null}
          </>
        )}
      />

      {summaryError ? (
        <Notice
          tone="warn"
          message="月次件数を読み込めませんでした。版と利用先は表示しています。"
          action={(
            <Button variant="secondary" disabled={summaryRetrying} onClick={() => void reloadSummary()}>
              月次件数をもう一度読み込む
            </Button>
          )}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
        <KpiCard variant="v6" title="いまの版" value={published?.versionNumber ?? null} unit="" detail={published?.publishedAt ? `${formatDay(published.publishedAt)} に公開` : 'まだ公開していません'} />
        <KpiCard variant="v6" title="呼び出し元" value={detail.bindings.length} unit="" detail={usageSummaryDetail(detail.bindings)} />
        <KpiCard
          variant="v6"
          title="今月 動いた回数"
          value={summary?.executionCountThisMonth ?? null}
          unit=""
          detail={summaryError ? '読み込めませんでした' : ''}
          help="実行記録から集計しています"
          onRetry={summaryError ? () => void reloadSummary() : undefined}
          retryLabel="月次件数をもう一度読み込む"
        />
        <KpiCard
          variant="v6"
          title="失敗"
          value={summary?.failureCountThisMonth ?? null}
          unit=""
          detail={summaryError ? '読み込めませんでした' : ''}
          help="部分成功を含みます"
          onRetry={summaryError ? () => void reloadSummary() : undefined}
          retryLabel="月次件数をもう一度読み込む"
        />
        <KpiCard variant="v6" title="古い版のまま" value={detail.bindings.filter((binding) => binding.hasNewerVersion).length} unit="" detail="回答フォーム" badge={detail.bindings.some((binding) => binding.hasNewerVersion) ? '要確認' : undefined} />
      </div>

      <NoteBar help="新版を公開しても、利用先は現在の版を使い続けます" helpLabel="版の切り替え">
        新版を公開しても、利用先は現在の版を使い続けます。差分を確認した利用先だけ切り替えてください。
      </NoteBar>

      {error ? <p className="text-danger text-sm" role="alert">{error}</p> : null}

      <section>
        <h2 className="text-ink font-semibold">どこから呼ばれているか</h2>
        <p className="text-ink-faint mt-1 text-sm">公開しても、呼び出し元は自動で変わりません。使う場所ごとに新しい版へ更新します。</p>
        {detail.bindings.length === 0 ? (
          <div className="border-hairline rounded-card mt-3 border bg-canvas p-8 text-center text-sm text-ink-faint">まだどこからも呼ばれていません。</div>
        ) : (
          <DataTable className="mt-3">
              <thead>
                <TableHeadRow>
                  {/* S1N-layout-1: 操作列にボタンの幅を確保し、狭い幅でも横スクロールさせない。合計100%。 */}
                  <Th style={{ width: '33%' }}>利用先</Th>
                  <Th style={{ width: '14%' }}>固定中の版</Th>
                  <Th style={{ width: '13%' }}>実行中</Th>
                  <Th style={{ width: '14%' }}>待機中</Th>
                  <Th style={{ width: '26%' }}>操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {detail.bindings.map((binding) => (
                  <Tr key={binding.id}>
                    {/*
                      S1N-layout-1 長文残差: `truncate` は inline の span では幅が定まらず
                      省略記号が効かない。block 化して列幅の中で切る。全文は title で残す。
                    */}
                    <NameCell
                      name={<span className="block truncate" title={binding.consumerId}>{CONSUMER_LABELS[binding.consumerType] ?? binding.consumerType}</span>}
                      sub={<span className="block truncate" title={binding.consumerPath}>{binding.consumerPath || '全体'}</span>}
                    />
                    <Td>
                      <span className="text-ink-secondary">v{binding.versionNumber}</span>
                      {binding.hasNewerVersion ? <StatusBadge tone="warning" size="compact" className="ml-2">新版あり</StatusBadge> : null}
                    </Td>
                    <Td className="text-ink-secondary" title={binding.runningCount === null ? '未取得' : undefined}>
                      {binding.runningCount ?? '—'}
                      {/* 監査 R471: 切替後も旧版の残りを見失わない。現在版の件数とは分けて出す。 */}
                      {binding.olderRunningCount ? <span className="text-ink-faint ml-1 text-xs">旧版{binding.olderRunningCount}</span> : null}
                    </Td>
                    <Td className="text-ink-secondary" title={binding.waitingCount === null ? '未取得' : undefined}>
                      {binding.waitingCount ?? '—'}
                      {binding.olderWaitingCount ? <span className="text-ink-faint ml-1 text-xs">旧版{binding.olderWaitingCount}</span> : null}
                    </Td>
                    <ActionCell>
                      {canManage && binding.hasNewerVersion && published ? (
                        <Button
                          variant="secondary"
                          disabled={Boolean(working)}
                          onClick={() => { setPendingBindingId(binding.id); setDialogError('') }}
                        >
                          v{published.versionNumber}への変更内容を確認
                        </Button>
                      ) : <span className="text-ink-faint">{binding.hasNewerVersion ? '編集権限が必要' : '最新版を使用中'}</span>}
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
          </DataTable>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-ink font-semibold">版の履歴</h2>
            <p className="text-ink-faint mt-1 text-sm">公開した版は書き換えられません。</p>
            <p className="text-ink-faint mt-1 text-xs">この30日の実行 {formatNumber(summary?.executionCountThisMonth) ?? '—'}回・失敗 {formatNumber(summary?.failureCountThisMonth) ?? '—'}回{summaryError ? '（月次件数を読み込めませんでした）' : ''}</p>
          </div>
        </div>
        <DataTable>
            <thead>
              <TableHeadRow>
                {/* S1N-layout-1: 操作列にボタンの幅を確保し、狭い幅でも横スクロールさせない。合計100%。 */}
                <Th style={{ width: '7%' }}>版</Th>
                <Th style={{ width: '13%' }}>状態</Th>
                <Th style={{ width: '13%' }}>作成者</Th>
                <Th style={{ width: '17%' }}>変更内容</Th>
                <Th style={{ width: '12%' }}>中の処理</Th>
                <Th style={{ width: '14%' }}>公開日時</Th>
                <Th style={{ width: '24%' }}>操作</Th>
              </TableHeadRow>
            </thead>
            <tbody>
              {detail.versions.map((version) => (
                <Tr key={version.id}>
                  <Td className="text-ink font-semibold">v{version.versionNumber}</Td>
                  <Td>
                    <StatusBadge tone={version.status === 'published' ? 'success' : 'neutral'} size="compact">
                      {version.status === 'published' ? '公開済み' : '下書き'}
                    </StatusBadge>
                  </Td>
                  <Td className="text-ink-secondary"><span className="block max-w-32 truncate" title={version.createdBy ?? '未取得'}>{version.createdBy || '未取得'}</span></Td>
                  <Td className="text-ink-secondary"><span className="block max-w-56 truncate" title={versionChangeLines(version, detail.versions).join('\n')}>{versionChangeSummary(version, detail.versions)}</span></Td>
                  <Td className="text-ink-secondary">{version.actions.length}個の処理</Td>
                  <Td className="text-ink-secondary">{version.publishedAt ? formatDateTime(version.publishedAt) : '—'}</Td>
                  <ActionCell>
                    {!canManage ? <span className="text-ink-faint">閲覧のみ</span> : version.status === 'draft' ? (
                      <Button
                        variant="secondary"
                        className="whitespace-nowrap"
                        disabled={Boolean(working)}
                        onClick={() => void run(`publish:${version.id}`, () => api.commonActions.publish(
                          detail.id,
                          selectedAccountId!,
                          version.id,
                          version.draftRevision,
                        )).then((result) => {
                          // 監査 R477: 公開が止まったら最新を取り直し、差分を確認し直す。
                          // 監査 R479: 読み直し（load の setError('')）で競合理由を消さない。
                          // 最新版へ置き換えたあとも理由と次の操作を残す。読み直し自体が
                          // 失敗したときはその文言を優先し、上書きしない。
                          if (result !== true) {
                            const message = result
                            void (async () => {
                              await load()
                              setError((current) => current || message)
                            })()
                          }
                        })}
                      >
                        この版を公開する
                      </Button>
                    ) : !draft ? (
                      <Button
                        variant="secondary"
                        className="whitespace-nowrap"
                        disabled={Boolean(working)}
                        onClick={() => void run(`copy:${version.id}`, () => api.commonActions.createDraft(
                          detail.id,
                          selectedAccountId!,
                          version.id,
                        ))}
                      >
                        この版をもとに新版を作る
                      </Button>
                    ) : <span className="text-ink-faint">下書き編集中</span>}
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
        </DataTable>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <KpiCard
          variant="v6"
          title="このアクションを実行中"
          value={runningTotal}
          unit="件"
          detail={runningTotal === null
            ? '未取得の利用先があります'
            : olderRunningTotal
              ? `旧版のまま進行中 ${olderRunningTotal}件あり`
              : '始まったときの版のまま最後まで進みます'}
        />
        <KpiCard
          variant="v6"
          title="待ち時間の途中"
          value={waitingTotal}
          unit="件"
          detail={waitingTotal === null
            ? '未取得の利用先があります'
            : olderWaitingTotal
              ? `旧版のまま進行中 ${olderWaitingTotal}件あり`
              : '設定した待ち時間の途中です'}
        />
      </section>

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
          void run(`binding:${pendingBinding.id}`, () => api.commonActions.updateBinding(
            detail.id,
            selectedAccountId,
            {
              bindingId: pendingBinding.id,
              versionId: published.id,
              expectedVersionId: pendingBinding.versionId,
            },
          )).then((result) => {
            if (result === true) {
              setPendingBindingId(null)
              setDialogError('')
            } else {
              // 監査 R467: 別担当が先に切り替えたら、最新を取り直して窓内で理由を示す。
              setDialogError(result)
              void load()
            }
          })
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="border-hairline rounded-control border p-3">
            <p className="text-ink-faint text-xs">現在の版</p>
            <p className="text-ink mt-1 font-semibold">v{pendingBinding?.versionNumber ?? '—'}・{pendingVersion?.actions.length ?? '—'}個の処理</p>
            <p className="text-ink-secondary mt-2 text-sm">{pendingVersion?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '未取得'}</p>
          </section>
          <section className="border-action rounded-control border p-3">
            <p className="text-ink-faint text-xs">更新後</p>
            <p className="text-ink mt-1 font-semibold">v{published?.versionNumber ?? '—'}・{published?.actions.length ?? '—'}個の処理</p>
            <p className="text-ink-secondary mt-2 text-sm">{published?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '未取得'}</p>
          </section>
        </div>
        {/*
          監査 R468: 処理の数だけでなく、待ち時間・失敗時の動き・順序・
          追加/削除の前後を確認窓だけで識別できるようにする。
        */}
        {pendingVersion && published ? (
          <section className="mt-3">
            <h3 className="text-ink text-sm font-semibold">変わった点</h3>
            <ul className="text-ink-secondary mt-1 list-disc space-y-1 pl-5 text-sm">
              {describeVersionChanges(pendingVersion.actions, published.actions).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <Notice tone="warn" message={`影響：実行中 ${pendingBinding?.runningCount ?? '—'}件、待機中 ${pendingBinding?.waitingCount ?? '—'}件は現在の版のまま完了します。未取得の件数は、実行集計の接続後に表示します。`} className="mt-3" />
        {dialogError ? <p className="text-danger mt-3 text-sm" role="alert">{dialogError}</p> : null}
      </Dialog>
    </div>
  )
}

/*
 * ★V8-B の切り替え。v8 の器は別ファイル
 * （common-action-versions-v8.tsx）に置き、v7 の器・動きはそのまま残す。
 */
export default function CommonActionVersionsPage() {
  const theme = useAdminTheme()
  if (theme === 'v8') return <CommonActionVersionsV8 />
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">版と利用先を読み込んでいます</div>}>
      <CommonActionVersionsInner />
    </Suspense>
  )
}
