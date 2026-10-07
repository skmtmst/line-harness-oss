'use client'

/*
 * ★V8 ウェビナーの ④通知（Pencil E7iAYs）。
 * 通知とリマインド（送った数・6つの通知の入／切と時刻）→ 視聴後にすること（3つの場合・本文・取れないとき）。
 * 右は LINE での見え方（選んだ通知の本文）。
 * 口・保存の順（通知の設定 → 版のある設定）・テスト送信は app/webinars/edit/notifications-v8.tsx と
 * components/webinars/webinar-notifications.tsx と同じ（BEHAVIOR.md）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { MoreHorizontal, Plus, Send } from 'lucide-react'
import { CreatePage } from '@/components/templates'
import ActionMenu from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import HelpTip from '@/components/shared/help-tip'
import IconButton from '@/components/shared/icon-button'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { TimeField } from '@/components/shared/date-time-field'
import { TextField } from '@/components/shared/text-field'
import { notifyToast } from '@/components/shared/toast'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { useAccount } from '@/contexts/account-context'
import {
  webinarApi,
  type WebinarAction,
  type WebinarEditor,
  type WebinarNotificationOverview,
  type WebinarNotificationSettings,
  type WebinarNotificationSettingsInput,
} from '@/lib/api'
import { formatNumber } from '@/lib/format'
import { ReadValue } from './parts'
import type { EditContext, PaneSaveProps, WizardChrome } from './types'
import form from './form.module.css'
import styles from './notifications.module.css'

const SETTINGS_KEYS = [
  'registrationEnabled', 'dayBeforeEnabled', 'dayBeforeTime',
  'hourBeforeEnabled', 'hourBeforeMinutes', 'startEnabled',
  'missedEnabled', 'missedTime', 'missedWindowDays', 'completedEnabled',
] as const

/* 設定がまだ無いときの始まり。勝手に入れない（全部切って始める）。 */
const emptySettings = (webinarId: string): WebinarNotificationSettings => ({
  webinarId, version: 0,
  registrationEnabled: false, dayBeforeEnabled: false, dayBeforeTime: '18:00',
  hourBeforeEnabled: false, hourBeforeMinutes: 60, startEnabled: false,
  missedEnabled: false, missedTime: '20:00', missedWindowDays: 7, completedEnabled: false,
  updatedAt: '',
})

const HOUR_OPTIONS = [15, 30, 60, 120].map((minutes) => ({ value: String(minutes), label: String(minutes) }))
const WINDOW_OPTIONS = Array.from({ length: 30 }, (_, index) => ({ value: String(index + 1), label: String(index + 1) }))

type RowKey = 'registration' | 'dayBefore' | 'hourBefore' | 'start' | 'missed' | 'completed'

const TRIGGERS: Array<{ key: WebinarAction['trigger']; label: string }> = [
  { key: 'completed', label: '視聴完了' },
  { key: 'cta_clicked', label: 'CTA クリック' },
  { key: 'unviewed', label: '未視聴' },
]
const ACTION_LABEL: Record<WebinarAction['actionType'], string> = {
  add_tag: 'タグを付ける', remove_tag: 'タグを外す', start_scenario: 'シナリオを始める', stop_scenario: 'シナリオを止める',
  resume_scenario: 'シナリオを再開する', send_message: 'メッセージを送る', send_webhook: 'Webhookを送る',
  switch_rich_menu: 'リッチメニューを変える', remove_rich_menu: 'リッチメニューを外す',
}
function referenceKey(type: WebinarAction['actionType']): string | null {
  if (type === 'add_tag' || type === 'remove_tag') return 'tagId'
  if (type === 'start_scenario' || type === 'stop_scenario' || type === 'resume_scenario') return 'scenarioId'
  if (type === 'send_message') return 'templateId'
  if (type === 'send_webhook') return 'webhookId'
  if (type === 'switch_rich_menu') return 'richMenuPageId'
  return null
}
function actionSummary(action: WebinarAction): string {
  const key = referenceKey(action.actionType)
  const ref = key ? String(action.config[key] ?? '').trim() : ''
  if (action.actionType === 'add_tag' && ref) return `タグ「${ref}」を付ける`
  if (action.actionType === 'start_scenario' && ref) return `シナリオ「${ref}」を始める`
  return ACTION_LABEL[action.actionType]
}

export default function NotificationsPane({ ctx, chrome, onDirtyChange, registerSave }: { ctx: EditContext; chrome: WizardChrome } & PaneSaveProps) {
  const { webinar, editor, readOnly } = ctx
  const webinarId = webinar.id
  const { accounts } = useAccount()
  const account = accounts.find((item) => item.id === webinar.accountId)
  const accountName = account?.displayName ?? account?.name ?? '公式アカウント'

  /* ===== 通知の設定 ===== */
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [baseline, setBaseline] = useState<WebinarNotificationSettings | null>(null)
  const [overview, setOverview] = useState<WebinarNotificationOverview | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading')
  const generation = useRef(0)
  const load = useCallback(async () => {
    const request = ++generation.current
    setLoadState('loading')
    try {
      const res = await webinarApi.notifications(webinarId)
      if (!res.data || typeof res.data !== 'object') throw new Error('shape')
      if (request !== generation.current) return
      setSettings(res.data.settings)
      setBaseline(res.data.settings)
      setOverview(res.data.overview ?? null)
      setLoadState('ready')
    } catch {
      if (request === generation.current) setLoadState('error')
    }
  }, [webinarId])
  useEffect(() => { void load(); return () => { generation.current += 1 } }, [load])
  const patch = (next: Partial<WebinarNotificationSettingsInput>) => setSettings((prev) => (prev ? { ...prev, ...next } : prev))
  const notificationDirty = settings !== null && baseline !== null && (baseline.version === 0 || SETTINGS_KEYS.some((key) => settings[key] !== baseline[key]))

  /* ===== 視聴後にすること ===== */
  const [actions, setActions] = useState<WebinarAction[] | null>(null)
  const [actionError, setActionError] = useState(false)
  const [actionAttempt, setActionAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setActions(null)
    setActionError(false)
    webinarApi.actions(webinarId).then((res) => { if (active) setActions(res.data) }).catch(() => { if (active) setActionError(true) })
    return () => { active = false }
  }, [webinarId, actionAttempt])
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy?.templateBody ?? '')
  const [policy, setPolicy] = useState<WebinarEditor['actionPolicy']['missingResultPolicy']>(editor.actionPolicy?.missingResultPolicy ?? 'escalate')
  const [policyBase, setPolicyBase] = useState({ templateBody: editor.actionPolicy?.templateBody ?? '', policy: editor.actionPolicy?.missingResultPolicy ?? 'escalate' })
  const policyDirty = templateBody !== policyBase.templateBody || policy !== policyBase.policy
  useEffect(() => {
    if (policyDirty) return
    const next = { templateBody: editor.actionPolicy?.templateBody ?? '', policy: editor.actionPolicy?.missingResultPolicy ?? 'escalate' }
    setTemplateBody(next.templateBody)
    setPolicy(next.policy)
    setPolicyBase(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.actionPolicy?.templateBody, editor.actionPolicy?.missingResultPolicy])

  const dirty = notificationDirty || policyDirty
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const [error, setError] = useState('')
  const save = async (): Promise<boolean> => {
    if (saveLock.current || readOnly) return false
    saveLock.current = true
    setSaving(true)
    setError('')
    try {
      let version = editor.version
      if (notificationDirty && settings) {
        const input: WebinarNotificationSettingsInput = {
          registrationEnabled: settings.registrationEnabled,
          dayBeforeEnabled: settings.dayBeforeEnabled,
          dayBeforeTime: settings.dayBeforeTime,
          hourBeforeEnabled: settings.hourBeforeEnabled,
          hourBeforeMinutes: settings.hourBeforeMinutes,
          startEnabled: settings.startEnabled,
          missedEnabled: settings.missedEnabled,
          missedTime: settings.missedTime,
          missedWindowDays: settings.missedWindowDays ?? 7,
          completedEnabled: settings.completedEnabled,
        }
        try {
          const res = await webinarApi.saveNotifications(webinarId, input)
          setSettings(res.data.settings)
          setBaseline(res.data.settings)
          notifyToast(`保存しました。${res.data.queued}件を予定に入れ、${res.data.cancelled}件を取り消しました。`)
        } catch {
          setError('通知の設定を保存できませんでした。入力を残しました。もう一度お試しください。')
          return false
        }
        void load()
        const refreshed = await webinarApi.editor(webinarId)
        version = refreshed.data.version
        ctx.onEditorChange(refreshed.data)
      }
      if (policyDirty) {
        const res = await webinarApi.saveEditor(webinarId, { expectedVersion: version, actionTemplateBody: templateBody, missingResultPolicy: policy })
        setPolicyBase({ templateBody, policy })
        ctx.onEditorChange(res.data)
      }
      return true
    } catch (cause) {
      setError(webinarErrorText(cause, '保存できませんでした。入力を残しました。もう一度お試しください。'))
      return false
    } finally {
      saveLock.current = false
      setSaving(false)
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    if (readOnly) { registerSave(null); return }
    registerSave(() => saveRef.current())
    return () => registerSave(null)
  }, [registerSave, readOnly])

  /* ===== テスト送信 ===== */
  const [testOpen, setTestOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const testLock = useRef(false)
  const [testResult, setTestResult] = useState('')
  const runTest = async () => {
    if (testLock.current) return
    testLock.current = true
    setTesting(true)
    setTestResult('')
    try {
      if (dirty && !(await saveRef.current())) return
      setTestOpen(false)
      const res = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${res.data.sent}件・失敗 ${res.data.failed}件`)
      const refreshed = await webinarApi.editor(webinarId)
      ctx.onEditorChange(refreshed.data)
    } catch (cause) {
      setTestResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      testLock.current = false
      setTesting(false)
    }
  }
  const testDone = !dirty && editor.notificationTest?.status === 'passed'

  /* ===== 視聴後の動きを変える窓 ===== */
  const [actionsOpen, setActionsOpen] = useState<WebinarAction['trigger'] | null>(null)
  const [menuOpen, setMenuOpen] = useState<WebinarAction['trigger'] | null>(null)

  /* ===== 見え方 ===== */
  const [previewKey, setPreviewKey] = useState<RowKey>('dayBefore')

  const available = overview !== null
  const count = (value: number | undefined) => (available && typeof value === 'number' ? formatNumber(value) : '—')

  const timeBox = (value: string, label: string, onChange: (next: string) => void) => (readOnly
    ? <ReadValue compact label={label}>{value}</ReadValue>
    : <TimeField className={styles.time} value={value} aria-label={label} disabled={saving} onChange={(next) => { if (next) onChange(next) }} />
  )
  const smallSelect = (value: string, label: string, options: Array<{ value: string; label: string }>, onChange: (next: string) => void) => (readOnly
    ? <ReadValue compact label={label}>{options.find((option) => option.value === value)?.label ?? value}</ReadValue>
    : <div className={styles.small}><Select aria-label={label} size="full" value={value} disabled={saving} onChange={onChange} options={options} /></div>
  )

  const rows: Array<{ key: RowKey; label: string; on: boolean; toggle: () => void; extra: ReactNode; caption: string }> = settings ? [
    { key: 'registration', label: '申込のお礼', on: settings.registrationEnabled, toggle: () => patch({ registrationEnabled: !settings.registrationEnabled }), extra: <span className={styles.rowText}>申し込んだらすぐ</span>, caption: '申込のすぐあと' },
    { key: 'dayBefore', label: '前日のご案内', on: settings.dayBeforeEnabled, toggle: () => patch({ dayBeforeEnabled: !settings.dayBeforeEnabled }), extra: <><span className={styles.rowText}>前日の</span>{timeBox(settings.dayBeforeTime, '前日のご案内を送る時刻', (next) => patch({ dayBeforeTime: next }))}</>, caption: `開始の前日 ${settings.dayBeforeTime}` },
    { key: 'hourBefore', label: '開始前のお知らせ', on: settings.hourBeforeEnabled, toggle: () => patch({ hourBeforeEnabled: !settings.hourBeforeEnabled }), extra: <><span className={styles.rowText}>開始の</span>{smallSelect(String(settings.hourBeforeMinutes), '開始前のお知らせを送るのは何分前か', HOUR_OPTIONS, (value) => patch({ hourBeforeMinutes: Number(value) }))}<span className={styles.rowText}>分前</span></>, caption: `開始の ${settings.hourBeforeMinutes} 分前` },
    { key: 'start', label: '開始のお知らせ', on: settings.startEnabled, toggle: () => patch({ startEnabled: !settings.startEnabled }), extra: <span className={styles.rowText}>開始したとき</span>, caption: '開始したとき' },
    { key: 'missed', label: '見逃した人への案内', on: settings.missedEnabled, toggle: () => patch({ missedEnabled: !settings.missedEnabled }), extra: <><span className={styles.rowText}>翌日の</span>{timeBox(settings.missedTime, '見逃した人への案内を送る時刻', (next) => patch({ missedTime: next }))}<span className={styles.rowText}>・見られる期限</span>{smallSelect(String(settings.missedWindowDays ?? 7), '見逃した人が見られる期限（日数）', WINDOW_OPTIONS, (value) => patch({ missedWindowDays: Number(value) }))}<span className={styles.rowText}>日</span></>, caption: `翌日 ${settings.missedTime}` },
    { key: 'completed', label: '見終わった人へのお礼', on: settings.completedEnabled, toggle: () => patch({ completedEnabled: !settings.completedEnabled }), extra: <span className={styles.rowText}>見終わったら</span>, caption: '見終わったら' },
  ] : []
  const previewRow = rows.find((row) => row.key === previewKey) ?? rows[0]
  const previewText = (editor.notificationMessages?.[previewKey] ?? '').trim()

  let notificationBody: ReactNode
  if (loadState === 'loading') notificationBody = <ListState kind="loading" />
  else if (loadState === 'error') notificationBody = <ListState kind="error" title="通知の設定を読み込めませんでした" description="通信を確認して、もう一度読み込んでください。" action={<Button onClick={() => void load()}>もう一度読み込む</Button>} />
  else if (!settings) {
    notificationBody = <ListState kind="empty" title="通知の設定がまだありません" description="届けるものを決めて保存すると、申込・前日・開始前の通知が届くようになります。最初は全部オフから始めます。" action={readOnly ? undefined : <Button onClick={() => { const initial = emptySettings(webinarId); setSettings(initial); setBaseline(initial) }}>通知の設定を入力する</Button>} />
  } else {
    notificationBody = <>
      <dl className={styles.counts}>
        {([['送った', overview?.sent], ['届かなかった', overview?.failed], ['見送り', overview?.skipped]] as const).map(([label, value]) => (
          <div key={label} className={styles.countItem}><dt className={styles.countLabel}>{label}</dt><dd className={styles.countValue}>{count(value)}</dd></div>
        ))}
      </dl>
      <ul className={styles.rows}>
        {rows.map((row) => (
          <li key={row.key} className={styles.row} data-selected={row.key === previewKey || undefined}>
            <button type="button" className={styles.rowLabel} onClick={() => setPreviewKey(row.key)} title="右の見え方に出す">{row.label}</button>
            <div className={styles.rowExtra}>{row.extra}</div>
            {readOnly
              ? <span className={styles.state}>{row.on ? '送る' : '送らない'}</span>
              : <Toggle checked={row.on} onChange={row.toggle} label={row.label} />}
          </li>
        ))}
      </ul>
      {available && (overview?.skippedReasons?.length ?? 0) > 0 ? (
        <ul className={styles.reasons} aria-label="見送りの内訳">
          {overview!.skippedReasons.map((reason) => <li key={reason.code ?? 'unknown'}><span>{reason.label}</span><span>{formatNumber(reason.count)}件</span></li>)}
        </ul>
      ) : null}
      {readOnly ? null : (
        <div><Button onClick={() => setTestOpen(true)} disabled={testing || saving || testDone} title={testDone ? 'テスト済みです' : undefined} busy={testing} busyLabel="送信中…"><Send size={15} aria-hidden="true" />{testDone ? 'テスト送信済み（全部）' : 'テストを送る（全部）'}</Button></div>
      )}
    </>
  }

  return (
    <CreatePage
      boardId="E7iAYs"
      title={chrome.title}
      identity={chrome.identity}
      steps={chrome.steps}
      description="いつ LINE で知らせるかと、見た人・見なかった人に何をするかを決めます。"
      footerActions={chrome.footerActions}
      status={chrome.status}
      preview={<>
        <LinePreview accountName={accountName} caption={previewRow?.caption ?? '今日'}>
          {previewText
            ? <LinePreviewMessage accountName={accountName} avatar={accountName.trim().charAt(0) || 'L'} time="">{previewText}</LinePreviewMessage>
            : <p className={styles.previewEmpty}>{`「${previewRow?.label ?? '通知'}」の本文はまだありません。送るときに決まった文面を使います。`}</p>}
        </LinePreview>
        <div className={form.previewActions}>
          {readOnly ? null : <Button onClick={() => setTestOpen(true)} disabled={testing || saving || testDone || !settings} busy={testing} busyLabel="送信中…">{testDone ? 'テスト送信済み' : 'テストを送る'}</Button>}
          {ctx.canOpenPublicPage && ctx.publicUrl ? <Button href={ctx.publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : null}
        </div>
        {!ctx.canOpenPublicPage && ctx.publicPageReason ? <p className={form.previewNote}>{ctx.publicPageReason}</p> : null}
      </>}
    >
      <section className={form.card} data-gap="tight" aria-labelledby="webinar-notify-title" data-wc-pane="notifications">
        <div className={form.cardHeadRow}>
          <h2 id="webinar-notify-title" className={form.cardTitle}>通知とリマインド</h2>
          <HelpTip label="送った数と通知の対象">{`予定 ${count(overview?.pending)}件・取消 ${count(overview?.cancelled)}件・合計 ${count(overview?.total)}件。通知の対象：${overview?.audience ? `${formatNumber(overview.audience.people)}人（取消を除いた有効な申込。延べ予約は${formatNumber(overview.audience.bookings)}件）` : '—'}`}</HelpTip>
        </div>
        <p className={styles.desc}>LINE で送るお知らせです。テストは全部をまとめて自分に送ります。</p>
        {notificationBody}
      </section>

      <section className={form.card} data-gap="tight" aria-labelledby="webinar-after-title">
        <h2 id="webinar-after-title" className={form.cardTitle}>視聴後にすること</h2>
        <p className={styles.desc}>見たかどうかで、タグを付けたりシナリオを始めたりします。</p>
        {actionError ? (
          <Notice tone="info" action={<Button onClick={() => setActionAttempt((value) => value + 1)}>もう一度読み込む</Button>}>視聴後の設定を読み込めませんでした。</Notice>
        ) : (
          <ul className={styles.rows}>
            {TRIGGERS.map((trigger) => {
              const list = actions?.filter((action) => action.trigger === trigger.key) ?? []
              const text = actions === null ? '読み込んでいます' : list.map(actionSummary).join('・') || 'まだ何もしない'
              const menuLabel = `${trigger.label}のときの動きの操作`
              return (
                <li key={trigger.key} className={styles.row} data-tall>
                  <span className={styles.afterLabel}>{trigger.label}</span>
                  <span className={`${styles.rowText} ${styles.afterText}`} title={text}>{text}</span>
                  {readOnly ? null : (
                    <div className={form.menuBox}>
                      <IconButton aria-label={menuLabel} title={menuLabel} aria-haspopup="menu" aria-expanded={menuOpen === trigger.key} onClick={() => setMenuOpen((current) => (current === trigger.key ? null : trigger.key))}>
                        <MoreHorizontal size={16} aria-hidden="true" />
                      </IconButton>
                      <ActionMenu
                        open={menuOpen === trigger.key}
                        onClose={() => setMenuOpen(null)}
                        ariaLabel={menuLabel}
                        items={[{ id: 'edit', label: '動きを変える', onSelect: () => { setMenuOpen(null); setActionsOpen(trigger.key) } }]}
                      />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className={form.field}>
          <label className={form.label} htmlFor="webinar-action-message">視聴完了のメッセージ</label>
          <TextField id="webinar-action-message" aria-label="視聴完了メッセージ本文" value={templateBody} disabled={readOnly || saving} onChange={(event) => setTemplateBody(event.target.value)} />
        </div>
        <div className={form.field}>
          <label className={form.labelSmall} htmlFor="webinar-missing-policy">結果が取れないとき</label>
          <div className={styles.policy}>
            {readOnly
              ? <ReadValue label="視聴結果を取得できない場合">{policy === 'escalate' ? '要対応へ追加' : '翌日に取り直す'}</ReadValue>
              : <Select id="webinar-missing-policy" aria-label="視聴結果を取得できない場合" size="full" value={policy} disabled={saving} onChange={(value) => setPolicy(value as typeof policy)} options={[{ value: 'escalate', label: '要対応へ追加' }, { value: 'retry_next_day', label: '翌日に取り直す' }]} />}
          </div>
        </div>
        {readOnly ? null : <div><Button onClick={() => setActionsOpen('completed')}><Plus size={15} aria-hidden="true" />条件を足す</Button></div>}
      </section>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {testResult ? <p role="status" className={form.previewNote}>{testResult}</p> : null}

      <ConfirmDialog open={testOpen} title="通知をテスト送信しますか？" description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。" confirmLabel="テストを送る" busy={testing} onCancel={() => { if (!testing) setTestOpen(false) }} onConfirm={() => void runTest()}>
        <p className={form.cardNote}>{dirty ? '保存していない設定を保存してから送ります。' : ''}{`対象：「${webinar.title}」の入っている通知。本文は設定済みのものを送ります。`}</p>
      </ConfirmDialog>
      {actionsOpen && actions ? (
        <ActionsDialog
          webinarId={webinarId}
          initialTrigger={actionsOpen}
          actions={actions}
          onClose={() => setActionsOpen(null)}
          onSaved={(next) => { setActions(next); setActionsOpen(null) }}
        />
      ) : null}
    </CreatePage>
  )
}

/** 視聴後の動きを変える窓。場合ごとに動きを足す・外す・保存（口は webinarApi.saveActions）。 */
function ActionsDialog({ webinarId, initialTrigger, actions, onClose, onSaved }: {
  webinarId: string
  initialTrigger: WebinarAction['trigger']
  actions: WebinarAction[]
  onClose: () => void
  onSaved: (next: WebinarAction[]) => void
}) {
  const [draft, setDraft] = useState<WebinarAction[]>(actions)
  const [trigger, setTrigger] = useState(initialTrigger)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const visible = draft.filter((action) => action.trigger === trigger)
  const update = (target: WebinarAction, patchValue: Partial<WebinarAction>) => setDraft((current) => current.map((action) => (action === target ? { ...action, ...patchValue } : action)))
  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const response = await webinarApi.saveActions(webinarId, draft)
      onSaved(response.data)
    } catch {
      setError('保存できませんでした。状態を読み直して、もう一度お試しください。')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Dialog open title="視聴後の動きを変える" description="見終わった・CTA を押した・見ていない、の場合ごとに動きを決めます。" confirmLabel="保存する" busy={saving} error={error || undefined} onConfirm={() => void save()} onCancel={() => { if (!saving) onClose() }}>
      <div className={styles.dialogBody}>
        <Select aria-label="どの場合か" size="full" value={trigger} onChange={(value) => setTrigger(value as WebinarAction['trigger'])} options={TRIGGERS.map((item) => ({ value: item.key, label: item.label }))} />
        {visible.length === 0 ? <p className={form.cardNote}>この場合の動きはまだありません。</p> : visible.map((action, index) => {
          const key = referenceKey(action.actionType)
          return (
            <div key={action.id ?? `${trigger}-${index}`} className={styles.dialogRow}>
              <Select aria-label="する動き" size="full" value={action.actionType} onChange={(value) => update(action, { actionType: value as WebinarAction['actionType'], config: {} })} options={Object.entries(ACTION_LABEL).map(([value, label]) => ({ value, label }))} />
              {key ? <TextField aria-label="対象（タグ・シナリオなどの名前やID）" value={String(action.config[key] ?? '')} onChange={(event) => update(action, { config: { [key]: event.target.value } })} placeholder="対象の名前・ID" /> : <span className={form.cardNote}>ほかに決めることはありません</span>}
              <Button onClick={() => setDraft((current) => current.filter((item) => item !== action))}>外す</Button>
            </div>
          )
        })}
        <div><Button onClick={() => setDraft((current) => [...current, { trigger, actionType: 'add_tag', config: { tagId: '' } }])}><Plus size={15} aria-hidden="true" />動きを足す</Button></div>
      </div>
    </Dialog>
  )
}
