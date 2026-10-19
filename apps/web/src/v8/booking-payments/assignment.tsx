'use client'

import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

import { DataTable, Tr, Th, Td } from '@/components/shared/table'

import { isConflictResponse, CONFLICT_TEXT } from '@/components/shared/save-conflict'

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { ListOrdered, Lock, Scale, Shuffle } from 'lucide-react'
import type { BookingAssignmentMethod, BookingAssignmentPeriod, BookingAssignmentPriority, BookingAssignmentResource, BookingAssignmentSettings } from '@line-crm/shared'
import Dialog from '@/components/shared/dialog'
import { isSaveConflict, SaveConflictBand, SaveConflictCompareDialog, saveConflictTitle, useSaveConflict, type SaveConflictDiffLine, type SaveConflictState } from '@/components/shared/save-conflict'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import NumberInput from '@/components/shared/number-field'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import type { StatusBadgeTone } from '@/components/shared/status-badge'
import { Field } from '@/components/shared/form-controls'

import { notifySaved } from '@/components/shared/toast'
import { ApiError } from '@/lib/api'
import { bookingAssignmentApi } from '@/lib/api/helpers/booking-assignment'
import { isNotReadyError } from '@/lib/api/helpers/booking-payment-admin'
import settings from '../booking-menus/settings.module.css'
import styles from './assignment.module.css'

/*
 * 指名なしの予約の割り当て方（・絵 QJMoY＝担当スタッフ、jmVYJ＝卓）。
 * 口：組3 の bookingAssignmentApi（人＝LINEアカウント、卓＝飲食店舗）。表が無い（storageReady=false・503・404）間は
 * 共通の案内の窓を出し、保存しない（今は一覧の上の人・卓から入る）。版が古いと 409 → 比べる窓。
 */

export const PRIORITY: Record<BookingAssignmentPriority, { label: string; tone: StatusBadgeTone }> = {
  preferred: { label: '優先', tone: 'success' },
  normal: { label: 'ふつう', tone: 'neutral' },
  low: { label: '控えめ', tone: 'warning' },
}
const METHOD_LABEL: Record<BookingAssignmentMethod, string> = { balanced: '均等', priority: '優先順', random: 'ランダム' }

export type AssignmentTarget = { kind: 'staff'; accountId: string } | { kind: 'tables'; accountId: string; storeId: string }

export interface AssignmentState {
  status: 'loading' | 'ready' | 'not-ready' | 'error'
  method: BookingAssignmentMethod
  period: BookingAssignmentPeriod
  resources: Record<string, BookingAssignmentResource>
  dirty: boolean
  saving: boolean
  error: string | null
  saveErrors: ReturnType<typeof useSaveFormErrors>
  conflict: SaveConflictState<BookingAssignmentSettings>
  setMethod: (method: BookingAssignmentMethod) => void
  setPeriod: (period: BookingAssignmentPeriod) => void
  setResource: (id: string, patch: Partial<BookingAssignmentResource>) => void
  save: (order: string[]) => Promise<void>
  reset: () => void
}

function toMap(list: BookingAssignmentResource[]) {
  return Object.fromEntries(list.map((item) => [item.resourceId, item]))
}

export function useAssignment(target: AssignmentTarget | null): AssignmentState {
  const [status, setStatus] = useState<AssignmentState['status']>('loading')
  const [saved, setSaved] = useState<BookingAssignmentSettings | null>(null)
  const [method, setMethod] = useState<BookingAssignmentMethod>('balanced')
  const [period, setPeriod] = useState<BookingAssignmentPeriod>('day')
  const [resources, setResources] = useState<Record<string, BookingAssignmentResource>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveErrors = useSaveFormErrors()
  const generation = useRef(0)
  const key = target ? JSON.stringify(target) : ''

  const apply = (next: BookingAssignmentSettings) => {
    setSaved(next); setMethod(next.method); setPeriod(next.balancePeriod); setResources(toMap(next.resources))
  }

  useEffect(() => {
    if (!target) return
    const mine = ++generation.current
    setStatus('loading')
    const request = Promise.resolve().then(() => target.kind === 'staff' ? bookingAssignmentApi.get(target.accountId) : bookingAssignmentApi.getTables(target.accountId, target.storeId))
    request.then((response) => {
      if (mine !== generation.current) return
      apply(response.data)
      setStatus(response.data.storageReady ? 'ready' : 'not-ready')
    }).catch((cause: unknown) => {
      if (mine !== generation.current) return
      setStatus(isNotReadyError(cause) ? 'not-ready' : 'error')
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const fetchSettings = () => !target ? Promise.resolve(null) : (target.kind === 'staff' ? bookingAssignmentApi.get(target.accountId) : bookingAssignmentApi.getTables(target.accountId, target.storeId)).then((response) => response.data)
  const conflict = useSaveConflict<BookingAssignmentSettings>({
    contextKey: key,
    fetchLatest: fetchSettings,
    reload: async () => { const latest = await fetchSettings(); if (latest) { apply(latest); conflict.clear() } },
  })

  const dirty = (status === 'ready' || status === 'not-ready') && saved !== null && JSON.stringify({ method, period, resources }) !== JSON.stringify({ method: saved.method, period: saved.balancePeriod, resources: toMap(saved.resources) })

  const write = useCallback(async (order: string[], version: number) => {
    if (!target) return
    const body = {
      method, balancePeriod: period, expectedVersion: version,
      resources: order.map((id, index) => ({ resourceId: id, priority: resources[id]?.priority ?? 'normal', dailyLimit: resources[id]?.dailyLimit ?? null, sortOrder: index })),
    }
    setSaving(true); setError(null)
    try {
      const response = target.kind === 'staff' ? await bookingAssignmentApi.save(target.accountId, body) : await bookingAssignmentApi.saveTables(target.accountId, target.storeId, body)
      apply(response.data); conflict.clear()
      notifySaved('割り当て方を保存しました')
    } catch (cause) {
      if (isSaveConflict(cause)) {
        /* 共通の帯と比べる窓（違いを比べる／最新を読み込んで続ける）。入力は捨てない。 */
        conflict.mark()
      } else if (isNotReadyError(cause)) {
        setStatus('not-ready')
      } else if (!saveErrors.capture(cause)) {
        setError(cause instanceof ApiError && cause.status === 403 ? '割り当て方を変える権限がありません。' : '保存できませんでした。もう一度お試しください。')
      }
    } finally {
      setSaving(false)
    }
  }, [target, method, period, resources, conflict, saveErrors])

  return {
    saveErrors, status, method, period, resources, dirty, saving, error, conflict,
    setMethod, setPeriod,
    setResource: (id, patch) => setResources((current) => ({ ...current, [id]: { ...(current[id] ?? { resourceId: id, priority: 'normal' as const, dailyLimit: null, sortOrder: 0 }), ...patch } })),
    save: (order) => write(order, saved?.version ?? 0),
    reset: () => { if (saved) apply(saved); setError(null) },
  }
}

const METHODS: Array<{ value: BookingAssignmentMethod; title: string; icon: ReactNode }> = [
  { value: 'balanced', title: '均等（おすすめ）', icon: <Scale size={16} aria-hidden="true" /> },
  { value: 'priority', title: '優先順', icon: <ListOrdered size={16} aria-hidden="true" /> },
  { value: 'random', title: 'ランダム', icon: <Shuffle size={16} aria-hidden="true" /> },
]

/** 割り当て方の区画（題・案内・3 つの選び方・数える期間）。 */
export function AssignmentSection({ state, kind, canEdit }: { state: AssignmentState; kind: 'staff' | 'tables'; canEdit: boolean }) {
  const staff = kind === 'staff'
  /* 表がまだ無い（not-ready）ときも選べる形で出し、保存を押すと共通の案内の窓（：手書きの帯は出さない）。 */
  const locked = state.status === 'loading' || state.status === 'error'
  const notes: Record<BookingAssignmentMethod, string> = staff
    ? { balanced: '担当の少ない人から入れます', priority: '決めた順番で埋めます', random: '空いている人から無作為に' }
    : { balanced: 'その日の予約の少ない卓から', priority: '決めた順番で埋めます', random: '空いている卓から無作為に' }
  return (
    <SaveErrorScope errors={state.saveErrors}>
      {state.error ? <Notice tone="danger" role="alert">{state.error}</Notice> : null}
      <section className={settings.section} aria-labelledby={`assign-${kind}-heading`}>
        <div className={styles.headRow}>
          <h2 id={`assign-${kind}-heading`} className={settings.sectionTitle}>{staff ? '指名なしの予約の割り当て方' : '卓の割り当て方'}</h2>
          <HelpTip label="割り当て方の説明">{staff ? '指名なしで入った予約を、どのスタッフに入れるかの決め方です。指名のある予約はそのままです。' : '人数に合う卓の中から、どの卓に入れるかの決め方です。'}</HelpTip>
        </div>
        {!staff ? (
          <>
            <p className={styles.fixedRule}><Lock size={14} aria-hidden="true" />いつも：人数に合う一番小さい卓から入れます（2名を 6 人卓に入れない）</p>
            <h3 className={styles.subTitle}>同じ大きさの卓の中での選び方</h3>
          </>
        ) : null}
        {canEdit ? (
          <SaveErrorField names={['method', `assign-${kind}-method`]}><RadioCardGroup legend={staff ? '指名なしの予約の割り当て方' : '同じ大きさの卓の中での選び方'} columns={3}>
            {METHODS.map((choice) => (
              <RadioCard key={choice.value} name={`assign-${kind}-method`} value={choice.value} title={choice.title} note={notes[choice.value]} icon={choice.icon}
                checked={state.method === choice.value} disabled={locked} onChange={(value) => state.setMethod(value as BookingAssignmentMethod)} />
            ))}
          </RadioCardGroup></SaveErrorField>
        ) : <p className={styles.readValue}>{`${METHODS.find((choice) => choice.value === state.method)?.title}：${notes[state.method]}`}</p>}
        {staff && canEdit ? (
          <div className={styles.periodRow}>
            <span className={styles.periodLabel}>数える期間</span>
            <span className={styles.periodSelect}>
              <SaveErrorField names={['balancePeriod', 'balance_period']}><Select aria-label="数える期間" value={state.period} disabled={locked || state.method !== 'balanced'} onChange={(value) => state.setPeriod(value as BookingAssignmentPeriod)}
                options={[{ value: 'day', label: 'その日の担当数' }, { value: 'week', label: 'その週の担当数' }]} /></SaveErrorField>
            </span>
            <span className={styles.minor}>同じ数のときは 優先度 → 最近入っていない人 → ランダム の順に決めます。</span>
          </div>
        ) : null}
      </section>
    </SaveErrorScope>
  )
}

/** 行の「…」→［割り当ての設定］の窓（優先度と 1 日の上限）。 */
export function AssignmentRowDialog({ open, name, unit, value, onClose, onApply }: {
  open: boolean
  name: string
  unit: string
  value: BookingAssignmentResource | undefined
  onClose: () => void
  onApply: (patch: Partial<BookingAssignmentResource>) => void
}) {
  const [priority, setPriority] = useState<BookingAssignmentPriority>('normal')
  const [limit, setLimit] = useState('')
  useEffect(() => {
    if (!open) return
    setPriority(value?.priority ?? 'normal')
    setLimit(value?.dailyLimit ? String(value.dailyLimit) : '')
  }, [open, value])
  const limitNumber = limit.trim() === '' ? null : Number(limit)
  const invalid = limitNumber !== null && (!Number.isInteger(limitNumber) || limitNumber < 1)
  return (
    <Dialog open={open} title={`${name}の割り当ての設定`} onCancel={onClose} size="small" cancelLabel="キャンセル" confirmLabel="決める" confirmDisabled={invalid} onConfirm={() => { onApply({ priority, dailyLimit: limitNumber }); onClose() }}>
      <div className={styles.dialogBody}>
        <Field label="優先度">
          <Select aria-label="優先度" value={priority} onChange={(next) => setPriority(next as BookingAssignmentPriority)}
            options={(Object.keys(PRIORITY) as BookingAssignmentPriority[]).map((key) => ({ value: key, label: PRIORITY[key].label }))} />
        </Field>
        <Field label="1日の上限" optional error={invalid ? '1 以上の整数で入れてください（空なら上限なし）' : undefined}>
          <NumberInput aria-label="1日の上限" unit={unit} type="number" min={1} value={limit} placeholder="上限なし" onChange={(event) => setLimit(event.target.value)} />
        </Field>
        <p className={styles.minor}>上限に達した日は、その日はもう入れません。保存は画面の下の［保存する］で行います。</p>
      </div>
    </Dialog>
  )
}

/** 先に保存されたとき（共通の帯と比べる窓。jmVYJ の右の比べる窓）。 */
export function AssignmentConflict({ state, names, unit, order, subject }: { state: AssignmentState; names: Record<string, string>; unit: string; order: string[]; subject: string }) {
  const { conflict } = state
  if (!conflict.conflict) return null
  const latest = conflict.latest
  let lines: SaveConflictDiffLine[] | null = null
  if (latest) {
    lines = []
    if (latest.method !== state.method) lines.push({ text: `選び方：あなた「${METHOD_LABEL[state.method]}」／最新「${METHOD_LABEL[latest.method]}」` })
    const latestMap = toMap(latest.resources)
    for (const id of order) {
      const mine = state.resources[id]?.dailyLimit ?? null
      const theirs = latestMap[id]?.dailyLimit ?? null
      const show = (value: number | null) => value === null ? '上限なし' : `${value} ${unit}`
      if (mine !== theirs) lines.push({ text: `${names[id] ?? id} の上限：あなた「${show(mine)}」／最新「${show(theirs)}」` })
      const myPriority = state.resources[id]?.priority ?? 'normal'
      const theirPriority = latestMap[id]?.priority ?? 'normal'
      if (myPriority !== theirPriority) lines.push({ text: `${names[id] ?? id} の優先度：あなた「${PRIORITY[myPriority].label}」／最新「${PRIORITY[theirPriority].label}」` })
    }
  }
  return <>
    <SaveConflictBand title={saveConflictTitle('', subject, '')} compareBusy={conflict.compareBusy} onCompare={() => void conflict.compare()} onReload={() => void conflict.reloadLatest()} />
    <SaveConflictCompareDialog open={conflict.compareOpen} error={conflict.compareError} lines={lines} onReload={() => void conflict.reloadLatest()} onCancel={conflict.closeCompare} />
  </>
}
