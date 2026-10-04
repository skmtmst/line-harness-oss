'use client'

/*
 * ★V8-B 共通アクションの版と使われている場所（板 `ziSgL`）。
 *
 * v7（versions/page.tsx の器）とは別の器。データの口・動きは v7 と同じ
 * （版の履歴・公開・前の版から新版・利用先の版切り替え・月次集計）。
 * 変える操作は器の外（共通の部品・API）へ触らない。
 * v7 を直す必要が出たら versions/page.tsx 側も同じ判断を入れる。
 */
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { api, ApiError, type CommonActionDetail, type CommonActionSummary } from '@/lib/api'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import MetricValue from '@/components/ui/metric-value'
import { useCanManageCommonActions } from '@/components/automations/use-common-action-permission'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useManualHref } from '@/lib/use-manual-href'
import { sumBindingCount, usageSummaryDetail } from './usage-summary'
import { ACTION_LABELS, describeVersionChanges, versionChangeLines, versionChangeSummary } from './version-diff'
import { formatDateTime, formatDay, formatNumber } from '@/lib/format'
import styles from '@/app/automations/automations-v8.module.css'

const CONSUMER_LABELS: Record<string, string> = {
  scenario: 'シナリオ配信',
  form: '回答フォーム',
  auto_reply: '自動応答',
  rich_menu: 'リッチメニュー',
  automation: 'オートメーション',
}

function VersionsV8Inner() {
  usePageTitle('版と使われている場所')
  const canManage = useCanManageCommonActions()
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
    return <ListState kind="loading" title="版と利用先を読み込んでいます" />
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

  const outdatedCount = detail.bindings.filter((binding) => binding.hasNewerVersion).length

  return (
    <div data-design-node="ziSgL">
      <div className={styles.head}>
        <div className={styles.headText}>
          <Link href="/common-actions" className={styles.backLink}>← 共通アクション一覧へ戻る</Link>
          <h1 className={styles.headTitle}>{detail.name}（版と使われている場所）</h1>
          <p className={styles.headDescription}>
            公開した版は書き換えられません。公開しても、呼び出し元は自動で変わりません。使う場所ごとに新しい版へ更新します。
          </p>
        </div>
        <div className={styles.headActions}>
          {manualHref ? <Button href={manualHref}>マニュアル</Button> : null}
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
        </div>
      </div>

      {summaryError ? (
        <p className={styles.errorBand} role="alert">
          月次件数を読み込めませんでした。版と利用先は表示しています。
          <Button variant="secondary" size="compact" disabled={summaryRetrying} onClick={() => void reloadSummary()}>
            月次件数をもう一度読み込む
          </Button>
        </p>
      ) : null}

      <div className={styles.kpis}>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>いまの版</p>
          <p className={styles.kpiValue}>v{published?.versionNumber ?? '—'}</p>
          <p className={styles.kpiSub}>{published?.publishedAt ? `${formatDay(published.publishedAt)}公開` : 'まだ公開していません'}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>呼び出し元</p>
          <p className={styles.kpiValue}><MetricValue value={detail.bindings.length} unit="か所" /></p>
          <p className={styles.kpiSub}>{usageSummaryDetail(detail.bindings)}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>古い版のまま</p>
          <p className={styles.kpiValue}><MetricValue value={outdatedCount} unit="か所" /></p>
          <p className={styles.kpiSub}>{outdatedCount > 0 ? '新版あり' : 'すべて最新の版です'}</p>
        </div>
        <div className={styles.kpi}>
          <p className={styles.kpiLabel}>今月動いた回数</p>
          <p className={styles.kpiValue}><MetricValue value={summary?.executionCountThisMonth ?? null} unit="回" /></p>
          <p className={styles.kpiSub}>失敗 {summary ? formatNumber(summary.failureCountThisMonth) : '—'}回</p>
        </div>
      </div>

      {error ? <p className={styles.stepError} role="alert">{error}</p> : null}

      <section className={styles.formCard}>
        <h2 className={styles.formTitle}>版の履歴</h2>
        <p className={styles.footnote}>公開しても、使っている所はいまの版のまま。使う所ごとに新しい版へ切り替えます。</p>
        <ul className={styles.versionList}>
          {detail.versions.map((version) => (
            <li key={version.id} className={styles.versionRow}>
              <span className={styles.versionName}>v{version.versionNumber}</span>
              <span className={version.status === 'published' ? `${styles.pill} ${styles.pillActive}` : `${styles.pill} ${styles.pillWarn}`}>
                {version.status === 'published' ? '公開中' : '下書き'}
              </span>
              <span className={styles.versionSummary} title={versionChangeLines(version, detail.versions).join('\n')}>
                {versionChangeSummary(version, detail.versions)}
              </span>
              <span className={styles.versionMeta}>
                {version.publishedAt ? formatDateTime(version.publishedAt) : ''}
              </span>
              {!canManage ? <span className={styles.footnote}>閲覧のみ</span> : version.status === 'draft' ? (
                <Button
                  variant="primary"
                  size="compact"
                  disabled={Boolean(working)}
                  onClick={() => void run(`publish:${version.id}`, () => api.commonActions.publish(
                    detail.id,
                    selectedAccountId!,
                    version.id,
                    version.draftRevision,
                  )).then((result) => {
                    if (result !== true) {
                      const message = result
                      void (async () => {
                        await load()
                        setError((current) => current || message)
                      })()
                    }
                  })}
                >
                  公開する
                </Button>
              ) : !draft ? (
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={Boolean(working)}
                  onClick={() => void run(`copy:${version.id}`, () => api.commonActions.createDraft(
                    detail.id,
                    selectedAccountId!,
                    version.id,
                  ))}
                >
                  この版から新しい版
                </Button>
              ) : <span className={styles.footnote}>下書き編集中</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className={styles.formTitle}>どこから呼ばれているか</h2>
        {detail.bindings.length === 0 ? (
          <p className={styles.footnote}>まだどこからも呼ばれていません。</p>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">利用先</th>
                  <th scope="col">固定中の版</th>
                  <th scope="col">実行中</th>
                  <th scope="col">待機中</th>
                  <th scope="col">状態</th>
                  <th scope="col"><span className={styles.visuallyHidden}>操作</span></th>
                </tr>
              </thead>
              <tbody>
                {detail.bindings.map((binding) => (
                  <tr key={binding.id}>
                    <td>
                      <p className={styles.cellMain} title={binding.consumerId}>{CONSUMER_LABELS[binding.consumerType] ?? binding.consumerType}</p>
                      <p className={styles.cellSub} title={binding.consumerPath}>{binding.consumerPath || '全体'}</p>
                    </td>
                    <td><span className={styles.num}>v{binding.versionNumber}</span></td>
                    <td>
                      <span className={styles.num} title={binding.runningCount === null ? '未取得' : undefined}>
                        {binding.runningCount ?? '—'}
                      </span>
                      {binding.olderRunningCount ? <span className={styles.cellSub}> 旧版{binding.olderRunningCount}</span> : null}
                    </td>
                    <td>
                      <span className={styles.num} title={binding.waitingCount === null ? '未取得' : undefined}>
                        {binding.waitingCount ?? '—'}
                      </span>
                      {binding.olderWaitingCount ? <span className={styles.cellSub}> 旧版{binding.olderWaitingCount}</span> : null}
                    </td>
                    <td>
                      {binding.hasNewerVersion ? (
                        <span className={`${styles.pill} ${styles.pillWarn}`}>新版あり</span>
                      ) : (
                        <span className={`${styles.pill} ${styles.pillActive}`}>最新</span>
                      )}
                    </td>
                    <td>
                      <div className={styles.rowActions}>
                        {canManage && binding.hasNewerVersion && published ? (
                          <Button
                            variant="secondary"
                            size="compact"
                            disabled={Boolean(working)}
                            onClick={() => { setPendingBindingId(binding.id); setDialogError('') }}
                          >
                            v{published.versionNumber}へ更新する
                          </Button>
                        ) : <span className={styles.footnote}>{binding.hasNewerVersion ? '編集権限が必要' : '—'}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={styles.footnote}>更新しても、実行中・待機中の処理は変えず、次に始まる処理から新版を使います。</p>
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
              setDialogError(result)
              void load()
            }
          })
        }}
      >
        <div className={styles.detailGrid}>
          <section className={styles.detailCell}>
            <p className={styles.detailLabel}>現在の版</p>
            <p className={styles.detailValue}>v{pendingBinding?.versionNumber ?? '—'}・{pendingVersion?.actions.length ?? '—'}個の処理</p>
            <p className={styles.footnote}>{pendingVersion?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '未取得'}</p>
          </section>
          <section className={styles.detailCell}>
            <p className={styles.detailLabel}>更新後</p>
            <p className={styles.detailValue}>v{published?.versionNumber ?? '—'}・{published?.actions.length ?? '—'}個の処理</p>
            <p className={styles.footnote}>{published?.actions.map((action) => ACTION_LABELS[action.type] ?? action.type).join(' → ') || '未取得'}</p>
          </section>
        </div>
        {pendingVersion && published ? (
          <section>
            <h3 className={styles.formTitle}>変わった点</h3>
            <ul className={styles.noteList}>
              {describeVersionChanges(pendingVersion.actions, published.actions).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}
        <p className={styles.footnote}>
          影響：実行中 {pendingBinding?.runningCount ?? '—'}件、待機中 {pendingBinding?.waitingCount ?? '—'}件は現在の版のまま完了します。
        </p>
        {dialogError ? <p className={styles.stepError} role="alert">{dialogError}</p> : null}
      </Dialog>
    </div>
  )
}

export function CommonActionVersionsV8() {
  return (
    <Suspense fallback={<ListState kind="loading" title="版と利用先を読み込んでいます" />}>
      <VersionsV8Inner />
    </Suspense>
  )
}
