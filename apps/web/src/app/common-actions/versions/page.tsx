'use client'

import { usageSummaryDetail } from '../usage-summary'
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, type CommonActionDetail } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import NoteBar from '@/components/shared/note-bar'
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

function CommonActionVersionsInner() {
  const canManage = useCanManageCommonActions()
  const searchParams = useSearchParams()
  const id = searchParams.get('id') ?? ''
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [detail, setDetail] = useState<CommonActionDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [working, setWorking] = useState('')
  const [error, setError] = useState('')
  const [pendingBindingId, setPendingBindingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setDetail(null)
      setLoading(false)
      return
    }
    setLoading(true)
    setError('')
    try {
      const response = await api.commonActions.get(id, selectedAccountId)
      if (response.success) setDetail(response.data)
      else setError(response.error)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '版と利用先を読み込めませんでした')
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

  if (loading) {
    return <div className="border-hairline rounded-card border bg-canvas p-10 text-center text-sm text-ink-faint" aria-busy="true">版と利用先を読み込んでいます</div>
  }
  if (!detail) {
    return (
      <div role="alert" className="border-danger bg-danger-bg text-danger rounded-card border p-6">
        <p className="font-semibold">共通アクションを表示できません</p>
        <p className="mt-1 text-sm">{error || 'LINE公式アカウントを選んでください'}</p>
        <Button href="/common-actions" className="mt-4">共通アクション一覧へ戻る</Button>
      </div>
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

      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard variant="v6" title="現在の公開版" value={published?.versionNumber ?? null} unit="" detail={published ? `v${published.versionNumber}を利用できます` : 'まだ公開していません'} />
        <SummaryCard variant="v6" title="版の数" value={detail.versions.length} unit="" detail="下書きを含む" />
        <SummaryCard variant="v6" title="使われている場所" value={detail.bindings.length} unit="" detail={usageSummaryDetail(detail.bindings)} />
        <SummaryCard variant="v6" title="古い版のまま" value={detail.bindings.filter((binding) => binding.hasNewerVersion).length} unit="" detail="確認して更新します" />
      </div>

      <NoteBar>
        新版を公開しても、利用先は現在の版を使い続けます。差分を確認した利用先だけ切り替えてください。
      </NoteBar>

      {error ? <p className="text-danger my-4 text-sm" role="alert">{error}</p> : null}

      <section className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-ink font-semibold">版の履歴</h2>
            <p className="text-ink-faint mt-1 text-sm">公開した版は書き換えられません。</p>
          </div>
        </div>
        <DataTable>
            <thead>
              <TableHeadRow>
                <Th style={{ width: '14%' }}>版</Th>
                <Th style={{ width: '18%' }}>状態</Th>
                <Th style={{ width: '18%' }}>中の処理</Th>
                <Th style={{ width: '28%' }}>公開日時</Th>
                <Th style={{ width: '22%' }}>操作</Th>
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
                  <Td className="text-ink-secondary">{version.actions.length}個の処理</Td>
                  <Td className="text-ink-secondary">{version.publishedAt ? new Date(version.publishedAt).toLocaleString('ja-JP') : '—'}</Td>
                  <ActionCell>
                    {!canManage ? <span className="text-ink-faint">閲覧のみ</span> : version.status === 'draft' ? (
                      <button
                        type="button"
                        disabled={Boolean(working)}
                        className="text-action font-semibold hover:underline disabled:opacity-40"
                        onClick={() => void run(`publish:${version.id}`, () => api.commonActions.publish(
                          detail.id,
                          selectedAccountId!,
                          version.id,
                        ))}
                      >
                        この版を公開する
                      </button>
                    ) : !draft ? (
                      <button
                        type="button"
                        disabled={Boolean(working)}
                        className="text-action font-semibold hover:underline disabled:opacity-40"
                        onClick={() => void run(`copy:${version.id}`, () => api.commonActions.createDraft(
                          detail.id,
                          selectedAccountId!,
                          version.id,
                        ))}
                      >
                        この版をもとに新版を作る
                      </button>
                    ) : <span className="text-ink-faint">下書き編集中</span>}
                  </ActionCell>
                </Tr>
              ))}
            </tbody>
        </DataTable>
      </section>

      <section className="mt-6">
        <h2 className="text-ink font-semibold">使われている場所</h2>
        <p className="text-ink-faint mt-1 text-sm">実行中・待機中の処理は、切り替えても開始時の版のまま完了します。</p>
        {detail.bindings.length === 0 ? (
          <div className="border-hairline rounded-card mt-3 border bg-canvas p-8 text-center text-sm text-ink-faint">まだ呼ばれている場所はありません。</div>
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
                      name={<span className="truncate" title={binding.consumerId}>{binding.consumerType}</span>}
                      sub={<span className="truncate" title={binding.consumerPath}>{binding.consumerPath || '全体'}</span>}
                    />
                    <Td>
                      <span className="text-ink-secondary">v{binding.versionNumber}</span>
                      {binding.hasNewerVersion ? <StatusBadge tone="warning" size="compact" className="ml-2">新版あり</StatusBadge> : null}
                    </Td>
                    <Td className="text-ink-secondary">{binding.runningCount ?? '—'}</Td>
                    <Td className="text-ink-secondary">{binding.waitingCount ?? '—'}</Td>
                    <ActionCell>
                      {canManage && binding.hasNewerVersion && published ? (
                        <button
                          type="button"
                          disabled={Boolean(working)}
                          className="text-action font-semibold hover:underline disabled:opacity-40"
                          onClick={() => setPendingBindingId(binding.id)}
                        >
                          v{published.versionNumber}への変更内容を確認
                        </button>
                      ) : <span className="text-ink-faint">{binding.hasNewerVersion ? '編集権限が必要' : '最新版を使用中'}</span>}
                    </ActionCell>
                  </Tr>
                ))}
              </tbody>
          </DataTable>
        )}
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
            <p className="text-ink-secondary mt-2 text-sm">{pendingVersion?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '内容を取得できません'}</p>
          </section>
          <section className="border-action rounded-control border p-3">
            <p className="text-ink-faint text-xs">更新後</p>
            <p className="text-ink mt-1 font-semibold">v{published?.versionNumber ?? '—'}・{published?.actions.length ?? '—'}個の処理</p>
            <p className="text-ink-secondary mt-2 text-sm">{published?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '内容を取得できません'}</p>
          </section>
        </div>
        <p className="bg-warning-bg text-warning rounded-control mt-3 p-3 text-sm">
          影響：実行中 {pendingBinding?.runningCount ?? '確認できません'}件、待機中 {pendingBinding?.waitingCount ?? '確認できません'}件は現在の版のまま完了します。
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
