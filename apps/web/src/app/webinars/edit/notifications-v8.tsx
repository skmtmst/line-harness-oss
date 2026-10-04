'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Notice from '@/components/shared/notice'
import HelpTip from '@/components/shared/help-tip'
import Select from '@/components/shared/select'
import LinePreview from '@/components/shared/line-preview'
import WebinarNotifications from '@/components/webinars/webinar-notifications'
import { webinarApi, type WebinarAction, type WebinarEditor, type WebinarNotificationOverview, type WebinarNotificationSettings } from '@/lib/api'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'
import { canManageRole, useStaffRole } from '@/lib/staff-role'

const TRIGGER_LABEL: Record<WebinarAction['trigger'], string> = { completed: '視聴完了', cta_clicked: 'CTAクリック', unviewed: '未視聴' }
const ACTION_LABEL: Record<WebinarAction['actionType'], string> = { add_tag: 'タグを付ける', remove_tag: 'タグを外す', start_scenario: 'シナリオを始める', stop_scenario: 'シナリオを止める', resume_scenario: 'シナリオを再開する', send_message: 'メッセージを送る', send_webhook: 'Webhookを送る', switch_rich_menu: 'リッチメニューを変える', remove_rich_menu: 'リッチメニューを外す' }

export default function NotificationsV8({ webinarId, webinarTitle, editor, onEditorChange, onOpenActions, onDirtyChange, registerSave, publicUrl, canOpenPublicPage, publicPageReason }: {
  webinarId: string; webinarTitle: string; editor: WebinarEditor; onOpenActions: () => void
  onEditorChange?: (value: WebinarEditor) => void
  onDirtyChange?: (value: boolean) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
  publicUrl?: string | null; canOpenPublicPage?: boolean; publicPageReason?: string
}) {
  const canEdit = canManageRole(useStaffRole())
  const [settingsReady, setSettingsReady] = useState(false)
  const [notificationDirty, setNotificationDirty] = useState(false)
  const notificationSave = useRef<(() => Promise<boolean>) | null>(null)
  const handleLoaded = useCallback((data: { settings: WebinarNotificationSettings | null; overview: WebinarNotificationOverview | null } | null) => setSettingsReady(data !== null && data.settings !== null), [])
  const registerNotificationSave = useCallback((save: (() => Promise<boolean>) | null) => { notificationSave.current = save }, [])
  const [actions, setActions] = useState<WebinarAction[] | null>(null)
  const [actionError, setActionError] = useState(false)
  const [actionAttempt, setActionAttempt] = useState(0)
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy?.templateBody ?? '')
  const [policy, setPolicy] = useState<WebinarEditor['actionPolicy']['missingResultPolicy']>(editor.actionPolicy?.missingResultPolicy ?? 'escalate')
  const [baseline, setBaseline] = useState({ templateBody: editor.actionPolicy?.templateBody ?? '', policy: editor.actionPolicy?.missingResultPolicy ?? 'escalate' })
  const policyDirty = templateBody !== baseline.templateBody || policy !== baseline.policy
  const dirty = notificationDirty || policyDirty
  const [saving, setSaving] = useState(false)
  const saveLock = useRef(false)
  const [error, setError] = useState('')
  const [testConfirmOpen, setTestConfirmOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const testLock = useRef(false)
  const [testResult, setTestResult] = useState('')
  const [testRefreshError, setTestRefreshError] = useState(false)

  useEffect(() => {
    let current = true
    setActions(null); setActionError(false)
    webinarApi.actions(webinarId).then((res) => { if (current) setActions(res.data) }).catch(() => { if (current) setActionError(true) })
    return () => { current = false }
  }, [webinarId, actionAttempt])
  useEffect(() => {
    if (policyDirty) return
    const next = { templateBody: editor.actionPolicy?.templateBody ?? '', policy: editor.actionPolicy?.missingResultPolicy ?? 'escalate' }
    setTemplateBody(next.templateBody); setPolicy(next.policy); setBaseline(next)
  }, [editor.actionPolicy?.templateBody, editor.actionPolicy?.missingResultPolicy])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const save = async (): Promise<boolean> => {
    if (!canEdit || saveLock.current || (!settingsReady && !dirty)) return false
    saveLock.current = true; setSaving(true); setError('')
    try {
      let version = editor.version
      if (notificationDirty) {
        if (!notificationSave.current || !await notificationSave.current()) return false
        const refreshed = await webinarApi.editor(webinarId)
        version = refreshed.data.version
        onEditorChange?.(refreshed.data)
      }
      if (policyDirty) {
        const res = await webinarApi.saveEditor(webinarId, { expectedVersion: version, actionTemplateBody: templateBody, missingResultPolicy: policy })
        setBaseline({ templateBody, policy }); onEditorChange?.(res.data)
      }
      return true
    } catch (cause) {
      setError(webinarErrorText(cause, '保存できませんでした。入力を残しました。もう一度お試しください。'))
      return false
    } finally { saveLock.current = false; setSaving(false) }
  }
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => {
    registerSave?.(() => saveRef.current())
    return () => registerSave?.(null)
  }, [registerSave])

  const refreshTestResult = async () => {
    try {
      const refreshed = await webinarApi.editor(webinarId)
      onEditorChange?.(refreshed.data)
      setTestRefreshError(false)
    } catch { setTestRefreshError(true) }
  }
  const retryTestResult = async () => {
    if (testLock.current) return
    testLock.current = true; setTesting(true)
    try { await refreshTestResult() }
    finally { testLock.current = false; setTesting(false) }
  }
  const runTest = async () => {
    if (!canEdit || !settingsReady || testRefreshError || testLock.current) return
    testLock.current = true; setTesting(true); setTestResult('')
    try {
      if (dirty && !await saveRef.current()) return
      setTestConfirmOpen(false)
      const res = await webinarApi.testNotifications(webinarId)
      setTestResult(`テスト送信しました。成功 ${res.data.sent}件・失敗 ${res.data.failed}件`)
      // 送信後の読み直しだけが失敗しても、届いた結果を消して再送へ誘導しない。
      await refreshTestResult()
    } catch (cause) { setTestResult(webinarErrorText(cause, 'テスト送信できませんでした。時間をおいてもう一度お試しください。')) }
    finally { testLock.current = false; setTesting(false) }
  }
  const testDone = !dirty && editor.notificationTest?.status === 'passed'
  const preview = editor.notificationMessages?.registration || editor.notificationMessages?.start || ''
  const testButton = (label: string) => <Button onClick={() => setTestConfirmOpen(true)} disabled={!canEdit || testing || saving || testDone || !settingsReady || testRefreshError} title={!canEdit ? 'テスト送信はオーナーか管理者に依頼してください' : testRefreshError ? '送信済みの結果を読み直してください' : testDone ? 'テスト済みです' : !settingsReady ? '通知の設定を読み込んでから実行できます' : undefined} busy={testing} busyLabel={testRefreshError ? '読み込んでいます…' : '送信中…'}>{testDone ? 'テスト送信済み' : label}</Button>

  return (
    <div data-design-node="E7iAYs" data-webinar-pane="notifications">
      <div className="min-w-0 space-y-4">
        <fieldset disabled={!canEdit || saving || testing} className="border-hairline bg-canvas min-w-0 rounded-card border p-5">
          <WebinarNotifications webinarId={webinarId} onLoaded={handleLoaded} onDirtyChange={setNotificationDirty} registerSave={registerNotificationSave} />
          <div className="mt-3">{testButton('テストを送る（全部）')}</div>
        </fieldset>
        <fieldset disabled={!canEdit || saving || testing} className="border-hairline bg-canvas min-w-0 rounded-card border p-5">
          <h2 className="text-ink text-base font-semibold">視聴後にすること <HelpTip label="視聴後にすることの説明">見たかどうかで、タグを付けたりシナリオを始めたりします。</HelpTip></h2>
          {actionError ? <Notice tone="info" action={<Button onClick={() => setActionAttempt((value) => value + 1)}>もう一度読み込む</Button>}>視聴後の設定を読み込めませんでした。</Notice> : <ul className="divide-hairline my-3 divide-y">
            {(['completed', 'cta_clicked', 'unviewed'] as const).map((trigger) => <li key={trigger} className="flex items-center gap-4 py-3"><span className="text-ink w-24 shrink-0 text-sm font-semibold">{TRIGGER_LABEL[trigger]}</span><span className="text-ink-secondary min-w-0 flex-1 truncate text-sm" title={actions?.filter((a) => a.trigger === trigger).map((a) => ACTION_LABEL[a.actionType]).join('・')}>{actions === null ? '読み込んでいます' : actions.filter((a) => a.trigger === trigger).map((a) => ACTION_LABEL[a.actionType]).join('・') || 'まだ何もしない'}</span><Button size="compact" onClick={onOpenActions} aria-label={`${TRIGGER_LABEL[trigger]}の動きを変える`}>…</Button></li>)}
          </ul>}
          <label className="text-ink block text-xs font-semibold" htmlFor="webinar-action-message">視聴完了のメッセージ</label>
          <textarea id="webinar-action-message" aria-label="視聴完了メッセージ本文" value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} rows={2} className="border-hairline bg-canvas text-ink mt-2 w-full rounded-control border px-3 py-2 text-sm" />
          <div className="mt-3"><label className="text-ink mb-2 block text-xs font-semibold">結果が取れないとき</label><Select aria-label="視聴結果を取得できない場合" value={policy} onChange={(value) => setPolicy(value as typeof policy)} options={[{ value: 'escalate', label: '要対応へ追加' }, { value: 'retry_next_day', label: '翌日に再取得' }]} /></div>
          <div className="mt-3"><Button onClick={onOpenActions}>条件を足す</Button></div>
          {!registerSave ? <Button onClick={() => void save()} disabled={saving}>下書きを保存</Button> : null}
        </fieldset>
        {error ? <Notice tone="info">{error}</Notice> : null}
        {testResult ? <p role="status" className="text-ink-secondary text-xs">{testResult}</p> : null}
        {testRefreshError ? <Notice tone="info" action={<Button onClick={() => void retryTestResult()} disabled={testing} busy={testing}>送信結果を読み直す</Button>}>テスト送信の結果を受け取りましたが、確認状態を読み込めませんでした。再送せずに結果を読み直してください。</Notice> : null}
      </div>
      <aside aria-label="LINEでの見え方">
        <h2 className="text-ink mb-3 text-base font-semibold">LINEでの見え方</h2>
        <LinePreview><div className="bg-canvas text-ink rounded-control p-3 text-sm">{preview || '通知の本文を入れると、ここに出ます。'}</div></LinePreview>
        <div className="mt-3 flex flex-wrap justify-center gap-2">{testButton('テストを送る')}{canOpenPublicPage && publicUrl ? <Button href={publicUrl} target="_blank" rel="noreferrer">公開ページを見る</Button> : publicPageReason ? <Button disabled title={publicPageReason}>公開ページを見る</Button> : null}</div>
        {publicPageReason && !canOpenPublicPage ? <p className="text-ink-faint mt-2 text-xs">{publicPageReason}</p> : null}
      </aside>
      <ConfirmDialog open={testConfirmOpen} title="通知をテスト送信しますか？" description="アカウント設定で登録したテスト受信者へ、実際のLINEメッセージを送ります。申込者全員には届きません。" confirmLabel="テストを送る" busy={testing} onCancel={() => { if (!testing) setTestConfirmOpen(false) }} onConfirm={() => void runTest()}><p className="text-ink-secondary text-xs">{dirty ? '未保存の設定を保存してから送ります。' : ''}対象：「{webinarTitle}」の有効な通知。本文は設定済みのものを送ります。</p></ConfirmDialog>
    </div>
  )
}
