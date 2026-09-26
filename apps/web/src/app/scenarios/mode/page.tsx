'use client'

import StepTrail from '@/components/shared/step-trail'
import { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DeliveryMode, Folder, Scenario } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import SelectField from '@/components/shared/select-field'
import Button from '@/components/shared/button'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import './scenario-mode.css'

/**
 * 配信方式の選択（設計）。
 *
 * `id` ありで来たときは既存のシナリオの方式を保存する。`id` なし
 * （一覧の「＋ シナリオを作成」から来たとき）は**まだ行を作らず**、
 * 名前とフォルダを決めて方式を選んだ時点ではじめて作成する
 * （#949 N-055）。途中で閉じても一覧に空の行は残らない。
 *
 * 以前はモーダルの中で方式と名前をまとめて決めていた。並べた具体例が
 * 入りきらず、どちらを選ぶと何が変わるのかを読まずに押していた。
 */
export default function ScenarioModePage() {
  return (
    <Suspense fallback={<div className="text-ink-faint py-12 text-center text-sm">読み込み中…</div>}>
      <ScenarioModeContent />
    </Suspense>
  )
}

function ScenarioModeContent() {
  usePageTitle('シナリオを作成')
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()
  const [scenario, setScenario] = useState<Scenario | null>(null)
  // id なしは「これから作る」。読み込む行が無いので最初から入力できる。
  const [scenarioState, setScenarioState] = useState<'loading' | 'ready' | 'error'>(
    id ? 'loading' : 'ready',
  )
  const [saving, setSaving] = useState<DeliveryMode | null>(null)
  /*
   * ★V7: 2択はカードごとの緑ボタンで即確定させない。カード全体を選ぶ
   * ラジオ選択にし、確定は画面1つの主ボタンにまとめる。
   */
  const [selectedMode, setSelectedMode] = useState<DeliveryMode | null>(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState('')
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detailsSaving, setDetailsSaving] = useState(false)
  const detailsSavePromise = useRef<Promise<boolean> | null>(null)

  /**
   * 名前とフォルダを先に保存する。方式を選ぶ前に閉じても、分類は残る。
   *
   * **id なし（これから作る）のときは保存先が無い**ので、入力は画面の
   * 中に持つだけで何もしない。作るのは方式を確定したとき（#949 N-055）。
   */
  const saveDetails = (nextFolderId = folderId): Promise<boolean> => {
    if (!id) return Promise.resolve(true)
    if (detailsSavePromise.current) return detailsSavePromise.current
    const trimmed = name.trim()
    const nextFolder = nextFolderId || null
    if (!scenario || !trimmed) return Promise.resolve(false)
    if (trimmed === scenario.name && nextFolder === (scenario.folderId ?? null)) {
      return Promise.resolve(true)
    }

    const operation = (async () => {
      setDetailsSaving(true)
      setError('')
      try {
        const res = await api.scenarios.update(id, { name: trimmed, folderId: nextFolder })
        if (!res.success) {
          setError('シナリオ情報を保存できませんでした。時間をおいてもう一度お試しください。')
          setFolderId(scenario.folderId ?? '')
          return false
        }
        setScenario(res.data)
        scenarioReferenceData.invalidateScenario(id)
        setName(res.data.name)
        setFolderId(res.data.folderId ?? '')
        return true
      } catch (cause) {
        setError(scenarioSaveError(cause))
        setFolderId(scenario.folderId ?? '')
        return false
      } finally {
        setDetailsSaving(false)
      }
    })()
    detailsSavePromise.current = operation
    void operation.finally(() => {
      if (detailsSavePromise.current === operation) detailsSavePromise.current = null
    })
    return operation
  }

  useEffect(() => {
    let active = true
    // id があるときだけ既存の行を読む。新規（id なし）は読む行が無い。
    if (id) {
    setScenarioState('loading')
    void scenarioReferenceData.scenario(id)
      .then((res) => {
        if (!active) return
        if (res.success) {
          setScenario(res.data)
          setName(res.data.name)
          setFolderId(res.data.folderId ?? '')
          setScenarioState('ready')
        } else {
          setError('シナリオを読み込めませんでした。時間をおいてもう一度お試しください。')
          setScenarioState('error')
        }
      })
      .catch(() => {
        if (active) {
          setError('シナリオを読み込めませんでした。時間をおいてもう一度お試しください。')
          setScenarioState('error')
        }
      })
    }
    return () => { active = false }
  }, [id])

  /*
   * SCENARIO-20: フォルダはアカウント単位。無指定で全権限範囲を取ると、
   * 別アカウントの同名フォルダを選んで保存してしまう。
   * シナリオの所属アカウント（共通なら選択中のアカウント）の候補だけを
   * 出し、切り替わったら取り直す。
   */
  const folderAccountId = scenario?.lineAccountId ?? selectedAccountId
  useEffect(() => {
    let active = true
    setFolderState('loading')
    void api.folders.list('scenario', folderAccountId ?? undefined)
      .then((res) => {
        if (!active) return
        if (res.success) {
          setFolders(res.data)
          setFolderState('ready')
        } else {
          setFolderState('error')
        }
      })
      .catch(() => {
        if (active) setFolderState('error')
      })
    return () => { active = false }
  }, [folderAccountId])

  /**
   * 行をまだ作っていない（id なし）ときの作成。方式を確定したこの瞬間に
   * 初めて作るので、途中で閉じても空の行は残らない（#949 N-055）。
   */
  const createNew = async (mode: DeliveryMode): Promise<string | null> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('シナリオ名を入力してください')
      return null
    }
    const res = await api.scenarios.create({
      name: trimmed,
      description: null,
      triggerType: 'friend_add',
      triggerTagId: null,
      lineAccountId: selectedAccountId,
      isActive: true,
      deliveryMode: mode,
      folderId: folderId || null,
    })
    if (!res.success) {
      // APIの内部エラー文はそのまま出さない（画面は決まった言葉で断る）。
      setError('シナリオを作成できませんでした。時間をおいてもう一度お試しください。')
      return null
    }
    return res.data.id
  }

  const choose = async (mode: DeliveryMode) => {
    if (saving) return
    if (id && !scenario) return
    if (detailsSavePromise.current) {
      const saved = await detailsSavePromise.current
      if (!saved) return
    }
    setSaving(mode)
    setError('')
    const trimmed = name.trim()
    if (!trimmed) {
      setError('シナリオ名を入力してください')
      setSaving(null)
      return
    }
    try {
      if (!id) {
        // 新規。名前・フォルダ・方式をまとめて1回で作る。
        const createdId = await createNew(mode)
        if (!createdId) {
          setSaving(null)
          return
        }
        router.push(`/scenarios/first-step?id=${encodeURIComponent(createdId)}`)
        return
      }
      // 名前と方式は同じ受け口で一度に保存する。
      const res = await api.scenarios.update(id, {
        name: trimmed,
        folderId: folderId || null,
        deliveryMode: mode,
      })
      if (!res.success) {
        setError('配信方式を保存できませんでした。時間をおいてもう一度お試しください。')
        setSaving(null)
        return
      }
      scenarioReferenceData.invalidateScenario(id)
      // 3段目へ。設計の帯が3段なので、2段で編集画面へ放り出さない。
      router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)
    } catch (cause) {
      setError(id ? scenarioModeError(cause) : 'シナリオを作成できませんでした。時間をおいてもう一度お試しください。')
      setSaving(null)
    }
  }

  const continueAsDraft = async () => {
    if (saving || detailsSaving) return
    if (id && !scenario) return
    if (!id) {
      // 新規で「あとで決める」も、行を作る確定操作。方式は暫定で
      // 「時刻で指定」（設計でおすすめの方。通が0のあいだは変えられる）。
      setDetailsSaving(true)
      setError('')
      try {
        const createdId = await createNew('absolute_time')
        if (createdId) router.push(`/scenarios/first-step?id=${encodeURIComponent(createdId)}`)
      } finally {
        setDetailsSaving(false)
      }
      return
    }
    const saved = await saveDetails()
    if (saved) router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)
  }

  const selectedFolderName = folderState === 'loading'
    ? '読み込み中…'
    : folderState === 'error'
      ? '確認できません'
      : folders.find((folder) => folder.id === folderId)?.name
        ?? (folderId ? '名前を確認できません' : '未分類')
  const selectedFolderMissing = Boolean(folderId && !folders.some((folder) => folder.id === folderId))

  return (
    <div data-design-node="cCB7r" data-list-state={scenarioState} aria-busy={scenarioState === 'loading'}>
      <div data-design="Head" className="mb-7 flex items-center justify-between">
        <nav data-design="Crumb" className="text-ink-faint text-xs">
          <Link href="/scenarios" className="hover:underline">
            シナリオ配信
          </Link>
          <span className="mx-1.5">/</span>
          <span>新規作成</span>
        </nav>
        {/* 見た目を手書きしない。共通ボタンで高さをそろえる。 */}
        <Button href="/scenarios">✕ キャンセル</Button>
      </div>

      <StepTrail
        label="シナリオ作成の進み方"
        items={[
          // id なしは「これから作る」。名前と方式をこの画面でまとめて決める。
          { label: 'シナリオ情報', state: id ? 'done' : 'current' },
          { label: '配信方式', state: 'current' },
          { label: '1通目を設定', state: 'todo' },
        ]}
      />

      <div data-design="Notice" className="mt-4 space-y-2">
        {scenarioState === 'loading' && (
          <p className="bg-info-bg text-info rounded-card px-4 py-3 text-sm">
            シナリオを読み込んでいます。
          </p>
        )}
        {scenarioState === 'ready' && scenario && (
          <p className="bg-success-bg text-success rounded-card px-4 py-3 text-sm">
            「{scenario.name}」の下書きを作成しました。続けて配信方式を選んでください。
          </p>
        )}
        {/* id なしはまだ作っていない。確定するまで行は作らない（#949 N-055）。 */}
        {!id && (
          <p className="bg-info-bg text-info rounded-card px-4 py-3 text-sm">
            シナリオ名と配信方式を決めると作成されます。途中で閉じても一覧には残りません。
          </p>
        )}
        {error && <p className="bg-danger-bg text-danger rounded-card px-4 py-3 text-sm">{error}</p>}
      </div>

      <div data-design="Name" className="bg-canvas rounded-card border-hairline mt-4 mb-4 border p-4">
        <h2 className="text-ink text-sm font-bold">シナリオ情報</h2>
        <div className="mt-2 grid max-w-4xl gap-4 md:grid-cols-2">
          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">
              シナリオ名 <span className="text-danger">*</span>
            </span>
            <input
              type="text"
              value={name}
              disabled={(Boolean(id) && !scenario) || detailsSaving || saving !== null}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void saveDetails()}
              placeholder="例: 友だち追加ウェルカム"
              className="border-hairline rounded-control bg-canvas text-ink focus:ring-accent w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="text-ink-secondary mb-1 block text-xs font-medium">フォルダ：</span>
            <SelectField
              value={folderId}
              title={selectedFolderName}
              disabled={(Boolean(id) && !scenario) || folderState !== 'ready' || detailsSaving || saving !== null}
              onChange={(event) => {
                const nextFolderId = event.target.value
                setFolderId(nextFolderId)
                void saveDetails(nextFolderId)
              }}
              aria-label="シナリオのフォルダ"
              className="v6-select border-hairline rounded-control bg-canvas text-ink focus:ring-accent disabled:bg-canvas-sunken disabled:text-ink-faint w-full border px-3 py-2 text-sm focus:ring-2 focus:outline-none"
              options={[
                { value: '', label: '未分類' },
                ...(selectedFolderMissing ? [{ value: folderId, label: '名前を確認できません' }] : []),
                ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
              ]}
            />
            {folderState !== 'ready' || detailsSaving ? (
              <span className="text-ink-faint mt-1 block text-xs">
                {folderState === 'loading'
                  ? 'フォルダを読み込んでいます。'
                  : folderState === 'error'
                    ? 'フォルダを確認できないため、いまは変更できません。'
                    : 'フォルダを保存しています。'}
              </span>
            ) : null}
            {/*
              SCENARIO-20: 保存済みのフォルダがこのアカウントの候補に無い
              場合は理由を示す。黙って「未分類」に見せると、保存時に
              別範囲の値を上書きしてしまう。
            */}
            {folderState === 'ready' && selectedFolderMissing ? (
              <span className="text-warning mt-1 block text-xs">
                選択中のフォルダはこのアカウントの候補にありません（別アカウントまたは削除済み）。このまま保存すると外れます。
              </span>
            ) : null}
          </label>
        </div>
      </div>

      <fieldset data-design="Choices">
        <legend className="sr-only">配信方式</legend>
        <div className="grid gap-4 xl:grid-cols-2">
        <ModeCard
          mode="absolute_time"
          selected={selectedMode === 'absolute_time'}
          onSelect={setSelectedMode}
          title="時刻で指定"
          lead="配信時刻がそろうため、開封されやすい時間帯に寄せられます。"
          body="配信のタイミングを「購読開始から〇日後の〇時」と指定できます。メルマガのような決まった時間の定期配信ができます。"
          uses={['メルマガ配信', '定期リマインド', '朝夜の固定配信']}
          result="2人とも同じ時刻に届く（1通目 15:00 ／ 2通目 20:00）"
          note="購読開始時刻が最初の配信時刻を過ぎている場合、翌日の配信時刻から配信が開始されます。"
          rows={[
            { who: '友だち A', start: '4/1 12:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00' },
            { who: '友だち B', start: '4/1 14:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00' },
          ]}
          heads={['当日 15:00', '翌日 20:00']}
          disabled={(Boolean(id) && !scenario) || detailsSaving}
        />
        <ModeCard
          mode="elapsed"
          title="経過時間で指定"
          lead="友だち追加の時刻を起点にするため、一人ひとりに同じ体験を届けられます。"
          body="配信のタイミングを「購読開始から〇日と〇時間後」と指定できます。「友だち追加から5時間限定」のような期間限定の配信ができます。"
          uses={['期間限定オファー', '初回フォロー', 'カウントダウン']}
          result="経過時間は2人とも同じ。購読開始が2時間遅い分、配信時刻も2時間うしろにズレる"
          note="購読開始時刻によっては夜間の配信となる場合があります。"
          rows={[
            { who: '友だち A', start: '4/1 12:00 に購読開始', first: '4/1 15:00', second: '4/2 20:00', gaps: ['+3時間', '+1日と8時間'] },
            { who: '友だち B', start: '4/1 14:00 に購読開始', first: '4/1 17:00', second: '4/2 22:00', gaps: ['+3時間', '+1日と8時間'] },
          ]}
          selected={selectedMode === 'elapsed'}
          onSelect={setSelectedMode}
          disabled={(Boolean(id) && !scenario) || detailsSaving}
        />
        </div>
      </fieldset>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="text-ink-faint text-xs">
          どちらを選んでも、作成後にステップの追加・並べ替えができます。
          {/* 1通だけ試しに送る受け口が無いので、テスト送信とは書かない。 */}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            disabled={(Boolean(id) && !scenario) || saving !== null || detailsSaving}
            onClick={() => void continueAsDraft()}
          >
            あとで決める（下書きとして保存）
          </Button>
          <Button
            variant="primary"
            disabled={!selectedMode || (Boolean(id) && !scenario) || saving !== null || detailsSaving}
            onClick={() => { if (selectedMode) void choose(selectedMode) }}
          >
            {saving !== null ? '作成中…' : id ? 'この方式で保存' : 'この方式で作成'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── 部品 ────────────────────────────────────────────────────────────────────


function scenarioSaveError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 403) return 'シナリオ情報を変更する権限がありません。'
    if (cause.status === 404) return 'シナリオが見つかりませんでした。一覧から開き直してください。'
  }
  return 'シナリオ情報を保存できませんでした。時間をおいてもう一度お試しください。'
}

function scenarioModeError(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 400 && !cause.message.startsWith('API error:')) return cause.message
    if (cause.status === 403) return '配信方式を変更する権限がありません。'
    if (cause.status === 404) return 'シナリオが見つかりませんでした。一覧から開き直してください。'
  }
  return '配信方式を保存できませんでした。時間をおいてもう一度お試しください。'
}

function ModeCard({
  mode,
  selected,
  onSelect,
  title,
  recommended,
  lead,
  body,
  uses,
  rows,
  heads,
  result,
  note,
  disabled,
}: {
  mode: DeliveryMode
  selected: boolean
  onSelect: (mode: DeliveryMode) => void
  title: string
  recommended?: boolean
  lead: string
  body: string
  uses: string[]
  rows: Array<{ who: string; start: string; first: string; second: string; gaps?: string[] }>
  heads?: string[]
  result: string
  note: string
  disabled: boolean
}) {
  return (
    // ★V7: カード全体を選ぶラジオ選択。本物の input[type=radio] を使い、
    // 選択中は枠と淡い面で示す（色だけに頼らない）。確定は画面下の主ボタン。
    <label className={`rounded-card flex h-full cursor-pointer flex-col border bg-canvas p-5 ${selected ? 'border-accent bg-accent-soft' : 'border-hairline'} ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}>
      <input
        type="radio"
        name="delivery-mode"
        value={mode}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect(mode)}
        className="sr-only"
      />
      <div className="flex items-start gap-3">
        {/* 絵文字は使わない。端末やフォントで見た目が変わるうえ、
            色が乗って見出しより目立つ。線の記号にする。 */}
        <span className="bg-accent-soft text-accent-deep rounded-card flex h-9 w-9 shrink-0 items-center justify-center">
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            {mode === 'absolute_time' ? (
              <path strokeLinecap="round" d="M12 7v5l3 2" />
            ) : (
              <path strokeLinecap="round" d="M12 8v4M9 3h6" />
            )}
          </svg>
        </span>
        <div className="min-w-0">
          <h2 className="text-ink flex flex-wrap items-center gap-2 text-lg font-bold">
            {title}
            {recommended && (
              <span className="bg-accent-soft text-accent-deep rounded-pill px-2 py-0.5 text-xs font-bold">
                おすすめ
              </span>
            )}
          </h2>
          <p className="text-ink-secondary mt-0.5 text-xs leading-relaxed">{lead}</p>
        </div>
      </div>

      <p className="text-ink mt-3 text-sm leading-relaxed">{body}</p>

      <div className="mt-2 flex flex-wrap gap-2">
        {uses.map(u => (
          <span key={u} className="bg-canvas-sunken text-ink-secondary rounded-control px-2 py-1 text-xs">
            {u}
          </span>
        ))}
      </div>

      {/*
        具体例。どちらを選ぶと何が変わるかは、言葉より並べた時刻のほうが早い。
        同じ日の違う時刻に始めた2人で、届く時刻がそろうか・ズレるかを見せる。
      */}
      <div className={`border-hairline rounded-card border p-4 ${mode === 'absolute_time' ? 'mt-0' : 'mt-2'}`}>
        <p className="text-ink-secondary text-xs">具体例：同じ日の違う時刻に購読開始した2人</p>
        {heads && (
          <div className={`${mode === 'absolute_time' ? 'mt-0' : 'mt-2'} flex gap-2 pl-[9.5rem]`}>
            {heads.map(h => (
              <span
                key={h}
                className="bg-accent-deep text-on-accent rounded-control flex-1 px-2 py-1 text-center text-xs font-bold"
              >
                {h}
              </span>
            ))}
          </div>
        )}
        <div className={mode === 'absolute_time' ? 'mt-0 space-y-0' : 'mt-1 space-y-1'}>
          {rows.map(r => (
            <div key={r.who} className="flex items-center gap-2">
              <div className="w-36 shrink-0">
                <p className="text-ink text-xs font-bold">{r.who}</p>
                <p className="text-ink-faint text-[11px]">{r.start}</p>
              </div>
              <Slot order="1通目" at={r.first} gap={r.gaps?.[0]} />
              <Slot order="2通目" at={r.second} gap={r.gaps?.[1]} />
            </div>
          ))}
        </div>
        <p className={`border-hairline text-ink-secondary rounded-control border px-3 py-2 text-xs leading-relaxed ${mode === 'absolute_time' ? 'mt-0' : 'mt-2'}`}>
          {result}
        </p>
        <p className={`text-ink-faint text-[11px] leading-relaxed ${mode === 'absolute_time' ? 'mt-0' : 'mt-1'}`}>※ {note}</p>
      </div>

    </label>
  )
}

function Slot({ order, at, gap }: { order: string; at: string; gap?: string }) {
  return (
    <div className="min-w-0 flex-1">
      {gap && (
        <p className="bg-info-bg text-info rounded-pill mb-1 px-2 py-0.5 text-center text-[10px]">
          {gap}
        </p>
      )}
      <div className="border-hairline rounded-control bg-canvas border px-2 py-1.5 text-center">
        <p className="text-ink-faint text-[10px]">{order}</p>
        <p className="text-ink text-xs font-bold">{at}</p>
      </div>
    </div>
  )
}
