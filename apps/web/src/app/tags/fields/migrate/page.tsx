'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FriendField, FriendFieldType } from '@line-crm/shared'
import { useAccount } from '@/contexts/account-context'
import FeatureGate from '@/components/feature-gate'
import { usePageTitle } from '@/components/shell/page-chrome'
import Breadcrumb from '@/components/shared/breadcrumb'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import SelectField from '@/components/shared/select-field'
import { DataTable, TableHeadRow, Td, Th, Tr } from '@/components/shared/table'
import { ApiError, api } from '@/lib/api'
import type { FriendFieldMigrationPreview, FriendFieldMigrationRun } from '@/lib/api'
import { createResponseGate } from '@/lib/latest-request'
import { FIELD_TYPE_HINTS, FIELD_TYPE_LABELS } from '@/components/friend-fields/field-list'

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
    <section className="rounded-card border border-hairline bg-canvas p-5 shadow-sm">
      <p className="text-xs font-semibold text-ink-faint">{title}</p>
      <div className="mt-3 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-ink">{field.name}</h2>
          <p className="mt-1 font-mono text-xs text-ink-faint">{`{{field.${field.fieldKey}}}`}</p>
        </div>
        <span className={kind === 'source' ? 'rounded-full bg-surface-soft px-3 py-1 text-xs font-semibold text-ink-secondary' : 'rounded-full bg-accent-soft px-3 py-1 text-xs font-semibold text-accent'}>
          {FIELD_TYPE_LABELS[field.type]}
        </span>
      </div>
    </section>
  )
}

function MigrateFriendField() {
  usePageTitle('友だち情報欄を移行')
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
  const [loading, setLoading] = useState(true)
  const [checking, setChecking] = useState(false)
  const [executing, setExecuting] = useState(false)
  const [error, setError] = useState('')

  /*
    ATTR-10: 確認中に種類・名前・移行先を変えても、古い確認結果が
    新しい条件の下に表示されてはいけない。要求世代で照合し、
    入力が変わった時点で飛んでいる確認を無効にする。
  */
  const gateRef = useRef(createResponseGate())
  const accountRef = useRef(selectedAccountId)
  accountRef.current = selectedAccountId
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!selectedAccountId) {
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    void api.friendFields.list(selectedAccountId, { withUsage: true })
      .then((res) => {
        if (!active) return
        if (!res.success) throw new Error(res.error)
        setFields(res.data)
        const source = res.data.find((item) => item.id === sourceId)
        if (source) {
          setTargetName(`${source.name}（新）`)
          setTargetKey(`${source.fieldKey}_new`.slice(0, 32))
          setTargetType(source.type)
        }
      })
      .catch((reason) => { if (active) setError(reason instanceof ApiError ? reason.message : '項目を読み込めませんでした') })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [selectedAccountId, sourceId])

  /*
    アカウント・移行元が変わったら、確認結果・実行状態・作った項目の
    選択をすべて捨てる。前のアカウントの実行状況が残ると、いまの
    アカウントで起きていない移行が「完了」と見える。
  */
  useEffect(() => {
    gateRef.current.invalidate()
    setPreview(null)
    setIdempotencyKey(null)
    setRun(null)
    setCreatedTarget(null)
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
  }

  const runPreview = async () => {
    if (!source || !selectedAccountId || checking) return
    setChecking(true); setError(''); setPreview(null); setRun(null)
    const token = gateRef.current.begin()
    const account = selectedAccountId
    try {
      let targetField = target
      // 新規モードでは、実行できる確認（期限付き証票）に項目の実体が要るので先に作る。
      if (!targetField && targetMode === 'new') {
        const created = await api.friendFields.create(account, {
          name: targetName.trim() || `${source.name}（新）`,
          fieldKey: targetKey.trim() || `${source.fieldKey}_new`.slice(0, 32),
          type: targetType,
        })
        if (!created.success) throw new Error(created.error)
        targetField = created.data
        if (!gateRef.current.current(token) || accountRef.current !== account) return
        setCreatedTarget(created.data)
        setFields((current) => [...current, created.data])
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

  const pollRun = (runId: string, account: string, token: number, attempt: number) => {
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current)
    pollTimerRef.current = setTimeout(() => {
      void api.friendFields.migrationRun(runId, account)
        .then((res) => {
          if (!gateRef.current.current(token) || accountRef.current !== account) return
          if (res.success) {
            setRun(res.data)
            if (RUN_RUNNING.has(res.data.status) && attempt < 20) {
              pollRun(runId, account, token, attempt + 1)
            }
          }
        })
        .catch(() => { /* 状況確認の失敗は実行そのものを壊さない */ })
    }, attempt === 0 ? 0 : 2000)
  }

  const execute = async () => {
    if (!source || !selectedAccountId || !preview?.previewToken || !idempotencyKey || executing) return
    setExecuting(true); setError('')
    const token = gateRef.current.begin()
    const account = selectedAccountId
    try {
      const res = await api.friendFields.migrationExecute(source.id, account, preview.previewToken, idempotencyKey)
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      if (!res.success) throw new Error(res.error)
      pollRun(res.data.runId, account, token, 0)
    } catch (reason) {
      if (!gateRef.current.current(token) || accountRef.current !== account) return
      setError(reason instanceof ApiError ? reason.message : '移行を開始できませんでした。事前確認からやり直してください。')
    } finally {
      if (gateRef.current.current(token) && accountRef.current === account) setExecuting(false)
    }
  }

  useEffect(() => () => { if (pollTimerRef.current) clearTimeout(pollTimerRef.current) }, [])

  if (loading) return <div data-design-node="KoT6c" className="p-6 text-sm text-ink-faint">友だち情報欄を読み込んでいます…</div>
  /*
    U097: 「一覧から選び直してください」と言うだけの画面に、実際に
    戻れる操作を置く。直リンク・履歴なしでも画面内だけで復帰できる。
  */
  if (!selectedAccountId) return (
    <div data-design-node="KoT6c" role="alert" className="rounded-control border border-warning/30 bg-warning-bg p-4 text-sm text-warning">
      LINE公式アカウントを選んでください。
      <div className="mt-3"><Button href="/tags?tab=fields">友だち情報欄の一覧へ戻る</Button></div>
    </div>
  )
  if (!source) return (
    <div data-design-node="KoT6c" role="alert" className="rounded-control border border-danger/20 bg-danger-bg p-4 text-sm text-danger">
      移行元の項目が見つかりません。友だち情報欄の一覧から選び直してください。
      <div className="mt-3"><Button href="/tags?tab=fields">友だち情報欄の一覧へ戻る</Button></div>
    </div>
  )

  const confirmed = Boolean(preview?.previewToken)
  const running = executing || (run ? RUN_RUNNING.has(run.status) : false)

  return (
    <div data-design-node="KoT6c">
      <div className="mb-4 flex items-center justify-between gap-4">
        <Breadcrumb items={[{ label: '友だち情報欄', href: '/tags?tab=fields' }, { label: '項目を移行' }]} />
        <Button href="/tags?tab=fields">友だち情報欄へ</Button>
      </div>

      <div className="mb-4 rounded-control border border-info/25 bg-info-bg p-4 text-sm leading-6 text-info">
        事前確認では値を1件も変更しません。移せる数と切り替わる使用先を確かめてから、「移行を実行する」を押した時だけ書き込みます。
      </div>
      {error ? <p role="alert" className="mb-4 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{error}</p> : null}

      <div data-design="Fields" className="grid gap-4 xl:grid-cols-3 xl:items-stretch">
        <FieldSummary title="いま使っている項目" field={source} kind="source" />
        <div className="flex items-center justify-center text-2xl text-ink-faint" aria-hidden="true">→</div>
        <section className="rounded-card border border-accent/30 bg-canvas p-5 shadow-sm">
          <p className="text-xs font-semibold text-accent">移行先の項目</p>
          {target ? (
            <div className="mt-3">
              <h2 className="text-base font-bold text-ink">{target.name}</h2>
              <p className="mt-1 font-mono text-xs text-ink-faint">{`{{field.${target.fieldKey}}}`}</p>
              <p className="mt-1 text-xs text-ink-faint">{FIELD_TYPE_LABELS[target.type]}</p>
              <button
                type="button"
                onClick={() => { setCreatedTarget(null); setExistingTargetId(''); resetConfirmation() }}
                className="mt-3 text-xs font-semibold text-accent hover:underline"
              >
                別の項目を選び直す
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <fieldset>
                <legend className="sr-only">移行先の決め方</legend>
                <div className="flex flex-wrap gap-4 text-sm text-ink-secondary">
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={targetMode === 'new'} onChange={() => { setTargetMode('new'); resetConfirmation() }} />
                    新しい項目を作る
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="radio" checked={targetMode === 'existing'} onChange={() => { setTargetMode('existing'); resetConfirmation() }} />
                    既存の項目を使う
                  </label>
                </div>
              </fieldset>
              {targetMode === 'new' ? (
                <>
                  <label className="mt-3 block text-sm font-semibold text-ink">項目名
                    <input value={targetName} onChange={(event) => { setTargetName(event.target.value); resetConfirmation() }} className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal outline-none focus:border-accent" />
                  </label>
                  <label className="mt-3 block text-sm font-semibold text-ink">差し込み名
                    <input value={targetKey} onChange={(event) => { setTargetKey(event.target.value); resetConfirmation() }} className="mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-mono font-normal outline-none focus:border-accent" />
                  </label>
                  <label className="mt-3 block text-sm font-semibold text-ink">種類
                    <SelectField
                      value={targetType}
                      onChange={(event) => { setTargetType(event.target.value as FriendFieldType); resetConfirmation() }}
                      aria-label="移行後の友だち情報欄の種類"
                      className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal"
                      options={TYPES.map((type) => ({ value: type, label: `${FIELD_TYPE_LABELS[type]} — ${FIELD_TYPE_HINTS[type]}` }))}
                    />
                  </label>
                </>
              ) : (
                <label className="mt-3 block text-sm font-semibold text-ink">移行先
                  <SelectField
                    value={existingTargetId}
                    onChange={(event) => { setExistingTargetId(event.target.value); resetConfirmation() }}
                    aria-label="移行先の既存項目"
                    className="v6-select mt-1.5 h-10 w-full rounded-control border border-hairline bg-canvas px-3 font-normal"
                    options={[
                      { value: '', label: '項目を選ぶ' },
                      ...fields
                        .filter((field) => field.id !== source.id)
                        .map((field) => ({ value: field.id, label: `${field.name}（${FIELD_TYPE_LABELS[field.type]}）` })),
                    ]}
                  />
                </label>
              )}
            </div>
          )}
        </section>
      </div>

      <section data-design="Preview" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-base font-bold text-ink">値を変換できるか事前確認</h2><p className="mt-1 text-sm text-ink-secondary">登録済みの値を読み取り、移行できる数だけを確認します。</p></div>
          <Button type="button" onClick={() => void runPreview()} disabled={checking || running || (!target && targetMode === 'existing' && !existingTargetId)}>
            {checking ? '確認しています…' : targetMode === 'new' && !createdTarget ? '項目を作成して事前確認' : '事前確認する'}
          </Button>
        </div>
        {preview ? (
          <div className="mt-5">
            <div className="grid gap-3 sm:grid-cols-4">
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">値がある友だち</p><p className="mt-1 text-xl font-bold text-ink">{preview.summary.total}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">そのまま移せる</p><p className="mt-1 text-xl font-bold text-accent">{preview.summary.convertible}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">人が確認する</p><p className="mt-1 text-xl font-bold text-warning">{preview.summary.review}人</p></div>
              <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">空欄</p><p className="mt-1 text-xl font-bold text-danger">{preview.summary.invalid}人</p></div>
            </div>
            {preview.rows.length ? (
              <DataTable className="mt-4">
                <thead><TableHeadRow><Th>友だちID</Th><Th>いまの値</Th><Th>確認する理由</Th></TableHeadRow></thead>
                <tbody>{preview.rows.map((row) => <Tr key={row.friendId}><Td className="truncate font-mono text-xs" title={row.friendId}>{row.friendId}</Td><Td className="truncate" title={row.sourceValue}>{row.sourceValue || '（空欄）'}</Td><Td>{row.reason ?? '確認してください'}</Td></Tr>)}</tbody>
              </DataTable>
            ) : <p className="mt-4 rounded-control bg-accent-soft p-3 text-sm text-accent">確認が必要な値はありません。</p>}
          </div>
        ) : <p className="mt-4 text-sm text-ink-faint">まだ事前確認していません。未取得を0人として表示しません。</p>}
      </section>

      <section data-design="Usage" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm">
        <h2 className="text-base font-bold text-ink">切り替わる使用先</h2>
        {preview ? preview.usageTargets.length > 0 ? (
          <div className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
            {preview.usageTargets.map((usage) => <p key={`${usage.kind}:${usage.id}`} className="rounded-control bg-surface-soft p-3"><span className="block truncate font-semibold text-ink" title={usage.name}>{usage.name}</span><span className="mt-1 block text-xs text-ink-faint">{usage.kind} ／ {usage.switchable ? '移行時に切り替え' : '手動確認が必要'}</span></p>)}
          </div>
        ) : <p className="mt-3 rounded-control bg-accent-soft p-3 text-sm text-accent">切り替えが必要な使用先はありません。</p>
          : <p className="mt-3 text-sm text-ink-faint">事前確認すると、回答フォームや自動処理などの使用先を表示します。</p>}
        {preview?.runId && preview.previewExpiresAt ? <p className="mt-2 text-xs text-ink-faint">確認番号：{preview.runId} ／ 有効期限：{new Date(preview.previewExpiresAt).toLocaleString('ja-JP')}</p> : null}
      </section>

      {run ? (
        <section data-design="Result" className="mt-4 rounded-card border border-hairline bg-canvas p-5 shadow-sm" aria-live="polite">
          <h2 className="text-base font-bold text-ink">移行の結果</h2>
          <p className="mt-2 text-sm font-semibold text-ink">{RUN_STATUS_LABELS[run.status]}</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">移行できた</p><p className="mt-1 text-xl font-bold text-accent">{run.summary.succeeded}人</p></div>
            <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">移行できなかった</p><p className="mt-1 text-xl font-bold text-danger">{run.summary.failed}人</p></div>
            <div className="rounded-control border border-hairline bg-surface-soft p-3"><p className="text-xs text-ink-faint">確認が必要なまま</p><p className="mt-1 text-xl font-bold text-warning">{run.summary.review + run.summary.invalid}人</p></div>
          </div>
          {run.rows.filter((row) => row.status === 'failed').length ? (
            <DataTable className="mt-4">
              <thead><TableHeadRow><Th>友だちID</Th><Th>いまの値</Th><Th>失敗の理由</Th></TableHeadRow></thead>
              <tbody>{run.rows.filter((row) => row.status === 'failed').map((row) => <Tr key={row.friendId}><Td className="truncate font-mono text-xs" title={row.friendId}>{row.friendId}</Td><Td className="truncate" title={row.sourceValue}>{row.sourceValue || '（空欄）'}</Td><Td>{row.reason ?? '失敗しました'}</Td></Tr>)}</tbody>
            </DataTable>
          ) : null}
          {run.error ? <p role="alert" className="mt-3 rounded-control border border-danger/20 bg-danger-bg p-3 text-sm text-danger">{run.error}</p> : null}
          {/*
            復旧可否を正直に伝える。元の項目の値は期限まで残るが、
            自動で元に戻す操作はまだ無い。戻す必要が出たときの行き先を
            はっきり書く。
          */}
          {run.rollbackDeadline ? (
            <p className="mt-3 text-xs leading-5 text-ink-faint">
              元の項目の値は {new Date(run.rollbackDeadline).toLocaleString('ja-JP')} まで残ります。元に戻す必要がある場合は、この期限前に運用へ相談してください。
            </p>
          ) : null}
        </section>
      ) : null}

      <StickyBar
        status={run ? RUN_STATUS_LABELS[run.status] : confirmed ? `事前確認済み：${preview?.summary.total ?? 0}人` : 'まだ事前確認していません'}
        actions={<>
          <Button href="/tags?tab=fields">移行をやめる</Button>
          {confirmed && !run ? (
            <Button type="button" onClick={() => void runPreview()} disabled={checking || running}>確認をやり直す</Button>
          ) : null}
          {confirmed && !run ? (
            <Button variant="primary" type="button" onClick={() => void execute()} disabled={executing || running}>
              {running ? '実行中…' : '移行を実行する'}
            </Button>
          ) : null}
          {!confirmed ? (
            <Button variant="primary" type="button" onClick={() => void runPreview()} disabled={checking || (!target && targetMode === 'existing' && !existingTargetId)}>
              {checking ? '確認しています…' : targetMode === 'new' && !createdTarget ? '項目を作成して事前確認' : '事前確認する'}
            </Button>
          ) : null}
        </>}
      />
    </div>
  )
}

export default function MigrateFriendFieldPage() {
  return <FeatureGate feature="friend_fields"><Suspense fallback={<div className="p-6 text-sm text-ink-faint">読み込み中…</div>}><MigrateFriendField /></Suspense></FeatureGate>
}
