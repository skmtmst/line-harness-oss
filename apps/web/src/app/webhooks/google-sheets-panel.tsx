'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api, type GoogleSheetsConnection, type GoogleSheetsSyncRun } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Disclosure from '@/components/shared/disclosure'
import { isGoogleSheetsConnectionPayload, isGoogleSheetsRunsPayload } from '@line-crm/shared'
import { formatDateTime, formatNumber } from '@/lib/format'

type LoadStatus = 'loading' | 'ready' | 'error'

/*
  OAuthからの戻り（/webhooks?tab=sheets&sheets=…）。Worker側が付ける
  結果コードを、操作した人に読める言葉へ写す。
  知らないコードは「失敗しました」の一般形に寄せ、生のコードは出さない。
*/
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

/*
 * サーバ側と同じ「30分で実行中のまま止まったとみなす」時間。
 * これを超えた実行中の記録は、次の同期を始めるときに自動で
 * 終了処理される（表示で迷わせないよう同じ基準を持つ）。
 */
const STALE_RUN_MS = 30 * 60 * 1000


/**
 * #838 第2段: Google Sheets への直接書き出しの設定と状態。
 *
 * 1アカウント = 1連携 = 1シート。接続はOAuthでGoogleの画面へ往復し、
 * 戻ってきたときの結果は ?sheets=… でこのパネルが受け取る。
 * 変更できるのは統括（口側の canManage が権限の正本）。
 */
export default function GoogleSheetsPanel() {
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
  // 書き込み（保存・解除）は成功したのに読み直しが落ちた、という状態を
  // 「操作の失敗」と混ぜないための別窓。
  const [saveNotice, setSaveNotice] = useState('')
  const [disconnectNotice, setDisconnectNotice] = useState('')
  const [runsError, setRunsError] = useState('')
  const [runsLoading, setRunsLoading] = useState(false)
  const [busy, setBusy] = useState<'connect' | 'target' | 'sync' | 'disconnect' | null>(null)
  // 「出力先を変更」は畳める。新規設定時は自動で開く。
  const [showTargetForm, setShowTargetForm] = useState(false)
  const [targetInput, setTargetInput] = useState('')
  /*
   * 解除の確認窓を「どのアカウントに対して開いたか」まで持つ。
   * 窓を開いたあとで別アカウントへ切り替わると、表示中の内容と
   * 実際に消される対象がずれるのを防ぐ。
   */
  const [disconnectFor, setDisconnectFor] = useState<{ id: string; label: string } | null>(null)

  const selectedAccountIdRef = useRef(selectedAccountId)
  selectedAccountIdRef.current = selectedAccountId
  const loadGenerationRef = useRef(0)
  const runsGenerationRef = useRef(0)

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
        // 失敗を「記録が0件」に見せない。古い記録は残したまま、
        // 読み直せなかったことと再読込の導線を出す。
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
    /*
     * R151: 応答の無い通信はブラウザもいつまでも待つ。30秒で打ち切って
     * 「読み込めなかった」表示と再試行へ逃がす（読み込み中のまま止めない）。
     */
    const signal = AbortSignal.timeout(30_000)
    // 連携の状態と同期の記録は別々に扱う。記録だけ落ちても
    // 「連携そのものの失敗」には見せない（逆も同じ）。
    const runsPromise = loadRuns(requestAccountId, signal)
    const connectionResult = await api.webhooks.googleSheets.connection(requestAccountId, { signal })
      .then((res) => ({ ok: true as const, res }))
      .catch(() => ({ ok: false as const }))
    if (
      loadGenerationRef.current !== requestGeneration
      || selectedAccountIdRef.current !== requestAccountId
    ) {
      await runsPromise
      return false
    }
    /*
     * 応答の形は packages/shared の判定で確かめる。形が違う応答でも
     * 「読み込めなかった」表示へ逃がす（読み込み中のまま止めない）。
     */
    const connectionPayload = connectionResult.ok && connectionResult.res.success
      ? connectionResult.res.data
      : undefined
    if (isGoogleSheetsConnectionPayload(connectionPayload)) {
      setConnection(connectionPayload.connection)
      setCanManage(connectionPayload.canManage)
      setOauthConfigured(connectionPayload.oauthConfigured)
      setSyncRunning(connectionPayload.syncRunning)
      // 未設定（pending_target）なら出力先フォームを開いた状態で見せる。
      setShowTargetForm(connectionPayload.connection.status === 'pending_target')
      setStatus('ready')
      // 読み直せたので「保存はできたが状態が読めない」案内は要らない。
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

  /*
   * 別アカウントへ切り替わったら、前のアカウントのために開いていた
   * 確認窓・入力・進行中表示・操作結果は全部捨てる。
   * 非同期処理の側は応答時にアカウントを照合して結果を捨てるが、
   * 窓や入力のような「画面に残るもの」はここで片付ける必要がある。
   */
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
      /*
       * 応答が返る前に別アカウントへ切り替わっていたら何もしない。
       * ここで止めないと、いま見ているアカウントの画面から
       * 前のアカウント向けの認証へ勝手に連れて行かれる。
       */
      if (selectedAccountIdRef.current !== requestAccountId) return
      if (!res.success) {
        setActionError(res.error)
        return
      }
      // Googleの同意画面へ。このページは離れる（戻りは ?sheets=… で来る）。
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
      /*
       * 保存は通ったのに読み直しだけ落ちたとき、「保存に失敗した」
       * ように見せると同じ出力先をもう一度保存させてしまう。
       * 保存できたことは伝え、読み直しの失敗だけを分けて知らせる。
       */
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
      // 成功でも一部失敗（partial）でも、結果は履歴と状態の読み直しで見せる。
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
    // 確認窓を開いたときのアカウントと今のアカウントが違うなら実行しない。
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
      /*
       * こちら側の連携は消えても、Google側の許可取り消しに失敗する
       * ことがある。その場合は「解除できた」だけでは済ませず、
       * Google側に許可が残っているかもしれないことを伝える。
       */
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
      <p className="text-ink-secondary mt-4 text-sm">
        左のサイドバーからLINEアカウントを選ぶと、そのアカウントの書き出し設定をここで変えられます。
      </p>
    )
  }

  const callbackNotice = callbackResult
    ? CALLBACK_MESSAGES[callbackResult]
      ?? (callbackResult.startsWith('error:')
        ? { tone: 'error' as const, text: 'Googleとの接続に失敗しました。もう一度お試しください。' }
        : null)
    : null

  const connStatus = connection?.status ?? 'disconnected'
  /*
   * 実行中のまま長く止まっている記録は、次の同期開始時にサーバ側で
   * 自動で終了処理される。それまでは「同期中」のままボタンが
   * 押せず回収の手立てがないため、ここでは押せる状態にして
   * 状況だけを伝える。
   */
  const staleRunningRun = runs.find(
    (run) => run.status === 'running' && Date.parse(run.startedAt) < Date.now() - STALE_RUN_MS,
  )
  const effectivelyRunning = syncRunning && !staleRunningRun

  return (
    <div className="mt-4">
      {callbackNotice && (
        <div
          role={callbackNotice.tone === 'error' ? 'alert' : 'status'}
          className={`rounded-control mb-4 px-4 py-3 text-sm ${
            callbackNotice.tone === 'ok'
              ? 'bg-info-bg text-ink-secondary'
              : callbackNotice.tone === 'warn'
                ? 'bg-status-warning-soft text-status-warning'
                : 'bg-danger-bg text-danger'
          }`}
        >
          {callbackNotice.text}
        </div>
      )}

      {status === 'loading' && (
        <p className="text-ink-faint text-sm">読み込んでいます…</p>
      )}
      {/*
       * 操作の結果は読み込み状態と別に出す。
       * 「保存はできたのに読み直しだけ落ちた」場合でも
       * 読込失敗のカードに埋もれないようにする。
       */}
      {disconnectNotice && (
        <div role="alert" className="bg-status-warning-soft text-status-warning rounded-control mb-4 px-4 py-3 text-sm">
          {disconnectNotice}
        </div>
      )}
      {saveNotice && (
        <div role="status" className="bg-status-warning-soft text-status-warning rounded-control mb-4 px-4 py-3 text-sm">
          {saveNotice}
          <Button variant="secondary" className="ml-3" onClick={() => void load()}>
            もう一度読み込む
          </Button>
        </div>
      )}
      {status === 'error' && (
        <div className="bg-canvas border-hairline rounded-card border p-5">
          <p className="text-ink text-sm font-semibold">{loadError}</p>
          <p className="text-ink-secondary mt-1 text-xs">
            {saveNotice ? '直前に行った変更は保存されています。' : '連携の内容は変わっていません。'}
            読み込み直しても直らないときは、下の確かめ方を見てください。
          </p>
          <div className="mt-3">
            <Button variant="secondary" onClick={() => void load()}>
              もう一度読み込む
            </Button>
          </div>
          <Disclosure title="確かめ方" size="compact" className="mt-3">
            <ul className="list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-secondary">
              <li>左で選んでいるLINEアカウントが合っているか確かめてください。</li>
              <li>ログインし直してから、もう一度読み込んでください。</li>
              <li>Google側でこのアプリの許可を取り消した場合は、「Googleアカウントを接続する」からやり直してください。</li>
            </ul>
          </Disclosure>
        </div>
      )}

      {status === 'ready' && connection && (
        <>
          {actionError && (
            <div role="alert" className="bg-danger-bg rounded-control mb-4 px-4 py-3 text-sm text-danger">
              {actionError}
            </div>
          )}
          <section className="bg-canvas border-hairline rounded-card border p-5" aria-label="Google Sheets への書き出し">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-ink text-lg font-bold">Google Sheets への書き出し</h2>
                <p className="text-ink-secondary mt-1 text-sm">
                  友だち一覧とフォーム回答を、1日1回（JST）自動でスプレッドシートへ写します。
                  「今すぐ同期」で手動でも送れます。
                </p>
              </div>
              {connStatus === 'connected' && (
                <span className="bg-status-success-soft text-status-success-deep rounded-control shrink-0 px-3 py-1 text-xs font-semibold">
                  接続中
                </span>
              )}
              {connStatus === 'expired' && (
                <span className="bg-status-warning-soft text-status-warning rounded-control shrink-0 px-3 py-1 text-xs font-semibold">
                  要再接続
                </span>
              )}
            </div>

            {!oauthConfigured && (
              <p className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm">
                この環境にはGoogle接続の設定（OAuthクライアント）がまだありません。管理者に確かめてください。
              </p>
            )}

            {connStatus === 'disconnected' && oauthConfigured && (
              <div className="mt-4">
                <p className="text-ink-secondary text-sm">
                  まだ接続されていません。Googleアカウントで許可すると、書き出し先を設定できるようになります。
                </p>
                {canManage ? (
                  <Button
                    variant="primary"
                    className="mt-3"
                    disabled={busy !== null}
                    onClick={() => void handleConnect()}
                  >
                    {busy === 'connect' ? 'Googleへ移動しています…' : 'Googleアカウントを接続する'}
                  </Button>
                ) : (
                  <p className="text-ink-faint mt-3 text-xs">
                    接続の設定は、統括の管理者だけが変更できます。
                  </p>
                )}
              </div>
            )}

            {connStatus !== 'disconnected' && (
              <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="bg-canvas-sunken rounded-control p-3">
                  <dt className="text-ink-faint text-xs">接続しているGoogleアカウント</dt>
                  <dd className="text-ink mt-1 break-all">{connection.googleAccountEmail ?? '—'}</dd>
                </div>
                <div className="bg-canvas-sunken rounded-control p-3">
                  <dt className="text-ink-faint text-xs">書き出し先</dt>
                  <dd className="text-ink mt-1 break-all">
                    {connection.spreadsheetUrl ? (
                      <a
                        href={connection.spreadsheetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-action underline"
                      >
                        {connection.spreadsheetTitle ?? connection.spreadsheetUrl}
                      </a>
                    ) : (
                      '未設定'
                    )}
                  </dd>
                </div>
                <div className="bg-canvas-sunken rounded-control p-3">
                  <dt className="text-ink-faint text-xs">前回の同期</dt>
                  <dd className="text-ink mt-1">
                    {formatDateTime(connection.lastSyncedAt)}
                    {connection.lastSyncStatus && connection.lastSyncStatus !== 'ok' && (
                      <span className="text-status-warning ml-2">
                        （{connection.lastSyncStatus === 'partial' ? '一部だけ完了' : '失敗'}）
                      </span>
                    )}
                  </dd>
                </div>
                <div className="bg-canvas-sunken rounded-control p-3">
                  <dt className="text-ink-faint text-xs">いまの状態</dt>
                  <dd className="text-ink mt-1">
                    {syncRunning ? (staleRunningRun ? '前の同期が途中で止まっています' : '同期を実行しています') : '待機中'}
                  </dd>
                </div>
              </dl>
            )}

            {connStatus === 'expired' && (
              <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm">
                Googleとの許可が切れています。同期は止まっています。
                {canManage && '「再接続する」から許可をやり直してください。'}
              </div>
            )}
            {connection.lastSyncError && connStatus !== 'expired' && (
              <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm">
                前回の同期で問題がありました：{connection.lastSyncError === 'stale_run' ? '途中で止まったため自動で終了しました' : connection.lastSyncError}
              </div>
            )}
            {staleRunningRun && (
              <div className="bg-status-warning-soft text-status-warning rounded-control mt-4 px-4 py-3 text-sm">
                {formatDateTime(staleRunningRun.startedAt)}に始まった同期が、途中で止まったまま残っています。
                「今すぐ同期」を押すと、この実行を終了処理してから新しい同期を始めます。
              </div>
            )}

            {connStatus !== 'disconnected' && canManage && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {connStatus === 'expired' ? (
                  <Button
                    variant="primary"
                    disabled={busy !== null}
                    onClick={() => void handleConnect()}
                  >
                    {busy === 'connect' ? 'Googleへ移動しています…' : '再接続する'}
                  </Button>
                ) : (
                  <>
                    <Button
                      variant="primary"
                      disabled={busy !== null || effectivelyRunning || !connection.spreadsheetId}
                      onClick={() => void handleSync()}
                    >
                      {busy === 'sync' ? '同期しています…' : effectivelyRunning ? '同期中' : '今すぐ同期'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() => setShowTargetForm((current) => !current)}
                    >
                      {showTargetForm ? '閉じる' : connection.spreadsheetId ? '出力先を変更' : '出力先を設定'}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy !== null}
                      onClick={() =>
                        setDisconnectFor({
                          id: selectedAccountId,
                          label: selectedAccount?.name?.trim() || selectedAccountId,
                        })
                      }
                    >
                      接続を解除
                    </Button>
                  </>
                )}
              </div>
            )}
            {connStatus !== 'disconnected' && !canManage && (
              <p className="text-ink-faint mt-4 text-xs">
                接続の設定は、統括の管理者だけが変更できます。
              </p>
            )}

            {showTargetForm && connStatus !== 'disconnected' && canManage && connStatus !== 'expired' && (
              <form onSubmit={handleSaveTarget} className="border-hairline mt-4 border-t pt-4">
                <label className="text-ink-secondary block text-sm font-medium" htmlFor="sheets-target">
                  スプレッドシートのURLまたはID
                </label>
                <p className="text-ink-faint mt-1 text-xs">
                  共有設定で「{connection.googleAccountEmail ?? '接続したGoogleアカウント'}」に編集権限を付けたシートを指定してください。
                  指定したシート内に「友だち」「フォーム回答」のタブを自動で作ります。
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    id="sheets-target"
                    value={targetInput}
                    onChange={(e) => setTargetInput(e.target.value)}
                    className="border-hairline rounded-control min-w-0 flex-1 border px-3 py-2 text-sm"
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    required
                  />
                  <Button type="submit" variant="primary" disabled={busy !== null}>
                    {busy === 'target' ? '確認しています…' : '保存'}
                  </Button>
                </div>
              </form>
            )}
          </section>

          {(runs.length > 0 || runsError || runsLoading) && (
            <section className="bg-canvas border-hairline rounded-card mt-4 border p-5" aria-label="同期の記録">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-ink text-sm font-semibold">同期の記録</h3>
                {runsError && (
                  <Button variant="secondary" onClick={() => selectedAccountId && void loadRuns(selectedAccountId)}>
                    {runsLoading ? '読み込んでいます…' : '記録を読み直す'}
                  </Button>
                )}
              </div>
              {runsError && (
                <div role="alert" className="bg-status-warning-soft text-status-warning rounded-control mt-3 px-4 py-3 text-sm">
                  {runsError}表示中の記録は、最後に読み込めた時点のものです。
                </div>
              )}
              {runsLoading && runs.length === 0 && !runsError && (
                <p className="text-ink-faint mt-3 text-sm">読み込んでいます…</p>
              )}
              {runs.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {runs.map((run) => (
                    <li
                      key={run.id}
                      className="bg-canvas-sunken rounded-control flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-sm"
                    >
                      <span className="text-ink font-medium">
                        {RUN_DATA_LABEL[run.dataType] ?? run.dataType}
                      </span>
                      <span className="text-ink-faint text-xs">{RUN_KIND_LABEL[run.kind] ?? run.kind}</span>
                      <span
                        className={`text-xs font-semibold ${
                          run.status === 'ok'
                            ? 'text-status-success-deep'
                            : run.status === 'error'
                              ? 'text-danger'
                              : 'text-status-warning'
                        }`}
                      >
                        {RUN_STATUS_LABEL[run.status] ?? run.status}
                      </span>
                      {/*
                       * 出力先を変える前に走った記録を、今の出力先への
                       * 書き出しと取り違えないよう印を付ける。
                       */}
                      {run.spreadsheetId && connection.spreadsheetId && run.spreadsheetId !== connection.spreadsheetId && (
                        <span className="text-ink-faint text-xs">（切替前の出力先）</span>
                      )}
                      <span className="text-ink-secondary text-xs">
                        {formatNumber(run.rowsWritten)}行
                      </span>
                      {run.error === 'stale_run' ? (
                        <span className="text-status-warning text-xs">途中で止まったため自動で終了しました</span>
                      ) : run.error ? (
                        <span className="text-danger text-xs">{run.error}</span>
                      ) : null}
                      <span className="text-ink-faint ml-auto text-xs">
                        {formatDateTime(run.startedAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </>
      )}

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
