'use client'

/*
 * ★V8 ウェビナーの ②動画と公開期間（Pencil：オンデマンド VWNaA・日時指定と開催回 LPOe7）。
 * 動画（差し替える・準備の段）→ 公開期間（オンデマンド）／開催回（日時指定）→ 配信枠 → 視聴の数え方。
 * 右は公開ページでの見え方。
 * 口・保存の決まりは app/webinars/edit/video-v8.tsx・video-stages.tsx・scheduled-session-row.tsx と同じ（BEHAVIOR.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { CalendarPlus, Check, Monitor, MoreHorizontal, Play, Plus, Smartphone, Upload } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import Dialog from '@/components/shared/dialog'
import IconButton from '@/components/shared/icon-button'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { TextField } from '@/components/shared/text-field'
import type { MediaItem } from '@line-crm/shared'
import {
  api,
  describeSaveFailure,
  webinarApi,
  type WebinarScheduleRule,
  type WebinarSessionCapacity,
  type WebinarVideoAsset,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { fmtJaDuration } from './helpers'
import { ReadValue } from './parts'
import type { EditContext, PaneSaveProps, WizardChrome } from './types'
import form from './form.module.css'
import styles from './video.module.css'

const WEEKDAY = ['日', '月', '火', '水', '木', '金', '土']

/** JST の「10/8（木）20:00」。 */
function shortJst(iso: string): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const d = new Date(time + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WEEKDAY[d.getUTCDay()]}）${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
/** datetime-local の字面を JST で（`2026-10-01T10:00`）。 */
function localJst(value: string | null | undefined): string {
  if (!value) return ''
  const time = Date.parse(value)
  return Number.isNaN(time) ? '' : new Date(time + 9 * 60 * 60 * 1000).toISOString().slice(0, 16)
}
function toJstIso(local: string): string {
  return `${local}:00+09:00`
}

function ruleView(rule: WebinarScheduleRule): { kind: string; tone: 'success' | 'neutral' | 'warn'; detail: string } {
  if (rule.type === 'daily') return { kind: '毎日', tone: 'success', detail: rule.time ? `${rule.time}〜` : '時刻未定' }
  if (rule.type === 'weekly') {
    const days = (rule.days ?? []).map((day) => WEEKDAY[day] ?? '').join('・')
    return { kind: '毎週', tone: 'neutral', detail: `${days}${days ? ' ' : ''}${rule.time ?? ''}`.trim() || '曜日未定' }
  }
  return { kind: '単発', tone: 'warn', detail: rule.at ? shortJst(rule.at) : '日時未定' }
}

function sessionText(session: WebinarSessionCapacity | null | undefined, failed: boolean): string {
  if (session === undefined) return failed ? '読み込めません' : '確認中'
  if (session === null) return '定員なし'
  if (session.state === 'closed') return '受付終了'
  if (session.state === 'full') return '満員'
  return session.remaining === null ? '受付中' : `残り ${formatNumber(session.remaining)}人`
}

/** 開催回1つぶんの定員・申込（口 webinarApi.webinarSession）。 */
function useSession(webinarId: string, startAt: number | null) {
  const [session, setSession] = useState<WebinarSessionCapacity | null | undefined>(undefined)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (startAt === null) return
    let active = true
    setSession(undefined)
    setFailed(false)
    void webinarApi.webinarSession(webinarId, startAt).then((response) => { if (active) setSession(response.data.session) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [webinarId, startAt, attempt])
  return { session, setSession, failed, reload: () => setAttempt((n) => n + 1) }
}

const STAGES = [
  { key: 'uploaded', label: '受け付け' },
  { key: 'inspecting', label: '検査' },
  { key: 'converting', label: '変換' },
  { key: 'packaging', label: '配信の形' },
  { key: 'thumbnail', label: '表紙' },
  { key: 'ready', label: '準備完了' },
] as const
/* 段の順番はサーバーの順（配信の形 → 表紙）。絵（LPOe7）は表紙を先に描いているが、済んでいない段に ✓ を付けない。 */
const STAGE_ORDER: WebinarVideoAsset['stage'][] = ['uploaded', 'inspecting', 'converting', 'packaging', 'thumbnail', 'ready']
const NEXT_STAGE: Record<string, WebinarVideoAsset['stage'][]> = {
  uploaded: ['inspecting', 'failed'], inspecting: ['converting', 'failed'], converting: ['packaging', 'failed'],
  packaging: ['thumbnail', 'failed'], thumbnail: ['ready', 'failed'], ready: [], failed: [],
}
const NEXT_LABEL: Record<string, string> = {
  uploaded: '動画の準備を始める', inspecting: '検査へ進める', converting: '変換へ進める', packaging: '配信の形へ進める',
  thumbnail: '表紙へ進める', ready: '準備完了にする', failed: '失敗にする',
}

export default function VideoPane({ ctx, chrome, onDirtyChange, registerSave }: { ctx: EditContext; chrome: WizardChrome } & PaneSaveProps) {
  const { webinar, editor, readOnly } = ctx
  const scheduled = editor.deliveryKind === 'scheduled'
  const hasVideo = Boolean(webinar.videoPrefix || webinar.videoMediaId)

  /* ===== 動画の準備の段 ===== */
  const [asset, setAsset] = useState<WebinarVideoAsset | null | undefined>(undefined)
  const [assetError, setAssetError] = useState('')
  const loadAsset = useCallback(async () => {
    setAssetError('')
    try {
      const res = await webinarApi.videoAsset(webinar.id)
      setAsset(res.data.asset)
    } catch {
      setAsset(undefined)
      setAssetError('動画の準備を読み込めませんでした。')
    }
  }, [webinar.id])
  useEffect(() => { if (hasVideo) void loadAsset() }, [hasVideo, loadAsset])

  /* ===== 公開期間 ===== */
  const [startsAt, setStartsAt] = useState(() => localJst(webinar.publicationStartsAt))
  const [endsAt, setEndsAt] = useState(() => localJst(webinar.publicationEndsAt))
  const [noEnd, setNoEnd] = useState(!webinar.publicationEndsAt)
  const savedPeriod = useRef(JSON.stringify([startsAt, endsAt, noEnd]))
  const periodDirty = JSON.stringify([startsAt, endsAt, noEnd]) !== savedPeriod.current
  const [periodError, setPeriodError] = useState('')
  const periodLock = useRef(false)
  const savePeriod = async (): Promise<boolean> => {
    if (readOnly || periodLock.current) return false
    if (!noEnd && endsAt && startsAt && new Date(toJstIso(endsAt)) <= new Date(toJstIso(startsAt))) {
      setPeriodError('公開の終了は開始より後にしてください。')
      return false
    }
    const saved = JSON.stringify([startsAt, endsAt, noEnd])
    periodLock.current = true
    setPeriodError('')
    try {
      const fresh = await webinarApi.editor(webinar.id)
      const res = await webinarApi.update(webinar.id, {
        publicationStartsAt: startsAt ? toJstIso(startsAt) : null,
        publicationEndsAt: noEnd || !endsAt ? null : toJstIso(endsAt),
        expectedVersion: fresh.data.version,
      })
      savedPeriod.current = saved
      ctx.onWebinarSaved(res.data)
      return true
    } catch (cause) {
      setPeriodError(describeSaveFailure(cause))
      return false
    } finally {
      periodLock.current = false
    }
  }

  /* ===== 配信枠 ===== */
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState<number | null>(null)
  const [adding, setAdding] = useState<'one' | 'bulk' | null>(null)
  const [capacityEdit, setCapacityEdit] = useState<number | null>(null)
  const saveSchedule = async (schedule: WebinarScheduleRule[]): Promise<boolean> => {
    if (readOnly || busy) return false
    setBusy(true)
    setError('')
    try {
      const fresh = await webinarApi.editor(webinar.id)
      const res = await webinarApi.update(webinar.id, { schedule, expectedVersion: fresh.data.version })
      ctx.onWebinarSaved(res.data)
      return true
    } catch (cause) {
      setError(describeSaveFailure(cause))
      return false
    } finally {
      setBusy(false)
    }
  }
  const removeRule = (index: number) => { setMenuOpen(null); void saveSchedule(webinar.schedule.filter((_, i) => i !== index)) }
  const duplicateRule = (index: number) => {
    setMenuOpen(null)
    const rules = [...webinar.schedule]
    rules.splice(index + 1, 0, { ...webinar.schedule[index] })
    void saveSchedule(rules)
  }

  /* ===== 視聴の数え方（結果が取れないとき：選んだらすぐ保存） ===== */
  const [policy, setPolicy] = useState(editor.actionPolicy.missingResultPolicy)
  const [policyBusy, setPolicyBusy] = useState(false)
  const [policyError, setPolicyError] = useState('')
  const savePolicy = async (next: 'escalate' | 'retry_next_day') => {
    if (readOnly || policyBusy) return
    setPolicy(next)
    setPolicyBusy(true)
    setPolicyError('')
    try {
      const response = await webinarApi.saveEditor(webinar.id, { expectedVersion: editor.version, missingResultPolicy: next })
      ctx.onEditorChange(response.data)
    } catch {
      setPolicyError('保存できませんでした。時間をおいてもう一度お試しください。')
    } finally {
      setPolicyBusy(false)
    }
  }

  const [replaceOpen, setReplaceOpen] = useState(false)

  const saveCurrent = useRef<() => Promise<boolean>>(async () => true)
  saveCurrent.current = async () => {
    if (capacityEdit !== null) { setError('編集中の定員を保存するか、やめてから進んでください。'); return false }
    if (periodDirty && !(await savePeriod())) return false
    return true
  }
  useEffect(() => { onDirtyChange(periodDirty || capacityEdit !== null) }, [periodDirty, capacityEdit, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])
  useEffect(() => {
    if (readOnly) { registerSave(null); return }
    registerSave(() => saveCurrent.current())
    return () => registerSave(null)
  }, [registerSave, readOnly])

  const fileName = webinar.videoPrefix ? (webinar.videoPrefix.split('/').pop() ?? webinar.videoPrefix) : null
  const showStages = asset !== undefined && asset !== null && asset.stage !== 'ready'
  const stageIndex = asset ? STAGE_ORDER.indexOf(asset.stage) : -1
  const firstOnce = webinar.schedule.find((rule) => rule.type === 'once' && rule.at)
  const sessions = webinar.schedule.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.type === 'once' && rule.at && Number.isFinite(Date.parse(rule.at)))
  const otherRules = webinar.schedule.map((rule, index) => ({ rule, index })).filter(({ rule }) => !(scheduled && rule.type === 'once' && rule.at && Number.isFinite(Date.parse(rule.at))))

  const ruleMenu = (index: number, label: string, extra: Array<{ id: string; label: string; onSelect: () => void }> = []) => readOnly ? null : (
    <div className={form.menuBox}>
      <IconButton aria-label={`${label}の操作`} title={`${label}の操作`} aria-haspopup="menu" aria-expanded={menuOpen === index} disabled={busy} onClick={() => setMenuOpen((current) => (current === index ? null : index))}>
        <MoreHorizontal size={16} aria-hidden="true" />
      </IconButton>
      <ActionMenu
        open={menuOpen === index}
        onClose={() => setMenuOpen(null)}
        ariaLabel={`${label}の操作`}
        items={[
          ...extra,
          { id: 'duplicate', label: '複製する', onSelect: () => duplicateRule(index) },
          { id: 'remove', label: '消す', tone: 'danger' as const, onSelect: () => removeRule(index) },
        ]}
      />
    </div>
  )

  return (
    <CreatePage
      boardId={scheduled ? 'LPOe7' : 'VWNaA'}
      title={chrome.title}
      identity={chrome.identity}
      steps={chrome.steps}
      description={scheduled
        ? '日時指定配信：開催回ごとに日時と定員を決めます。動画は準備（変換など）が済んでから公開できます。'
        : '動画と、見られる期間を決めます。見終わったかどうかの決め方もここで決めます。'}
      footerActions={chrome.footerActions}
      status={chrome.status}
      preview={<>
        <h2 className={form.previewTitle}>公開ページでの見え方</h2>
        <div className={styles.pageCard}>
          <p className={styles.pageTitle} title={webinar.title}>{webinar.title}</p>
          <span className={styles.player} aria-hidden="true"><Play size={32} /></span>
          <p className={styles.pageNote}>
            {scheduled && firstOnce?.at
              ? `${shortJst(firstOnce.at)} から・${fmtJaDuration(webinar.durationSeconds)}`
              : `${webinar.publicationEndsAt ? '期間内だけ見られます' : 'いつでも見られます'}・${fmtJaDuration(webinar.durationSeconds)}`}
          </p>
        </div>
        {ctx.canOpenPublicPage && ctx.publicUrl ? (
          <div className={form.previewActions}>
            <Button href={ctx.publicUrl} target="_blank" rel="noreferrer"><Monitor size={15} aria-hidden="true" />PC で見る</Button>
            <Button href={ctx.publicUrl} target="_blank" rel="noreferrer"><Smartphone size={15} aria-hidden="true" />スマホで見る</Button>
          </div>
        ) : ctx.publicPageReason ? <p className={form.previewNote}>{ctx.publicPageReason}</p> : null}
      </>}
    >
      <section className={form.card} aria-labelledby="webinar-video-title" data-wc-pane="video">
        <div className={form.cardHead}><h2 id="webinar-video-title" className={form.cardTitle}>動画</h2></div>
        <div className={styles.videoRow}>
          <span className={styles.thumb} aria-hidden="true"><Play size={18} /></span>
          <span className={styles.videoText}>
            <span className={styles.videoName} title={fileName ?? undefined}>{fileName ?? '動画がまだ選ばれていません'}</span>
            <span className={styles.videoMeta}>{hasVideo ? `${fmtJaDuration(webinar.durationSeconds)}・16:9・自動再生なし` : '差し替えるから登録メディアの動画を選びます'}</span>
          </span>
          {readOnly ? null : <Button onClick={() => setReplaceOpen(true)}><Upload size={15} aria-hidden="true" />{hasVideo ? '差し替える' : '動画を選ぶ'}</Button>}
        </div>
        {showStages && asset ? <>
          <ol className={styles.stages} aria-label="動画の準備の段">
            {STAGES.map((stage, index) => {
              const done = asset.stage !== 'failed' && STAGE_ORDER.indexOf(stage.key) < stageIndex
              const current = stage.key === asset.stage
              return (
                <li key={stage.key} className={styles.stageItem}>
                  {index > 0 ? <span aria-hidden="true" className={styles.stageSep}>›</span> : null}
                  <span className={styles.stage} data-state={done ? 'done' : current ? 'current' : 'todo'} aria-current={current ? 'step' : undefined}>{done ? `✓ ${stage.label}` : stage.label}</span>
                </li>
              )
            })}
          </ol>
          <p className={styles.stageNote}>
            {asset.stage === 'failed'
              ? `動画の準備に失敗しました${asset.errorCode ? `（${asset.errorCode}）` : ''}。差し替えてください。`
              : `準備が済むまで公開できません（いま「${STAGES.find((stage) => stage.key === asset.stage)?.label ?? asset.stageLabel}」を作っています）`}
          </p>
        </> : null}
        {assetError ? <p className={styles.stageNote} role="alert">{assetError}<Button size="compact" onClick={() => void loadAsset()}>もう一度読み込む</Button></p> : null}
      </section>

      {scheduled ? null : (
        <section className={form.card} aria-labelledby="webinar-period-title">
          <div className={form.cardHead}><h2 id="webinar-period-title" className={form.cardTitle}>公開期間</h2></div>
          <div className={form.pair}>
            <div className={form.field}>
              <label className={form.label} htmlFor="webinar-period-start">公開の開始</label>
              <input id="webinar-period-start" type="datetime-local" className={styles.dateInput} value={startsAt} disabled={readOnly} onChange={(event) => setStartsAt(event.target.value)} />
            </div>
            <div className={form.field}>
              <label className={form.label} htmlFor="webinar-period-end">公開の終了<span className={form.optional}>任意</span></label>
              {noEnd
                ? <TextField id="webinar-period-end" value="なし（いつでも）" readOnly disabled={readOnly} onFocus={() => { if (!readOnly) setNoEnd(false) }} />
                : <input id="webinar-period-end" type="datetime-local" className={styles.dateInput} value={endsAt} disabled={readOnly} onChange={(event) => setEndsAt(event.target.value)} />}
              {!readOnly && !noEnd ? <Checkbox checked={noEnd} onCheckedChange={setNoEnd}>終わりを決めない（いつでも見られる）</Checkbox> : null}
            </div>
          </div>
          {periodError ? <Notice tone="danger">{periodError}</Notice> : null}
        </section>
      )}

      {scheduled ? (
        <section className={form.card} data-gap="tight" aria-labelledby="webinar-sessions-title">
          <div className={form.cardHeadRow}><h2 id="webinar-sessions-title" className={form.cardTitle}>開催回</h2></div>
          <p className={styles.note}>回ごとに日時と定員を決めます。定員を空にすると無制限</p>
          <div className={styles.sessionHead} role="presentation">
            <span className={styles.colWhen}>日時</span><span className={styles.colCap}>定員</span><span className={styles.colCount}>申込</span><span className={styles.colState}>状態</span>
          </div>
          {sessions.map(({ rule, index }) => (
            <SessionRow
              key={`${rule.at}-${index}`}
              webinarId={webinar.id}
              at={rule.at as string}
              readOnly={readOnly}
              editing={capacityEdit === index}
              onEdit={(on) => setCapacityEdit(on ? index : null)}
              menu={(openEdit) => ruleMenu(index, `${shortJst(rule.at as string)}の開催回`, [{ id: 'capacity', label: '定員を変える', onSelect: () => { setMenuOpen(null); openEdit() } }])}
            />
          ))}
          {sessions.length === 0 ? <p className={form.cardNote}>まだ開催回がありません。</p> : null}
          {otherRules.map(({ rule, index }) => <RuleRow key={index} rule={rule} menu={ruleMenu(index, `枠${index + 1}`)} />)}
          {readOnly ? null : <button type="button" className={form.textButton} disabled={busy} onClick={() => setAdding('one')}>＋ 枠を足す（毎日・毎週・単発）</button>}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </section>
      ) : (
        <section className={form.card} data-gap="tight" aria-labelledby="webinar-rules-title">
          <div className={form.cardHeadRow}><h2 id="webinar-rules-title" className={form.cardTitle}>{`配信枠 ${webinar.schedule.length}件`}</h2></div>
          <p className={styles.desc}>視聴できる時間の枠です。枠が0件だと公開できません。</p>
          {webinar.schedule.map((rule, index) => <RuleRow key={index} rule={rule} webinarId={webinar.id} menu={ruleMenu(index, `枠${index + 1}`)} />)}
          {webinar.schedule.length === 0 ? <p className={form.cardNote}>まだ枠がありません。下の「枠を足す」から足してください。</p> : null}
          {readOnly ? null : (
            <div className={form.buttons}>
              <Button disabled={busy} onClick={() => setAdding('one')}><Plus size={15} aria-hidden="true" />枠を足す（毎日・毎週・単発）</Button>
              <Button disabled={busy} onClick={() => setAdding('bulk')}><CalendarPlus size={15} aria-hidden="true" />まとめて作る</Button>
            </div>
          )}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </section>
      )}

      <section className={form.card} aria-labelledby="webinar-count-title">
        <div className={form.cardHead}><h2 id="webinar-count-title" className={form.cardTitle}>視聴の数え方</h2></div>
        <div className={form.pair}>
          <div className={form.field}>
            <label className={form.labelSmall} htmlFor="webinar-completion">視聴完了とみなす</label>
            <TextField id="webinar-completion" readOnly value="90%以上見たら視聴完了（変えられません）" title="視聴完了の決め方はサーバーが決めています（動画の9割以上）" />
          </div>
          <div className={form.field}>
            <label className={form.labelSmall} htmlFor="webinar-policy">結果が取れないとき</label>
            {readOnly
              ? <ReadValue label="結果が取れないとき">{policy === 'escalate' ? '担当へ上げる' : '翌日に取り直す'}</ReadValue>
              : <Select id="webinar-policy" aria-label="結果が取れないとき" size="full" value={policy} disabled={policyBusy} onChange={(value) => void savePolicy(value as 'escalate' | 'retry_next_day')} options={[{ value: 'retry_next_day', label: '翌日に取り直す' }, { value: 'escalate', label: '担当へ上げる' }]} />}
            {policyError ? <p className={form.fieldError} role="alert">{policyError}</p> : null}
          </div>
        </div>
      </section>

      {adding ? <AddRuleDialog mode={adding} busy={busy} error={error} onCancel={() => { if (!busy) { setAdding(null); setError('') } }} onAdd={async (rules) => { if (await saveSchedule([...webinar.schedule, ...rules])) setAdding(null) }} /> : null}
      {replaceOpen ? <ReplaceVideoDialog ctx={ctx} asset={asset} onAsset={setAsset} onClose={() => setReplaceOpen(false)} /> : null}
    </CreatePage>
  )
}

/** 配信枠の1行：札・中身・（単発なら）残り・「…」。 */
function RuleRow({ rule, webinarId, menu }: { rule: WebinarScheduleRule; webinarId?: string; menu: React.ReactNode }) {
  const view = ruleView(rule)
  const startAt = webinarId && rule.type === 'once' && rule.at && Number.isFinite(Date.parse(rule.at)) ? Math.floor(Date.parse(rule.at) / 1000) : null
  const { session, failed } = useSession(webinarId ?? '', startAt)
  return (
    <div className={form.listRow} data-kind={rule.type}>
      <span className={form.pill} data-tone={view.tone}><span className={form.pillDot} aria-hidden="true" />{view.kind}</span>
      <span className={`${form.rowMain} ${form.ellipsis}`} title={view.detail}>{view.detail}</span>
      {startAt !== null ? <span className={styles.side}>{sessionText(session, failed)}</span> : null}
      {menu}
    </div>
  )
}

/** 開催回の1行（日時・定員・申込・状態・「…」）。定員は「…」→ 定員を変える でその場で直す。 */
function SessionRow({ webinarId, at, readOnly, editing, onEdit, menu }: {
  webinarId: string
  at: string
  readOnly: boolean
  editing: boolean
  onEdit: (on: boolean) => void
  menu: (openEdit: () => void) => React.ReactNode
}) {
  const startAt = Math.floor(Date.parse(at) / 1000)
  const { session, setSession, failed, reload } = useSession(webinarId, startAt)
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const save = async () => {
    if (readOnly || lock.current) return
    const capacity = input.trim() === '' ? null : Number(input)
    if (capacity !== null && (!Number.isSafeInteger(capacity) || capacity < 1)) { setError('定員は1人以上の整数で入れてください。空にすると無制限です。'); return }
    lock.current = true
    setSaving(true)
    setError('')
    try {
      const response = await webinarApi.setSessionCapacity(webinarId, startAt, capacity)
      setSession(response.data.session)
      onEdit(false)
    } catch {
      setError('定員を保存できませんでした。入力は残しています。もう一度お試しください。')
    } finally {
      lock.current = false
      setSaving(false)
    }
  }
  const when = shortJst(at)
  return (
    <div className={`${form.listRow} ${styles.sessionRow}`}>
      <span className={styles.colWhen}><span className={styles.strong}>{when}</span></span>
      <span className={styles.colCap}>
        {editing ? (
          <span className={styles.capEdit}>
            <TextField aria-label={`${when}の定員（人）`} inputMode="numeric" value={input} disabled={saving} placeholder="無制限" onChange={(event) => setInput(event.target.value)} />
            <IconButton aria-label="定員を保存" title="定員を保存" disabled={saving} onClick={() => void save()}><Check size={15} aria-hidden="true" /></IconButton>
          </span>
        ) : <span className={styles.cell}>{session === undefined ? '—' : session?.capacity == null ? '無制限' : `${formatNumber(session.capacity)} 人`}</span>}
      </span>
      <span className={styles.colCount}><span className={styles.cell}>{session ? `${formatNumber(session.reservedCount)} 人` : '—'}</span></span>
      <span className={styles.colState}>
        <span className={form.pill} data-tone={session?.state === 'full' ? 'warn' : session?.state === 'open' ? 'info' : undefined}><span className={form.pillDot} aria-hidden="true" />{sessionText(session, failed)}</span>
      </span>
      {menu(() => { setInput(session?.capacity == null ? '' : String(session.capacity)); setError(''); onEdit(true) })}
      {editing ? <Button size="compact" disabled={saving} onClick={() => { onEdit(false); setError('') }}>やめる</Button> : null}
      {error ? <span className={styles.rowError} role="alert">{error}</span> : null}
      {failed ? <Button size="compact" onClick={reload}>もう一度読み込む</Button> : null}
    </div>
  )
}

/** 枠を足す（毎日・毎週・単発）／まとめて作る（日付の範囲に単発を1日1つ・31日まで）。 */
function AddRuleDialog({ mode, busy, error, onCancel, onAdd }: { mode: 'one' | 'bulk'; busy: boolean; error: string; onCancel: () => void; onAdd: (rules: WebinarScheduleRule[]) => Promise<void> }) {
  const [kind, setKind] = useState<'daily' | 'weekly' | 'once'>('daily')
  const [time, setTime] = useState('10:00')
  const [days, setDays] = useState<number[]>([6])
  const [date, setDate] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [localError, setLocalError] = useState('')
  const submit = () => {
    setLocalError('')
    if (mode === 'bulk') {
      if (!from || !to || from > to) { setLocalError('始まりと終わりの日付を正しく入れてください。'); return }
      const rules: WebinarScheduleRule[] = []
      const cursor = new Date(`${from}T00:00:00+09:00`)
      const end = new Date(`${to}T00:00:00+09:00`)
      while (cursor <= end && rules.length < 31) {
        const day = new Date(cursor.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
        rules.push({ type: 'once', at: toJstIso(`${day}T${time}`) })
        cursor.setTime(cursor.getTime() + 24 * 60 * 60 * 1000)
      }
      void onAdd(rules)
      return
    }
    const rule: WebinarScheduleRule | null = kind === 'daily'
      ? { type: 'daily', time }
      : kind === 'weekly'
        ? { type: 'weekly', days: [...days].sort(), time }
        : date ? { type: 'once', at: toJstIso(`${date}T${time}`) } : null
    if (!rule) { setLocalError('単発の枠は日付を入れてください。'); return }
    void onAdd([rule])
  }
  return (
    <Dialog open title={mode === 'bulk' ? '枠をまとめて作る' : '枠を足す'} description={mode === 'bulk' ? '日付の範囲に、単発の枠を1日1つずつ足します（31日まで）。' : '毎日・毎週・単発から選びます。'} confirmLabel={mode === 'bulk' ? 'まとめて足す' : '枠を足す'} busy={busy} error={localError || error || undefined} onConfirm={submit} onCancel={onCancel}>
      <div className={styles.dialogBody}>
        {mode === 'one' ? <Select label="枠の種類" aria-label="枠の種類" size="full" value={kind} onChange={(value) => setKind(value as typeof kind)} options={[{ value: 'daily', label: '毎日' }, { value: 'weekly', label: '毎週' }, { value: 'once', label: '単発' }]} /> : null}
        {mode === 'one' && kind === 'weekly' ? (
          <div className={styles.days} role="group" aria-label="曜日">
            {WEEKDAY.map((label, day) => (
              <button key={label} type="button" className={styles.day} aria-pressed={days.includes(day)} onClick={() => setDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort()))}>{label}</button>
            ))}
          </div>
        ) : null}
        {mode === 'one' && kind === 'once' ? <label className={form.field}><span className={form.labelSmall}>日付</span><input type="date" className={styles.dateInput} value={date} onChange={(event) => setDate(event.target.value)} /></label> : null}
        {mode === 'bulk' ? (
          <div className={form.pair}>
            <label className={form.field}><span className={form.labelSmall}>始まり</span><input type="date" className={styles.dateInput} value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className={form.field}><span className={form.labelSmall}>終わり</span><input type="date" className={styles.dateInput} value={to} onChange={(event) => setTo(event.target.value)} /></label>
          </div>
        ) : null}
        <label className={form.field}><span className={form.labelSmall}>時刻</span><input type="time" className={styles.dateInput} value={time} onChange={(event) => setTime(event.target.value)} /></label>
      </div>
    </Dialog>
  )
}

/** 動画を差し替える：登録メディアの動画から選び、長さを決める。準備の段もここで進める。 */
function ReplaceVideoDialog({ ctx, asset, onAsset, onClose }: { ctx: EditContext; asset: WebinarVideoAsset | null | undefined; onAsset: (asset: WebinarVideoAsset | null) => void; onClose: () => void }) {
  const { webinar } = ctx
  const EXTERNAL = '__external__'
  const [media, setMedia] = useState<MediaItem[] | null>(null)
  const [mediaError, setMediaError] = useState(false)
  const [choice, setChoice] = useState(webinar.videoMediaId ?? (webinar.videoPrefix ? EXTERNAL : ''))
  const [minutes, setMinutes] = useState(String(Math.round(webinar.durationSeconds / 60)))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!webinar.accountId) return
    let active = true
    void api.media.list(webinar.accountId, { kind: 'video', limit: 100 }).then((res) => {
      if (!active) return
      if (res.success) setMedia(res.data.items)
      else setMediaError(true)
    }).catch(() => { if (active) setMediaError(true) })
    return () => { active = false }
  }, [webinar.accountId])
  const save = async () => {
    const duration = Number(minutes)
    if (!Number.isFinite(duration) || duration <= 0) { setError('動画の長さ（分）を入れてください。'); return }
    setBusy(true)
    setError('')
    try {
      const res = await webinarApi.update(webinar.id, {
        durationSeconds: Math.round(duration * 60),
        ...(choice === EXTERNAL ? {} : { videoMediaId: choice || null }),
      })
      ctx.onWebinarSaved(res.data)
      onClose()
    } catch (cause) {
      setError(describeSaveFailure(cause))
    } finally {
      setBusy(false)
    }
  }
  const advance = async (stage: WebinarVideoAsset['stage']) => {
    setBusy(true)
    setError('')
    try {
      const res = await webinarApi.advanceVideoAsset(webinar.id, { stage })
      onAsset(res.data.asset)
    } catch {
      setError('段を進められませんでした。権限か段の順番を確かめてください。')
    } finally {
      setBusy(false)
    }
  }
  const nexts = asset === null ? (['uploaded'] as WebinarVideoAsset['stage'][]) : asset ? NEXT_STAGE[asset.stage] ?? [] : []
  return (
    <Dialog open title="動画を差し替える" description="登録メディアの動画から選びます。保存しても、公開中の内容は「確認」で公開し直すまで変わりません。" confirmLabel="保存する" busy={busy} error={error || undefined} onConfirm={() => void save()} onCancel={() => { if (!busy) onClose() }}>
      <div className={styles.dialogBody}>
        {mediaError ? <Notice tone="info">登録メディアの動画を読み込めませんでした。</Notice> : null}
        <Select label="動画" aria-label="動画" size="full" value={choice} disabled={media === null && !mediaError} onChange={setChoice} options={[
          { value: '', label: '選ばない' },
          ...(webinar.videoPrefix && !webinar.videoMediaId ? [{ value: EXTERNAL, label: `今の動画のまま（${webinar.videoPrefix}）` }] : []),
          ...(media ?? []).map((item) => ({ value: item.id, label: item.filename })),
          ...(choice && choice !== EXTERNAL && media && !media.some((item) => item.id === choice) ? [{ value: choice, label: '今の動画' }] : []),
        ]} />
        <label className={form.field}><span className={form.labelSmall}>動画の長さ（分）</span><TextField inputMode="numeric" value={minutes} onChange={(event) => setMinutes(event.target.value)} /></label>
        {nexts.length > 0 ? (
          <div className={form.field}>
            <span className={form.labelSmall}>動画の準備（検査・変換・配信の形・表紙を通した動画だけ公開できます）</span>
            <div className={form.buttons}>{nexts.map((next) => <Button key={next} disabled={busy} onClick={() => void advance(next)}>{NEXT_LABEL[next] ?? next}</Button>)}</div>
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}
