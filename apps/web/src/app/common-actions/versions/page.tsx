'use client'

import { usageSummaryDetail } from '../usage-summary'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, type CommonActionDetail, type CommonActionSummary, type CommonActionVersion } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import NoteBar from '@/components/shared/note-bar'
import TargetMissing from '@/components/shared/target-missing'
import PageHeader from '@/components/shared/page-header'
import StatusBadge from '@/components/shared/status-badge'
import SummaryCard from '@/components/shared/summary-card'
import { ActionCell, DataTable, NameCell, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'

const ACTION_LABELS: Record<string, string> = {
  add_tag: 'タグを付ける', remove_tag: 'タグを外す', set_metadata: '友だち情報を設定する',
  start_scenario: 'シナリオを開始する', stop_scenario: 'シナリオを停止する',
  resume_scenario: 'シナリオを再開する', send_message: 'LINEメッセージを送る',
  send_webhook: '外部サービスへ送る', switch_rich_menu: 'リッチメニューを切り替える',
  remove_rich_menu: 'リッチメニューを外す', wait: '待つ', common_action: '別の共通アクションを呼ぶ',
}

const CONSUMER_LABELS: Record<string, string> = {
  scenario: 'シナリオ配信',
  form: '回答フォーム',
  auto_reply: '自動応答',
  rich_menu: 'リッチメニュー',
  automation: 'オートメーション',
}

function versionChangeSummary(version: CommonActionVersion, versions: CommonActionVersion[]): string {
  const previous = versions
    .filter((item) => item.versionNumber < version.versionNumber)
    .sort((left, right) => right.versionNumber - left.versionNumber)[0]
  if (!previous) return 'はじめて公開した'
  if (previous.actions.length !== version.actions.length) {
    return `処理を${previous.actions.length}個から${version.actions.length}個にした`
  }
  const changedIndex = version.actions.findIndex((action, index) => {
    const oldAction = previous.actions[index]
    return !oldAction || JSON.stringify(oldAction) !== JSON.stringify(action)
  })
  if (changedIndex >= 0) {
    const label = ACTION_LABELS[version.actions[changedIndex].type] ?? '処理'
    return `「${label}」の内容を変えた`
  }
  return '内容の変更はありません'
}

function CommonActionVersionsInner() {
  const canManage = useCanManageCommonActions()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<CommonActionDetail | null>(null)
  const [summary, setSummary] = useState<CommonActionSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  /** 取得の失敗の内訳（操作の失敗とは分ける）。 */
  const [loadFailure, setLoadFailure] = useState<'missing' | 'forbidden' | 'error' | null>(null)
  const [pendingBindingId, setPendingBindingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    // U096: 対象が無いURLでは取りに行かない。案内は描画側で出す。
    if (!selectedAccountId || !id) {
      setDetail(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    setLoadFailure(null)
    setSummary(null)
    try {
      const [response, listResponse] = await Promise.all([
        api.commonActions.get(id, selectedAccountId),
        api.commonActions.list({ accountId: selectedAccountId }),
      ])
      if (response.success) setDetail(response.data)
      else {
        setError(response.error)
        setLoadFailure('error')
      }
      setSummary(listResponse.success ? listResponse.data.find((item) => item.id === id) ?? null : null)
    } catch (caught) {
      setSummary(null)
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
    } finally {
      setLoading(false)
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

  const run = async (key: string, task: () => Promise<unknown>): Promise<boolean> => {
    if (working) return false
    // 押下と実行の間に店が外れたら何もしない（#519 軽）。`selectedAccountId!` の3箇所を守る。
    if (!selectedAccountId) {
      setError('LINEアカウントを選び直してください。')
      return false
    }
    setWorking(key)
    setError('')
    try {
      await task()
      await load()
      return true
    } catch (caught) {
      setError(caught instanceof ApiError || caught instanceof Error ? caught.message : '操作を完了できませんでした')
      return false
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
  if (!selectedAccountId && !detail) {
    return (
      <ListState
        kind="empty"
        title="LINE公式アカウントを選んでください"
        description="選ぶと版と利用先を確認できます。"
        action={<Button href="/common-actions">共通アクション一覧へ戻る</Button>}
      />
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
    <div data-design-node="syWp4">
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
            <Button href="/support">マニュアル</Button>
          </>
        )}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-5">
        <SummaryCard variant="v6" title="いまの版" value={published?.versionNumber ?? null} unit="" detail={published?.publishedAt ? `${new Date(published.publishedAt).toLocaleDateString('ja-JP')} に公開` : 'まだ公開していません'} />
        <SummaryCard variant="v6" title="呼び出し元" value={detail.bindings.length} unit="" detail={usageSummaryDetail(detail.bindings)} />
        <SummaryCard variant="v6" title="今月 動いた回数" value={summary?.executionCountThisMonth ?? null} unit="" detail="実行記録から集計" />
        <SummaryCard variant="v6" title="失敗" value={summary?.failureCountThisMonth ?? null} unit="" detail="部分成功を含む" />
        <SummaryCard variant="v6" title="古い版のまま" value={detail.bindings.filter((binding) => binding.hasNewerVersion).length} unit="" detail="回答フォーム" badge={detail.bindings.some((binding) => binding.hasNewerVersion) ? '要確認' : undefined} />
      </div>

      <NoteBar>
        新版を公開しても、利用先は現在の版を使い続けます。差分を確認した利用先だけ切り替えてください。
      </NoteBar>

      {error ? <p className="text-danger my-4 text-sm" role="alert">{error}</p> : null}

      <section className="mt-4">
        <h2 className="text-ink font-semibold">どこから呼ばれているか</h2>
        <p className="text-ink-faint mt-1 text-sm">公開しても、呼び出し元は自動で変わりません。使う場所ごとに新しい版へ更新します。</p>
        {detail.bindings.length === 0 ? (
          <div className="border-hairline rounded-card mt-3 border bg-canvas p-8 text-center text-sm text-ink-faint">まだどこからも呼ばれていません。</div>
        ) : (
          <DataTable className="mt-3">
              <thead>
                <TableHeadRow>
                  <Th style={{ width: '35%' }}>利用先</Th>
                  <Th style={{ width: '15%' }}>固定中の版</Th>
                  <Th style={{ width: '14%' }}>実行中</Th>
                  <Th style={{ width: '14%' }}>待機中</Th>
                  <Th style={{ width: '22%' }}>操作</Th>
                </TableHeadRow>
              </thead>
              <tbody>
                {detail.bindings.map((binding) => (
                  <Tr key={binding.id}>
                    <NameCell
                      name={<span className="truncate" title={binding.consumerId}>{CONSUMER_LABELS[binding.consumerType] ?? binding.consumerType}</span>}
                      sub={<span className="truncate" title={binding.consumerPath}>{binding.consumerPath || '全体'}</span>}
                    />
                    <Td>
                      <span className="text-ink-secondary">v{binding.versionNumber}</span>
                      {binding.hasNewerVersion ? <StatusBadge tone="warning" size="compact" className="ml-2">新版あり</StatusBadge> : null}
                    </Td>
                    <Td className="text-ink-secondary" title={binding.runningCount === null ? '未取得' : undefined}>{binding.runningCount ?? '—'}</Td>
                    <Td className="text-ink-secondary" title={binding.waitingCount === null ? '未取得' : undefined}>{binding.waitingCount ?? '—'}</Td>
                    <ActionCell>
                      {canManage && binding.hasNewerVersion && published ? (
                        <Button
                          variant="secondary"
                          disabled={Boolean(working)}
                          onClick={() => setPendingBindingId(binding.id)}
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

      <section className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-ink font-semibold">版の履歴</h2>
            <p className="text-ink-faint mt-1 text-sm">公開した版は書き換えられません。</p>
            <p className="text-ink-faint mt-1 text-xs">この30日の実行 {summary?.executionCountThisMonth.toLocaleString('ja-JP') ?? '—'}回・失敗 {summary?.failureCountThisMonth.toLocaleString('ja-JP') ?? '—'}回</p>
          </div>
        </div>
        <DataTable>
            <thead>
              <TableHeadRow>
                <Th style={{ width: '8%' }}>版</Th>
                <Th style={{ width: '14%' }}>状態</Th>
                <Th style={{ width: '15%' }}>作成者</Th>
                <Th style={{ width: '23%' }}>変更内容</Th>
                <Th style={{ width: '12%' }}>中の処理</Th>
                <Th style={{ width: '14%' }}>公開日時</Th>
                <Th style={{ width: '14%' }}>操作</Th>
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
                  <Td className="text-ink-secondary"><span className="block max-w-56 truncate" title={versionChangeSummary(version, detail.versions)}>{versionChangeSummary(version, detail.versions)}</span></Td>
                  <Td className="text-ink-secondary">{version.actions.length}個の処理</Td>
                  <Td className="text-ink-secondary">{version.publishedAt ? new Date(version.publishedAt).toLocaleString('ja-JP') : '—'}</Td>
                  <ActionCell>
                    {!canManage ? <span className="text-ink-faint">閲覧のみ</span> : version.status === 'draft' ? (
                      <Button
                        variant="secondary"
                        disabled={Boolean(working)}
                        onClick={() => void run(`publish:${version.id}`, () => api.commonActions.publish(
                          detail.id,
                          selectedAccountId!,
                          version.id,
                        ))}
                      >
                        この版を公開する
                      </Button>
                    ) : !draft ? (
                      <Button
                        variant="secondary"
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

      <section className="mt-6 grid gap-3 sm:grid-cols-2">
        <SummaryCard
          variant="v6"
          title="このアクションを実行中"
          value={detail.bindings.reduce((sum, binding) => sum + (binding.runningCount ?? 0), 0)}
          unit="件"
          detail="始まったときの版のまま最後まで進みます"
        />
        <SummaryCard
          variant="v6"
          title="待ち時間の途中"
          value={detail.bindings.reduce((sum, binding) => sum + (binding.waitingCount ?? 0), 0)}
          unit="件"
          detail="設定した待ち時間の途中です"
        />
      </section>

      <Dialog
        open={Boolean(pendingBinding && published)}
        title={`この利用先をv${published?.versionNumber ?? ''}へ更新しますか`}
        description="実行中・待機中の処理は変えず、次に始まる処理から新版を使います。"
        confirmLabel={`v${published?.versionNumber ?? ''}へ更新`}
        busy={working.startsWith('binding:')}
        onCancel={() => setPendingBindingId(null)}
        onConfirm={() => {
          if (!pendingBinding || !published || !selectedAccountId) return
          void run(`binding:${pendingBinding.id}`, () => api.commonActions.updateBinding(
            detail.id,
            selectedAccountId,
            pendingBinding.id,
            published.id,
          )).then((succeeded) => { if (succeeded) setPendingBindingId(null) })
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
        <p className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-sm">
          影響：実行中 {pendingBinding?.runningCount ?? '—'}件、待機中 {pendingBinding?.waitingCount ?? '—'}件は現在の版のまま完了します。未取得の件数は、実行集計の接続後に表示します。
        </p>
      </Dialog>
    </div>
  )
}

export default function CommonActionVersionsPage() {
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">版と利用先を読み込んでいます</div>}>
      <CommonActionVersionsInner />
    </Suspense>
  )
}
