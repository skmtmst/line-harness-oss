'use client'

/*
 * ★V8-B ウェビナー編集④通知（板 `E7iAYs`）。
 *
 * 見本の形：通知とリマインド（送った数と6つのトグル・時刻）と、
 * 視聴後にすること（3つの条件の概要・お礼の文面・結果が取れないとき）。
 * トグルと文面の保存は下の帯の「下書きを保存」に載せる（段の登録式）。
 * 口は v7 と同じ（`notifications`・`saveNotifications`・`actions`・
 * `saveEditor`・`testNotifications`）。アクションの足し引きは
 * 視聴後アクションの段（対象外）に残し、ここでは概要だけ出す。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import ListState from '@/components/shared/list-state'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import Toggle from '@/components/shared/toggle'
import { ApiError, webinarApi, type WebinarAction, type WebinarEditor, type WebinarNotificationOverview, type WebinarNotificationSettings } from '@/lib/api'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { notificationPreview } from './preview-body'
import styles from './notifications-v8.module.css'

const ACTION_LABELS: Record<WebinarAction['actionType'], string> = {
  add_tag: 'タグを付ける',
  remove_tag: 'タグを外す',
  start_scenario: 'シナリオを開始する',
  stop_scenario: 'シナリオを停止する',
  resume_scenario: 'シナリオを再開する',
  send_message: 'LINEメッセージまたはテンプレートを送る',
  send_webhook: '外部Webhookへ送る',
  switch_rich_menu: 'リッチメニューを切り替える',
  remove_rich_menu: 'リッチメニューを外す',
}

const TRIGGER_LABELS: Record<WebinarAction['trigger'], string> = {
  completed: '視聴完了',
  cta_clicked: 'CTAクリック',
  unviewed: '未視聴',
}

function actionSummary(action: WebinarAction): string {
  const base = ACTION_LABELS[action.actionType]
  if (action.actionType === 'add_tag' || action.actionType === 'remove_tag') {
    const tag = typeof action.config?.tagId === 'string' && action.config.tagId ? `「${action.config.tagId}」` : ''
    return `${base}${tag ? ` タグ${tag}を付ける` : ''}`
  }
  if (action.actionType === 'start_scenario' || action.actionType === 'stop_scenario' || action.actionType === 'resume_scenario') {
    const scenario = typeof action.config?.scenarioId === 'string' && action.config.scenarioId ? `「${action.config.scenarioId}」` : ''
    return scenario ? `シナリオ${scenario}を始める` : base
  }
  if (action.actionType === 'send_message') return '案内を送る'
  return base
}

export default function NotificationsStepV8({ webinarId, webinarTitle, editor, onEditorChange, onDirtyChange, registerSave, onConflict }: {
  webinarId: string
  webinarTitle: string
  editor: WebinarEditor
  onEditorChange: (editor: WebinarEditor) => void
  onDirtyChange: (dirty: boolean) => void
  registerSave: (save: (() => Promise<boolean>) | null) => void
  onConflict: () => void
}) {
  const [settings, setSettings] = useState<WebinarNotificationSettings | null>(null)
  const [overview, setOverview] = useState<WebinarNotificationOverview | null>(null)
  const [failed, setFailed] = useState(false)
  const [baseline, setBaseline] = useState('')
  const [actions, setActions] = useState<WebinarAction[] | null>(null)
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy.templateBody)
  const [missingPolicy, setMissingPolicy] = useState(editor.actionPolicy.missingResultPolicy)
  const [policyBaseline, setPolicyBaseline] = useState(JSON.stringify({ templateBody: editor.actionPolicy.templateBody, missingResultPolicy: editor.actionPolicy.missingResultPolicy }))
  const [message, setMessage] = useState('')
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const id = ++requestId.current
    setSettings(null)
    setFailed(false)
    try {
      const res = await webinarApi.notifications(webinarId)
      if (id !== requestId.current) return
      setSettings(res.data.settings)
      setOverview(res.data.overview)
      setBaseline(JSON.stringify(res.data.settings))
    } catch {
      if (id !== requestId.current) return
      setFailed(true)
    }
  }, [webinarId])

  const loadActions = useCallback(async () => {
    try {
      const res = await webinarApi.actions(webinarId)
      setActions(res.data)
    } catch {
      setActions([])
    }
  }, [webinarId])

  useEffect(() => {
    void load()
    void loadActions()
    return () => { requestId.current += 1 }
  }, [load, loadActions])

  const settingsDirty = settings !== null && JSON.stringify(settings) !== baseline
  const policyDirty = JSON.stringify({ templateBody, missingResultPolicy: missingPolicy }) !== policyBaseline
  const dirty = settingsDirty || policyDirty
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])

  const save = useCallback(async (): Promise<boolean> => {
    if (!dirty) return true
    setMessage('')
    try {
      if (settingsDirty && settings) {
        const { webinarId: _webinarId, version: _version, updatedAt: _updatedAt, ...input } = settings
        const res = await webinarApi.saveNotifications(webinarId, input)
        setSettings(res.data.settings)
        setBaseline(JSON.stringify(res.data.settings))
      }
      if (policyDirty) {
        const editorResponse = await webinarApi.saveEditor(webinarId, {
          expectedVersion: editor.version,
          actionTemplateBody: templateBody,
          missingResultPolicy: missingPolicy,
        })
        onEditorChange(editorResponse.data)
        setPolicyBaseline(JSON.stringify({ templateBody, missingResultPolicy: missingPolicy }))
      }
      setMessage('通知の設定を保存しました')
      return true
    } catch (cause) {
      /* 他の人が先に保存したときは競合の帯を出す（板 `pvimJ`）。 */
      if (cause instanceof ApiError && cause.status === 409) onConflict()
      setMessage(webinarErrorText(cause, '保存できませんでした。開き直して試してください。'))
      return false
    }
  }, [dirty, settingsDirty, policyDirty, settings, templateBody, missingPolicy, webinarId, editor.version, onEditorChange, onConflict])

  useEffect(() => {
    registerSave(dirty ? save : null)
    return () => registerSave(null)
  }, [dirty, registerSave, save])

  const update = (patch: Partial<WebinarNotificationSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  /*
    テスト送信は実際にLINEへ届く。押す前に、送る相手と文面を確認させる。
    設定が読めていない間は実行可能に見せない。
  */
  const notificationTestDone = editor.notificationTest?.status === 'passed'
  const runNotificationTest = async () => {
    setTestConfirmOpen(false)
    setTesting(true)
    setTestResult('')
    try {
      const response = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${response.data.sent}件・失敗 ${response.data.failed}件`)
      webinarApi.editor(webinarId)
        .then((editorResponse) => onEditorChange(editorResponse.data))
        .catch(() => undefined)
    } catch (cause) {
      setTestResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。'))
    } finally {
      setTesting(false)
    }
  }

  const previewBody = editor.notificationMessages.registration || notificationPreview(null).empty

  return (
    <div className={styles.columns}>
      <div className={styles.main}>
        {message ? <Notice tone="info">{message}</Notice> : null}
        <section className={styles.card} aria-label="通知とリマインド">
          <h2 className={styles.cardTitle}>通知とリマインド</h2>
          <p className={styles.cardDesc}>LINEで送るお知らせです。テストは全部をまとめて自分に送ります。</p>
          {overview ? (
            <p className={styles.counts}>
              <span><strong>{overview.sent}</strong> 送った</span>
              <span><strong>{overview.failed}</strong> 届かなかった</span>
              <span><strong>{overview.skipped}</strong> 見送り</span>
            </p>
          ) : null}
          {settings === null ? (
            failed ? (
              <Notice
                tone="danger"
                action={<button type="button" onClick={() => void load()} className="font-medium underline">もう一度読み込む</button>}
              >
                通知の設定を読み込めませんでした。読み込めるまで保存はできません。
              </Notice>
            ) : <ListState kind="loading" />
          ) : (
            <ul className={styles.rows}>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>申込のお礼</span><span className={styles.rowNote}>申し込んだらすぐ</span></span>
                <Toggle checked={settings.registrationEnabled} onChange={(checked) => update({ registrationEnabled: checked })} label="申込のお礼を送る" />
              </li>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>前日のご案内</span><span className={styles.rowNote}>前日の <input value={settings.dayBeforeTime} onChange={(e) => update({ dayBeforeTime: e.target.value })} className={styles.timeInput} aria-label="前日のご案内の時刻" /> </span></span>
                <Toggle checked={settings.dayBeforeEnabled} onChange={(checked) => update({ dayBeforeEnabled: checked })} label="前日のご案内を送る" />
              </li>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>開始前のお知らせ</span><span className={styles.rowNote}>開始の <input type="number" min={0} value={settings.hourBeforeMinutes} onChange={(e) => update({ hourBeforeMinutes: Number(e.target.value) })} className={styles.timeInput} aria-label="開始の何分前" /> 分前</span></span>
                <Toggle checked={settings.hourBeforeEnabled} onChange={(checked) => update({ hourBeforeEnabled: checked })} label="開始前のお知らせを送る" />
              </li>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>開始のお知らせ</span><span className={styles.rowNote}>開始したとき</span></span>
                <Toggle checked={settings.startEnabled} onChange={(checked) => update({ startEnabled: checked })} label="開始のお知らせを送る" />
              </li>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>見逃した人への案内</span><span className={styles.rowNote}>翌日の <input value={settings.missedTime} onChange={(e) => update({ missedTime: e.target.value })} className={styles.timeInput} aria-label="見逃した人への案内の時刻" /> ・見られる期限 <input type="number" min={1} max={30} value={settings.missedWindowDays} onChange={(e) => update({ missedWindowDays: Number(e.target.value) })} className={styles.timeInput} aria-label="見られる期限の日数" /> 日</span></span>
                <Toggle checked={settings.missedEnabled} onChange={(checked) => update({ missedEnabled: checked })} label="見逃した人への案内を送る" />
              </li>
              <li className={styles.row}>
                <span><span className={styles.rowTitle}>見終わった人へのお礼</span><span className={styles.rowNote}>見終わったら</span></span>
                <Toggle checked={settings.completedEnabled} onChange={(checked) => update({ completedEnabled: checked })} label="見終わった人へのお礼を送る" />
              </li>
            </ul>
          )}
          <div className={styles.rowActions}>
            <Button disabled={testing || notificationTestDone || settings === null} title={notificationTestDone ? 'テスト済みです' : settings === null ? '通知の設定を読み込んでから実行できます' : undefined} onClick={() => setTestConfirmOpen(true)} busy={testing} busyLabel="送信中…">{notificationTestDone ? 'テスト送信済み' : 'テストを送る（全部）'}</Button>
          </div>
          {testResult ? <p className="text-ink-secondary text-xs" role="status">{testResult}</p> : null}
        </section>
        <section className={styles.card} aria-label="視聴後にすること">
          <h2 className={styles.cardTitle}>視聴後にすること</h2>
          <p className={styles.cardDesc}>見たかどうかで、タグを付けたりシナリオを始めたりします。</p>
          <ul className={styles.rows}>
            {(['completed', 'cta_clicked', 'unviewed'] as const).map((trigger) => {
              const first = actions?.find((action) => action.trigger === trigger) ?? null
              return (
                <li key={trigger} className={styles.row}>
                  <span className={styles.rowTitle}>{TRIGGER_LABELS[trigger]}</span>
                  <span className={styles.rowNote}>{actions === null ? '確認中' : first ? actionSummary(first) : '何もしない'}</span>
                </li>
              )
            })}
          </ul>
          <label className={styles.field}>視聴完了のメッセージ
            <textarea value={templateBody} onChange={(e) => setTemplateBody(e.target.value)} rows={2} className={styles.textArea} aria-label="視聴完了のメッセージ" />
          </label>
          <label className={styles.field}>結果が取れないとき
            <Select
              aria-label="結果が取れないとき"
              value={missingPolicy}
              onChange={(value) => setMissingPolicy(value as WebinarEditor['actionPolicy']['missingResultPolicy'])}
              options={[{ value: 'retry_next_day', label: '翌日に取り直す' }, { value: 'escalate', label: '何もしない' }]}
            />
          </label>
        </section>
      </div>
      <div>
        <h2 className={styles.previewTitle}>LINEでの見え方</h2>
        <div className={styles.linePreview} aria-hidden="true">
          <p className={styles.lineBubble}>{previewBody}</p>
        </div>
        <div className={styles.rowActions}>
          <Button disabled={testing || notificationTestDone || settings === null} onClick={() => setTestConfirmOpen(true)} busy={testing} busyLabel="送信中…">{notificationTestDone ? 'テスト送信済み' : 'テストを送る'}</Button>
        </div>
      </div>
      {/* 相手と文面を確認してから実送信する。申込者全員には届かない。 */}
      <ConfirmDialog
        open={testConfirmOpen}
        title="通知をテスト送信しますか？"
        description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。"
        confirmLabel="テストを送る"
        busy={testing}
        onCancel={() => { if (!testing) setTestConfirmOpen(false) }}
        onConfirm={() => void runNotificationTest()}
      >
        <p className="text-ink-secondary text-xs">送る文面（開始のお知らせ）：「{webinarTitle}」が始まりました、という案内に参加URLを添えて送ります。</p>
      </ConfirmDialog>
    </div>
  )
}
