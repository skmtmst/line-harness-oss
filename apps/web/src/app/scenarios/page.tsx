'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario } from '@line-crm/shared'
import { api, type ScenarioRuns, type ScenarioSimulation } from '@/lib/api'
import { useOffsetServerList } from '@/lib/use-server-list'
import { clampSearchQuery } from '@/lib/search-query'
import { useAccount } from '@/contexts/account-context'

function scenarioCompletionDetail(active: number, completed: number): string {
  const enrolled = active + completed
  if (enrolled === 0) return '—'
  const rate = Math.round((completed / enrolled) * 100)
  return `登録合計 ${enrolled.toLocaleString('ja-JP')}人のうち ${rate}%`
}
import type { Folder } from '@line-crm/shared'
import ListKpis from '@/components/shared/list-kpis'
import ListToolbar from '@/components/shared/list-toolbar'
import FolderPanel, { FOLDER_RAIL_STYLE } from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import ScenarioList from '@/components/scenarios/scenario-list'
import { ON_COMPLETE_LABEL, type OnCompleteMode } from '@/components/scenarios/scenario-dialogs'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import type { ScenarioTriggerItem } from '@/lib/api'
import { startChecklist } from './start-checklist'

type ScenarioWithCount = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

/** 開始のきっかけ1件を、確認欄で読める1行にする。 */
function describeStartTrigger(trigger: ScenarioTriggerItem, tagName: string | null): string {
  if (trigger.kind === 'friend_add') return '友だち追加時'
  if (trigger.kind === 'tag_added') {
    return tagName ? `タグ「${tagName}」が付いたとき` : 'タグが付いたとき（タグ名を確認できません）'
  }
  if (trigger.kind === 'form_answer') return 'フォーム回答時'
  if (trigger.kind === 'booking_confirmed') return '予約確定時'
  return '呼ばれたとき'
}

function StartScenarioDialog({
  scenario,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  scenario: ScenarioWithCount
  busy: boolean
  error: string
  onConfirm: () => void
  onCancel: () => void
}) {
  const { selectedAccountId, accounts } = useAccount()
  const lineAccountId = scenario.lineAccountId ?? selectedAccountId
  const [simulation, setSimulation] = useState<ScenarioSimulation | null>(null)
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
  /*
   * SCENARIO-06: 確認欄は実設定から組み立てる。開始のきっかけ・終了後の
   * 処理・完了時アクションを実データで取り、取れないものは「未取得」と
   * 書く。固定の説明文を置くと、実設定と違うことを確認したことになる。
   */
  const [triggers, setTriggers] = useState<ScenarioTriggerItem[] | null>(null)
  const [completeActionCount, setCompleteActionCount] = useState<number | null>(null)
  const [tagNameById, setTagNameById] = useState<Record<string, string>>({})
  const [moveTargetName, setMoveTargetName] = useState<string | null>(null)
  /*
   * SCENARIO-07: 試算の取得待ち・取得失敗のあいだは開始できない。
   * 「対象人数・内容・送信枠を確認しました」のチェックが入っていても、
   * 数が読めていないなら確認したことにならない。
   */
  const [preflightState, setPreflightState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [preflightReason, setPreflightReason] = useState('')
  /*
   * 開始は戻せない操作なので、確認のチェックが入るまで開始ボタンを
   * 押せない。defaultChecked の非制御にすると、見ていないまま
   * 始められて確認が形だけになる（点検 #495 中4）。
   */
  const [confirmed, setConfirmed] = useState(false)
  /*
   * SCENARIO-07: アカウントか対象が変わると古い取得が走ったままになる。
   * あとから返ってきた古い応答を新しい対象へ書き込まないよう、
   * 何回目の取得かを覚えて、新しい取得が始まった時点で捨てる。
   */
  const preflightSeqRef = useRef(0)

  /*
   * SCENARIO-07: 共通シナリオでは選択中のアカウントで対象が変わる。
   * アカウント・対象・設定が変わったあともチェック済みを引き継ぐと、
   * 別の対象へ「確認しました」を使い回すことになる。変わったら外す。
   */
  useEffect(() => {
    setConfirmed(false)
  }, [scenario.id, scenario.updatedAt, lineAccountId])

  const loadPreflight = useCallback(async () => {
    const seq = ++preflightSeqRef.current
    if (!lineAccountId) {
      setPreflightState('error')
      setPreflightReason('LINEアカウントが選ばれていないため、対象人数を試算できません。')
      return
    }
    setPreflightState('loading')
    setPreflightReason('')
    const [simulationResponse, runsResponse, triggersResponse, actionsResponse, tagsResponse, moveTargetResponse] =
      await Promise.all([
        api.scenarios.simulate(scenario.id, lineAccountId).catch(() => null),
        api.scenarios.runs(scenario.id, lineAccountId, { limit: 1 }).catch(() => null),
        api.scenarios.triggers.list(scenario.id).catch(() => null),
        api.scenarios.actions.list(scenario.id).catch(() => null),
        scenarioReferenceData.tags(lineAccountId).catch(() => null),
        scenario.onCompleteMode === 'move' && scenario.onCompleteScenarioId
          ? api.scenarios.get(scenario.onCompleteScenarioId).catch(() => null)
          : Promise.resolve(null),
      ])
    // 新しい取得が始まっていたら、この古い応答は書き込まない（SCENARIO-07）。
    if (seq !== preflightSeqRef.current) return
    setSimulation(simulationResponse?.success ? simulationResponse.data : null)
    setRuns(runsResponse?.success ? runsResponse.data : null)
    setTriggers(triggersResponse?.success ? triggersResponse.data : null)
    setCompleteActionCount(
      actionsResponse?.success
        ? actionsResponse.data.filter((a) => a.hook === 'scenario_completed').length
        : null,
    )
    setTagNameById(
      tagsResponse?.success
        ? Object.fromEntries(tagsResponse.data.map((t) => [t.id, t.name]))
        : {},
    )
    setMoveTargetName(
      moveTargetResponse && moveTargetResponse.success ? moveTargetResponse.data.name : null,
    )
    /*
     * 人数の試算と配信記録の両方が取れないときは「確認できた」と言えない
     * ので開始を止める。きっかけ・タグ名・移動先名だけの失敗は、その欄を
     * 「取得できません」と書いて警告どまりにする。
     */
    if (!simulationResponse?.success && !runsResponse?.success) {
      setPreflightState('error')
      setPreflightReason(
        simulationResponse && !simulationResponse.success
          ? simulationResponse.error
          : '開始前の実データを取得できませんでした。',
      )
      return
    }
    setPreflightState('ready')
  }, [
    lineAccountId,
    scenario.id,
    scenario.onCompleteMode,
    scenario.onCompleteScenarioId,
  ])

  useEffect(() => {
    void loadPreflight()
  }, [loadPreflight])

  const preflightLoading = preflightState === 'loading'

  const checks = startChecklist(scenario).map((item, index) => {
    if (index === 1 && simulation) {
      const complete = simulation.steps.length > 0
      return {
        ...item,
        state: complete ? 'ok' as const : 'warn' as const,
        detail: complete
          ? `${simulation.steps.length}通すべての配信日時を試算しました`
          : '配信日時を試算できない通があります',
      }
    }
    if (index === 2 && runs) {
      return {
        ...item,
        state: runs.testSends.length > 0 ? 'ok' as const : 'warn' as const,
        detail: runs.testSends.length > 0
          ? `最新のテスト送信は${runs.testSends[0].messageCount}通です`
          : 'テスト送信の記録がありません',
      }
    }
    if (index === 3 && runs) {
      const enough = runs.quota.remaining === null
        ? runs.quota.state === 'unlimited'
        : runs.quota.remaining >= (simulation?.audience.newStartPlanned ?? 0)
      return {
        ...item,
        state: enough ? 'ok' as const : 'warn' as const,
        detail: runs.quota.state === 'unlimited'
          ? '送信数の上限はありません'
          : runs.quota.remaining === null
            ? runs.quota.reason ?? '送信枠を取得できませんでした'
            : `残り${runs.quota.remaining.toLocaleString('ja-JP')}通です`,
      }
    }
    return item
  })

  /*
   * SCENARIO-06: 終了後の処理は編集画面と同じ onCompleteMode / 移動先 /
   * 完了時アクションから読む。実設定と別の表示（固定文など）は置かない。
   */
  const completeMode = (scenario.onCompleteMode ?? 'pause') as OnCompleteMode
  const accountLabel =
    scenario.lineAccountId === null
      ? '全アカウント共通'
      : accounts.find((a) => a.id === lineAccountId)?.name ?? '—（取得できません）'
  const triggerSummary =
    triggers === null
      ? preflightLoading
        ? '—（確認中）'
        : '—（取得できません）'
      : triggers.length === 0
        ? '呼ばれたときだけ（アクション・手動での開始）'
        : triggers
            .map((t) => describeStartTrigger(t, t.tagId ? tagNameById[t.tagId] ?? null : null))
            .join('、')
  const completeSummary =
    ON_COMPLETE_LABEL[completeMode] +
    (completeMode === 'move'
      ? `（${moveTargetName ?? (preflightLoading ? '確認中…' : '移動先を取得できませんでした')}）`
      : '') +
    (completeActionCount === null
      ? ''
      : completeActionCount > 0
        ? `＋完了時アクション ${completeActionCount}件`
        : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'color-mix(in srgb, var(--color-ink) 35%, transparent)' }} role="dialog" aria-modal="true" aria-labelledby="start-scenario-title">
      <div className="border-hairline flex w-full flex-col overflow-y-auto rounded-card border shadow-xl" style={{ height: 860, maxWidth: 1040, background: 'var(--color-canvas)' }}>
        <div className="border-hairline flex items-start justify-between gap-4 border-b px-6 py-5">
          <div>
            <h2 id="start-scenario-title" className="text-ink text-xl font-bold">
              配信を開始しますか？
            </h2>
            <p className="text-ink-secondary mt-1 text-sm">開始前の最終確認です。開始後は条件に一致した友だちから順に配信されます。</p>
          </div>
          <button type="button" onClick={onCancel} disabled={busy} aria-label="閉じる" className="text-ink-faint hover:text-ink text-xl">×</button>
        </div>

        <div className="grid gap-6 px-6 pb-4 lg:grid-cols-2">
          <section className="border-hairline rounded-card border p-5" style={{ minHeight: 510 }}>
            <p className="text-ink mb-4 text-sm font-bold">開始するシナリオ</p>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-ink-faint">シナリオ</dt><dd className="text-ink text-right font-medium">{scenario.name}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">LINEアカウント</dt><dd className="text-ink text-right font-medium">{accountLabel}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">開始対象</dt><dd className="text-ink text-right font-medium">{simulation ? `新規開始予定 ${simulation.audience.newStartPlanned.toLocaleString('ja-JP')}人` : preflightLoading ? '—（試算中）' : '—（取得できません）'}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">開始のきっかけ</dt><dd className="text-ink text-right font-medium">{triggerSummary}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">配信ステップ</dt><dd className="text-ink text-right font-medium">{simulation ? `${simulation.steps.length}通` : scenario.stepCount === undefined ? '—通' : `${scenario.stepCount}通`}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">終了後</dt><dd className="text-ink text-right font-medium">{completeSummary}</dd></div>
            </dl>
          </section>

          <section className="border-hairline rounded-card border p-5" style={{ minHeight: 510 }}>
            <p className="text-ink mb-3 text-sm font-bold">配信前チェック</p>
            <ul className="space-y-3 text-sm">
              {preflightLoading ? <li className="text-ink-faint text-xs">開始前の実データを確認しています…</li> : null}
              {preflightState === 'error' ? (
                <li className="text-danger flex items-start gap-3 text-xs">
                  <span>対象人数を試算できなかったため、開始はできません。{preflightReason}</span>
                  <button
                    type="button"
                    className="text-info shrink-0 font-medium hover:underline"
                    onClick={() => void loadPreflight()}
                  >
                    再試行
                  </button>
                </li>
              ) : null}
              {checks.map((item) => (
                <li key={item.label} className="flex items-start gap-3">
                  <span aria-hidden className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${item.state === 'ok' ? 'bg-success-bg text-success' : item.state === 'warn' ? 'bg-warning-bg text-warning' : 'bg-canvas-sunken text-ink-faint'}`}>
                    {item.state === 'ok' ? '✓' : item.state === 'warn' ? '!' : '—'}
                  </span>
                  <span><span className="text-ink block font-medium">{item.label}</span><span className="text-ink-faint block text-xs">{item.detail}</span></span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="bg-warning-bg mx-6 mb-5 rounded-card px-5 py-4">
          <p className="text-warning text-sm font-bold">開始後に起きること</p>
          <ul className="text-ink-secondary mt-2 space-y-1 text-xs"><li>・条件に一致した{simulation?.audience.newStartPlanned.toLocaleString('ja-JP') ?? '—'}人が購読を開始します</li><li>・配信中の友だちは停止するまで次のステップへ進みます</li><li>・一度届いたメッセージは取り消せません。間違いに気づいたらすぐ停止してください</li></ul>
        </div>
        <label className={`mx-6 mb-4 flex items-center gap-2 text-sm font-medium ${preflightLoading ? 'opacity-60' : ''}`}><input type="checkbox" checked={confirmed} disabled={preflightState !== 'ready'} onChange={(event) => setConfirmed(event.target.checked)} />対象人数・内容・送信枠を確認しました</label>
        {error ? <p className="bg-danger-bg text-danger mx-6 mb-4 rounded-card px-4 py-3 text-sm">{error}</p> : null}
        <div className="border-hairline mt-auto flex justify-end gap-3 border-t px-6 py-4">
          <span className="text-ink-faint mr-auto self-center text-xs">開始後も、一覧からいつでも停止できます。</span><Button onClick={onCancel} disabled={busy}>戻って確認</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy || !confirmed || preflightState !== 'ready'}>{busy ? '開始中…' : '配信を開始'}</Button>
        </div>
      </div>
    </div>
  )
}

/** 運用画面の基準である日本時間の今月初日。 */
function currentMonthStart(now = new Date()): string {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  return `${month.format(now)}-01T00:00:00+09:00`
}

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  // 名前の絞り込み（設計 `Body` の検索）。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  const [serverQuery, setServerQuery] = useState('')
  /** よく使う絞り込み。いま数えられるのは「停止中のみ」だけ。 */
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [createdThisMonthOnly, setCreatedThisMonthOnly] = useState(false)
  const [actionError, setActionError] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  /** 「未分類」の件数。`null` は数えていない（#631、#730）。 */
  const [unfiledCount, setUnfiledCount] = useState<number | null>(null)
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  /*
   * SCENARIO-16: 案内帯の「配信を始める方法」。リンク風の見た目だけの
   * span だったので、押すとその場で手順が開くボタンにする。
   * 開始条件の設定は各シナリオの詳細画面にあるため、ここでは
   * 「どこへ行って何を設定するか」を案内する。
   */
  const [startGuideOpen, setStartGuideOpen] = useState(false)
  const [toggleTarget, setToggleTarget] = useState<ScenarioWithCount | null>(null)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState('')
  /**
   * 絞り込みを掛けない「すべて」の件数（NEXT-26）。
   *
   * 一覧APIの `total` は検索・フォルダ・停止中などの絞り込みを
   * 通ったあとの数なので、フォルダ帯の「すべて」には使えない。
   * 同じアカウント範囲で、絞り込み無しの件数だけ別に取る。
   * `null` は「まだ数えられていない」。FolderPanel は `—` を出す。
   */
  const [overallTotal, setOverallTotal] = useState<number | null>(null)

  /*
   * 直近で選んでいるアカウント。切替後に前のアカウント宛の遅い応答が
   * 返ってきても採用しないための印（テンプレート一覧の N-147 と同じ）。
   */
  const activeAccountRef = useRef<string | null>(selectedAccountId)

  useEffect(() => {
    activeAccountRef.current = selectedAccountId
    // フォルダはアカウント単位。切り替えたら前のアカウントの帯も
    // 選択中のフォルダも残さない。件数は次の取得が来るまで「未取得」にする。
    setFolders([])
    setUnfiledCount(null)
    setFolderFilter('')
    setOverallTotal(null)
  }, [selectedAccountId])

  /*
   * NEXT-26: 一覧・フォルダ・KPIは同じアカウント範囲で数える。
   * 一覧は `lineAccountId` を渡しているのに、フォルダとKPIは全権限範囲で
   * 数えていたため「KPI12件・すべて11・未分類12」が混在していた。
   */
  const loadFolders = useCallback(async () => {
    const accountId = selectedAccountId
    const res = await api.folders.list('scenario', accountId ?? undefined)
    if (activeAccountRef.current !== accountId) return
    if (res.success) setFolders(res.data)
    setUnfiledCount(res.success ? res.unfiledCount ?? null : null)
  }, [selectedAccountId])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  /** 「すべて」の件数。絞り込み無し・同じアカウント範囲で、一覧と同じ口から取る。 */
  const loadOverallTotal = useCallback(async () => {
    const accountId = selectedAccountId
    try {
      const res = await api.scenarios.listPage({
        accountId: accountId || undefined,
        page: 1,
        limit: 1,
      })
      if (activeAccountRef.current !== accountId) return
      setOverallTotal(res.success ? res.data.total : null)
    } catch {
      if (activeAccountRef.current === accountId) setOverallTotal(null)
    }
  }, [selectedAccountId])

  useEffect(() => {
    void loadOverallTotal()
  }, [loadOverallTotal])

  useEffect(() => {
    // #625: サーバーへ送る語はここでも上限へ切り詰める（入力欄でも切るが、
    // 値が別経路で入っても同じ長さにそろえる）。
    const timer = setTimeout(() => setServerQuery(clampSearchQuery(nameQuery.trim())), 300)
    return () => clearTimeout(timer)
  }, [nameQuery])

  const loadScenarioPage = useCallback(async (
    request: { page: number; limit: number },
    signal: AbortSignal,
  ) => {
    if (accountLoading) return { items: [], total: 0, limit: request.limit, sort: [] }
    const res = await api.scenarios.listPage({
      accountId: selectedAccountId || undefined,
      page: request.page,
      limit: request.limit,
      query: serverQuery || undefined,
      active: stoppedOnly ? 0 : undefined,
      createdFrom: createdThisMonthOnly ? currentMonthStart() : undefined,
      folderId: folderFilter || undefined,
    }, signal)
    if (!res.success) throw new Error(res.error)
    return res.data
  }, [accountLoading, createdThisMonthOnly, folderFilter, selectedAccountId, serverQuery, stoppedOnly])
  const scenarioList = useOffsetServerList<ScenarioWithCount>({
    requestKey: JSON.stringify({
      ready: !accountLoading,
      accountId: selectedAccountId ?? '',
      query: serverQuery,
      stoppedOnly,
      createdThisMonthOnly,
      folderFilter,
    }),
    load: loadScenarioPage,
  })
  const scenarios = scenarioList.items
  const loadScenarios = scenarioList.retry

  /**
   * 配信方式の選択へ送るだけ。**ここでは作らない**（#949 N-055）。
   *
   * 以前は押した時点で空のシナリオ行を作り、方式選択や1通目の設定を
   * 放り出されると名前も通も無い行が一覧に残った。作るのは方式を
   * 選んで確定したとき。放り出しても一覧に何も残らない。
   */
  const handleCreate = () => {
    router.push('/scenarios/mode')
  }

  /**
   * 掴んで入れ替えた並びを保存する。
   *
   * 画面はすぐ入れ替える。往復を待つと、掴んだ手応えが無い。
   * 失敗したときだけ読み直して、元の並びに戻す。
   */
  const handleReorder = async (ids: string[]) => {
    setActionError('')
    try {
      const res = await api.scenarios.reorder(ids)
      if (!res.success) throw new Error(res.error)
      void loadScenarios()
    } catch {
      setActionError('並び順を保存できませんでした。最新の並び順を読み直しました。')
      void loadScenarios()
    }
  }

  const requestToggleActive = (id: string) => {
    const target = scenarios.find((scenario) => scenario.id === id)
    if (!target) {
      setActionError('対象のシナリオを確認できませんでした。一覧を読み直してください。')
      return
    }
    setToggleError('')
    setToggleTarget(target)
  }

  const confirmToggleActive = async () => {
    if (!toggleTarget || toggleBusy) return
    const target = toggleTarget
    setToggleBusy(true)
    setToggleError('')
    try {
      const response = await api.scenarios.update(target.id, { isActive: !target.isActive })
      if (!response.success) throw new Error(response.error)
      setToggleTarget(null)
      if (target.isActive) {
        void loadScenarios()
      } else {
        router.push(`/scenarios/detail?id=${encodeURIComponent(target.id)}&started=1`)
      }
    } catch {
      setToggleError(
        target.isActive
          ? 'シナリオを停止できませんでした。状態を読み直してから、もう一度お試しください。'
          : 'シナリオを開始できませんでした。状態を読み直してから、もう一度お試しください。',
      )
    } finally {
      setToggleBusy(false)
    }
  }

  /**
   * フォルダを付け替える。作ったフォルダへ中身を入れる操作。
   *
   * 行の「その他→フォルダを移動」と選択時の一括操作、どちらもここへ来る
   * （NEXT-25）。移すと各フォルダの件数が変わるので、一覧と合わせて
   * フォルダ帯の件数も読み直す（NEXT-26）。1件でも失敗があれば例外を
   * 投げ、呼び出し元の窓に残してもらう。
   */
  const handleMoveFolders = async (ids: string[], folderId: string) => {
    setActionError('')
    const results = await Promise.all(
      ids.map((id) => api.scenarios.update(id, { folderId: folderId || null }).catch(() => null)),
    )
    const failed = results.filter((res) => !res || !res.success).length
    void loadScenarios()
    void loadFolders()
    if (failed > 0) {
      setActionError('フォルダを変更できませんでした。状態を読み直してから、もう一度お試しください。')
      throw new Error(`${failed}件のフォルダ移動に失敗しました`)
    }
  }

  /*
   * 「すべて」とフォルダ内訳の母集団の差（#981 A05-02）。
   *
   * アカウントを1つ選んでいるとき、一覧（＝「すべて」の母集団）には
   * 全アカウントに共通で適用されるシナリオ（line_account_id IS NULL）も
   * 出るが、フォルダAPIの件数はそのアカウントの行だけを数える（#730）。
   * 共通ぶんがあれば、ずれではなく定義の違いとして画面に書く。
   * 件数が1つでも取れていないときは差を推測しない（0とみなして黙る）。
   */
  const folderedTotal = folders.every((f) => f.itemCount !== undefined)
    ? folders.reduce((sum, f) => sum + (f.itemCount ?? 0), 0)
    : null
  const sharedScenarioCount =
    overallTotal !== null && unfiledCount !== null && folderedTotal !== null
      ? Math.max(0, overallTotal - folderedTotal - unfiledCount)
      : 0

  /** 畳んだ帯に出す、いま選んでいるフォルダ名（U027）。 */
  const activeFolderLabel =
    folderFilter === ''
      ? 'すべて'
      : folderFilter === UNFILED
        ? '未分類'
        : folders.find((f) => f.id === folderFilter)?.name ?? 'フォルダ'

  /*
   * フォルダの帯はスマホで畳むため2か所へ出す（U027）。中身は同じなので、
   * 要素を1つ作って使い回す。
   */
  const folderPanel = (
    <FolderPanel
      /*
        見出しの総数と「すべて」は、絞り込みを掛けない全体の件数。
        一覧の `total` は検索・フォルダ選択を通ったあとの数なので、
        ここに使うと「すべて11・未分類12」のように母集団がずれた
        数字が並ぶ（NEXT-26）。取れていないときは「—」を出す。
      */
      total={overallTotal === null ? '—' : `${overallTotal} 件`}
      activeId={folderFilter}
      onSelect={setFolderFilter}
      onAddFolder={() => setFolderDialogOpen(true)}
      rows={[
        { id: '', label: 'すべて', count: overallTotal },
        ...folders.map((f) => ({
          id: f.id,
          label: f.name,
          // #631: フォルダ件数はAPI(itemCount)をそのまま出す。現在ページの
          // 行だけを数えるフォールバックは、ページングで実数と食い違うため廃止。
          count: f.itemCount ?? null,
          color: f.color,
        })),
        {
          id: UNFILED,
          label: '未分類',
          count: unfiledCount,
        },
      ]}
    >
      <p className="text-ink-faint text-xs leading-relaxed">
        フォルダを消しても、入っていたシナリオは未分類として残ります。
      </p>
      {/*
        #981 A05-02: 「すべて」（一覧と同じ母集団）には全アカウント共通の
        シナリオも入るが、フォルダ別の件数と「未分類」はこのアカウントの
        ものだけを数える。差があるときだけ理由を書く。
      */}
      {sharedScenarioCount > 0 ? (
        <p className="text-ink-faint text-xs leading-relaxed">
          全アカウントに共通で適用されるシナリオが{sharedScenarioCount}件あります。「すべて」の件数には含まれますが、フォルダ別の件数と「未分類」には含まれません。
        </p>
      ) : null}
    </FolderPanel>
  )

  const handleDelete = async (id: string) => {
    try {
      /*
       * fetchApi は口の失敗を例外でなく {success:false} で返す。
       * 成功を見ないと、消えていないのに再読込だけされて気づけない
       * （点検 #495 中6）。同じ画面の並べ替え・移動・切替は見ている。
       */
      const res = await api.scenarios.delete(id)
      if (!res.success) throw new Error(res.error)
      void loadScenarios()
      // 全体・フォルダ内訳・未分類の件数が減るので、一覧と一緒に読み直す（NEXT-26）。
      void loadFolders()
      void loadOverallTotal()
    } catch {
      setActionError('シナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。')
      /*
       * SCENARIO-18: 失敗を呼び出し元の確認窓へ返す。ここで握りつぶすと
       * 一覧側の確認窓が成功と同じく閉じてしまい、消えていないのに
       * 「消した」と見えてしまう。
       */
      throw new Error('scenario delete failed')
    }
  }

  return (
    <div>
      <section data-design="Head" className="bg-success-bg text-success mb-4 rounded-card px-4 py-3 text-sm">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span aria-hidden>ⓘ</span>
          <strong>作成しただけでは配信されません。開始条件を設定すると配信が始まります。</strong>
          {/*
            SCENARIO-16: 下線だけの span は押せない。ボタンにして、
            その場で始め方の手順を開閉できるようにする。
          */}
          <button
            type="button"
            className="font-semibold underline underline-offset-2"
            aria-expanded={startGuideOpen}
            aria-controls="scenario-start-guide"
            onClick={() => setStartGuideOpen((current) => !current)}
          >
            配信を始める方法
          </button>
        </div>
        {startGuideOpen ? (
          <ol id="scenario-start-guide" className="mt-2 list-decimal space-y-1 pl-8 text-sm">
            <li>一覧からシナリオを開き、「開始のきっかけ」（友だち追加時・タグが付いたときなど）を設定します。</li>
            <li>詳細画面の「テスト送信」で、実際の届き方を確認します。</li>
            <li>この一覧に戻り、行の「その他 → 再開する」から配信を開始します。</li>
          </ol>
        ) : null}
      </section>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      <div data-design="KPIs">
      <ListKpis
        variant="broadcast"
        // NEXT-26: 一覧・フォルダと同じアカウント範囲で数える。
        // 未選択（全アカウント表示）のときは未指定＝一覧と同じ全範囲。
        accountId={selectedAccountId ?? undefined}
        titles={['シナリオ', '購読中', '読了済', '今週の配信']}
        build={(s) => [
            {
              title: 'シナリオ',
              /*
               * #981 A05-02: 「すべて」と同じ母集団で数える。
               * `s.scenarios.total` は全アカウント共通のシナリオ
               * （line_account_id IS NULL）を含まないため、アカウントを
               * 選んだ表示では一覧・「すべて」とずれる。一覧と同じ口で
               * 数えた overallTotal を使い、未取得は `—`。
               */
              value: overallTotal,
              unit: '件',
              detail: `稼働中 ${s.scenarios.active}${sharedScenarioCount > 0 ? `・共通 ${sharedScenarioCount}件を含む` : ''}`,
            },
            { title: '購読中', value: s.scenarios.subscribers, unit: '人', detail: '現在配信中・重複を含む' },
            {
              title: '読了済',
              value: s.scenarios.completed,
              unit: '人',
              detail: scenarioCompletionDetail(
                s.scenarios.subscribers,
                s.scenarios.completed,
              ),
            },
            // 設計の4枚目。source='scenario'（028）で数えられる。
            { title: '今週の配信', value: s.scenarios.sentThisWeek, unit: '通', detail: '過去7日' },
            // 設計は「前週比 +6%」だが、前週ぶんを数える口が無い。
            // 何と比べた数字かを言えないので、期間だけ書いておく。
        ]}
      />
      </div>

      {folderDialogOpen && (
        <FolderAddDialog
          kind="scenario"
          note="シナリオを分けてしまう箱です。消しても、入っていたシナリオは未分類として残ります。"
          placeholder="例: 01_新規フォロー"
          onClose={() => setFolderDialogOpen(false)}
          onAdded={() => void loadFolders()}
        />
      )}

      {toggleTarget ? (
        <div data-design-node="RUxNf">
          {toggleTarget.isActive ? (
          <ConfirmDialog
            open
            title={`「${toggleTarget.name}」を停止しますか？`}
            description={[
              toggleTarget.lineAccountId === null ? '全LINEアカウントに適用されるシナリオです。' : '',
              `現在の購読中は${toggleTarget.subscriberCount === undefined ? '—人（人数を確認できませんでした）' : `${toggleTarget.subscriberCount}人`}です。`,
              `配信内容は${toggleTarget.stepCount === undefined ? '—通（通数を確認できませんでした）' : `${toggleTarget.stepCount}通`}です。`,
              '停止すると新しい配信を止めます。これまでの配信履歴は残ります。',
            ].filter(Boolean).join(' ')}
            confirmLabel="シナリオを停止"
            destructive
            busy={toggleBusy}
            error={toggleError || undefined}
            onConfirm={() => void confirmToggleActive()}
            onCancel={() => {
              if (toggleBusy) return
              setToggleTarget(null)
              setToggleError('')
            }}
          />
          ) : (
            <StartScenarioDialog
              scenario={toggleTarget}
              busy={toggleBusy}
              error={toggleError}
              onConfirm={() => void confirmToggleActive()}
              onCancel={() => {
                if (toggleBusy) return
                setToggleTarget(null)
                setToggleError('')
              }}
            />
          )}
        </div>
      ) : null}

      {/* 一覧本体（設計 `Body`）。 */}
      <div data-design="Body">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={handleCreate}
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          ＋ シナリオを作成
        </button>
      </div>
      {/*
        設計はフォルダを左の縦パネルに置く。シナリオはフォルダを持って
        いないので（列が無い）、いまは「すべて」だけ。分類できるように
        なったらここに並ぶ。
      */}
      <div style={FOLDER_RAIL_STYLE} className="grid gap-4 lg:grid-cols-[var(--folder-rail-width)_minmax(0,1fr)]">
        {/*
          スマホではフォルダを畳む（U027）。開いたまま置くと、フォルダが
          増えたとき検索とシナリオ行まで長く送ることになり、390px では
          領域が右へはみ出していた。開閉は <details> に任せ、PCでは
          今までどおり左の帯へ出す。
        */}
        <details className="lg:hidden">
          <summary className="bg-canvas border-hairline rounded-card text-ink-secondary cursor-pointer list-none border px-4 py-3 text-sm">
            フォルダ：{activeFolderLabel}
            <span className="text-ink-faint ml-2 text-xs">タップで開く</span>
          </summary>
          <div className="mt-2">{folderPanel}</div>
        </details>
        <div className="hidden lg:block">{folderPanel}</div>

        <div>
      <ListToolbar
        searchPlaceholder="シナリオ名で検索"
        searchValue={nameQuery}
        // #625: 長い検索語は上限へ切り詰める。共有部品(ListToolbar)は
        // 変えず、受け取る値をここで制限する。
        onSearchChange={(value) => setNameQuery(clampSearchQuery(value))}
      />

      {/*
        よく使う絞り込み。数え方が決まっているのは「停止中のみ」だけ。
        離脱の大きさと作成月は、比べる相手を決める前に押せるようにすると、
        押した人ごとに違うものを想像する。
      */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="text-ink-faint text-xs">よく使う</span>
        <button
          onClick={() => setStoppedOnly((v) => !v)}
          className={`rounded-pill px-3 py-1 text-xs transition-colors ${
            stoppedOnly
              ? 'bg-accent-soft text-accent-deep'
              : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
          }`}
        >
          停止中のみ
        </button>
        {[
          /* ★V7：押せないまま置かれていた「離脱が大きい」は外した（比較の基準が決まるまで出さない）。 */
          {
            label: '今月作成',
            disabled: false,
            active: createdThisMonthOnly,
            title: undefined,
            onClick: () => setCreatedThisMonthOnly((current) => !current),
          },
        ].map((filter) => (
          <button
            key={filter.label}
            disabled={filter.disabled}
            title={filter.title}
            onClick={filter.onClick}
            aria-pressed={filter.disabled ? undefined : filter.active}
            className={`rounded-pill border px-3 py-1 text-xs transition-colors ${
              filter.disabled
                ? 'border-hairline text-ink-faint opacity-50'
                : filter.active
                  ? 'border-accent-soft bg-accent-soft text-accent-deep'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>


      {/*
        フォルダ帯の「すべて」は絞り込み無しの全体件数、ここはいまの
        検索・絞り込みに一致した件数。2つを同じ数字で出さない（NEXT-26）。
        絞り込んでいないときは一致＝全体なので、この行は出さない。
      */}
      {(serverQuery || stoppedOnly || createdThisMonthOnly || folderFilter) && scenarioList.loaded && (
        <p className="text-ink-faint mb-3 text-xs tabular-nums">
          条件に一致したシナリオ：{scenarioList.total.toLocaleString('ja-JP')}件
        </p>
      )}

      {actionError && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {actionError}
        </div>
      )}

      {scenarioList.loading && scenarios.length === 0 ? (
        <ListState kind="loading" title="読み込んでいます" />
      ) : scenarioList.error ? (
        <ListState
          kind="error"
          title="表示できませんでした"
          description="登録したシナリオは消えていません。再読み込みしても直らないときは、エラー報告へお知らせください。"
          onRetry={() => void loadScenarios()}
        />
      ) : (
        <ScenarioList
          scenarios={scenarios}
          onReorder={handleReorder}
          folders={folders}
          onMoveFolders={handleMoveFolders}
          onToggleActive={(id) => requestToggleActive(id)}
          onDelete={handleDelete}
          onCreate={() => void handleCreate()}
        />
      )}
      {scenarioList.pageCount > 1 ? (
        <div className="mt-4 flex items-center justify-end gap-3 text-sm">
          <Button disabled={scenarioList.page <= 1 || scenarioList.loading} onClick={() => scenarioList.setPage(scenarioList.page - 1)}>
            前へ
          </Button>
          <span className="text-ink-secondary">{scenarioList.page} / {scenarioList.pageCount}ページ</span>
          <Button disabled={scenarioList.page >= scenarioList.pageCount || scenarioList.loading} onClick={() => scenarioList.setPage(scenarioList.page + 1)}>
            次へ
          </Button>
        </div>
      ) : null}
        </div>
      </div>
      </div>
    </div>
  )
}
