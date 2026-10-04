'use client'

import { useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import HelpTip from '@/components/shared/help-tip'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import SegmentedControl from '@/components/shared/segmented'
import StickyBar from '@/components/shared/sticky-bar'
import { TextArea, TextField } from '@/components/shared/text-field'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { webinarApi, type WebinarAction, type WebinarEditor } from '@/lib/api'
import { webinarErrorText } from '@/components/webinars/webinar-error-text'

const LABELS: Record<WebinarAction['actionType'], string> = {
  add_tag: 'タグを付ける', remove_tag: 'タグを外す', start_scenario: 'シナリオを開始する',
  stop_scenario: 'シナリオを停止する', resume_scenario: 'シナリオを再開する',
  send_message: 'LINEメッセージまたはテンプレートを送る', send_webhook: '外部Webhookへ送る',
  switch_rich_menu: 'リッチメニューを切り替える', remove_rich_menu: 'リッチメニューを外す',
}
const TRIGGERS: Array<{ value: WebinarAction['trigger']; label: string }> = [
  { value: 'completed', label: '視聴完了' }, { value: 'cta_clicked', label: 'CTAクリック' }, { value: 'unviewed', label: '未視聴' },
]
function referenceOf(type: WebinarAction['actionType']): { key: string; label: string } | null {
  if (type === 'add_tag' || type === 'remove_tag') return { key: 'tagId', label: 'タグID' }
  if (type === 'start_scenario' || type === 'stop_scenario' || type === 'resume_scenario') return { key: 'scenarioId', label: 'シナリオID' }
  if (type === 'send_message') return { key: 'templateId', label: 'テンプレートID' }
  if (type === 'send_webhook') return { key: 'webhookId', label: 'Webhook ID' }
  if (type === 'switch_rich_menu') return { key: 'richMenuPageId', label: 'リッチメニューページID' }
  return null
}

/** E7iAYs の「視聴後にすること」から開く編集。機能は既存の口へつなぐ。 */
export default function ActionsV8({ webinarId, editor, onEditorChange, onActionsSaved, onDirtyChange }: {
  webinarId: string; editor: WebinarEditor
  onEditorChange: (next: WebinarEditor) => void
  onActionsSaved: () => void
  onDirtyChange: (dirty: boolean) => void
}) {
  const canEdit = canManageRole(useStaffRole())
  const [actions, setActions] = useState<WebinarAction[]>([])
  const [baseline, setBaseline] = useState('[]')
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [trigger, setTrigger] = useState<WebinarAction['trigger']>('completed')
  const [templateBody, setTemplateBody] = useState(editor.actionPolicy.templateBody)
  const [policy, setPolicy] = useState(editor.actionPolicy.missingResultPolicy)
  const [savedPolicy, setSavedPolicy] = useState({ templateBody, policy })
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const generation = useRef(0)
  const lock = useRef(false)
  const version = useRef(editor.version)
  const actionsDirty = JSON.stringify(actions) !== baseline
  const policyDirty = templateBody !== savedPolicy.templateBody || policy !== savedPolicy.policy
  const dirty = state === 'ready' && (actionsDirty || policyDirty)
  const currentPolicyDirty = useRef(policyDirty)
  currentPolicyDirty.current = policyDirty

  useEffect(() => {
    version.current = editor.version
    if (currentPolicyDirty.current) return
    const next = { templateBody: editor.actionPolicy.templateBody, policy: editor.actionPolicy.missingResultPolicy }
    setTemplateBody(next.templateBody); setPolicy(next.policy); setSavedPolicy(next)
  }, [editor.version, editor.actionPolicy.templateBody, editor.actionPolicy.missingResultPolicy])
  useEffect(() => {
    const request = ++generation.current
    setState('loading'); setNotice('')
    webinarApi.actions(webinarId).then((response) => {
      if (request !== generation.current) return
      setActions(response.data); setBaseline(JSON.stringify(response.data)); setState('ready')
    }).catch(() => { if (request === generation.current) setState('error') })
    return () => { generation.current += 1 }
  }, [webinarId, attempt])
  useEffect(() => { onDirtyChange(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const save = async () => {
    if (!canEdit || state !== 'ready' || lock.current || !dirty) return
    lock.current = true; setSaving(true); setNotice('')
    const request = generation.current
    try {
      // 競合を先に確認する。保存できた部分は再送せず、残った部分だけ再試行する。
      if (policyDirty) {
        const response = await webinarApi.saveEditor(webinarId, { expectedVersion: version.current, actionTemplateBody: templateBody, missingResultPolicy: policy })
        if (request !== generation.current) return
        version.current = response.data.version
        setSavedPolicy({ templateBody, policy }); onEditorChange(response.data)
      }
      if (actionsDirty) {
        const response = await webinarApi.saveActions(webinarId, actions)
        if (request !== generation.current) return
        setActions(response.data); setBaseline(JSON.stringify(response.data)); onActionsSaved()
      }
      setNotice('視聴後アクションを保存しました。')
    } catch (cause) {
      if (request === generation.current) setNotice(webinarErrorText(cause, '保存できませんでした。入力を残しました。もう一度お試しください。'))
    } finally { lock.current = false; if (request === generation.current) setSaving(false) }
  }
  const update = (index: number, patch: Partial<WebinarAction>) => setActions((current) => current.map((action, i) => i === index ? { ...action, ...patch } : action))

  return <div className="min-w-0 space-y-4">
    {state === 'loading' ? <p className="text-ink-secondary text-sm">読み込んでいます。</p> : state === 'error' ? <Notice tone="info" action={<Button onClick={() => setAttempt((value) => value + 1)}>もう一度読み込む</Button>}>視聴後アクションを読み込めませんでした。</Notice> : <>
      {!canEdit ? <Notice tone="info">閲覧のみです。変更はオーナーか管理者に依頼してください。</Notice> : null}
      <h2 className="text-ink text-base font-semibold">視聴後にすること <HelpTip label="視聴後にすることの説明">視聴完了・CTAクリック・未視聴ごとに、実行する処理を設定します。</HelpTip></h2>
      <SegmentedControl options={TRIGGERS} value={trigger} onChange={setTrigger} aria-label="実行する条件" />
      <fieldset disabled={!canEdit || saving} className="min-w-0 space-y-4">
        <div className="divide-hairline divide-y">
          {actions.filter((action) => action.trigger === trigger).length === 0 ? <p className="text-ink-secondary py-4 text-sm">この条件のアクションはまだありません。</p> : null}
          {actions.map((action, index) => {
            if (action.trigger !== trigger) return null
            const reference = referenceOf(action.actionType)
            return <div key={action.id ?? index} className="grid min-w-0 gap-3 py-4 md:grid-cols-3 md:items-center">
              <Select value={action.actionType} onChange={(value) => update(index, { actionType: value as WebinarAction['actionType'], config: {} })} aria-label={`${index + 1}件目のアクション`} options={Object.entries(LABELS).map(([value, label]) => ({ value, label }))} />
              {reference ? <TextField aria-label={`${index + 1}件目の${reference.label}`} value={String(action.config[reference.key] ?? '')} placeholder={reference.label} onChange={(event) => update(index, { config: { ...action.config, [reference.key]: event.target.value } })} /> : <span className="text-ink-secondary text-xs">追加設定はありません</span>}
              <Button onClick={() => setActions((current) => current.filter((_, i) => i !== index))} aria-label={`${index + 1}件目のアクションを外す`}>外す</Button>
            </div>
          })}
        </div>
        <Button onClick={() => setActions((current) => [...current, { trigger, actionType: 'add_tag', config: { tagId: '' } }])}>通知・アクションを追加</Button>
        <label className="text-ink block text-xs font-semibold">視聴完了のメッセージ<TextArea aria-label="視聴完了メッセージ本文" rows={2} value={templateBody} onChange={(event) => setTemplateBody(event.target.value)} /></label>
        <label className="text-ink block text-xs font-semibold">結果が取れないとき<Select aria-label="視聴結果を取得できない場合" value={policy} onChange={(value) => setPolicy(value as typeof policy)} options={[{ value: 'escalate', label: '要対応へ追加' }, { value: 'retry_next_day', label: '翌日に再取得' }]} /></label>
      </fieldset>
    </>}
    {notice ? <Notice tone="info">{notice}</Notice> : null}
    <StickyBar status={dirty ? '保存していない変更があります' : undefined} actions={<><Button href="/webinars">キャンセル</Button><Button variant="primary" disabled={!canEdit || state !== 'ready' || saving || !dirty} busy={saving} onClick={() => void save()}>視聴後アクションを保存する</Button></>} />
  </div>
}
