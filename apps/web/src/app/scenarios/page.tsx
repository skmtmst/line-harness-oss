'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

function scenarioCompletionDetail(active: number, completed: number): string {
  const enrolled = active + completed
  if (enrolled === 0) return '—'
  const rate = Math.round((completed / enrolled) * 100)
  return `登録合計 ${enrolled.toLocaleString('ja-JP')}人のうち ${rate}%`
}
import type { Folder } from '@line-crm/shared'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import ListToolbar from '@/components/shared/list-toolbar'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import ScenarioList from '@/components/scenarios/scenario-list'
import { shouldShowStartChecklist, startChecklist } from './start-checklist'

type ScenarioWithCount = Scenario & {
  stepCount?: number
  subscriberCount?: number
  completedCount?: number
}
type LoadStatus = 'loading' | 'ready' | 'error'

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

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
      <div data-design="Head">
      <Header
        title="シナリオ配信"
        description="配信のタイミングを指定して複数のメッセージを順に送ります。友だちの反応に応じて分岐もできます。作成しただけでは配信されません。"
        action={
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="border-hairline bg-canvas-sunken text-ink-secondary rounded-control border px-3 py-2 text-sm font-medium"
              title="表の左端の ⠿ を掴むと並べ替えられます"
            >
              ⇅ 並び替えは ⠿ を掴む
            </span>
            <button
              disabled
              title="マニュアルは準備中です"
              className="border-hairline text-ink-faint rounded-control border px-3 py-2 text-sm font-medium opacity-50"
            >
              マニュアル
            </button>
          </div>
        }
      />
      </div>

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
          <ConfirmDialog
            open
            title={`「${toggleTarget.name}」を${toggleTarget.isActive ? '停止' : '開始'}しますか？`}
            description={[
              toggleTarget.lineAccountId === null ? '全LINEアカウントに適用されるシナリオです。' : '',
              `現在の購読中は${toggleTarget.subscriberCount === undefined ? '—人（人数を確認できませんでした）' : `${toggleTarget.subscriberCount}人`}です。`,
              `配信内容は${toggleTarget.stepCount === undefined ? '—通（通数を確認できませんでした）' : `${toggleTarget.stepCount}通`}です。`,
              toggleTarget.isActive
                ? '停止すると新しい配信を止めます。これまでの配信履歴は残ります。'
                : toggleTarget.subscriberCount === 0
                  ? '現在届く人はいません。開始後に登録された友だちから配信対象になります。'
                  : '開始すると、登録条件に合う友だちへの配信が動き始めます。',
            ].filter(Boolean).join(' ')}
            confirmLabel={toggleTarget.isActive ? 'シナリオを停止' : 'シナリオを開始'}
            destructive={toggleTarget.isActive}
            busy={toggleBusy}
            error={toggleError || undefined}
            onConfirm={() => void confirmToggleActive()}
            onCancel={() => {
              if (toggleBusy) return
              setToggleTarget(null)
              setToggleError('')
            }}
          >
            {shouldShowStartChecklist(toggleTarget.isActive) ? (
              <div className="space-y-2">
                <p className="text-ink-secondary text-xs font-medium">配信前チェック</p>
                <ul className="space-y-1.5 text-sm">
                  {startChecklist(toggleTarget).map((item) => (
                    <li key={item.label} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={
                          item.state === 'ok'
                            ? 'text-success'
                            : item.state === 'warn'
                              ? 'text-warning'
                              : 'text-ink-faint'
                        }
                      >
                        {item.state === 'ok' ? '✓' : item.state === 'warn' ? '!' : '—'}
                      </span>
                      <span>
                        <span className="text-ink block">{item.label}</span>
                        <span className="text-ink-faint block text-xs">{item.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="text-ink-faint text-xs">
                  「—」は、この画面から確かめられない項目です。確認済みとしては扱いません。
                </p>
              </div>
            ) : null}
          </ConfirmDialog>
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
        <ListState kind="loading" title="シナリオを読み込んでいます" />
      ) : loadStatus === 'error' ? (
        <ListState
          kind="error"
          title="シナリオを表示できませんでした"
          description="登録したシナリオは消えていません。再読み込みしても直らない場合は、エラー報告へ連絡してください。"
          action={<Button variant="secondary" onClick={() => void loadScenarios()}>シナリオを再読み込み</Button>}
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
        />
      )}
        </div>
      </div>
      </div>
    </div>
  )
}
