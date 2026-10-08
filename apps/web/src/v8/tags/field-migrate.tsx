'use client'

/*
 * ★V8 友だち情報欄の移行（種類を変える。Pencil `GobMd`）。
 *
 * 読み込み・移行先の作成（R519）・事前確認・実行・結果の見守り（R547・R548）・アカウント切替の扱いは
 * 今の画面（app/tags/field-migrate-v8.tsx）から写した。見せ方を絵に合わせた：
 * 頭は「「〇〇」の種類を変える」と今の種類・人数、注意の帯、段「移行の先」に移行後の種類と見本の表
 * （今の値 → 移したあと・人数。種類だけで読む事前確認＝何も書き込まない）、その下に移行先の名前など。
 * 事前確認したあとは、結果・切り替わる使用先・実行の結果の段を足す。
 * 受け付ける URL：`/tags/fields/migrate?id=<移行元の項目>`。
 */
import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { ArrowRight, TriangleAlert } from 'lucide-react'
import type { FriendField, FriendFieldType } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { CreatePage } from '@/components/templates'
import Button from '@/components/shared/button'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import TargetMissing from '@/components/shared/target-missing'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import { ApiError, api, describeSaveFailure } from '@/lib/api'
import type { FriendFieldMigrationPreview, FriendFieldMigrationRun } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import { FIELD_TYPE_HINTS } from '@/components/friend-fields/field-list'
import { formatDateTime, formatNumber } from '@/lib/format'
import { FIELD_TYPE_WORDS } from './field-editor'
import styles from './create.module.css'

const TYPES = Object.keys(FIELD_TYPE_WORDS) as FriendFieldType[]

/** 移行実行の状態を画面の言葉へ。APIの内部名はそのまま出さない。 */
const RUN_STATUS_LABELS: Record<FriendFieldMigrationRun['status'], string> = {
  previewed: '事前確認済み',
  queued: '実行待ち',
  running: '実行中',
  partial: '一部の友だちだけ移行できました',
  succeeded: '移行が完了しました',
  failed: '移行できませんでした。事前確認からやり直してください',
  stale: '確認後に内容が変わったため停止しました',
}

const RUN_RUNNING = new Set<FriendFieldMigrationRun['status']>(['previewed', 'queued', 'running'])

/** 見本の表の行：事前確認の行を「今の値 → 移したあと」でまとめ、そのまま移せる人数を先頭に。 */
export function sampleRows(preview: FriendFieldMigrationPreview): Array<{ from: string; to: string; count: number }> {
  const groups = new Map<string, { from: string; to: string; count: number }>()
  for (const row of preview.rows) {
    const from = row.sourceValue || '（空）'
    const to = row.convertedValue ?? (row.status === 'invalid' ? '（空）' : `人が確認（${row.reason ?? '確認してください'}）`)
    const key = `${from}\u0000${to}`
    const current = groups.get(key)
    if (current) current.count += 1
    else groups.set(key, { from, to, count: 1 })
  }
  const head = preview.summary.convertible > 0 ? [{ from: 'そのまま移せる値', to: '同じ値', count: preview.summary.convertible }] : []
  return [...head, ...groups.values()]
}

export default function FieldMigrateV8() {
  return (
    <Suspense fallback={<ListState kind="loading" />}>
      <FieldMigrate />
    </Suspense>
  )
}

function FieldMigrate() {
  usePageTitle('種類を変える')
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
          // 絵（GobMd）は「1つ選ぶ」を選んだ状態。同じ種類への移行は意味が無いので、今と違う種類から始める。
          setTargetType(source.type === 'select' ? 'text' : 'select')
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


  /*
   * 見本の表（絵の「今の値 → 移したあと・人数」）。移行後の種類だけで事前確認を読む。
   * 種類だけの事前確認はサーバーで何も書き込まない（移行先が無いので確認番号も出ない）。
   */
  const sampleType: FriendFieldType | null = targetMode === 'existing' ? (existingTarget?.type ?? null) : (createdTarget?.type ?? targetType)
  const [sample, setSample] = useState<FriendFieldMigrationPreview | null>(null)
  const [sampleState, setSampleState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const sampleGateRef = useRef(createResponseGate())
  useEffect(() => {
    if (!source || !selectedAccountId || !sampleType) {
      setSample(null)
      setSampleState('idle')
      return
    }
    const token = sampleGateRef.current.begin()
    const account = selectedAccountId
    setSampleState('loading')
    void api.friendFields.migrationPreview(source.id, account, { targetType: sampleType })
      .then((res) => {
        if (!sampleGateRef.current.current(token) || accountRef.current !== account) return
        if (!res.success) throw new Error(res.error)
        setSample(res.data)
        setSampleState('ready')
      })
      .catch(() => {
        if (!sampleGateRef.current.current(token) || accountRef.current !== account) return
        setSample(null)
        setSampleState('error')
      })
  }, [source, selectedAccountId, sampleType])

  if (loading) return <ListState kind="loading" description="友だち情報欄を読み込んでいます" />
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
  /* 「読み込めなかった」と「移行元が無い」を分ける（ATTR-11）。 */
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
  /* 取得の失敗・停滞で人の手が必要なときだけ、同じ実行の再取得・再開を出す（R547・R548）。 */
  const needsPollAction = executedRunId !== null && !executing && pollProblem !== ''
    && (!run || RUN_RUNNING.has(run.status))
  const pollAttention = pollProblem !== '' && (!run || RUN_RUNNING.has(run.status))
  const status = pollAttention ? pollProblem : run ? RUN_STATUS_LABELS[run.status] : executedRunId ? '実行を受け付けました。結果を確認しています' : confirmed ? `事前確認済み：${preview?.summary.total ?? 0}人` : undefined
  const usage = typeof source.usageCount === 'number' ? `${formatNumber(source.usageCount)}人に値が入っている` : '値が入っている人数は未集計'
  const back = <Link href="/tags?tab=fields" className={styles.backLink}>← 友だち情報欄へ</Link>
  const rows = sample ? sampleRows(sample) : []

  return (
    <CreatePage
      boardId="GobMd"
      title={`「${source.name}」の種類を変える`}
      description={`今の種類：${FIELD_TYPE_WORDS[source.type]}・${usage}`}
      identity={back}
      status={status}
      footerActions={<>
        <Button href="/tags?tab=fields">キャンセル</Button>
        {confirmed && !executedRunId ? (
          <Button type="button" onClick={() => void runPreview()} disabled={checking || running}>確認をやり直す</Button>
        ) : null}
        {confirmed && !executedRunId ? (
          <Button variant="primary" type="button" onClick={() => void execute()} disabled={executing || running} busy={running} busyLabel="実行中…">移行を実行する</Button>
        ) : null}
        {needsPollAction ? (
          <Button type="button" onClick={() => void refetchRun()} disabled={executing}>結果を確認する</Button>
        ) : null}
        {needsPollAction ? (
          <Button variant="primary" type="button" onClick={() => void resume()} disabled={executing}>{executing ? '再開中…' : '続きから再開する'}</Button>
        ) : null}
        {!confirmed ? (
          <Button variant="primary" type="button" onClick={() => void runPreview()} disabled={checking || (!target && targetMode === 'existing' && !existingTargetId)} busy={checking} busyLabel="確認しています…">
            <ArrowRight size={15} aria-hidden="true" />
            {targetMode === 'new' && !createdTarget ? '項目を作って事前確認' : '事前確認する'}
          </Button>
        ) : null}
      </>}
    >
      <p className={styles.infoNote}>
        <TriangleAlert className={styles.wayIcon} aria-hidden="true" />
        種類を変えると、合わない値は空になることがあります。まず新しい種類の項目を作って、値がどう移るかを事前に確かめます。今の項目はそのまま残ります。
      </p>
      {error ? <Notice tone="danger" message={error} /> : null}

      <section className={styles.card} aria-labelledby="migrate-target">
        <div className={styles.cardHead}><h2 className={styles.cardTitle} id="migrate-target">移行の先</h2></div>
        {targetMode === 'new' && !createdTarget ? (
          <div className={styles.field}>
            <span className={styles.labelStrong}>移行後の種類</span>
            <span className={styles.selectBox}>
              <Select
                value={targetType}
                onChange={(value) => { setTargetType(value as FriendFieldType); resetConfirmation() }}
                aria-label="移行後の種類"
                size="full"
                options={TYPES.map((type) => ({ value: type, label: FIELD_TYPE_WORDS[type] }))}
              />
            </span>
          </div>
        ) : null}

        <div className={styles.sampleTable} role="table" aria-label="値の移り方の見本">
          <div className={styles.sampleHead} role="row">
            <span role="columnheader">今の値</span>
            <span role="columnheader">移したあと</span>
            <span role="columnheader" className={styles.sampleCount}>人数</span>
          </div>
          {sampleState === 'loading' ? <p className={styles.sampleNote}>値の移り方を確かめています…</p> : null}
          {sampleState === 'error' ? <p className={styles.sampleNote}>値の移り方を確かめられませんでした。「項目を作って事前確認」で確かめられます。</p> : null}
          {sampleState === 'ready' && rows.length === 0 ? <p className={styles.sampleNote}>値が入っている友だちはいません。</p> : null}
          {rows.map((row) => (
            <div key={`${row.from}:${row.to}`} className={styles.sampleRow} role="row">
              <span role="cell" title={row.from}>{row.from}</span>
              <span role="cell" title={row.to}>{row.to}</span>
              <span role="cell" className={styles.sampleCount}>{`${formatNumber(row.count)}人`}</span>
            </div>
          ))}
        </div>

        {target ? (
          <div className={styles.field}>
            <span className={styles.labelStrong}>移行先の項目</span>
            <p className={styles.cardNote}>{`${target.name}（{{field.${target.fieldKey}}}・${FIELD_TYPE_WORDS[target.type]}）`}</p>
            <span>
              <Button type="button" variant="text" onClick={() => { setCreatedTarget(null); setExistingTargetId(''); resetConfirmation() }}>別の項目を選び直す</Button>
            </span>
          </div>
        ) : (
          <>
            <SegmentedControl
              aria-label="移行先の決め方"
              options={[{ value: 'new' as const, label: '新しい項目を作る' }, { value: 'existing' as const, label: '今ある項目へ移す' }]}
              value={targetMode}
              onChange={(value) => { setTargetMode(value); resetConfirmation() }}
            />
            {targetMode === 'new' ? (
              <div className={styles.twoCols}>
                <label className={styles.field}>
                  <span className={styles.label}>新しい項目の名前</span>
                  <input className={styles.input} value={targetName} onChange={(event) => { setTargetName(event.target.value); resetConfirmation() }} />
                </label>
                <label className={styles.field}>
                  <span className={styles.label}>差し込みの名前</span>
                  <input className={styles.input} value={targetKey} onChange={(event) => { setTargetKey(event.target.value); resetConfirmation() }} />
                </label>
              </div>
            ) : (
              <div className={styles.field}>
                <span className={styles.label}>移行先</span>
                <span className={styles.selectBox}>
                  <Select
                    value={existingTargetId}
                    onChange={(value) => { setExistingTargetId(value); resetConfirmation() }}
                    aria-label="移行先の既存項目"
                    size="full"
                    options={[
                      { value: '', label: '項目を選ぶ' },
                      ...fields.filter((field) => field.id !== source.id).map((field) => ({ value: field.id, label: `${field.name}（${FIELD_TYPE_WORDS[field.type]}）` })),
                    ]}
                  />
                </span>
              </div>
            )}
          </>
        )}
        {targetMode === 'new' && !createdTarget ? <p className={styles.fieldNote}>{FIELD_TYPE_HINTS[targetType]}</p> : null}
      </section>

      {preview ? (
        <section className={styles.card} aria-labelledby="migrate-preview">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle} id="migrate-preview">事前確認の結果</h2>
            <p className={styles.cardNote}>登録済みの値を読み取り、移せる数だけを確かめました。まだ何も変えていません。</p>
          </div>
          <dl className={styles.placeList}>
            <div className={styles.placeRow}><dt>値がある友だち</dt><dd>{`${preview.summary.total}人`}</dd></div>
            <div className={styles.placeRow}><dt>そのまま移せる</dt><dd>{`${preview.summary.convertible}人`}</dd></div>
            <div className={styles.placeRow}><dt>人が確認する</dt><dd>{`${preview.summary.review}人`}</dd></div>
            <div className={styles.placeRow}><dt>空欄</dt><dd>{`${preview.summary.invalid}人`}</dd></div>
          </dl>
          <div className={styles.cardHead}><h3 className={styles.labelStrong}>切り替わる使用先</h3></div>
          {preview.usageTargets.length > 0 ? (
            <dl className={styles.placeList}>
              {preview.usageTargets.map((item) => (
                <div key={`${item.kind}:${item.id}`} className={styles.placeRow}><dt title={item.name}>{item.name}</dt><dd>{item.switchable ? '移行のときに切り替わる' : '手で確かめる'}</dd></div>
              ))}
            </dl>
          ) : <p className={styles.fieldNote}>切り替えが必要な使用先はありません。</p>}
          {preview.runId && preview.previewExpiresAt ? <p className={styles.fieldNote}>{`確認番号：${preview.runId} ／ 有効期限：${formatDateTime(preview.previewExpiresAt)}`}</p> : null}
        </section>
      ) : null}

      {/* 実行を受け付けたのに結果がまだ無い間は「未確認」と出し、再取得・再開へつなげる（R548）。 */}
      {!run && executedRunId ? (
        <section className={styles.card} aria-live="polite">
          <h2 className={styles.cardTitle}>移行の結果</h2>
          <p className={styles.cardNote}>{pollProblem || '実行を受け付けました。結果を確認しています…'}</p>
        </section>
      ) : null}
      {run ? (
        <section className={styles.card} aria-live="polite">
          <div className={styles.cardHead}>
            <h2 className={styles.cardTitle}>移行の結果</h2>
            <p className={styles.cardNote}>{RUN_STATUS_LABELS[run.status]}</p>
          </div>
          <dl className={styles.placeList}>
            <div className={styles.placeRow}><dt>移行できた</dt><dd>{`${run.summary.succeeded}人`}</dd></div>
            <div className={styles.placeRow}><dt>移行できなかった</dt><dd>{`${run.summary.failed}人`}</dd></div>
            <div className={styles.placeRow}><dt>確認が必要なまま</dt><dd>{`${run.summary.review + run.summary.invalid}人`}</dd></div>
          </dl>
          {run.rows.filter((row) => row.status === 'failed').map((row) => (
            <p key={row.friendId} className={styles.fieldError}>{`${row.sourceValue || '（空欄）'}：${row.reason ?? '失敗しました。通信を確かめて、もう一度お試しください。'}`}</p>
          ))}
          {run.error ? <Notice tone="danger" message={run.error} /> : null}
          {/* 元に戻す操作はまだ無い。戻す必要が出たときの行き先をはっきり書く。 */}
          {run.rollbackDeadline ? <p className={styles.fieldNote}>{`元の項目の値は ${formatDateTime(run.rollbackDeadline)} まで残ります。元に戻す必要がある場合は、この期限前に運用へ相談してください。`}</p> : null}
        </section>
      ) : null}
    </CreatePage>
  )
}
