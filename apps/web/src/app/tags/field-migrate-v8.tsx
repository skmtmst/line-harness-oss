'use client'

/*
 * ★V8 友だち情報欄を移行（Pencil `GobMd`）。
 *
 * v7（tags/fields/migrate/page.tsx）と動きは同じで、置き場だけを
 * V8 の絵へ合わせる。注意の帯 → 元→先の比較 → 値がどう移るかの
 * 事前確認 → 切り替わる使用先 → 移行の結果。追従バーは
 * キャンセル・事前確認・実行を真ん中に置く（オーナー決定 2026-10-01）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FriendField, FriendFieldType } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import ListState from '@/components/shared/list-state'
import StickyBar from '@/components/shared/sticky-bar'
import TargetMissing from '@/components/shared/target-missing'
import Select from '@/components/shared/select'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import type { FriendFieldMigrationPreview, FriendFieldMigrationRun } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'
import { formatDateTime } from '@/lib/format'
import styles from './field-migrate-v8.module.css'

const TYPES = Object.keys(FIELD_TYPE_LABELS) as FriendFieldType[]

/** 移行実行の状態を画面の言葉へ。APIの内部名はそのまま出さない。 */
const RUN_STATUS_LABELS: Record<FriendFieldMigrationRun['status'], string> = {
  previewed: '事前確認済み',
  queued: '実行待ち',
  running: '実行中',
  partial: '一部の友だちだけ移行できました',
  succeeded: '移行が完了しました',
  failed: '移行に失敗しました',
  stale: '確認後に内容が変わったため停止しました',
}

const RUN_RUNNING = new Set<FriendFieldMigrationRun['status']>(['previewed', 'queued', 'running'])

function FieldSummary({ title, field, kind }: { title: string; field: FriendField; kind: 'source' | 'target' }) {
  return (
    <section className={`${styles.fieldCard} ${kind === 'target' ? styles.fieldCardTarget : ''}`}>
      <p className={styles.fieldCardLabel}>{title}</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={styles.fieldCardName}>{field.name}</h2>
          <p className={styles.fieldCardKey}>{`{{field.${field.fieldKey}}}`}</p>
        </div>
        <span className={`${styles.typeBadge} ${kind === 'target' ? styles.typeBadgeTarget : ''}`}>
          {FIELD_TYPE_LABELS[field.type]}
        </span>
      </div>
    </section>
  )
}

export default function FieldMigrateV8() {
  usePageTitle('友だち情報欄を移行')
  usePageCrumbs([{ label: 'ホーム', href: '/' }, { label: '友だち属性', href: '/tags' }, { label: '友だち情報欄', href: '/tags?tab=fields' }])
  const params = useSearchParams()
  const sourceId = params.get('id') ?? ''
  const { selectedAccountId } = useAccount()
  const [fields, setFields] = useState<FriendField[]>([])
  const [targetMode, setTargetMode] = useState<'new' | 'existing'>('new')
  const [targetName, setTargetName] = useState('')
  const [targetKey, setTargetKey] = useState('')
  const [targetType, setTargetType] = useState<FriendFieldType>('text')
  const [existingTargetId, setExistingTargetId] = useState('')
  /** 新規モードで作成済みの移行先。作ったあとは入力ではなくこの実体を使う。 */
  const [createdTarget, setCreatedTarget] = useState<FriendField | null>(null)
  const [preview, setPreview] = useState<FriendFieldMigrationPreview | null>(null)
  /** 実行は確認と同じ証票で1回だけ。確認が成立した時点で発行する。 */
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null)
  const [run, setRun] = useState<FriendFieldMigrationRun | null>(null)
  /*
   * R548: 実行POSTを受け付けたrun。結果がまだ無くても「移行を実行する」
   * には戻さない（同じ実行の再取得・再開で続ける）。
   */
  const [executedRunId, setExecutedRunId] = useState<string | null>(null)
  /** 結果の取得に失敗・停滞したときの説明。再取得・再開の入口と一緒に出す。 */
  const [pollProblem, setPollProblem] = useState('')
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')
  /*
    ATTR-11: 一覧の取得失敗は「移行元が見つかりません」とは別の状態。
    読み込みに失敗しただけで項目が消えたわけではないので、
    再試行できる失敗として出す。
  */
  const [loadError, setLoadError] = useState('')
  /** 権限なしの失敗（見ること自体ができない）。通信の失敗とは分ける。 */
  const [loadForbidden, setLoadForbidden] = useState(false)

  /*
    ATTR-10: 確認中に種類・名前・移行先を変えても、古い確認結果が
    新しい条件の下に表示されてはいけない。要求世代で照合し、
    入力が変わった時点で飛んでいる確認を無効にする。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [reloadTick, setReloadTick] = useState(0)
  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    setLoadError('')
    setLoadForbidden(false)
    void api.friendFields.list(selectedAccountId, { withUsage: true })
      .then((res) => {
        if (!active) return
        if (!res.success) throw new ApiError(0, res.error, 'load_failed')
        setFields(res.data)
        const source = res.data.find((item) => item.id === sourceId)
        if (source) {
          setTargetName(`${source.name}（新）`)
          setTargetKey(`${source.fieldKey}_new`.slice(0, 32))
          setTargetType(source.type)
        }
      })
      .catch((reason) => {
        // ATTR-11: 失敗は loadError へ。項目未発見（!source）と混ぜない。
        if (!active) return
        if (reason instanceof ApiError && reason.status === 403) {
          setLoadError('友だち情報欄を見る権限がありません。オーナーか管理者に確認してください。')
          setLoadForbidden(true)
        } else {
          setLoadError('項目を読み込めませんでした')
        }
      })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedAccountId, sourceId, reloadTick])

  /*
    アカウント・移行元が変わったら、確認結果・実行状態・作った項目の
    選択をすべて捨てる。前のアカウントの実行状況が残ると、いまの
    アカウントで起きていない移行が「完了」と見える。
  */
  /*
   * R519: 同じ移行先の作り直しは同じ要求キーで送る。入力を変えたら
   * 新しいキーにする（同じキーに異なる内容はサーバが409で止める）。
   */
  const createKeyRef = useRef<string>(crypto.randomUUID())
  useEffect(() => {
    createKeyRef.current = crypto.randomUUID()
  }, [targetName, targetKey, targetType])

  useEffect(() => {
    gateRef.current.invalidate()
    setPreview(null)
    setIdempotencyKey(null)
    setRun(null)
    setExecutedRunId(null)
    setPollProblem('')
    setCreatedTarget(null)
    createKeyRef.current = crypto.randomUUID()
    /*
      TECH-07: 飛んでいる確認・実行を捨てたら、ボタンの「確認中…
      実行中…」も捨てる。世代を止めてもフラグが残ると、
      いつまでも押せない画面になる。
    */
    setChecking(false)
    setExecuting(false)
    if (pollTimerRef.current) { clearTimeout(pollTimerRef.current); pollTimerRef.current = null }
  }, [selectedAccountId, sourceId])

  const source = useMemo(() => fields.find((item) => item.id === sourceId) ?? null, [fields, sourceId])
  const existingTarget = useMemo(
    () => fields.find((item) => item.id === existingTargetId) ?? null,
    [fields, existingTargetId],
  )
  const target: FriendField | null = targetMode === 'existing' ? existingTarget : createdTarget

  /** 対象の入力を変えたら、確認結果は今の条件のものではなくなる。 */
  const resetConfirmation = () => {
    gateRef.current.invalidate()
    setPreview(null)
    setIdempotencyKey(null)
    setRun(null)
    setExecutedRunId(null)
    setPollProblem('')
  }

  /*
   * R519: 移行先を作るか、作り済みを取り直す。
   *
   * 応答だけ失った再試行は同じ要求キーで送るため、サーバは保存済みを
   * 返す。要求キーが変わった後の差し込み名の重複では、作成済みを
   * 取り直して比べる。同一内容ならその移行先で事前確認を続け、
   * 異なる内容なら衝突として説明する。
   */
  const createTargetOrRecover = async (account: string, token: number): Promise<FriendField | null> => {
    if (!source) return null
    const params = {
      name: targetName.trim() || `${source.name}（新）`,
      fieldKey: targetKey.trim() || `${source.fieldKey}_new`.slice(0, 32),
      type: targetType,
    }
    try {
      const created = await api.friendFields.create(account, params, createKeyRef.current)
      if (!created.success) throw new Error(created.error)
      if (!gateRef.current.current(token) || accountRef.current !== account) return null
      setCreatedTarget(created.data)
      setFields((current) => (current.some((item) => item.id === created.data.id) ? current : [...current, created.data]))
      return created.data
    } catch (reason) {
      try {
        const res = await api.friendFields.list(account)
        if (res.success) {
          const existing = res.data.find((item) => item.fieldKey === params.fieldKey) ?? null
          if (existing && existing.name === params.name && existing.type === params.type) {
            if (!gateRef.current.current(token) || accountRef.current !== account) return null
            setCreatedTarget(existing)
            setFields((current) => (current.some((item) => item.id === existing.id) ? current : [...current, existing]))
            return existing
          }
        }
      } catch { /* 取り直せないときは下の説明へ */ }
      if (!gateRef.current.current(token) || accountRef.current !== account) return null
      const status = (reason as { status?: number } | null)?.status
      if (status === 409) {
        setError(`同じ差し込み名「${params.fieldKey}」の別の項目があります。一覧を確認してください`)
      } else {
        setError(describeSaveFailure(reason))
      }
      return null
    }
  }

  const runPreview = async () => {
    if (!source || !selectedAccountId || checking) return
    setChecking(true); setError(''); setPreview(null); setRun(null)
    // 確認のやり直しは新しい出発にする。実行中の見守りは捨てる。
    setExecutedRunId(null); setPollProblem('')
    const token = gateRef.current.begin()
    const account = selectedAccountId
    try {
      let targetField = target
      // 新規モードでは、実行できる確認（期限付き証票）に項目の実体が要るので先に作る。
      if (!targetField && targetMode === 'new') {
        targetField = await createTargetOrRecover(account, token)
        if (!targetField) return
      }
      if (!targetField) {
        setError('移行先の項目を選んでください')
        return
      }
      const res = await api.friendFields.migrationPreview(source.id, account, { targetFieldId: targetField.id })
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setPreview(res.data)
      setIdempotencyKey(crypto.randomUUID())
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setError(reason instanceof ApiError ? reason.message : '事前確認を実行できませんでした')
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setChecking(false)
    }
  }

  /*
   * R548: 結果の取得失敗は黙殺しない。実行そのものは壊さないが、
   * 失敗をはっきり出し、同じrunの再取得・再開へつなげる。
   * R547: 上限で止まったまま「実行中」にしない。理由と入口を出す。
   */
  const pollRun = (runId: string, account: string, token: number, attempt: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = setTimeout(() => {
      void api.friendFields.migrationRun(runId, account)
        .then((res) => {
          if (!gateRef.current.current(token) || accountRef.current !== account) return
          if (res.success) {
            setRun(res.data)
            if (RUN_RUNNING.has(res.data.status)) {
              if (attempt < 20) {
                pollRun(runId, account, token, attempt + 1)
              } else {
                setPollProblem('まだ実行中です。結果の再取得か、止まっている場合の再開ができます。')
              }
            } else {
              setPollProblem('')
            }
          }
        })
        .catch(() => {
          if (!gateRef.current.current(token) || accountRef.current !== account) return
          setPollProblem('移行の結果を確認できませんでした。通信を確かめて、結果を確認し直してください。')
        })
    }, attempt === 0 ? 0 : 2000)
  }

  const execute = async () => {
    if (!source || !selectedAccountId || !preview?.previewToken || !idempotencyKey || executing) return
    setExecuting(true); setError(''); setPollProblem('')
    const token = gateRef.current.begin()
    const account = selectedAccountId
    try {
      const res = await api.friendFields.migrationExecute(source.id, account, preview.previewToken, idempotencyKey)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setExecutedRunId(res.data.runId)
      pollRun(res.data.runId, account, token, 0)
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setError(reason instanceof ApiError ? reason.message : '移行を開始できませんでした。事前確認からやり直してください。')
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setExecuting(false)
    }
  }

  /** R548: 同じrunの結果を取り直す。完了していれば結果へ戻れる。 */
  const refetchRun = () => {
    if (!selectedAccountId || !executedRunId || executing) return
    setPollProblem('')
    pollRun(executedRunId, selectedAccountId, gateRef.current.begin(), 0)
  }

  /*
   * R547: 止まった実行を続きから再開する。新しい要求キーで送るため、
   * サーバは受け付け済みの実行を再開する（D036）。終わっている実行の
   * 再開は409になるので、そのときは結果を取り直して見せる。
   */
  const resume = async () => {
    if (!source || !selectedAccountId || !preview?.previewToken || !executedRunId || executing) return
    setExecuting(true); setError(''); setPollProblem('')
    const token = gateRef.current.begin()
    const account = selectedAccountId
    try {
      const res = await api.friendFields.migrationExecute(source.id, account, preview.previewToken, crypto.randomUUID())
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      setExecutedRunId(res.data.runId)
      pollRun(res.data.runId, account, token, 0)
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      try {
        const current = await api.friendFields.migrationRun(executedRunId, account)
        if (!gateRef.current.current(token) || accountRef.current !== account) return
        if (current.success) {
          setRun(current.data)
          setPollProblem('')
          return
        }
      } catch { /* 下の説明へ */ }
      setError(reason instanceof ApiError ? reason.message : '移行を再開できませんでした。事前確認からやり直してください。')
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setExecuting(false)
    }
  }

  useEffect(() => () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }, [])

  if (loading) return <ListState kind="loading" description="友だち情報欄を読み込んでいます" />
  /*
    U097: 「一覧から選び直してください」と言うだけの画面に、実際に
    戻れる操作を置く。直リンク・履歴なしでも画面内だけで復帰できる。
  */
  if (!sourceId) {
    return (
      <TargetMissing
        kind="unspecified"
        title="移行する項目が指定されていません"
        description="一覧から移行する項目を選び直してください。"
        backHref="/tags?tab=fields"
        backLabel="友だち情報欄の一覧へ戻る"
      />
    )
  }
  if (!selectedAccountId) return (
    <Notice tone="warn" action={<Button href="/tags?tab=fields">友だち情報欄の一覧へ戻る</Button>}>
      LINE公式アカウントを選んでください。
    </Notice>
  )
  /*
    ATTR-11: 「読み込めなかった」と「移行元が無い」を分ける。
    通信失敗は再試行でき、項目が本当に無い（消された・URLが古い）
    ときだけ一覧へ戻す導線を出す。
  */
  if (loadForbidden) {
    return (
      <ListState
        kind="forbidden"
        title="友だち情報欄を見る権限がありません"
        description="オーナーか管理者に確認してください。"
        action={<Button href="/tags?tab=fields">友だち情報欄の一覧へ戻る</Button>}
      />
    )
  }
  if (loadError) return (
    <TargetMissing
      kind="error"
      title="項目を読み込めませんでした"
      description="通信が切れたか、サーバが応えませんでした。しばらくしてから、もう一度読み込んでください。"
      onRetry={() => setReloadTick((tick) => tick + 1)}
    />
  )
  if (!source) return (
    <TargetMissing
      kind="not-found"
      title="移行元の項目が見つかりません"
      description="削除されたか、リンクが古くなっています。友だち情報欄の一覧から選び直してください。"
      backHref="/tags?tab=fields"
      backLabel="友だち情報欄の一覧へ戻る"
    />
  )

  const confirmed = Boolean(preview?.previewToken)
  const running = executing || (run ? RUN_RUNNING.has(run.status) : false)
  /*
   * R547・R548: 取得の失敗・停滞で人の手が必要なときだけ、同じrunの
   * 再取得・再開を出す。見守りの最中は何も出さない。
   */
  const needsPollAction = executedRunId !== null && !executing && pollProblem !== ''
    && (!run || RUN_RUNNING.has(run.status))
  const pollAttention = pollProblem !== '' && (!run || RUN_RUNNING.has(run.status))

  return (
    <div className={styles.board}>
      <div className={styles.head} data-design="Head">
        <div>
          <h2 className={styles.headTitle}>項目を移行</h2>
          <p className={styles.headDescription}>いま使っている項目の値を、別の項目へ移します。</p>
        </div>
      </div>

      {/* ★V8: 注意の帯。事前確認では何も変えず、実行のときだけ書き込む。 */}
      <Notice tone="warn">
        事前確認では値を1件も変更しません。移せる数と切り替わる使用先を確かめてから、「移行を実行する」を押した時だけ書き込みます。
      </Notice>
      {error ? <Notice tone="danger" message={error} /> : null}

      <div data-design="Fields" className={styles.fieldsGrid}>
        <FieldSummary title="いま使っている項目" field={source} kind="source" />
        <div className={styles.arrowCell} aria-hidden="true">
          <span className={styles.arrowY}>↓</span>
          <span className={styles.arrowX}>→</span>
        </div>
        <section className={`${styles.fieldCard} ${styles.fieldCardTarget}`}>
          <p className={styles.fieldCardLabel}>移行先の項目</p>
          {target ? (
            <div className="mt-3">
              <h2 className={styles.fieldCardName}>{target.name}</h2>
              <p className={styles.fieldCardKey}>{`{{field.${target.fieldKey}}}`}</p>
              <p className={styles.fieldCardMeta}>{FIELD_TYPE_LABELS[target.type]}</p>
              <button
                type="button"
                onClick={() => { setCreatedTarget(null); setExistingTargetId(''); resetConfirmation() }}
                className={styles.relink}
              >
                別の項目を選び直す
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <RadioCardGroup legend="移行先の決め方">
                <RadioCard name="field-migrate-target" value="new" checked={targetMode === 'new'} onChange={() => { setTargetMode('new'); resetConfirmation() }} title="新しい項目を作る" />
                <RadioCard name="field-migrate-target" value="existing" checked={targetMode === 'existing'} onChange={() => { setTargetMode('existing'); resetConfirmation() }} title="既存の項目を使う" />
              </RadioCardGroup>
              {targetMode === 'new' ? (
                <div className="mt-3 flex flex-col gap-3">
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>項目名</span>
                    <input className={styles.input} value={targetName} onChange={(event) => { setTargetName(event.target.value); resetConfirmation() }} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>差し込み名</span>
                    <input className={styles.inputMono} value={targetKey} onChange={(event) => { setTargetKey(event.target.value); resetConfirmation() }} />
                  </div>
                  <div className={styles.field}>
                    <span className={styles.fieldLabel}>移行後の種類</span>
                    <Select
                      value={targetType}
                      onChange={(value) => { setTargetType(value as FriendFieldType); resetConfirmation() }}
                      aria-label="移行後の友だち情報欄の種類"
                      size="full"
                      options={TYPES.map((type) => ({ value: type, label: `${FIELD_TYPE_LABELS[type]} — ${FIELD_TYPE_HINTS[type]}` }))}
                    />
                  </div>
                </div>
              ) : (
                <div className={`${styles.field} mt-3`}>
                  <span className={styles.fieldLabel}>移行先</span>
                  <Select
                    value={existingTargetId}
                    onChange={(value) => { setExistingTargetId(value); resetConfirmation() }}
                    aria-label="移行先の既存項目"
                    size="full"
                    options={[
                      { value: '', label: '項目を選ぶ' },
                      ...fields
                        .filter((field) => field.id !== source.id)
                        .map((field) => ({ value: field.id, label: `${field.name}（${FIELD_TYPE_LABELS[field.type]}）` })),
                    ]}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      <section data-design="Preview" className={styles.section}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>値を変換できるか事前確認</h2>
            <p className={styles.sectionDesc}>登録済みの値を読み取り、移行できる数だけを確認します。</p>
          </div>
          <Button type="button" onClick={() => void runPreview()} disabled={checking || running || (executedRunId !== null && run === null) || (!target && targetMode === 'existing' && !existingTargetId)} busy={checking} busyLabel="確認しています…">
            {targetMode === 'new' && !createdTarget ? '項目を作って事前確認' : '事前確認する'}
          </Button>
        </div>
        {preview ? (
          <div className="mt-5">
            <div className={styles.statGrid}>
              <div className={styles.stat}><p className={styles.statLabel}>値がある友だち</p><p className={styles.statValue}>{preview.summary.total}人</p></div>
              <div className={styles.stat}><p className={styles.statLabel}>そのまま移せる</p><p className={styles.statValue}>{preview.summary.convertible}人</p></div>
              <div className={styles.stat}><p className={styles.statLabel}>人が確認する</p><p className={`${styles.statValue} ${styles.statValueWarn}`}>{preview.summary.review}人</p></div>
              <div className={styles.stat}><p className={styles.statLabel}>空欄</p><p className={`${styles.statValue} ${styles.statValueDanger}`}>{preview.summary.invalid}人</p></div>
            </div>
            {preview.rows.length ? (
              <DataTable className="mt-4">
                <thead><TableHeadRow><Th>友だちID</Th><Th>いまの値</Th><Th>確認する理由</Th></TableHeadRow></thead>
                <tbody>{preview.rows.map((row) => <Tr key={row.friendId}><Td className="truncate font-mono text-xs" title={row.friendId}>{row.friendId}</Td><Td className="truncate" title={row.sourceValue}>{row.sourceValue || '（空欄）'}</Td><Td>{row.reason ?? '確認してください'}</Td></Tr>)}</tbody>
              </DataTable>
            ) : <Notice tone="success" className="mt-4">確認が必要な値はありません。</Notice>}
          </div>
        ) : <p className={`${styles.noteText} mt-4`}>まだ事前確認していません。未取得を0人として表示しません。</p>}
      </section>

      <section data-design="Usage" className={styles.section}>
        <h2 className={styles.sectionTitle}>切り替わる使用先</h2>
        {preview ? preview.usageTargets.length > 0 ? (
          <div className={`${styles.usageGrid} mt-3`}>
            {preview.usageTargets.map((usage) => <p key={`${usage.kind}:${usage.id}`} className={styles.usageTile}><span className={styles.usageName} title={usage.name}>{usage.name}</span><span className={styles.usageMeta}>{usage.kind} ／ {usage.switchable ? '移行時に切り替え' : '手動確認が必要'}</span></p>)}
          </div>
        ) : <Notice tone="success" className="mt-3">切り替えが必要な使用先はありません。</Notice>
          : <p className={`${styles.noteText} mt-3`}>事前確認すると、回答フォームや自動処理などの使用先を表示します。</p>}
        {preview?.runId && preview.previewExpiresAt ? <p className={`${styles.noteText} mt-2`}>確認番号：{preview.runId} ／ 有効期限：{formatDateTime(preview.previewExpiresAt)}</p> : null}
      </section>

      {/*
        R548: 実行を受け付けたのに結果がまだ無い間は、黙らせずに
        「未確認」と出し、同じrunの再取得・再開へつなげる。
        「移行を実行する」には戻さない。
      */}
      {!run && executedRunId ? (
        <section data-design="Result" className={styles.section} aria-live="polite">
          <h2 className={styles.sectionTitle}>移行の結果</h2>
          <p className={`${styles.noteText} mt-2`}>{pollProblem || '実行を受け付けました。結果を確認しています…'}</p>
        </section>
      ) : null}

      {run ? (
        <section data-design="Result" className={styles.section} aria-live="polite">
          <h2 className={styles.sectionTitle}>移行の結果</h2>
          <p className={`${styles.sectionDesc} mt-2`} style={{ fontWeight: 600, color: 'var(--color-ink)' }}>{RUN_STATUS_LABELS[run.status]}</p>
          <div className={`${styles.statGrid} mt-3`}>
            <div className={styles.stat}><p className={styles.statLabel}>移行できた</p><p className={`${styles.statValue} ${styles.statValueOk}`}>{run.summary.succeeded}人</p></div>
            <div className={styles.stat}><p className={styles.statLabel}>移行できなかった</p><p className={`${styles.statValue} ${styles.statValueDanger}`}>{run.summary.failed}人</p></div>
            <div className={styles.stat}><p className={styles.statLabel}>確認が必要なまま</p><p className={`${styles.statValue} ${styles.statValueWarn}`}>{run.summary.review + run.summary.invalid}人</p></div>
          </div>
          {run.rows.filter((row) => row.status === 'failed').length ? (
            <DataTable className="mt-4">
              <thead><TableHeadRow><Th>友だちID</Th><Th>いまの値</Th><Th>失敗の理由</Th></TableHeadRow></thead>
              <tbody>{run.rows.filter((row) => row.status === 'failed').map((row) => <Tr key={row.friendId}><Td className="truncate font-mono text-xs" title={row.friendId}>{row.friendId}</Td><Td className="truncate" title={row.sourceValue}>{row.sourceValue || '（空欄）'}</Td><Td>{row.reason ?? '失敗しました。通信を確かめて、もう一度お試しください。'}</Td></Tr>)}</tbody>
            </DataTable>
          ) : null}
          {run.error ? <Notice tone="danger" message={run.error} className="mt-3" /> : null}
          {/*
            復旧可否を正直に伝える。元の項目の値は期限まで残るが、
            自動で元に戻す操作はまだ無い。戻す必要が出たときの行き先を
            はっきり書く。
          */}
          {run.rollbackDeadline ? (
            <p className={`${styles.noteText} mt-3`}>
              元の項目の値は {formatDateTime(run.rollbackDeadline)} まで残ります。元に戻す必要がある場合は、この期限前に運用へ相談してください。
            </p>
          ) : null}
        </section>
      ) : null}

      <StickyBar
        status={pollAttention ? pollProblem : run ? RUN_STATUS_LABELS[run.status] : executedRunId ? '実行を受け付けました。結果を確認しています' : confirmed ? `事前確認済み：${preview?.summary.total ?? 0}人` : 'まだ事前確認していません'}
        actions={<>
          <Button href="/tags?tab=fields">キャンセル</Button>
          {confirmed && !executedRunId ? (
            <Button type="button" onClick={() => void runPreview()} disabled={checking || running}>確認をやり直す</Button>
          ) : null}
          {confirmed && !executedRunId ? (
            <Button variant="primary" type="button" onClick={() => void execute()} disabled={executing || running} busy={running} busyLabel="実行中…">移行を実行する
            </Button>
          ) : null}
          {needsPollAction ? (
            <Button type="button" onClick={() => void refetchRun()} disabled={executing}>結果を確認する</Button>
          ) : null}
          {needsPollAction ? (
            <Button variant="primary" type="button" onClick={() => void resume()} disabled={executing}>
              {executing ? '再開中…' : '続きから再開する'}
            </Button>
          ) : null}
          {!confirmed ? (
            <Button variant="primary" type="button" onClick={() => void runPreview()} disabled={checking || (!target && targetMode === 'existing' && !existingTargetId)} busy={checking} busyLabel="確認しています…">
              {targetMode === 'new' && !createdTarget ? '項目を作って事前確認' : '事前確認する'}
            </Button>
          ) : null}
        </>}
      />
    </div>
  )
}
