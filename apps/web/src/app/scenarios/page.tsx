'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario } from '@line-crm/shared'
import { api, type ScenarioRuns, type ScenarioSimulation } from '@/lib/api'
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
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import ScenarioList from '@/components/scenarios/scenario-list'
import { startChecklist } from './start-checklist'

type ScenarioWithCount = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}
type LoadStatus = 'loading' | 'ready' | 'error'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

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
  const { selectedAccountId } = useAccount()
  const lineAccountId = scenario.lineAccountId ?? selectedAccountId
  const [simulation, setSimulation] = useState<ScenarioSimulation | null>(null)
  const [runs, setRuns] = useState<ScenarioRuns | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(true)

  useEffect(() => {
    if (!lineAccountId) {
      setPreflightLoading(false)
      return
    }
    let cancelled = false
    setPreflightLoading(true)
    void Promise.all([
      api.scenarios.simulate(scenario.id, lineAccountId).catch(() => null),
      api.scenarios.runs(scenario.id, lineAccountId, { limit: 1 }).catch(() => null),
    ]).then(([simulationResponse, runsResponse]) => {
      if (cancelled) return
      setSimulation(simulationResponse?.success ? simulationResponse.data : null)
      setRuns(runsResponse?.success ? runsResponse.data : null)
      setPreflightLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [lineAccountId, scenario.id])

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
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-6" role="dialog" aria-modal="true" aria-labelledby="start-scenario-title">
      <div className="border-hairline flex h-[860px] w-full max-w-[1040px] flex-col overflow-y-auto rounded-card border bg-white shadow-xl">
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
          <section className="border-hairline min-h-[510px] rounded-card border p-5">
            <p className="text-ink mb-4 text-sm font-bold">開始するシナリオ</p>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-ink-faint">開始対象</dt><dd className="text-ink text-right font-medium">{simulation ? `新規開始予定 ${simulation.audience.newStartPlanned.toLocaleString('ja-JP')}人` : preflightLoading ? '—（試算中）' : '—（取得できません）'}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">開始タイミング</dt><dd className="text-ink text-right font-medium">保存後すぐ</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">配信ステップ</dt><dd className="text-ink text-right font-medium">{simulation ? `${simulation.steps.length}通` : scenario.stepCount === undefined ? '—通' : `${scenario.stepCount}通`}</dd></div>
              <div className="border-hairline flex justify-between gap-4 border-t pt-3"><dt className="text-ink-faint">終了後</dt><dd className="text-ink text-right font-medium">完了タグ＋担当者通知</dd></div>
            </dl>
          </section>

          <section className="border-hairline min-h-[510px] rounded-card border p-5">
            <p className="text-ink mb-3 text-sm font-bold">配信前チェック</p>
            <ul className="space-y-3 text-sm">
              {preflightLoading ? <li className="text-ink-faint text-xs">開始前の実データを確認しています…</li> : null}
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
          <ul className="text-ink-secondary mt-2 space-y-1 text-xs"><li>・条件に一致した{simulation?.audience.newStartPlanned.toLocaleString('ja-JP') ?? '—'}人が購読を開始します</li><li>・配信中の友だちは停止するまで次のステップへ進みます</li><li>・開始・停止・編集は監査履歴とSlackのPRスレッドへ記録します</li></ul>
        </div>
        <label className="mx-6 mb-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" defaultChecked />対象人数・内容・送信枠を確認しました</label>
        {error ? <p className="bg-danger-bg text-danger mx-6 mb-4 rounded-card px-4 py-3 text-sm">{error}</p> : null}
        <div className="border-hairline mt-auto flex justify-end gap-3 border-t px-6 py-4">
          <span className="text-ink-faint mr-auto self-center text-xs">開始後も緊急停止できます。停止理由は履歴に残ります。</span><Button onClick={onCancel} disabled={busy}>戻って確認</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>{busy ? '開始中…' : '配信を開始'}</Button>
        </div>
      </div>
    </div>
  )
}

/** 作成日時が、運用画面の基準である日本時間の今月か。 */
function isCreatedThisMonth(createdAt: string, now = new Date()): boolean {
  const month = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
  })
  return month.format(new Date(createdAt)) === month.format(now)
}

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioWithCount[]>([])
  // 名前の絞り込み（設計 `Body` の検索）。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  /** よく使う絞り込み。いま数えられるのは「停止中のみ」だけ。 */
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [createdThisMonthOnly, setCreatedThisMonthOnly] = useState(false)
  const [loadStatus, setLoadStatus] = useState<LoadStatus>('loading')
  const [actionError, setActionError] = useState('')
  const [creating, setCreating] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)
  const [toggleTarget, setToggleTarget] = useState<ScenarioWithCount | null>(null)
  const [toggleBusy, setToggleBusy] = useState(false)
  const [toggleError, setToggleError] = useState('')
  const loadRequestRef = useRef(0)

  const loadFolders = useCallback(async () => {
    const res = await api.folders.list('scenario')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const loadScenarios = useCallback(async () => {
    const requestId = ++loadRequestRef.current
    setLoadStatus('loading')
    setActionError('')
    setScenarios([])
    try {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
      if (requestId !== loadRequestRef.current) return
      if (res.success) {
        setScenarios(res.data)
        setLoadStatus('ready')
      } else {
        setScenarios([])
        setLoadStatus('error')
      }
    } catch {
      if (requestId !== loadRequestRef.current) return
      setScenarios([])
      setLoadStatus('error')
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    void loadScenarios()
    return () => {
      loadRequestRef.current += 1
    }
  }, [accountLoading, loadScenarios])

  /**
   * シナリオを作って、配信方式の選択へ送る。
   *
   * **押した時点で作る。** 設計の次の画面に「◯◯を作成しました。続けて
   * 配信方式を選んでください」と出ているので、そこへ着く前に行が要る。
   * 名前を聞くモーダルは挟まない（設計にその画面が無い）。
   *
   * 名前と開始のきっかけは、この先の編集画面（設計③）で決める。
   * 配信方式は暫定で「時刻で指定」にしておく。設計でおすすめになっている
   * 方で、次の画面で選び直せる（通がまだ0なので変えられる）。
   */
  const handleCreate = async () => {
    if (creating) return
    setCreating(true)
    setActionError('')
    const res = await api.scenarios.create({
      // 仮の名前。3段目で必ず聞くが、そこを飛ばした人のぶんが一覧で
      // 区別できるように日付を足す。
      name: `新しいシナリオ ${new Date().toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}`,
      description: null,
      triggerType: 'friend_add',
      triggerTagId: null,
      lineAccountId: selectedAccountId,
      isActive: true,
      deliveryMode: 'absolute_time',
    })
    if (res.success) {
      router.push(`/scenarios/mode?id=${res.data.id}`)
    } else {
      setActionError('シナリオを作成できませんでした。状態を読み直してから、もう一度お試しください。')
      setCreating(false)
    }
  }

  /**
   * 掴んで入れ替えた並びを保存する。
   *
   * 画面はすぐ入れ替える。往復を待つと、掴んだ手応えが無い。
   * 失敗したときだけ読み直して、元の並びに戻す。
   */
  const handleReorder = async (ids: string[]) => {
    setActionError('')
    const rank = new Map(ids.map((id, i) => [id, i]))
    setScenarios((prev) =>
      [...prev].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)),
    )
    try {
      const res = await api.scenarios.reorder(ids)
      if (!res.success) throw new Error(res.error)
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

  /** 一覧からフォルダを付け替える。作ったフォルダへ中身を入れる操作。 */
  const handleMoveFolder = async (id: string, folderId: string) => {
    setActionError('')
    try {
      const res = await api.scenarios.update(id, { folderId: folderId || null })
      if (!res.success) throw new Error(res.error)
      void loadScenarios()
    } catch {
      setActionError('フォルダを変更できませんでした。状態を読み直してから、もう一度お試しください。')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.scenarios.delete(id)
      void loadScenarios()
    } catch {
      setActionError('シナリオを削除できませんでした。状態を読み直してから、もう一度お試しください。')
    }
  }

  return (
    <div>
      <section data-design="Head" className="bg-success-bg text-success mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card px-4 py-3 text-sm">
        <span aria-hidden>ⓘ</span>
        <strong>作成しただけでは配信されません。開始条件を設定すると配信が始まります。</strong>
        <span className="font-semibold underline underline-offset-2">配信を始める方法</span>
      </section>

      {/* 設計の KPI 4枚。数は /api/list-stats から4画面ぶんまとめて来る。 */}
      <div data-design="KPIs">
      <ListKpis
        variant="broadcast"
        titles={['シナリオ', '購読中', '読了済', '今週の配信']}
        build={(s) => [
            { title: 'シナリオ', value: s.scenarios.total, unit: '件', detail: `稼働中 ${s.scenarios.active}` },
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
      {/*
        「フォルダを追加」と「＋ シナリオを作成」は、設計では KPI の下・
        フォルダ欄と表の上に置く。見出しの操作欄に入れていたので、
        絵と位置が違っていた。
      */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button onClick={() => setFolderDialogOpen(true)}>
          フォルダを追加
        </Button>
        <button
          onClick={() => void handleCreate()}
          disabled={creating}
          className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
        >
          {creating ? '作成中…' : '＋ シナリオを作成'}
        </button>
      </div>
      {/*
        設計はフォルダを左の縦パネルに置く。シナリオはフォルダを持って
        いないので（列が無い）、いまは「すべて」だけ。分類できるように
        なったらここに並ぶ。
      */}
      <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <FolderPanel
          total={`${scenarios.length} 件`}
          activeId={folderFilter}
          onSelect={setFolderFilter}
          rows={[
            { id: '', label: 'すべて', count: scenarios.length },
            ...folders.map((f) => ({
              id: f.id,
              label: f.name,
              count: scenarios.filter((sc) => sc.folderId === f.id).length,
              color: f.color,
            })),
            {
              id: UNFILED,
              label: '未分類',
              count: scenarios.filter((sc) => !sc.folderId).length,
            },
          ]}
        >
          <p className="text-ink-faint text-xs leading-relaxed">
            フォルダを消しても、入っていたシナリオは未分類として残ります。
          </p>
        </FolderPanel>

        <div>
      <ListToolbar
        searchPlaceholder="シナリオ名で検索"
        searchValue={nameQuery}
        onSearchChange={setNameQuery}
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
              ? 'bg-accent-soft text-accent'
              : 'border-hairline text-ink-secondary hover:bg-canvas-sunken border'
          }`}
        >
          停止中のみ
        </button>
        {[
          {
            label: '離脱が大きい',
            disabled: true,
            active: false,
            title: '離脱率の比較基準が決まっていないため、まだ数えられません',
            onClick: undefined,
          },
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
                  ? 'border-accent-soft bg-accent-soft text-accent'
                  : 'border-hairline text-ink-secondary hover:bg-canvas-sunken'
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>


      {actionError && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {actionError}
        </div>
      )}

      {loadStatus === 'loading' ? (
        <ListState kind="loading" title="読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="表示できませんでした"
          description="登録したシナリオは消えていません。再読み込みしても直らないときは、エラー報告へお知らせください。"
          onRetry={() => void loadScenarios()}
        />
      ) : (
        <ScenarioList
          scenarios={scenarios
            .filter((sc) =>
              nameQuery.trim() === ''
                ? true
                : sc.name.toLowerCase().includes(nameQuery.trim().toLowerCase()),
            )
            .filter((sc) => (stoppedOnly ? !sc.isActive : true))
            .filter((sc) => (createdThisMonthOnly ? isCreatedThisMonth(sc.createdAt) : true))
            .filter((sc) =>
              folderFilter === ''
                ? true
                : folderFilter === UNFILED
                  ? !sc.folderId
                  : sc.folderId === folderFilter,
            )}
          onReorder={handleReorder}
          folders={folders}
          onMoveFolder={handleMoveFolder}
          onToggleActive={(id) => requestToggleActive(id)}
          onDelete={handleDelete}
          onCreate={() => void handleCreate()}
        />
      )}
        </div>
      </div>
      </div>
    </div>
  )
}
