'use client'

/*
 * ★V8-B 外部連携の Google Sheets（板 `DxAAA`）。
 *
 * v7 の Sheets タブ（`google-sheets-panel.tsx` の GoogleSheetsPanel）とは
 * 別の部品として持つ。データの口（接続・出力先・同期・解除・記録）は同じ。
 * 違いは置き場と見せ方——書き出しカード・同期の記録の表・右の気をつけること。
 * v7 を直す必要が出たら向こうも同じ判断を入れる（V8 完成までの二重管理）。
 *
 * 見本と今の作りが合わない所（API が無い所は作らず。今の形のまま）：
 * - 同期の記録の表：実行の行を日時で束ねて出す（きっかけ・書き出したもの・
 *   結果）。束ねられない行はそのまま出す。
 * - 連携解除の注意：解除の確認の文と気をつけることの2点で、解除すると
 *   書き出し設定が消えること・書き出したシートは残ることを言う。
 */
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api, type GoogleSheetsConnection, type GoogleSheetsSyncRun } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { isGoogleSheetsConnectionPayload, isGoogleSheetsRunsPayload } from '@line-crm/shared'
import { usePageTitle } from '@/components/shell/page-chrome'
import { formatDateTime, formatNumber } from '@/lib/format'
import {
  WebhooksV8Band, WebhooksV8Head, outgoingKpiCells, useV8BandData,
} from './outgoing-v8'
import styles from './sheets-v8.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

const CALLBACK_MESSAGES: Record<string, { tone: 'ok' | 'warn' | 'error'; text: string }> = {
  connected: { tone: 'ok', text: 'Googleアカウントと接続しました。書き出し先のスプレッドシートを設定してください。' },
  reconnected: { tone: 'ok', text: 'Googleアカウントを再接続しました。' },
  'error:denied': { tone: 'warn', text: 'Googleでの許可が取り消されました。接続するには、もう一度「Googleアカウントを接続する」から進んでください。' },
  'error:invalid_state': { tone: 'error', text: '接続の確認に失敗しました。時間が経ちすぎた可能性があります。もう一度最初からお試しください。' },
  'error:no_refresh_token': { tone: 'error', text: 'Googleから長期利用の許可を受け取れませんでした。Googleアカウント側でこのアプリへの許可を一度取り消してから、接続をやり直してください。' },
  'error:account_missing': { tone: 'error', text: '接続しようとしたLINEアカウントが見つかりません。アカウントの選択を確かめてからやり直してください。' },
  'error:oauth_not_configured': { tone: 'error', text: 'この環境にはGoogle接続の設定がまだありません。管理者に確かめてください。' },
  'error:encryption_key_missing': { tone: 'error', text: 'この環境の暗号化設定が不足しています。管理者に確かめてください。' },
  'error:state_cancelled': { tone: 'warn', text: 'この接続操作は、途中で別の接続操作や解除が行われたため取り消されました。接続したい場合はもう一度最初から進めてください。' },
}

const RUN_KIND_LABEL: Record<GoogleSheetsSyncRun['kind'], string> = {
  manual: '手動',
  scheduled: '定期',
}
const RUN_DATA_LABEL: Record<GoogleSheetsSyncRun['dataType'], string> = {
  friends: '友だち',
  form_answers: 'フォーム回答',
}
const RUN_STATUS_LABEL: Record<GoogleSheetsSyncRun['status'], string> = {
  running: '実行中',
  ok: '完了',
  partial: '一部だけ完了',
  error: '失敗',
}

const STALE_RUN_MS = 30 * 60 * 1000

type RunGroup = {
  key: string
  startedAt: string
  kind: GoogleSheetsSyncRun['kind']
  parts: string[]
  status: GoogleSheetsSyncRun['status']
}

/* 同じ日時の実行の行を束ねて、見本の表の1行にする。 */
function groupRuns(runs: GoogleSheetsSyncRun[]): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  for (const run of runs) {
    const key = run.startedAt
    const content = `${RUN_DATA_LABEL[run.dataType] ?? run.dataType} ${formatNumber(run.rowsWritten)}`
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, { key, startedAt: run.startedAt, kind: run.kind, parts: [content], status: run.status })
      continue
    }
    existing.parts.push(content)
    if (run.status === 'error' || (run.status === 'partial' && existing.status === 'ok') || (run.status === 'running' && existing.status !== 'error')) {
      existing.status = run.status
    }
  }
  return [...groups.values()]
}

function runPillClass(status: GoogleSheetsSyncRun['status']): string {
  if (status === 'ok') return `${styles.pill} ${styles.pillActive}`
  if (status === 'error') return `${styles.pill} ${styles.pillDanger}`
  if (status === 'partial') return `${styles.pill} ${styles.pillScheduled}`
  return `${styles.pill} ${styles.pillNeutral}`
}

export default function SheetsV8Page() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <SheetsV8Inner />
    </Suspense>
  )
}

function SheetsV8Inner() {
  usePageTitle('外部連携')
  const { selectedAccountId, selectedAccount } = useAccount()
  const searchParams = useSearchParams()
  const callbackResult = searchParams.get('sheets')

  const [connection, setConnection] = useState<GoogleSheetsConnection | null>(null)
  const [runs, setRuns] = useState<GoogleSheetsSyncRun[]>([])
  const [canManage, setCanManage] = useState(false)
  const [oauthConfigured, setOauthConfigured] = useState(true)
  const [syncRunning, setSyncRunning] = useState(false)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [loadError, setLoadError] = useState('')
  const [actionError, setActionError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [disconnectNotice, setDisconnectNotice] = useState('')
  const [runsError, setRunsError] = useState('')
  const [runsLoading, setRunsLoading] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'target' | 'sync' | 'disconnect' | null>(null)
  const [showTargetForm, setShowTargetForm] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [disconnectFor, setDisconnectFor] = useState<{ id: string; label: string } | null>(null)

  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const runsGenerationRef = useRef(0)

  const band = useV8BandData()

  const loadRuns = useCallback(async (accountId: string, signal?: AbortSignal) => {
    const requestGeneration = ++runsGenerationRef.current
    setRunsLoading(true)
    try {
      const res = await api.webhooks.googleSheets.runs(accountId, { signal })
      if (runsGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== accountId) return
      if (res.success && isGoogleSheetsRunsPayload(res.data)) {
        setRuns(res.data.runs)
        setRunsError('')
      } else {
        setRunsError('同期の記録を読み込めませんでした。')
      }
    } catch {
      if (runsGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== accountId) return
      setRunsError('同期の記録を読み込めませんでした。')
    } finally {
      if (runsGenerationRef.current === requestGeneration && selectedAccountIdRef.current === accountId) {
        setRunsLoading(false)
      }
    }
  }, [])

  const load = useCallback(async () => {
    const requestGeneration = ++loadGenerationRef.current
    const requestAccountId = selectedAccountId
    setConnection(null)
    setActionError('')
    if (!requestAccountId) {
      setRuns([])
      setRunsError('')
      setStatus('ready')
      return true
    }
    setStatus('loading')
    setLoadError('')
    const signal = AbortSignal.timeout(30_000)
    const runsPromise = loadRuns(requestAccountId, signal)
    const connectionResult = await api.webhooks.googleSheets.connection(requestAccountId, { signal })
      .then((res) => ({ ok: true as const, res }))
      .catch(() => ({ ok: false as const }))
    if (loadGenerationRef.current !== requestGeneration || selectedAccountIdRef.current !== requestAccountId) {
      await runsPromise
      return false
    }
    const connectionPayload = connectionResult.ok && connectionResult.res.success
      ? connectionResult.res.data
      : undefined
    if (isGoogleSheetsConnectionPayload(connectionPayload)) {
      setConnection(connectionPayload.connection)
      setCanManage(connectionPayload.canManage)
      setOauthConfigured(connectionPayload.oauthConfigured)
      setSyncRunning(connectionPayload.syncRunning)
      setShowTargetForm(connectionPayload.connection.status === 'pending_target')
      setStatus('ready')
      setSaveNotice('')
      await runsPromise
      return true
    }
    setStatus('error')
    setLoadError('連携の状態を読み込めませんでした。')
    await runsPromise
    return false
  }, [selectedAccountId, loadRuns])

  useEffect(() => {
    void load()
  }, [load])

  const previousAccountRef = useRef(selectedAccountId)
  useEffect(() => {
    if (previousAccountRef.current === selectedAccountId) return
    previousAccountRef.current = selectedAccountId
    setDisconnectFor(null)
    setTargetInput('')
    setShowTargetForm(false)
    setBusy(null)
    setActionError('')
    setSaveNotice('')
    setDisconnectNotice('')
  }, [selectedAccountId])

  const handleConnect = async () => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return
    setBusy('connect')
    setActionError('')
    try {
      const res = await api.webhooks.googleSheets.connectStart(requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      window.location.assign(res.data.authorizeUrl)
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setActionError('接続を始められませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBusy(null)
    }
  }

  const handleSaveTarget = async (e: React.FormEvent) => {
    e.preventDefault()
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return
    setBusy('target')
    setActionError('')
    setSaveNotice('')
    try {
      const res = await api.webhooks.googleSheets.setTarget(requestAccountId, targetInput.trim())
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      setTargetInput('')
      setShowTargetForm(false)
      const loaded = await load()
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!loaded) {
        setSaveNotice('出力先を保存しましたが、最新の状態を読み込めませんでした。「もう一度読み込む」で状態を確かめてください。')
      }
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setActionError('出力先を保存できませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBusy(null)
    }
  }

  const handleSync = async () => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId) return
    setBusy('sync')
    setActionError('')
    try {
      const res = await api.webhooks.googleSheets.sync(requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError(res.error)
      }
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setActionError('同期を始められませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBusy(null)
    }
  }

  const handleDisconnect = async () => {
    const requestAccountId = selectedAccountId
    if (!requestAccountId || disconnectFor?.id !== requestAccountId) return
    setBusy('disconnect')
    setDisconnectNotice('')
    try {
      const res = await api.webhooks.googleSheets.disconnect(requestAccountId)
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError('接続を解除できませんでした。状態を読み直してから、もう一度お試しください。')
        return
      }
      setDisconnectFor(null)
      if (!res.data?.revoked) {
        setDisconnectNotice('このアプリ側の連携は解除しましたが、Google側の許可の取り消しに失敗しました。Googleアカウントの「セキュリティ」設定から、このアプリへのアクセスを取り消してください。')
      }
      await load()
    } catch {
      if (selectedAccountIdRef.current !== requestAccountId) return
      setActionError('接続を解除できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (selectedAccountIdRef.current === requestAccountId) setBusy(null)
    }
  }

  if (!selectedAccountId) {
    return (
      <div className={styles.board} data-design-node="DxAAA">
        <WebhooksV8Head activeTab="sheets" outgoingCount={null} incomingCount={null} />
        <p className={styles.footNote}>左のサイドバーからLINEアカウントを選ぶと、そのアカウントの書き出し設定をここで変えられます。</p>
      </div>
    )
  }

  const callbackNotice = callbackResult
    ? CALLBACK_MESSAGES[callbackResult]
      ?? (callbackResult.startsWith('error:')
        ? { tone: 'error' as const, text: 'Googleとの接続に失敗しました。もう一度お試しください。' }
        : null)
    : null

  const connStatus: 'connected' | 'pending_target' | 'expired' | 'disconnected' = connection?.status ?? 'disconnected'
  const staleRunningRun = runs.find(
    (run) => run.status === 'running' && Date.parse(run.startedAt) < Date.now() - STALE_RUN_MS,
  )
  const effectivelyRunning = syncRunning && !staleRunningRun
  const groups = groupRuns(runs)

  const lastSyncText = connection?.lastSyncedAt
    ? `${formatDateTime(connection.lastSyncedAt)}${connection.lastSyncStatus && connection.lastSyncStatus !== 'ok' ? `・${connection.lastSyncStatus === 'partial' ? '一部だけ完了' : '失敗'}` : ''}`
    : '—'

  return (
    <div className={styles.board} data-design-node="DxAAA">
      <WebhooksV8Head
        activeTab="sheets"
        outgoingCount={band.outgoingItems === null ? null : band.outgoingItems.length}
        incomingCount={band.incomingCount}
      />
      <WebhooksV8Band cells={outgoingKpiCells({ items: band.outgoingItems, incomingCount: band.incomingCount, summary: band.summary })} />

      {callbackNotice ? (
        <Notice tone={callbackNotice.tone === 'ok' ? 'success' : callbackNotice.tone === 'warn' ? 'warn' : 'danger'}>
          {callbackNotice.text}
        </Notice>
      ) : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      {disconnectNotice ? <Notice tone="warn">{disconnectNotice}</Notice> : null}
      {saveNotice ? (
        <Notice tone="warn">
          {saveNotice}{' '}
          <Button variant="secondary" onClick={() => void load()}>もう一度読み込む</Button>
        </Notice>
      ) : null}

      {status === 'loading' ? <ListState kind="loading" title="連携の状態を読み込んでいます" /> : null}
      {status === 'error' ? (
        <ListState
          kind="error"
          title={loadError || '連携の状態を読み込めませんでした'}
          description="連携の内容は変わっていません。左で選んでいるLINEアカウントが合っているか確かめてください。"
          action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
        />
      ) : null}

      {status === 'ready' ? (
        <div className={styles.main}>
          <div className={styles.cols}>
            <div className={styles.col}>
              <section className={styles.card} aria-label="Google Sheets への書き出し">
                <h2 className={styles.cardTitle}>Google Sheets への書き出し</h2>
                <p className={styles.cardNote}>友だち・フォーム回答をスプレッドシートへ書き出します</p>
                {connStatus === 'disconnected' ? (
                  <div>
                    <p className={styles.cardNote}>まだ接続されていません。Googleアカウントで許可すると、書き出し先を設定できるようになります。</p>
                    {canManage ? (
                      <div className={styles.buttonRow}>
                        <Button
                          variant="primary"
                          disabled={busy !== null || !oauthConfigured}
                          onClick={() => void handleConnect()} busy={busy === 'connect'} busyLabel="Googleへ移動しています…"
                        >
                          Googleアカウントを接続する
                        </Button>
                      </div>
                    ) : (
                      <p className={styles.footNote}>接続の設定は、統括の管理者だけが変更できます。</p>
                    )}
                  </div>
                ) : (
                  <>
                    <dl className={styles.statusRows}>
                      <div className={styles.statusRow}>
                        <dt className={styles.statusLabel}>いまの状態</dt>
                        <dd className={styles.statusValue}>
                          {connStatus === 'connected' ? '接続しています' : connStatus === 'expired' ? '許可が切れています' : '出力先の設定中'}
                        </dd>
                      </div>
                      <div className={styles.statusRow}>
                        <dt className={styles.statusLabel}>接続しているGoogleアカウント</dt>
                        <dd className={styles.statusValue}>{connection?.googleAccountEmail ?? '—'}</dd>
                      </div>
                      <div className={styles.statusRow}>
                        <dt className={styles.statusLabel}>書き出し先</dt>
                        <dd className={styles.statusValue}>
                          {connection?.spreadsheetUrl ? (
                            <a href={connection.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className={styles.sheetLink}>
                              {connection.spreadsheetTitle ?? connection.spreadsheetUrl}（シート：友だち・フォーム回答）
                            </a>
                          ) : (
                            '未設定'
                          )}
                        </dd>
                      </div>
                      <div className={styles.statusRow}>
                        <dt className={styles.statusLabel}>前回の同期</dt>
                        <dd className={styles.statusValue}>{lastSyncText}</dd>
                      </div>
                    </dl>
                    {connStatus === 'expired' ? (
                      <Notice tone="warn">
                        Googleとの許可が切れています。同期は止まっています。
                        {canManage ? '「再接続する」から許可をやり直してください。' : null}
                      </Notice>
                    ) : null}
                    {canManage ? (
                      <div className={styles.buttonRow}>
                        {connStatus === 'expired' ? (
                          <Button
                            variant="primary"
                            disabled={busy !== null}
                            onClick={() => void handleConnect()} busy={busy === 'connect'} busyLabel="Googleへ移動しています…"
                          >
                            再接続する
                          </Button>
                        ) : (
                          <>
                            <Button
                              variant="primary"
                              disabled={busy !== null || effectivelyRunning || !connection?.spreadsheetId}
                              onClick={() => void handleSync()} busy={busy === 'sync'} busyLabel="同期しています…"
                            >
                              {effectivelyRunning ? '同期中' : '今すぐ同期'}
                            </Button>
                            <Button
                              disabled={busy !== null}
                              onClick={() => setShowTargetForm((current) => !current)}
                            >
                              {showTargetForm ? '閉じる' : connection?.spreadsheetId ? '出力先を変更' : '出力先を設定'}
                            </Button>
                            <Button
                              variant="danger"
                              disabled={busy !== null}
                              onClick={() =>
                                setDisconnectFor({
                                  id: selectedAccountId,
                                  label: selectedAccount?.name?.trim() || selectedAccountId,
                                })
                              }
                            >
                              接続を解除する
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <p className={styles.footNote}>接続の設定は、統括の管理者だけが変更できます。</p>
                    )}
                    {showTargetForm && canManage && connStatus !== 'expired' ? (
                      <form onSubmit={handleSaveTarget} className={styles.targetForm}>
                        <label className={styles.label} htmlFor="sheets-v8-target">
                          スプレッドシートのURLまたはID
                        </label>
                        <p className={styles.footNote}>
                          共有設定で「{connection?.googleAccountEmail ?? '接続したGoogleアカウント'}」に編集権限を付けたシートを指定してください。
                          指定したシート内に「友だち」「フォーム回答」のタブを自動で作ります。
                        </p>
                        <div className={styles.targetRow}>
                          <input
                            id="sheets-v8-target"
                            value={targetInput}
                            onChange={(event) => setTargetInput(event.target.value)}
                            className={styles.input}
                            placeholder="https://docs.google.com/spreadsheets/d/…"
                            required
                          />
                          <Button type="submit" variant="primary" disabled={busy !== null} busy={busy === 'target'} busyLabel="確認しています…">
                            保存する
                          </Button>
                        </div>
                      </form>
                    ) : null}
                  </>
                )}
              </section>

              {connStatus !== 'disconnected' ? (
                <section className={styles.card} aria-label="同期の記録">
                  <h2 className={styles.cardTitle}>同期の記録</h2>
                  {runsError ? (
                    <div className={styles.buttonRow}>
                      <span className={styles.footNote}>{runsError}表示中の記録は、最後に読み込めた時点のものです。</span>
                      <Button onClick={() => selectedAccountId && void loadRuns(selectedAccountId)} busy={runsLoading} busyLabel="読み込んでいます…">
                        記録を読み直す
                      </Button>
                    </div>
                  ) : null}
                  {runsLoading && runs.length === 0 && !runsError ? (
                    <p className={styles.cardNote}>読み込んでいます…</p>
                  ) : null}
                  {groups.length === 0 && !runsLoading && !runsError ? (
                    <p className={styles.cardNote}>まだ同期の記録がありません。</p>
                  ) : null}
                  {groups.length > 0 ? (
                    <div className={styles.tableWrap} style={{ marginTop: 12 }}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th scope="col">日時</th>
                            <th scope="col">きっかけ</th>
                            <th scope="col">書き出したもの</th>
                            <th scope="col">結果</th>
                          </tr>
                        </thead>
                        <tbody>
                          {groups.map((group) => (
                            <tr key={group.key}>
                              <td className={styles.dimCell}>{formatDateTime(group.startedAt)}</td>
                              <td className={styles.dimCell}>{RUN_KIND_LABEL[group.kind] ?? group.kind}</td>
                              <td className={styles.contentCell}>{group.parts.join('・') || '—'}</td>
                              <td>
                                <span className={runPillClass(group.status)}>● {RUN_STATUS_LABEL[group.status] ?? group.status}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>

            <aside className={styles.sideCard} aria-label="気をつけること">
              <h2 className={styles.sideTitle}>気をつけること</h2>
              <ul className={styles.sideList}>
                <li>・Google側でこのアプリの許可を取り消したときは、「再接続する」からやり直します</li>
                <li>・解除しても、書き出したスプレッドシートは消えません</li>
              </ul>
            </aside>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={disconnectFor !== null}
        title="Google Sheets との接続を解除しますか？"
        description={`「${disconnectFor?.label ?? ''}」の連携を解除します。Google側の許可を取り消し、このアカウントの連携設定と同期の記録をすべて削除します。書き出し済みのシート側のデータは残ります。この操作は取り消せません。`}
        confirmLabel="接続を解除する"
        destructive
        busy={busy === 'disconnect'}
        onConfirm={() => void handleDisconnect()}
        onCancel={() => {
          if (busy === 'disconnect') return
          setDisconnectFor(null)
        }}
      />
    </div>
  )
}
