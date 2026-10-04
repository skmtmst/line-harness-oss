'use client'

/*
 * ★V8 シナリオを作る①：シナリオ情報・配信方式（Pencil `dnzqC`）。
 *
 * v7（mode/page.tsx の ScenarioModePageV7）と動きは同じ。変えるのは置き場だけ：
 * 手順の帯は見出しの下、操作は追従バーの真ん中
 * （キャンセル・あとで決める・この方式で保存する。オーナー決定 2026-10-01）。
 *
 * `id` なしで開いたときはまだ行を作らない。方式の確定か
 * 「あとで決める」ではじめて作成する（#949 N-055）。
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { DeliveryMode, Folder, Scenario } from '@line-crm/shared'
import { ApiError, api } from '@/lib/api'
import { notifyToast } from '@/components/shared/toast'
import Select from '@/components/shared/select'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import Stepper from '@/components/shared/stepper'
import StickyBar from '@/components/shared/sticky-bar'
import { TextField } from '@/components/shared/text-field'
import { RequiredBadge } from '@/components/shared/form-controls'
import { isForbiddenOrRateLimited, loadFailureCopy } from '@/components/shared/api-error-message'
import TargetMissing from '@/components/shared/target-missing'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { useAccount } from '@/contexts/account-context'
import { scenarioReferenceData } from '@/components/scenarios/scenario-reference-data'
import styles from './mode-v8.module.css'

export default function ScenarioModeV8() {
  usePageTitle('シナリオを作成')
  usePageCrumbs([{ label: 'シナリオ配信', href: '/scenarios' }])
  const router = useRouter()
  const params = useSearchParams()
  const id = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()
  const [scenario, setScenario] = useState<Scenario | null>(null)
  // id なしは「これから作る」。読み込む行が無いので最初から入力できる。
  const [scenarioState, setScenarioState] = useState<'loading' | 'ready' | 'error'>(
    id ? 'loading' : 'ready',
  )
  const [scenarioError, setScenarioError] = useState<unknown>(null)
  const [scenarioReloadKey, setScenarioReloadKey] = useState(0)
  const [saving, setSaving] = useState<DeliveryMode | null>(null)
  const [selectedMode, setSelectedMode] = useState<DeliveryMode | null>(null)
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
      setScenarioError(null)
      void scenarioReferenceData.scenario(id)
        .then((res) => {
          if (!active) return
          if (res.success) {
            setScenario(res.data)
            setName(res.data.name)
            setFolderId(res.data.folderId ?? '')
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
   * R172: 名前空欄の必須エラーは画面上方の帯だけに出すと、スマホでは
   * 画面外（約844px上）になり押した理由が見えない。該当欄の下にも
   * 短い案内を出し、入力欄へフォーカスとスクロールを移す。
   * 戻り値は「空欄で止めたか」。止めたとき真。
   */
  const rejectEmptyName = (): boolean => {
    if (name.trim()) return false
    setError('シナリオ名を入力してください')
    setNameError('シナリオ名を入力してください')
    const input = nameWrapRef.current?.querySelector('input')
    if (input) {
      input.focus()
      input.scrollIntoView({ block: 'center' })
    }
    return true
  }

  /**
   * 行をまだ作っていない（id なし）ときの作成。方式を確定したこの瞬間に
   * 初めて作るので、途中で閉じても空の行は残らない（#949 N-055）。
   */
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
      // APIの内部エラー文はそのまま出さない（画面は決まった言葉で断る）。
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
      setNameError('')
      try {
        const createdId = await createNew('absolute_time')
        if (createdId) router.push(`/scenarios/first-step?id=${encodeURIComponent(createdId)}`)
      } finally {
        setDetailsSaving(false)
      }
      return
    }
    const saved = await saveDetails()
    if (saved) {
      router.push(`/scenarios/first-step?id=${encodeURIComponent(id)}`)
    } else if (!name.trim()) {
      // R172: 名前を消して下書き保存を押しても何も起きないままにしない。
      rejectEmptyName()
    }
  }

  const selectedFolderName = folderState === 'loading'
    ? '読み込み中…'
    : folderState === 'error'
      ? '確認できません'
      : folders.find((folder) => folder.id === folderId)?.name
        ?? (folderId ? '名前を確認できません' : '未分類')
  const selectedFolderMissing = Boolean(folderId && !folders.some((folder) => folder.id === folderId))

  const disabled = (Boolean(id) && !scenario) || detailsSaving || saving !== null

  return (
    <div className={styles.board} data-design-node="dnzqC" data-list-state={scenarioState} aria-busy={scenarioState === 'loading'}>
      <div className={styles.head} data-design="Head">
        <div>
          <h2 className={styles.headTitle}>{id ? '配信方式を変える' : 'シナリオを作る'}</h2>
          <p className={styles.headDescription}>
            シナリオの名前と、メッセージを届ける時間の決め方を選びます。
          </p>
        </div>
      </div>

      <Stepper
        label="シナリオ作成の進み方"
        steps={[
          // id なし（新規）は名前と方式をこの画面でまとめて決めるので1段目は current。
          // id あり（既存の下書きを開いた）は1段目は済んでいる（#949 N-055）。
          { label: 'シナリオ情報', state: id ? 'done' : 'current' },
          { label: '配信方式', state: 'current' },
          { label: '1通目を設定', state: 'todo' },
        ]}
      />

      <div data-design="Notice" className="space-y-2">
        {scenarioState === 'loading' && (
          <Notice tone="info">
            シナリオを読み込んでいます。
          </Notice>
        )}
        {scenarioState === 'ready' && scenario && (
          <Notice tone="success">
            「{scenario.name}」の下書きを作成しました。続けて配信方式を選んでください。
          </Notice>
        )}
        {/* id なしはまだ作っていない。確定するまで行は作らない（#949 N-055）。 */}
        {!id && (
          <Notice tone="info">
            シナリオ名と配信方式を決めると作成されます。途中で閉じても一覧には残りません。
          </Notice>
        )}
        {/* D023: id ありの読み込み失敗は読み直し口つきの1枚にする。
            403・429だけ共通理由へ切り替える（保存不可文は残し両立。再試行の
            有無は `loadFailureCopy` が決める）。それ以外は画面の文のまま。 */}
        {(() => {
          const scenarioFailure = scenarioError ? loadFailureCopy(scenarioError, 'シナリオ') : null
          const useCommonReason = scenarioError ? isForbiddenOrRateLimited(scenarioError) : false
          return id && scenarioState === 'error' ? (
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
          ) : null
        })()}
        {error && <Notice tone="danger" message={error} />}
      </div>

      <section className={styles.section} data-design="Name">
        <h3 className={styles.sectionTitle}>シナリオ情報</h3>
        <div className={styles.sectionBody}>
          <div className={styles.field} ref={nameWrapRef}>
            <span className={styles.fieldLabel}>シナリオ名 <RequiredBadge /></span>
            <TextField
              value={name}
              disabled={disabled}
              onChange={(e) => { setName(e.target.value); if (nameError) setNameError('') }}
              onBlur={() => void saveDetails()}
              placeholder="例: 友だち追加ウェルカム"
              invalid={Boolean(nameError)}
              aria-describedby={nameError ? 'scenario-name-error' : undefined}
            />
            {nameError ? (
              <span id="scenario-name-error" className={styles.fieldError}>
                {nameError}
              </span>
            ) : null}
          </div>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>フォルダ</span>
            <span title={selectedFolderName} className="block">
              <Select
                value={folderId}
                disabled={(Boolean(id) && !scenario) || folderState !== 'ready' || detailsSaving || saving !== null}
                onChange={(value) => {
                  const nextFolderId = value
                  setFolderId(nextFolderId)
                  void saveDetails(nextFolderId)
                }}
                aria-label="シナリオのフォルダ"
                size="full"
                options={[
                  { value: '', label: '未分類' },
                  ...(selectedFolderMissing ? [{ value: folderId, label: '名前を確認できません' }] : []),
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                ]}
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
            {/*
              SCENARIO-20: 保存済みのフォルダがこのアカウントの候補に無い
              場合は理由を示す。黙って「未分類」に見せると、保存時に
              別範囲の値を上書きしてしまう。
            */}
            {folderState === 'ready' && selectedFolderMissing ? (
              <span className={styles.fieldHint} style={{ color: 'var(--color-warning)' }}>
                選択中のフォルダはこのアカウントの候補にありません（別アカウントまたは削除済み）。このまま保存すると外れます。
              </span>
            ) : null}
          </div>
        </div>
      </section>

      <fieldset className={styles.section} data-design="Choices" style={{ border: '1px solid var(--color-hairline)' }}>
        <legend className="sr-only">配信方式</legend>
        <h3 className={styles.sectionTitle}>配信方式</h3>
        <p className={styles.sectionDesc}>
          届ける時間の決め方を選びます。どちらを選んでも、作成後にメッセージの追加・並べ替えができます。
        </p>
        <div className={styles.sectionBody}>
          <div className={styles.modeGrid}>
            <ModeCardV8
              mode="absolute_time"
              selected={selectedMode === 'absolute_time'}
              onSelect={setSelectedMode}
              title="時刻で指定"
              lead="配信時刻がそろうため、開封されやすい時間帯に寄せられます。「購読開始から〇日後の〇時」と指定します。"
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
            <ModeCardV8
              mode="elapsed"
              title="経過時間で指定"
              lead="友だち追加の時刻を起点にするため、一人ひとりに同じ体験を届けられます。「購読開始から〇日と〇時間後」と指定します。"
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
        </div>
      </fieldset>

      <StickyBar
        status={saving ? '作成しています' : detailsSaving ? '保存しています' : undefined}
        actions={(
          <>
            <Button href="/scenarios">キャンセル</Button>
            <Button
              variant="secondary"
              disabled={disabled}
              onClick={() => void continueAsDraft()}
            >
              あとで決める（下書きとして保存）
            </Button>
            <Button
              variant="primary"
              disabled={!selectedMode || disabled}
              onClick={() => { if (selectedMode) void choose(selectedMode) }} busy={saving !== null} busyLabel="作成中…">
              {id ? 'この方式で保存する' : 'この方式で作る'}
            </Button>
          </>
        )}
      />
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

/**
 * ★V8 配信方式のカード。カード全体を選ぶラジオ選択（本物の
 * input[type=radio]）。確定は追従バーの主ボタンにまとめる（★V7 と同じ決まり）。
 */
function ModeCardV8({
  mode,
  selected,
  onSelect,
  title,
  lead,
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
  lead: string
  uses: string[]
  rows: Array<{ who: string; start: string; first: string; second: string; gaps?: string[] }>
  heads?: string[]
  result: string
  note: string
  disabled: boolean
}) {
  return (
    <label className={`${styles.modeCard} ${selected ? styles.modeCardOn : ''}`}>
      <input
        type="radio"
        name="delivery-mode"
        value={mode}
        checked={selected}
        disabled={disabled}
        onChange={() => onSelect(mode)}
        className="sr-only"
      />
      <div className={styles.modeHead}>
        {/* 絵文字は使わない。線の記号にする。 */}
        <span className={styles.modeIcon} aria-hidden="true">
          <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="9" />
            {mode === 'absolute_time' ? (
              <path strokeLinecap="round" d="M12 7v5l3 2" />
            ) : (
              <path strokeLinecap="round" d="M12 8v4M9 3h6" />
            )}
          </svg>
        </span>
        <h4 className={styles.modeTitle}>{title}</h4>
      </div>
      <p className={styles.modeLead}>{lead}</p>
      <ul className={styles.modeUses} aria-label="向いている使い方">
        {uses.map((use) => <li key={use} className={styles.modeUse}>{use}</li>)}
      </ul>
      <div>
        <p className={styles.exampleTitle}>具体例：同じ日の違う時刻に購読開始した2人</p>
        <table className={styles.exampleTable}>
          <thead>
            <tr>
              <th scope="col" />
              <th scope="col">1通目{heads?.[0] ? `（${heads[0]}）` : ''}</th>
              <th scope="col">2通目{heads?.[1] ? `（${heads[1]}）` : ''}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.who}>
                <td>{row.who}<br /><span className={styles.fieldHint}>{row.start}</span></td>
                <td>{row.first}{row.gaps?.[0] ? `（${row.gaps[0]}）` : ''}</td>
                <td>{row.second}{row.gaps?.[1] ? `（${row.gaps[1]}）` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.modeResult}>{result}</p>
      <p className={styles.modeNote}>{note}</p>
    </label>
  )
}
