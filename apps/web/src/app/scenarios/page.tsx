'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import type { Scenario, ScenarioTriggerType, DeliveryMode } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import type { Folder } from '@line-crm/shared'
import Header from '@/components/layout/header'
import ListKpis from '@/components/shared/list-kpis'
import ListToolbar from '@/components/shared/list-toolbar'
import FolderPanel from '@/components/shared/folder-panel'
import FolderAddDialog from '@/components/shared/folder-add-dialog'
import Button from '@/components/shared/button'
import ScenarioList from '@/components/scenarios/scenario-list'

type ScenarioWithCount = Scenario & { stepCount?: number }

/** 未分類を表す印。空文字は「すべて」なので別の値にする。 */
const UNFILED = '__unfiled__'

export default function ScenariosPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const router = useRouter()
  const [scenarios, setScenarios] = useState<ScenarioWithCount[]>([])
  // 名前の絞り込み（設計 `Body` の検索）。手元で絞る。
  const [nameQuery, setNameQuery] = useState('')
  /** よく使う絞り込み。いま数えられるのは「停止中のみ」だけ。 */
  const [stoppedOnly, setStoppedOnly] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderFilter, setFolderFilter] = useState('')
  const [folderDialogOpen, setFolderDialogOpen] = useState(false)

  const loadFolders = useCallback(async () => {
    const res = await api.folders.list('scenario')
    if (res.success) setFolders(res.data)
  }, [])

  useEffect(() => {
    void loadFolders()
  }, [loadFolders])

  const loadScenarios = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setScenarios(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false
    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.scenarios.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) {
          setScenarios(res.data)
        } else {
          setError(res.error)
        }
      } catch {
        if (cancelled) return
        setError('シナリオの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    fetchData()
    return () => {
      cancelled = true
    }
  }, [selectedAccountId, accountLoading])

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
    setError('')
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
      setError(res.error)
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
    setError('')
    const rank = new Map(ids.map((id, i) => [id, i]))
    setScenarios((prev) =>
      [...prev].sort((a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9)),
    )
    try {
      const res = await api.scenarios.reorder(ids)
      if (!res.success) throw new Error(res.error)
    } catch {
      setError('並び順を保存できませんでした')
      loadScenarios()
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.scenarios.update(id, { isActive: !current })
      loadScenarios()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  /** 一覧からフォルダを付け替える。作ったフォルダへ中身を入れる操作。 */
  const handleMoveFolder = async (id: string, folderId: string) => {
    setError('')
    try {
      const res = await api.scenarios.update(id, { folderId: folderId || null })
      if (!res.success) throw new Error(res.error)
      void loadScenarios()
    } catch {
      setError('フォルダの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    try {
      await api.scenarios.delete(id)
      loadScenarios()
    } catch {
      setError('削除に失敗しました')
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
            { title: '購読中', value: s.scenarios.subscribers, unit: '人', detail: '重複を含む' },
            {
              title: '読了済',
              value: s.scenarios.completed,
              unit: '人',
              detail:
                s.scenarios.subscribers + s.scenarios.completed > 0
                  ? `完了率 ${Math.round((s.scenarios.completed / (s.scenarios.subscribers + s.scenarios.completed)) * 100)}%`
                  : '—',
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
          className="bg-accent text-on-accent hover:bg-accent-hover rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50"
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
        sortLabel="購読中が多い順"
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
        {['離脱が大きい', '今月作成'].map((label) => (
          <button
            key={label}
            disabled
            title="この絞り込みはまだ数えられません"
            className="border-hairline text-ink-faint rounded-pill border px-3 py-1 text-xs opacity-50"
          >
            {label}
          </button>
        ))}
      </div>


      {error && (
        <div className="mb-4 p-4 bg-danger-bg border border-danger-bg rounded-lg text-danger text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-canvas rounded-card border border-hairline p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-canvas-sunken rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-canvas-sunken rounded w-24" />
                <div className="h-3 bg-canvas-sunken rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScenarioList
          scenarios={scenarios
            .filter((sc) =>
              nameQuery.trim() === ''
                ? true
                : sc.name.toLowerCase().includes(nameQuery.trim().toLowerCase()),
            )
            .filter((sc) => (stoppedOnly ? !sc.isActive : true))
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
          onToggleActive={handleToggleActive}
          onDelete={handleDelete}
          loading={loading}
        />
      )}
        </div>
      </div>
      </div>
    </div>
  )
}
