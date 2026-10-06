'use client'

/*
 * ★V8 外部連携「Google Sheets」タブ（Pencil `DxAAA`、解除の窓 `YZ57z`）。
 *
 * 左に書き出しのカード（いまの状態・Googleアカウント・書き出し先・前回の同期・
 * 今すぐ同期／出力先を変更／接続を解除する）と同期の記録、右に気をつけること。
 * データの口は v7 と同じ（接続・出力先・同期・解除・記録）。OAuth の戻り先
 * （?tab=sheets&sheets=…）の知らせも今と同じ言葉で出す。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { LayoutTemplate, RefreshCw, Sheet } from 'lucide-react'
import { isGoogleSheetsConnectionPayload, isGoogleSheetsRunsPayload } from '@line-crm/shared'
import { api, type GoogleSheetsConnection, type GoogleSheetsSyncRun } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { ListPage } from '@/components/templates'
import Button from '@/components/shared/button'
import Dialog from '@/components/shared/dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import { DelayedSkeleton, Skeleton } from '@/components/shared/skeleton'
import {
  ViewerBand,
  WEBHOOKS_DESCRIPTION,
  WebhookBand,
  WebhookTabs,
  overviewBandCells,
  useWebhookOverview,
} from './shell'
import { shortDateTime } from './words'
import styles from './sheets.module.css'

type LoadStatus = 'loading' | 'ready' | 'error'

/* OAuth の戻り先の知らせ（v7 の google-sheets-panel と同じ言葉）。 */
const CALLBACK_MESSAGES: Record<string, { tone: 'success' | 'warn' | 'danger'; text: string }> = {
  connected: { tone: 'success', text: 'Googleアカウントと接続しました。書き出し先のスプレッドシートを設定してください。' },
  reconnected: { tone: 'success', text: 'Googleアカウントを再接続しました。' },
  'error:denied': { tone: 'warn', text: 'Googleでの許可が取り消されました。接続するには、もう一度「Googleアカウントを接続する」から進んでください。' },
  'error:invalid_state': { tone: 'danger', text: '接続の確認に失敗しました。時間が経ちすぎた可能性があります。もう一度最初からお試しください。' },
  'error:no_refresh_token': { tone: 'danger', text: 'Googleから長期利用の許可を受け取れませんでした。Googleアカウント側でこのアプリへの許可を一度取り消してから、接続をやり直してください。' },
  'error:account_missing': { tone: 'danger', text: '接続しようとしたLINEアカウントが見つかりません。アカウントの選択を確かめてからやり直してください。' },
  'error:oauth_not_configured': { tone: 'danger', text: 'この環境にはGoogle接続の設定がまだありません。管理者に確かめてください。' },
  'error:encryption_key_missing': { tone: 'danger', text: 'この環境の暗号化設定が不足しています。管理者に確かめてください。' },
  'error:state_cancelled': { tone: 'warn', text: 'この接続操作は、途中で別の接続操作や解除が行われたため取り消されました。接続したい場合はもう一度最初から進めてください。' },
  'error:no_permission': { tone: 'danger', text: 'Googleの許可画面でスプレッドシートの許可が外れていたため、接続していません。もう一度接続して、この許可を付けたままにしてください。' },
}

const RUN_KIND_LABEL: Record<GoogleSheetsSyncRun['kind'], string> = { manual: '手動', scheduled: '定期' }
const RUN_DATA_LABEL: Record<GoogleSheetsSyncRun['dataType'], string> = { friends: '友だち', form_answers: 'フォーム回答' }
const RUN_STATUS_LABEL: Record<GoogleSheetsSyncRun['status'], string> = { running: '実行中', ok: '完了', partial: '一部だけ完了', error: '失敗' }
const RUN_STATUS_TONE: Record<GoogleSheetsSyncRun['status'], string> = { running: 'neutral', ok: 'active', partial: 'warn', error: 'danger' }

/** 30分以上「実行中」のままの記録は止まったものとみなす（v7 と同じ）。 */
const STALE_RUN_MS = 30 * 60 * 1000

type RunGroup = { key: string; startedAt: string; kind: GoogleSheetsSyncRun['kind']; parts: string[]; status: GoogleSheetsSyncRun['status'] }

/* 同じ開始時刻の行を束ねて表の1行にする。失敗で0件の行は「書き出したもの」に数えない。 */
export function groupRuns(runs: GoogleSheetsSyncRun[]): RunGroup[] {
  const groups = new Map<string, RunGroup>()
  for (const run of runs) {
    const content = run.status === 'error' && run.rowsWritten === 0
      ? null
      : `${RUN_DATA_LABEL[run.dataType] ?? run.dataType} ${formatNumber(run.rowsWritten)}`
    const existing = groups.get(run.startedAt)
    if (!existing) {
      groups.set(run.startedAt, { key: run.startedAt, startedAt: run.startedAt, kind: run.kind, parts: content ? [content] : [], status: run.status })
      continue
    }
    if (content) existing.parts.push(content)
    if (run.status === 'error' || (run.status === 'partial' && existing.status === 'ok') || (run.status === 'running' && existing.status !== 'error')) {
      existing.status = run.status
    }
  }
  return [...groups.values()]
}

export default function WebhooksSheetsV8() {
  usePageTitle('外部連携')
  usePageCrumbs([{ label: 'ホーム', href: '/' }])
  const { selectedAccountId, selectedAccount, accounts } = useAccount()
  const staffRole = useStaffRole()
  const isOwner = staffRole === null || staffRole === 'owner'
  const searchParams = useSearchParams()
  const callbackResult = searchParams.get('sheets')
  const overview = useWebhookOverview()

  const [connection, setConnection] = useState<GoogleSheetsConnection | null>(null)
  const [runs, setRuns] = useState<GoogleSheetsSyncRun[]>([])
  /* 接続の操作ができるかは口が返す（canManage）。 */
  const [canManage, setCanManage] = useState(false)
  const [oauthConfigured, setOauthConfigured] = useState(true)
  const [syncRunning, setSyncRunning] = useState(false)
  const [status, setStatus] = useState<LoadStatus>('loading')
  const [actionError, setActionError] = useState('')
  const [saveNotice, setSaveNotice] = useState('')
  const [disconnectNotice, setDisconnectNotice] = useState('')
  const [runsError, setRunsError] = useState('')
  const [runsLoading, setRunsLoading] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'target' | 'sync' | 'disconnect' | null>(null)
  const [showTargetForm, setShowTargetForm] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  const [disconnectFor, setDisconnectFor] = useState<{ id: string; label: string } | null>(null)

  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const runsGenerationRef = useRef(0)

  const loadRuns = useCallback(async (accountId: string, signal?: AbortSignal) => {
    const generation = ++runsGenerationRef.current
    setRunsLoading(true)
    try {
      const res = await api.webhooks.googleSheets.runs(accountId, { signal })
      if (runsGenerationRef.current !== generation || accountRef.current !== accountId) return
      if (res.success && isGoogleSheetsRunsPayload(res.data)) {
        setRuns(res.data.runs)
        setRunsError('')
      } else {
        setRunsError('同期の記録を読み込めませんでした。')
      }
    } catch {
      if (runsGenerationRef.current !== generation || accountRef.current !== accountId) return
      setRunsError('同期の記録を読み込めませんでした。')
    } finally {
      if (runsGenerationRef.current === generation && accountRef.current === accountId) setRunsLoading(false)
    }
  }, [])

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current
    const accountId = selectedAccountId
    setConnection(null)
    setActionError('')
    if (!accountId) {
      setRuns([])
      setRunsError('')
      setStatus('ready')
      return true
    }
    setStatus('loading')
    const signal = AbortSignal.timeout(30_000)
    const runsPromise = loadRuns(accountId, signal)
    const result = await api.webhooks.googleSheets.connection(accountId, { signal })
      .then((res) => ({ ok: true as const, res }))
      .catch(() => ({ ok: false as const }))
    if (loadGenerationRef.current !== generation || accountRef.current !== accountId) {
      await runsPromise
      return false
    }
    const payload = result.ok && result.res.success ? result.res.data : undefined
    if (isGoogleSheetsConnectionPayload(payload)) {
      setConnection(payload.connection)
      setCanManage(payload.canManage)
      setOauthConfigured(payload.oauthConfigured)
      setSyncRunning(payload.syncRunning)
      setShowTargetForm(payload.connection.status === 'pending_target')
      setStatus('ready')
      setSaveNotice('')
      await runsPromise
      return true
    }
    setStatus('error')
    await runsPromise
    return false
  }, [selectedAccountId, loadRuns])

  useEffect(() => { void load() }, [load])

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
    const accountId = selectedAccountId
    if (!accountId) return
    setBusy('connect')
    setActionError('')
    try {
      const res = await api.webhooks.googleSheets.connectStart(accountId)
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      window.location.assign(res.data.authorizeUrl)
    } catch {
      if (accountRef.current !== accountId) return
      setActionError('接続を始められませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (accountRef.current === accountId) setBusy(null)
    }
  }

  const handleSaveTarget = async (event: React.FormEvent) => {
    event.preventDefault()
    const accountId = selectedAccountId
    if (!accountId) return
    setBusy('target')
    setActionError('')
    setSaveNotice('')
    try {
      const res = await api.webhooks.googleSheets.setTarget(accountId, targetInput.trim())
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      setTargetInput('')
      setShowTargetForm(false)
      const loaded = await load()
      if (accountRef.current !== accountId) return
      if (!loaded) setSaveNotice('出力先を保存しましたが、最新の状態を読み込めませんでした。「もう一度読み込む」で状態を確かめてください。')
    } catch {
      if (accountRef.current !== accountId) return
      setActionError('出力先を保存できませんでした。通信を確かめて、もう一度お試しください。')
    } finally {
      if (accountRef.current === accountId) setBusy(null)
    }
  }

  const handleSync = async () => {
    const accountId = selectedAccountId
    if (!accountId) return
    setBusy('sync')
    setActionError('')
    try {
      const res = await api.webhooks.googleSheets.sync(accountId)
      if (accountRef.current !== accountId) return
      if (!res.success) setActionError(res.error)
      await load()
    } catch {
      if (accountRef.current !== accountId) return
      setActionError('同期を始められませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (accountRef.current === accountId) setBusy(null)
    }
  }

  const handleDisconnect = async () => {
    const accountId = selectedAccountId
    if (!accountId || disconnectFor?.id !== accountId) return
    setBusy('disconnect')
    setDisconnectNotice('')
    try {
      const res = await api.webhooks.googleSheets.disconnect(accountId)
      if (accountRef.current !== accountId) return
      if (!res.success) {
        setActionError('接続を解除できませんでした。状態を読み直してから、もう一度お試しください。')
        setDisconnectFor(null)
        return
      }
      setDisconnectFor(null)
      if (!res.data?.revoked) {
        setDisconnectNotice('このアプリ側の連携は解除しましたが、Google側の許可の取り消しに失敗しました。Googleアカウントの「セキュリティ」設定から、このアプリへのアクセスを取り消してください。')
      }
      await load()
    } catch {
      if (accountRef.current !== accountId) return
      setActionError('接続を解除できませんでした。時間をおいて、もう一度お試しください。')
    } finally {
      if (accountRef.current === accountId) setBusy(null)
    }
  }

  const callbackNotice = callbackResult
    ? CALLBACK_MESSAGES[callbackResult]
      ?? (callbackResult.startsWith('error:') ? { tone: 'danger' as const, text: 'Googleとの接続に失敗しました。もう一度お試しください。' } : null)
    : null

  const connStatus: 'connected' | 'pending_target' | 'expired' | 'disconnected' = connection?.status ?? 'disconnected'
  const staleRunningRun = runs.find((run) => run.status === 'running' && Date.parse(run.startedAt) < Date.now() - STALE_RUN_MS)
  const effectivelyRunning = syncRunning && !staleRunningRun
  const groups = groupRuns(runs)
  const lastKind = runs.find((run) => run.startedAt === connection?.lastSyncedAt)?.kind
  const lastSyncText = connection?.lastSyncedAt
    ? `${shortDateTime(connection.lastSyncedAt)}${lastKind ? ` ${RUN_KIND_LABEL[lastKind]}` : ''}・${connection.lastSyncStatus === 'partial' ? '一部だけ完了' : connection.lastSyncStatus === 'error' ? '失敗' : '完了'}`
    : '—'

  /* ===== 左：書き出しのカード ===== */
  let mainCard
  if (connStatus === 'disconnected') {
    mainCard = (
      <>
        <p className={styles.cardNote}>まだ接続されていません。Googleアカウントで許可すると、書き出し先を設定できるようになります。</p>
        {canManage ? (
          <div className={styles.buttonRow}>
            <Button variant="primary" disabled={busy !== null || !oauthConfigured} onClick={() => void handleConnect()} busy={busy === 'connect'} busyLabel="Googleへ移動しています…">
              Googleアカウントを接続する
            </Button>
          </div>
        ) : (
          <p className={styles.cardNote}>接続の設定は、統括だけが変更できます。</p>
        )}
      </>
    )
  } else {
    mainCard = (
      <>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>いまの状態</span>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.statusStrong}>
            {connStatus === 'connected' ? '接続しています' : connStatus === 'expired' ? '許可が切れています' : '出力先の設定中'}
          </span>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>接続しているGoogleアカウント</span>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.statusValue}>{connection?.googleAccountEmail ?? '—'}</span>
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>書き出し先</span>
          <span className={styles.spacer} aria-hidden="true" />
          {connection?.spreadsheetUrl ? (
            <a href={connection.spreadsheetUrl} target="_blank" rel="noopener noreferrer" className={styles.statusValue}>
              {`${connection.spreadsheetTitle ?? connection.spreadsheetUrl}（シート：友だち・フォーム回答）`}
            </a>
          ) : (
            <span className={styles.statusValue}>まだ決めていません</span>
          )}
        </div>
        <div className={styles.statusRow}>
          <span className={styles.statusLabel}>前回の同期</span>
          <span className={styles.spacer} aria-hidden="true" />
          <span className={styles.statusValue}>{lastSyncText}</span>
        </div>
        {connStatus === 'expired' ? (
          <Notice tone="warn">Googleとの許可が切れています。同期は止まっています。{canManage ? '「再接続する」から許可をやり直してください。' : null}</Notice>
        ) : null}
        {canManage ? (
          <div className={styles.buttonRow}>
            {connStatus === 'expired' ? (
              <Button variant="primary" disabled={busy !== null} onClick={() => void handleConnect()} busy={busy === 'connect'} busyLabel="Googleへ移動しています…">
                再接続する
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  disabled={busy !== null || effectivelyRunning || !connection?.spreadsheetId}
                  onClick={() => void handleSync()}
                  busy={busy === 'sync'}
                  busyLabel="同期しています…"
                >
                  <RefreshCw size={15} aria-hidden="true" />{effectivelyRunning ? '同期中' : '今すぐ同期'}
                </Button>
                <Button disabled={busy !== null} onClick={() => setShowTargetForm((current) => !current)}>
                  <Sheet size={15} aria-hidden="true" />{showTargetForm ? '閉じる' : connection?.spreadsheetId ? '出力先を変更' : '出力先を設定'}
                </Button>
              </>
            )}
            <span className={styles.spacer} aria-hidden="true" />
            <Button
              variant="danger"
              disabled={busy !== null}
              onClick={() => selectedAccountId && setDisconnectFor({ id: selectedAccountId, label: selectedAccount?.name?.trim() || selectedAccountId })}
            >
              接続を解除する
            </Button>
          </div>
        ) : (
          <p className={styles.cardNote}>接続の設定は、統括だけが変更できます。</p>
        )}
        {showTargetForm && canManage && connStatus !== 'expired' ? (
          <form onSubmit={handleSaveTarget} className={styles.targetForm}>
            <label className={styles.fieldLabel} htmlFor="wh-sheets-target">スプレッドシートのURLまたはID</label>
            <p className={styles.cardNote}>
              共有設定で「{connection?.googleAccountEmail ?? '接続したGoogleアカウント'}」に編集権限を付けたシートを指定してください。指定したシート内に「友だち」「フォーム回答」のタブを自動で作ります。
            </p>
            <div className={styles.targetRow}>
              <input id="wh-sheets-target" value={targetInput} onChange={(event) => setTargetInput(event.target.value)} className={styles.input} placeholder="https://docs.google.com/spreadsheets/d/…" required />
              <Button type="submit" variant="primary" disabled={busy !== null} busy={busy === 'target'} busyLabel="確認しています…">保存する</Button>
            </div>
          </form>
        ) : null}
      </>
    )
  }

  let body
  if (!selectedAccountId) {
    body = <ListState kind="empty" title={accounts.length > 0 ? '上のバーでLINE公式アカウントを選んでください' : 'LINE公式アカウントが登録されていません'} />
  } else if (status === 'loading') {
    body = (
      <div aria-busy="true" aria-label="連携の状態を読み込んでいます">
        <DelayedSkeleton
          loading
          skeleton={(
            <div aria-hidden="true" className={styles.card}>
              <Skeleton className={styles.skeletonTitle} />
              {[0, 1, 2, 3].map((row) => <Skeleton key={row} className={styles.skeletonRow} />)}
            </div>
          )}
        />
      </div>
    )
  } else if (status === 'error') {
    body = (
      <ListState
        kind="error"
        title="連携の状態を読み込めませんでした"
        description="連携の内容は変わっていません。上で選んでいるLINEアカウントが合っているか確かめてください。"
        action={<Button onClick={() => void load()}>もう一度読み込む</Button>}
      />
    )
  } else {
    body = (
      <>
        <section className={styles.card} aria-labelledby="wh-sheets-export">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="wh-sheets-export">Google Sheets への書き出し</h2>
            <p className={styles.cardNote}>友だち・フォーム回答をスプレッドシートへ書き出します</p>
          </div>
          {mainCard}
        </section>
        {connStatus !== 'disconnected' ? (
          <section className={styles.card} aria-labelledby="wh-sheets-runs">
            <div className={styles.cardHead}>
              <h2 className={styles.cardTitle} id="wh-sheets-runs">同期の記録</h2>
            </div>
            {runsError ? (
              <div className={styles.buttonRow}>
                <span className={styles.cardNote}>{runsError}表示中の記録は、最後に読み込めた時点のものです。</span>
                <Button onClick={() => selectedAccountId && void loadRuns(selectedAccountId)} busy={runsLoading} busyLabel="読み込んでいます…">記録を読み直す</Button>
              </div>
            ) : null}
            {groups.length === 0 && !runsError ? (
              <p className={styles.cardNote}>{runsLoading ? '読み込んでいます…' : 'まだ同期の記録がありません。'}</p>
            ) : null}
            {groups.length > 0 ? (
              <>
                <div className={styles.runHead} role="presentation">
                  <span className={styles.colWhen}>日時</span>
                  <span className={styles.colKind}>きっかけ</span>
                  <span className={styles.colWhat}>書き出したもの</span>
                  <span className={styles.colResult}>結果</span>
                </div>
                {groups.map((group) => (
                  <div key={group.key} className={styles.runRow}>
                    <span className={styles.colWhen}>{shortDateTime(group.startedAt)}</span>
                    <span className={styles.colKind}>{RUN_KIND_LABEL[group.kind] ?? group.kind}</span>
                    <span className={styles.colWhat} title={group.parts.join('・')}>{group.parts.join('・') || '—'}</span>
                    <span className={styles.colResult}>
                      <span className={styles.pill} data-tone={RUN_STATUS_TONE[group.status]}>
                        <span className={styles.pillDot} aria-hidden="true" />
                        {RUN_STATUS_LABEL[group.status] ?? group.status}
                      </span>
                    </span>
                  </div>
                ))}
              </>
            ) : null}
          </section>
        ) : null}
      </>
    )
  }

  return (
    <ListPage
      boardId="DxAAA"
      headingSize="regular"
      title="外部連携"
      description={WEBHOOKS_DESCRIPTION}
      actions={isOwner ? <Button href="/webhooks?tab=notify"><LayoutTemplate size={15} aria-hidden="true" />見本から作る</Button> : undefined}
      tabs={<WebhookTabs active="sheets" outgoingCount={overview.outgoingCount} incomingCount={overview.incomingCount} />}
      stats={<>
        {!isOwner ? <ViewerBand /> : null}
        <WebhookBand
          cells={overviewBandCells({
            outgoing: overview.outgoingCount === null ? null : overview.outgoing,
            incomingCount: overview.incomingCount,
            summary: overview.summary,
          })}
        />
      </>}
      overlays={(
        <Dialog
          open={disconnectFor !== null}
          title="Google Sheets との接続を解除しますか？"
          description="書き出しが止まります。シートの中身は消えません。この操作は取り消せません。"
          descriptionBand="danger"
          tone="destructive"
          confirmation
          compact
          designNode="YZ57z"
          busy={busy === 'disconnect'}
          confirmLabel="接続を解除する"
          onConfirm={() => void handleDisconnect()}
          onCancel={() => { if (busy !== 'disconnect') setDisconnectFor(null) }}
        >
          <p className={styles.dialogNote}>{`「${disconnectFor?.label ?? ''}」の連携設定と同期の記録を消し、Google側の許可も取り消します。`}</p>
        </Dialog>
      )}
    >
      <div className={styles.body}>
        <div className={styles.mainCol}>
          {callbackNotice ? <Notice tone={callbackNotice.tone}>{callbackNotice.text}</Notice> : null}
          {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
          {disconnectNotice ? <Notice tone="warn">{disconnectNotice}</Notice> : null}
          {saveNotice ? (
            <Notice tone="warn" action={<Button onClick={() => void load()}>もう一度読み込む</Button>}>{saveNotice}</Notice>
          ) : null}
          {body}
        </div>
        <aside className={`${styles.card} ${styles.sideCard}`} aria-labelledby="wh-sheets-care">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="wh-sheets-care">気をつけること</h2>
          </div>
          <p className={styles.careText}>
            ・Google 側でこのアプリの許可を取り消したときは、「再接続する」からやり直します<br />
            ・解除しても、書き出したスプレッドシートは消えません
          </p>
        </aside>
      </div>
    </ListPage>
  )
}
