'use client'

/*
 * ★V8 シナリオを作る①：シナリオ情報・配信方式（Pencil `dnzqC`）。
 *
 * 型（CreatePage）に、戻る・題・手順の輪と、左の段（シナリオ情報・配信方式）、
 * 下の帯（キャンセル・あとで決める・この方式で保存する）を渡す。右の列は無い。
 *
 * 動き（読み込み・保存・失敗時）は今までの V8（app/scenarios/mode-v8.tsx）と
 * v7（app/scenarios/mode/page.tsx）と同じ。写して型に載せ直した。
 * `id` なしで開いたときはまだ行を作らない。方式の確定か
 * 「あとで決める」ではじめて作成する（N-055）。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Check, Clock, Timer } from 'lucide-react'
import type { DeliveryMode, Folder, Scenario } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { CreatePage } from '@/components/templates'
import { Steps } from '@/components/templates/steps'
import { notifyToast } from '@/components/shared/toast'
import FolderSelect, { folderById, folderCreator } from '@/components/shared/folder-select'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Notice from '@/components/shared/notice'
import { browserDraftKey } from '@/v8/autosave/use-browser-draft'
import { BrowserDraftNotice, ScenarioDraftConflictNotice } from '@/v8/autosave/browser-draft-notice'
import {
  forgetNewScenarioDraftKey,
  newScenarioDraftKey,
  scenarioDraftKey,
  useScenarioDraft,
} from '@/v8/autosave/use-scenario-draft'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import { TextField } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { isForbiddenOrRateLimited, loadFailureCopy } from '@/components/shared/api-error-message'
import TargetMissing from '@/components/shared/target-missing'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import styles from './create.module.css'

/** 選んだ方式で、同じ日の違う時刻に始めた2人がいつ受け取るか（絵の見本）。 */
const EXAMPLES: Record<'absolute_time' | 'elapsed', { rows: Array<{ who: string; start: string; first: string; second: string }>; note: string }> = {
  absolute_time: {
    rows: [
      { who: '友だち A', start: '4/1 12:00 に開始', first: '1通目 4/1 15:00', second: '2通目 4/2 20:00' },
      { who: '友だち B', start: '4/1 14:00 に開始', first: '1通目 4/1 15:00', second: '2通目 4/2 20:00' },
    ],
    note: '時刻で指定は、2人とも同じ時刻に届きます',
  },
  elapsed: {
    rows: [
      { who: '友だち A', start: '4/1 12:00 に開始', first: '1通目 4/1 15:00', second: '2通目 4/2 20:00' },
      { who: '友だち B', start: '4/1 14:00 に開始', first: '1通目 4/1 17:00', second: '2通目 4/2 22:00' },
    ],
    note: '経過時間で指定は、始めた時刻が2時間遅い分、届く時刻も2時間うしろにずれます',
  },
}

export default function ScenarioCreateV8() {
  usePageTitle('シナリオを作成')
  usePageCrumbs([{ label: 'シナリオ配信', href: '/scenarios' }])
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()
  const role = useStaffRole()
  // 役割が読めるまでは出す（最後の守りはサーバー）。閲覧のみと分かったら作る操作を隠す。
  const canEdit = role === null || canManageRole(role)
  const [scenario, setScenario] = useState<Scenario | null>(null)
  // id なしは「これから作る」。読み込む行が無いので最初から入力できる。
  const [scenarioState, setScenarioState] = useState<'loading' | 'ready' | 'error'>(
    id ? 'loading' : 'ready',
  )
  const [scenarioError, setScenarioError] = useState<unknown>(null)
  const [scenarioReloadKey, setScenarioReloadKey] = useState(0)
  const [saving, setSaving] = useState<DeliveryMode | null>(null)
  // 絵どおり、はじめは「時刻で指定」（おすすめの方）を選んでおく。既存の行は保存済みの方式。
  const [selectedMode, setSelectedMode] = useState<DeliveryMode>('absolute_time')
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState('')
  const nameWrapRef = useRef<HTMLDivElement>(null)
  const [folders, setFolders] = useState<Folder[]>([])
  const [folderId, setFolderId] = useState('')
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [detailsSaving, setDetailsSaving] = useState(false)
  const detailsSavePromise = useRef<Promise<boolean> | null>(null)

  /**
   * 名前とフォルダを先に保存する。方式を選ぶ前に閉じても、分類は残る。
   * id なし（これから作る）のときは保存先が無いので、画面の中に持つだけ。
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
      setScenarioError(null)
      void scenarioReferenceData.scenario(id)
        .then((res) => {
          if (!active) return
          if (res.success) {
            setScenario(res.data)
            setName(res.data.name)
            setFolderId(res.data.folderId ?? '')
            if (res.data.deliveryMode === 'elapsed' || res.data.deliveryMode === 'absolute_time') {
              setSelectedMode(res.data.deliveryMode)
            }
            setScenarioState('ready')
          } else {
            setScenarioError(null)
            setScenarioState('error')
          }
        })
        .catch((caught) => {
          if (active) {
            setScenarioError(caught)
            setScenarioState('error')
          }
        })
    }
    return () => { active = false }
  }, [id, scenarioReloadKey])

  /*
   * フォルダはアカウント単位。シナリオの所属アカウント（共通なら選択中の
   * アカウント）の候補だけを出し、切り替わったら取り直す（SCENARIO-20）。
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

  /** 名前が空のまま押したら、欄の下にも理由を出して欄へ移す（R172）。止めたとき真。 */
  const rejectEmptyName = (): boolean => {
    if (name.trim()) return false
    // 上の帯には出さない：欄を赤くして欄の下に理由を出し、欄へ移す（2026-10-08 オーナー「重複している」）。
    setNameError('シナリオ名を入力してください')
    const input = nameWrapRef.current?.querySelector('input')
    if (input) {
      input.focus()
      input.scrollIntoView({ block: 'center' })
    }
    return true
  }

  /** 行をまだ作っていない（id なし）ときの作成。方式を確定したこの瞬間に初めて作る（N-055）。 */
  const createNew = async (mode: DeliveryMode): Promise<string | null> => {
    const trimmed = name.trim()
    if (!trimmed) {
      rejectEmptyName()
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
      // API の内部の文はそのまま出さない（画面は決まった言葉で断る）。
      setError('シナリオを作成できませんでした。時間をおいてもう一度お試しください。')
      return null
    }
    notifyToast('シナリオを作りました')
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
    setNameError('')
    const trimmed = name.trim()
    if (!trimmed) {
      rejectEmptyName()
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
        finishDraft()
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
      finishDraft()
      // 3段目へ。手順の帯が3段なので、2段で編集画面へ放り出さない。
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
      // 新規で「あとで決める」も行を作る確定操作。方式は暫定で「時刻で指定」。
      setDetailsSaving(true)
      setError('')
      setNameError('')
      try {
        const createdId = await createNew('absolute_time')
        if (createdId) {
          finishDraft()
          router.push(`/scenarios/first-step?id=${encodeURIComponent(createdId)}`)
        }
      } catch {
        // WEB226：通信の失敗（例外）も、方式を選んだときと同じ言葉で出す（黙って何も起きない、にしない）。
        setError('シナリオを作成できませんでした。時間をおいてもう一度お試しください。')
      } finally {
        setDetailsSaving(false)
      }
      return
    }
    const saved = await saveDetails()
    if (saved) {
      finishDraft()
      router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)
    } else if (!name.trim()) {
      rejectEmptyName()
    }
  }

  /*
   * 書きかけはシナリオの下書きの口（本物とは別の行・配信に使わない・30日で消える）へ残す。
   * 名前と方式を決めるまで本物のシナリオの行は作らない（N-055）。新規のキーは画面が作る UUID。
   */
  const draftAccountId = scenario?.lineAccountId ?? selectedAccountId
  const [newDraftKey, setNewDraftKey] = useState<string | null>(null)
  useEffect(() => {
    setNewDraftKey(!id && canEdit && selectedAccountId ? newScenarioDraftKey(selectedAccountId) : null)
  }, [id, canEdit, selectedAccountId])
  const browserDraft = useScenarioDraft({
    accountId: draftAccountId,
    draftKey: scenarioState === 'ready' && (!id || scenario)
      ? id ? scenarioDraftKey(id, 'info') : newDraftKey
      : null,
    // 共通（アカウントなし）のシナリオは本物に紐づけられないので、キーだけで置く。
    scenarioId: id && scenario?.lineAccountId ? id : null,
    legacyKey: browserDraftKey(['scenario-create', draftAccountId, id || 'new']),
    value: { name, folderId, mode: selectedMode },
    baseline: scenario
      ? {
          name: scenario.name,
          folderId: scenario.folderId ?? '',
          mode: scenario.deliveryMode === 'elapsed' ? 'elapsed' : 'absolute_time',
        }
      : { name: '', folderId: '', mode: 'absolute_time' },
    active: canEdit,
  })
  /** 本物を保存した・キャンセルした。下書きを消し、次の新規は新しいキーで始める。 */
  const finishDraft = () => {
    browserDraft.clear()
    if (!id) forgetNewScenarioDraftKey(selectedAccountId)
  }
  const cancel = () => {
    finishDraft()
    router.push('/scenarios')
  }
  const loadLatestDraft = () => {
    const latest = browserDraft.loadLatest()
    if (latest) applyDraft(latest)
  }
  const restoreBrowserDraft = () => {
    const stored = browserDraft.restore()
    if (stored) applyDraft(stored)
  }
  function applyDraft(stored: { name: string; folderId: string; mode: string }) {
    setName(stored.name)
    setFolderId(stored.folderId)
    if (stored.mode === 'elapsed' || stored.mode === 'absolute_time') setSelectedMode(stored.mode)
  }

  const selectedFolderName = folderState === 'loading'
    ? '読み込み中…'
    : folderState === 'error'
      ? '確認できません'
      : folders.find((folder) => folder.id === folderId)?.name
        ?? (folderId ? '名前を確認できません' : '未分類')
  const selectedFolderMissing = Boolean(folderId && !folders.some((folder) => folder.id === folderId))

  const locked = (Boolean(id) && !scenario) || detailsSaving || saving !== null
  const fieldsDisabled = locked || !canEdit
  const example = EXAMPLES[selectedMode === 'elapsed' ? 'elapsed' : 'absolute_time']
  const scenarioFailure = scenarioError ? loadFailureCopy(scenarioError, 'シナリオ') : null
  const useCommonReason = scenarioError ? isForbiddenOrRateLimited(scenarioError) : false

  return (
    <CreatePage
      boardId="dnzqC"
      title="シナリオを作る"
      identity={<Link href="/scenarios" className={styles.backLink}>← シナリオ配信へ</Link>}
      steps={(
        <Steps
          label="シナリオ作成の進み方"
          steps={[
            // 既存の下書き（id あり）は1段目が済んでいる。新規は名前を入れたら済み。
            { label: 'シナリオ情報', state: id || name.trim() ? 'done' : 'current', anchor: 'scenario-step-info' },
            { label: '配信方式', state: 'current' },
            { label: '1通目を設定', state: 'todo' },
          ]}
        />
      )}
      status={saving ? '作成しています' : detailsSaving ? '保存しています' : browserDraft.label ?? undefined}
      footerActions={(
        <>
          <Button type="button" onClick={cancel}>キャンセル</Button>
          {canEdit ? (
            <>
              <Button disabled={locked} onClick={() => void continueAsDraft()}>
                あとで決める（下書きとして保存）
              </Button>
              <Button
                variant="primary"
                disabled={locked}
                onClick={() => void choose(selectedMode)}
                busy={saving !== null}
                busyLabel="作成中…"
              >
                <Check size={15} aria-hidden="true" />この方式で保存する
              </Button>
            </>
          ) : null}
        </>
      )}
    >
      <div className={styles.notices} data-list-state={scenarioState} aria-busy={scenarioState === 'loading'}>
        {!canEdit ? (
          <p className={styles.viewerBand} role="status">閲覧のみで見ています。シナリオを作る操作は管理者に頼んでください。</p>
        ) : null}
        {scenarioState === 'loading' ? <Notice tone="info">シナリオを読み込んでいます。</Notice> : null}
        {scenarioState === 'ready' && scenario ? (
          <Notice tone="info">「{scenario.name}」の下書きを作りました。続けて配信方式を選んでください。</Notice>
        ) : null}
        {/* id なしはまだ作っていない。確定するまで行は作らない（N-055）。 */}
        {!id ? (
          <Notice tone="info">シナリオ名と配信方式を決めると作られます。途中で閉じても一覧には残りません。</Notice>
        ) : null}
        {/* id ありの読み込み失敗は読み直し口つきの1枚。403・429 だけ共通の理由に切り替える。 */}
        {id && scenarioState === 'error' ? (
          <TargetMissing
            kind="error"
            title={useCommonReason && scenarioFailure ? scenarioFailure.title : 'シナリオを読み込めませんでした'}
            description={
              useCommonReason && scenarioFailure
                ? `配信方式の選択・保存はできません。${scenarioFailure.description}`
                : '配信方式の選択・保存はできません。通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。'
            }
            error={scenarioError ?? undefined}
            onRetry={() => setScenarioReloadKey((key) => key + 1)}
          />
        ) : null}
        {error ? <Notice tone="danger" message={error} onClose={() => setError('')} /> : null}
        <BrowserDraftNotice ago={browserDraft.pendingAgo} onRestore={restoreBrowserDraft} onDiscard={browserDraft.clear} />
        <ScenarioDraftConflictNotice ago={browserDraft.conflictAgo} onLoadLatest={loadLatestDraft} onOverwrite={browserDraft.overwrite} />
      </div>

      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="シナリオ情報" id="scenario-step-info">
        <h2 className={styles.cardTitle}>シナリオ情報</h2>
        <div className={styles.infoRow}>
          <div className={styles.nameField} ref={nameWrapRef}>
            <span className={styles.fieldLabel}>シナリオ名 <RequiredBadge /></span>
            <TextField
              value={name}
              disabled={fieldsDisabled}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError('') }}
              onBlur={() => void saveDetails()}
              placeholder="例: 友だち追加ウェルカム"
              invalid={Boolean(nameError)}
              aria-label="シナリオ名"
              aria-describedby={nameError ? 'scenario-name-error' : undefined}
            />
            {nameError ? <span id="scenario-name-error" className={styles.fieldError}>{nameError}</span> : null}
          </div>
          <div className={styles.folderField}>
            <span className={styles.fieldLabelStrong}>フォルダ</span>
            <span title={selectedFolderName} className={styles.folderSelect}>
              <FolderSelect
                value={folderId}
                disabled={fieldsDisabled || folderState !== 'ready'}
                onChange={(value) => {
                  setFolderId(value)
                  void saveDetails(value)
                }}
                aria-label="シナリオのフォルダ"
                size="full"
                folders={[
                  ...(selectedFolderMissing ? [{ value: folderId, label: '名前を確認できません' }] : []),
                  ...folders.map(folderById),
                ]}
                // 一覧の左の列の「フォルダを追加」と同じ口（シナリオのフォルダは共有）。
                onCreate={canEdit && !locked
                  ? folderCreator((name, color) => api.folders.create({ kind: 'scenario', name, color }), folderById, (created) => setFolders((current) => [...current, created]))
                  : undefined}
              />
            </span>
            {folderState !== 'ready' || detailsSaving ? (
              <span className={styles.fieldHint}>
                {folderState === 'loading'
                  ? 'フォルダを読み込んでいます。'
                  : folderState === 'error'
                    ? 'フォルダを確認できないため、いまは変更できません。'
                    : 'フォルダを保存しています。'}
              </span>
            ) : null}
            {/* 保存済みのフォルダがこのアカウントの候補に無いときは理由を出す（黙って未分類に見せない）。 */}
            {folderState === 'ready' && selectedFolderMissing ? (
              <span className={styles.fieldWarn}>
                選択中のフォルダはこのアカウントの候補にありません（別アカウントまたは削除済み）。このまま保存すると外れます。
              </span>
            ) : null}
          </div>
        </div>
      </Card>

      <Card padding="roomy" layout="vertical" className={styles.card} aria-label="配信方式">
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>配信方式</h2>
          <p className={styles.cardDesc}>作ったあとは変えられません</p>
        </div>
        <RadioCardGroup legend="配信方式" className={styles.modeRow}>
          <RadioCard
            name="delivery-mode"
            value="absolute_time"
            checked={selectedMode === 'absolute_time'}
            onChange={() => setSelectedMode('absolute_time')}
            disabled={fieldsDisabled}
            icon={<Clock size={16} aria-hidden="true" />}
            title="時刻で指定"
            note="「購読開始から○日後の○時」。メルマガ・定期リマインド・朝夜の固定配信に"
            className={styles.modeCard}
          />
          <RadioCard
            name="delivery-mode"
            value="elapsed"
            checked={selectedMode === 'elapsed'}
            onChange={() => setSelectedMode('elapsed')}
            disabled={fieldsDisabled}
            icon={<Timer size={16} aria-hidden="true" />}
            title="経過時間で指定"
            note="「購読開始から○時間○分後」。買った直後・予約の直後のフォローに"
            className={styles.modeCard}
          />
        </RadioCardGroup>
        <div className={styles.example}>
          <p className={styles.exampleTitle}>見本：同じ日の違う時刻に購読を始めた 2 人（1通目＝当日 15:00、2通目＝翌日 20:00）</p>
          {example.rows.map((row) => (
            <div key={row.who} className={styles.exampleRow}>
              <span className={styles.exampleWho}>{row.who}</span>
              <span className={styles.exampleStart}>{row.start}</span>
              <span className={styles.exampleAt}>{row.first}</span>
              <span className={styles.exampleAt}>{row.second}</span>
            </div>
          ))}
          <p className={styles.exampleNote}>{example.note}</p>
        </div>
      </Card>
    </CreatePage>
  )
}

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
