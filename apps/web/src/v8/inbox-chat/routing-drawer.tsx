'use client'
import { notifySaved } from '@/components/shared/toast'

import { FormLeaveGuard } from '@/components/shared/form-leave-guard'

import { SaveErrorField, SaveErrorScope, useSaveFormErrors } from '@/components/shared/save-form-errors'

import EntitySelect from '@/components/shared/entity-select'

import { isConflictResponse, CONFLICT_TEXT } from '@/components/shared/save-conflict'

/*
 * 受信箱の「割り当てと返事の期限」の引き出し（板 L6pGz・要件 G3）。
 * 口：inboxRoutingApi（GET/PUT /api/inbox/routing-settings。契約 API-CONTRACT-GAP1.md）。
 * 割り当て方・対象者と、返事の期限を同じ版で保存する。
 * 設定はオーナー・管理者だけ（開く入口を出さない）。
 */
import { useEffect, useRef, useState } from 'react'
import type { InboxFirstResponseSettings } from '@line-crm/shared'
import Drawer from '@/components/shared/drawer'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Notice from '@/components/shared/notice'
import ListState from '@/components/shared/list-state'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import NumberInput from '@/components/shared/number-field'
import { Field } from '@/components/shared/form-controls'
import { ApiError, api } from '@/lib/api'
import { inboxRoutingApi } from '@/lib/api/helpers/gap1'
import { gap3InboxApi, type InboxAssignmentRun } from '@/lib/api/helpers/gap3'
import MultiSelect from '@/components/shared/multi-select'
import { describeApiFailure } from '@/components/shared/api-error-message'
import styles from './routing-drawer.module.css'

const MIN_MINUTES = 5
const MAX_MINUTES = 1440
/** 契約：期限の15分前から金の札。いまは変えられない固定値。 */
const SOON_MINUTES = 15
const STRATEGIES = [
  { value: 'none', label: 'しない', ready: true },
  { value: 'even', label: '均等', ready: true },
  { value: 'priority', label: '優先順', ready: true },
  { value: 'random_weighted', label: 'ランダム＋優先度', ready: true },
] as const

type Team = { id: string; name: string }

export default function RoutingDrawer({ accountId, open, onClose, onSaved }: {
  accountId: string
  open: boolean
  onClose: () => void
  /** 保存したあと、一覧の札を取り直す。 */
  onSaved: (settings: InboxFirstResponseSettings) => void
}) {
  const contextRef = useRef({ accountId, open })
  contextRef.current = { accountId, open }
  const saveErrors = useSaveFormErrors()
  const [settings, setSettings] = useState<InboxFirstResponseSettings | null>(null)
  const [draft, setDraft] = useState<InboxFirstResponseSettings | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [staff, setStaff] = useState<Array<{id:string;name:string}>>([])
  const [staffError, setStaffError] = useState(false)
  const [run, setRun] = useState<InboxAssignmentRun | null>(null)
  const [starting, setStarting] = useState(false)
  const runKey = useRef<string | null>(null)
  const keyAccount = useRef(accountId)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [minutesText, setMinutesText] = useState('30')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open) return
    let live = true
    if (keyAccount.current !== accountId) { runKey.current=null; keyAccount.current=accountId }
    setSettings(null); setDraft(null); setLoadError(null); setError(''); setRun(null); setStaff([]); setStaffError(false)
    void inboxRoutingApi.get(accountId).then((res) => {
      if (!live) return
      setSettings(res.data); setDraft(res.data); setMinutesText(String(res.data.firstResponseMinutes))
    }, (caught) => { if (live) setLoadError(caught) })
    void api.staff.list(accountId).then((res) => {
      if (live && res.success) setStaff(res.data.filter((person) => person.isActive && person.role !== 'viewer').map(({id,name})=>({id,name})))
      else if (live) setStaffError(true)
    }, () => { if (live) setStaffError(true) })
    void api.notifications.teams.list(accountId).then((res) => {
      if (live && res.success) setTeams(res.data.filter((team) => !team.archivedAt).map((team) => ({ id: team.id, name: team.name })))
    }, () => {})
    return () => { live = false }
  }, [open, accountId])

  useEffect(() => {
    if (!open || !run || !['queued','running','waiting','preparing'].includes(run.status)) return
    let live = true
    const timer = window.setTimeout(() => { void gap3InboxApi.assignmentRun(accountId, run.id).then((res) => {
      if (live) setRun(res.data)
    }, (caught) => { if (live) setError(describeApiFailure(caught, '進み具合の読み込み')) }) }, 2000)
    return () => { live=false; window.clearTimeout(timer) }
  }, [open, accountId, run])

  const startAssignment = async () => {
    if (!draft || dirty || starting) return
    setStarting(true); setError('')
    const key = runKey.current ?? `routing:${crypto.randomUUID()}`
    runKey.current = key
    try { const res = await gap3InboxApi.applyUnassigned(accountId,key); if (contextRef.current.accountId === accountId && contextRef.current.open) { setRun(res.data); runKey.current=null } }
    catch (caught) { if (contextRef.current.accountId === accountId && contextRef.current.open) setError(describeApiFailure(caught,'割り当て')) }
    finally { setStarting(false) }
  }

  const minutes = Number(minutesText)
  const minutesValid = Number.isInteger(minutes) && minutes >= MIN_MINUTES && minutes <= MAX_MINUTES
  const dirty = Boolean(settings && draft && (
    settings.enabled !== draft.enabled || settings.businessHoursOnly !== draft.businessHoursOnly
    || settings.strategy !== draft.strategy || JSON.stringify(settings.targets ?? []) !== JSON.stringify(draft.targets ?? [])
    || settings.escalateTeamId !== draft.escalateTeamId || settings.firstResponseMinutes !== (minutesValid ? minutes : settings.firstResponseMinutes)
  ))

  const save = async () => {
    if (!settings || !draft) return
    if (!minutesValid) { setError(`最初の返事までは ${MIN_MINUTES}〜${MAX_MINUTES} 分で入れてください。`); return }
    setSaving(true); setError('')
    try {
      const res = await inboxRoutingApi.save(accountId, {
        strategy: draft.strategy, targets: draft.targets ?? [], enabled: draft.enabled, firstResponseMinutes: minutes, businessHoursOnly: draft.businessHoursOnly,
        escalateTeamId: draft.escalateTeamId, expectedVersion: settings.version,
      })
      if (contextRef.current.accountId !== accountId || !contextRef.current.open) return
      notifySaved('「割り当てと返事の期限」を保存しました')
      onSaved(res.data)
      onClose()
    } catch (caught) {
      if (contextRef.current.accountId !== accountId || !contextRef.current.open) return
      saveErrors.capture(caught)
      setError(isConflictResponse(caught)
        ? CONFLICT_TEXT.routing
        : describeApiFailure(caught, '保存'))
    } finally { setSaving(false) }
  }

  return (<SaveErrorScope errors={saveErrors}>{(
    <>
    <FormLeaveGuard dirty={open && dirty} busy={saving} />
    <Drawer open={open} title="割り当てと返事の期限" description="新しい会話を、だれが・いつまでに返すかを決めます" width="editor" heightMode="viewport" dirty={dirty} busy={saving} error={error} onClose={onClose}
      footer={<div className={styles.footerRow}>
        <Button onClick={onClose} disabled={saving}>キャンセル</Button>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving} busy={saving}>保存する</Button>
      </div>}>
      {loadError ? <ListState kind="error" error={loadError} onRetry={() => { setLoadError(null); void inboxRoutingApi.get(accountId).then((res) => { setSettings(res.data); setDraft(res.data); setMinutesText(String(res.data.firstResponseMinutes)) }, setLoadError) }} />
        : !draft ? <ListState kind="loading" />
          : (
            <div className={styles.body}>
              <section className={styles.card} aria-labelledby="routing-strategy-heading">
                <h3 id="routing-strategy-heading" className={styles.cardTitle}>割り当て方</h3>
                <SegmentedControl aria-label="割り当て方" options={STRATEGIES.map(({value,label})=>({value,label}))} value={draft.strategy}
                  onChange={(strategy) => setDraft({...draft,strategy})} />
                {draft.strategy !== 'none' ? <>
                  {staffError ? <Notice tone="warn">担当者を読み込めませんでした。引き出しを開き直してください。</Notice> : null}
                  <Field label="対象の人"><MultiSelect aria-label="対象の人" options={staff.map(({id,name})=>({value:id,label:name}))}
                    values={(draft.targets ?? []).map((target)=>target.staffId)} onChange={(ids)=>setDraft({...draft,targets:ids.map((id,index)=>
                      (draft.targets ?? []).find((target)=>target.staffId===id) ?? {staffId:id,priority:index+1,cap:10})})} /></Field>
                  {(draft.targets ?? []).map((target) => <div className={styles.pair} key={target.staffId}>
                    <Field label={`${staff.find((person)=>person.id===target.staffId)?.name ?? target.staffId} の優先度`}>
                      <NumberInput min={1} max={100} value={target.priority} onChange={(event)=>setDraft({...draft,targets:(draft.targets ?? []).map((item)=>item.staffId===target.staffId?{...item,priority:Number(event.target.value)}:item)})} />
                    </Field>
                    <Field label="未対応の上限"><NumberInput min={1} max={1000} value={target.cap} onChange={(event)=>setDraft({...draft,targets:(draft.targets ?? []).map((item)=>item.staffId===target.staffId?{...item,cap:Number(event.target.value)}:item)})} /></Field>
                  </div>)}
                  <p className={styles.note}>今の未割り当て {settings?.unassignedCount ?? 0} 件</p>
                  <Button onClick={()=>void startAssignment()} disabled={dirty || starting || !(draft.targets ?? []).length || Boolean(run && ['queued','running','waiting','preparing'].includes(run.status))}>今の未割り当てにも当てる</Button>
                  {run && error ? <Button onClick={() => { setError(''); void gap3InboxApi.assignmentRun(accountId,run.id).then((res)=>setRun(res.data),(caught)=>setError(describeApiFailure(caught,'進み具合の読み込み'))) }}>進み具合を読み直す</Button> : null}
                  {run ? <Notice tone="info">{['queued','running','waiting','preparing'].includes(run.status) ? `割り当て中（${run.assigned + run.skipped} / ${run.total} 件）` : `${run.assigned} 件当てました・${run.skipped} 件は当てられませんでした${run.failed ? `・${run.failed} 件失敗` : ''}`}</Notice> : null}
                </> : null}
              </section>

              <section className={styles.card} aria-labelledby="routing-sla-heading">
                <h3 id="routing-sla-heading" className={styles.cardTitle}>返事の期限</h3>
                <div className={styles.switchRow}>
                  <span id="routing-sla-label">返事の期限を使う（初めはオフ）</span>
                  <Toggle label="返事の期限を使う" checked={draft.enabled} onChange={(next) => setDraft({ ...draft, enabled: next })} />
                </div>
                <div className={styles.pair}>
                  <Field label="最初の返事まで" required htmlFor="routing-minutes">
                    <SaveErrorField names={["firstResponseMinutes"]}><NumberInput id="routing-minutes" numericText inputMode="numeric" unit="分" value={minutesText} disabled={!draft.enabled}
                      invalid={!minutesValid} onChange={(event) => setMinutesText(event.target.value)} /></SaveErrorField>
                  </Field>
                  <Field label="金の印を出す" htmlFor="routing-soon">
                    <Select id="routing-soon" aria-label="金の印を出す" size="full" disabled value="soon" onChange={() => {}} options={[{ value: 'soon', label: `残り ${SOON_MINUTES} 分から` }]} />
                  </Field>
                </div>
                <Checkbox checked={draft.businessHoursOnly} disabled={!draft.enabled} onCheckedChange={(next) => setDraft({ ...draft, businessHoursOnly: next })}>
                  営業時間の中だけ数える（予約の受付時間から。予約を使っていない店は 9:00〜18:00）
                </Checkbox>
                <Field label="過ぎたら知らせる先" htmlFor="routing-team">
                  <EntitySelect id="routing-team" aria-label="過ぎたら知らせる先" size="full" disabled={!draft.enabled} value={draft.escalateTeamId ?? ''}
                    onChange={(value) => setDraft({ ...draft, escalateTeamId: value || null })}
                    options={[{ value: '', label: '担当者だけに知らせる' }, ...teams.map((team) => ({ value: team.id, label: `通知チーム：${team.name}` }))]} />
                </Field>
                <p className={styles.note}>期限の15分前に担当へ、過ぎたら担当へ、過ぎて30分で選んだ知らせる先へ、管理画面の通知で知らせます。</p>
              </section>
              {draft.enabled && !minutesValid ? <Notice tone="warn">{`最初の返事までは ${MIN_MINUTES}〜${MAX_MINUTES} 分で入れてください。`}</Notice> : null}
            </div>
          )}
    </Drawer>
    </>
  )}</SaveErrorScope>)
}
