'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Button from '@/components/shared/button'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import HelpTip from '@/components/shared/help-tip'
import LinePreview from '@/components/shared/line-preview'
import Notice from '@/components/shared/notice'
import RadioCard, { RadioCardGroup } from '@/components/shared/radio-card'
import Select from '@/components/shared/select'
import { RequiredBadge } from '@/components/shared/form-controls'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { webinarApi, describeSaveFailure, type Webinar, type WebinarEditor, type WebinarFolder } from '@/lib/api'
import './basic-v8.css'

/** 基本設定の編集も j7PP04 の並び。動画・公開操作は動画と確認の段に残す。 */
export default function BasicV8({ webinar, editor, onWebinarSaved, onEditorChange, onDirtyChange, registerSave }: {
  webinar: Webinar
  editor: WebinarEditor
  onWebinarSaved: (next: Webinar) => void
  onEditorChange: (next: WebinarEditor) => void
  onDirtyChange?: (dirty: boolean) => void
  registerSave?: (save: (() => Promise<boolean>) | null) => void
}) {
  const canEdit = canManageRole(useStaffRole())
  const [title, setTitle] = useState(webinar.title)
  const [slug, setSlug] = useState(webinar.slug)
  const [folderId, setFolderId] = useState(webinar.folderId ?? '')
  const [description, setDescription] = useState(editor.publicDescription ?? '')
  const [deliveryKind, setDeliveryKind] = useState(editor.deliveryKind)
  const [folders, setFolders] = useState<WebinarFolder[]>([])
  const [folderState, setFolderState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<{ title?: string; slug?: string }>({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testConfirm, setTestConfirm] = useState(false)
  const [testResult, setTestResult] = useState('')
  const lock = useRef(false)
  const folderRequest = useRef(0)
  const version = useRef(editor.version)
  const [savedCore, setSavedCore] = useState({ title, slug, folderId })
  const [savedEditor, setSavedEditor] = useState({ description, deliveryKind })
  const coreDirty = title !== savedCore.title || slug !== savedCore.slug || folderId !== savedCore.folderId
  const editorDirty = description !== savedEditor.description || deliveryKind !== savedEditor.deliveryKind
  const dirty = coreDirty || editorDirty

  // 他の段で保存しても、この段の未保存入力は捨てない。
  const currentCore = useRef({ title, slug, folderId, coreDirty })
  currentCore.current = { title, slug, folderId, coreDirty }
  useEffect(() => {
    if (currentCore.current.coreDirty) return
    const next = { title: webinar.title, slug: webinar.slug, folderId: webinar.folderId ?? '' }
    setTitle(next.title); setSlug(next.slug); setFolderId(next.folderId); setSavedCore(next)
  }, [webinar.title, webinar.slug, webinar.folderId])
  const currentEditorDirty = useRef(editorDirty)
  currentEditorDirty.current = editorDirty
  useEffect(() => {
    version.current = editor.version
    if (currentEditorDirty.current) return
    const next = { description: editor.publicDescription ?? '', deliveryKind: editor.deliveryKind }
    setDescription(next.description); setDeliveryKind(next.deliveryKind); setSavedEditor(next)
  }, [editor.version, editor.publicDescription, editor.deliveryKind])

  const loadFolders = useCallback(async () => {
    const request = ++folderRequest.current
    if (!webinar.accountId) { setFolders([]); setFolderState('ready'); return }
    setFolderState('loading')
    try {
      const response = await webinarApi.folders(webinar.accountId)
      if (request !== folderRequest.current) return
      if (!response.success || !Array.isArray(response.data)) throw new Error('folders')
      setFolders(response.data); setFolderState('ready')
    } catch {
      if (request === folderRequest.current) setFolderState('error')
    }
  }, [webinar.accountId])
  useEffect(() => {
    void loadFolders()
    return () => { folderRequest.current += 1 }
  }, [loadFolders])
  useEffect(() => { onDirtyChange?.(dirty) }, [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange])

  const save = async (): Promise<boolean> => {
    if (lock.current) return false
    if (!canEdit) { setError('基本設定の変更はオーナーか管理者に依頼してください。'); return false }
    const titleError = title.trim() ? undefined : 'ウェビナー名を入力してください。'
    const slugError = /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug.trim()) ? undefined : '公開ページのURLは半角の英小文字・数字・ハイフンで入力してください。'
    setFieldErrors({ title: titleError, slug: slugError })
    if (titleError || slugError) return false
    if (folderId !== savedCore.folderId && folderState !== 'ready') {
      setError('フォルダをもう一度読み込んでから保存してください。'); return false
    }
    lock.current = true; setSaving(true); setError('')
    try {
      // 版のある設定を先に保存。競合時は基本情報を書き換えない。
      if (editorDirty) {
        const response = await webinarApi.saveEditor(webinar.id, {
          expectedVersion: version.current,
          publicDescription: description.trim(),
          deliveryKind,
        })
        version.current = response.data.version
        setSavedEditor({ description, deliveryKind })
        onEditorChange(response.data)
      }
      if (coreDirty) {
        const response = await webinarApi.update(webinar.id, {
          title: title.trim(), slug: slug.trim(), folderId: folderId || null,
        })
        setSavedCore({ title, slug, folderId })
        onWebinarSaved(response.data)
      }
      return true
    } catch (cause) {
      setError(describeSaveFailure(cause))
      return false
    } finally {
      lock.current = false; setSaving(false)
    }
  }
  const latestSave = useRef(save)
  latestSave.current = save
  useEffect(() => {
    registerSave?.(() => latestSave.current())
    return () => registerSave?.(null)
  }, [registerSave])

  const runTest = async () => {
    if (testing || !canEdit || lock.current) return
    setTesting(true); setTestResult('')
    try {
      if (dirty && !(await save())) return
      const response = await webinarApi.testNotifications(webinar.id)
      setTestResult(`通知テスト：成功 ${response.data.sent}件・失敗 ${response.data.failed}件`)
      setTestConfirm(false)
    } catch (cause) {
      setError(describeSaveFailure(cause))
    } finally { setTesting(false) }
  }

  return (
    <div data-design-node="j7PP04" data-webinar-basic="v8">
      <div className="wb-basic-body">
        <fieldset className="wb-basic-form" disabled={!canEdit || saving || testing}>
          <section className="wb-basic-card" aria-labelledby="webinar-basic-heading">
            <h2 id="webinar-basic-heading" className="wb-basic-cardTitle">基本設定</h2>
            <div className="wb-basic-fieldGrid">
              <div className="wb-basic-fieldFull">
                <label className="wb-basic-label" htmlFor="webinar-basic-title">名前 <RequiredBadge /></label>
                <input id="webinar-basic-title" aria-label="タイトル" value={title} onChange={(event) => setTitle(event.target.value)} className="wb-basic-input" aria-invalid={Boolean(fieldErrors.title)} />
                {fieldErrors.title ? <p className="wb-basic-fieldError" role="alert">{fieldErrors.title}</p> : null}
              </div>
              <div>
                <div className="flex items-center gap-1"><label className="wb-basic-label" htmlFor="webinar-basic-slug">公開ページのURL</label><HelpTip label="公開ページのURLの説明">アドレスの最後の部分です。半角の英小文字・数字・ハイフンで入力します。</HelpTip></div>
                <input id="webinar-basic-slug" value={slug} onChange={(event) => setSlug(event.target.value)} className="wb-basic-input" aria-invalid={Boolean(fieldErrors.slug)} />
                {fieldErrors.slug ? <p className="wb-basic-fieldError" role="alert">{fieldErrors.slug}</p> : null}
              </div>
              <div>
                <label className="wb-basic-label" htmlFor="webinar-basic-folder">フォルダ</label>
                <Select id="webinar-basic-folder" aria-label="フォルダ" value={folderId} disabled={folderState !== 'ready' || !canEdit || saving || testing} onChange={setFolderId} options={[
                  { value: '', label: '未分類' },
                  ...folders.map((folder) => ({ value: folder.id, label: folder.name })),
                  ...(folderId && !folders.some((folder) => folder.id === folderId) ? [{ value: folderId, label: '現在のフォルダ' }] : []),
                ]} />
                {folderState === 'error' ? <p className="wb-basic-fieldHelp">フォルダを読み込めませんでした。<Button size="compact" onClick={() => void loadFolders()}>もう一度読み込む</Button></p> : null}
              </div>
              <div className="wb-basic-fieldFull">
                <label className="wb-basic-label" htmlFor="webinar-basic-description">案内文</label>
                <input id="webinar-basic-description" value={description} onChange={(event) => setDescription(event.target.value)} className="wb-basic-input" />
              </div>
            </div>
          </section>
          <section className="wb-basic-card" aria-labelledby="webinar-kind-heading">
            <h2 id="webinar-kind-heading" className="wb-basic-cardTitle">開催形式</h2>
            <RadioCardGroup legend="開催形式" className="wb-basic-radioRow">
              <RadioCard name="webinar-basic-kind" value="on_demand" checked={deliveryKind === 'on_demand'} onChange={() => setDeliveryKind('on_demand')} title="オンデマンド配信" note="録画動画をいつでも視聴" />
              <RadioCard name="webinar-basic-kind" value="scheduled" checked={deliveryKind === 'scheduled'} onChange={() => setDeliveryKind('scheduled')} title="日時指定配信" note="指定日時に公開開始" />
              {deliveryKind === 'external' ? <p className="wb-basic-fieldHelp">現在は外部動画を使っています。別の形式を選ぶまで維持します。</p> : null}
            </RadioCardGroup>
          </section>
          <section className="wb-basic-card" aria-labelledby="webinar-audience-heading">
            <h2 id="webinar-audience-heading" className="wb-basic-cardTitle">だれに案内するか</h2>
            <p className="wb-basic-label">案内する相手</p>
            <p className="text-ink text-sm">{editor.viewingCondition.label}</p>
          </section>
          {error ? <Notice tone="info">{error}</Notice> : null}
          {!canEdit ? <Notice tone="info">閲覧のみで見ています。変更はオーナーか管理者に依頼してください。</Notice> : null}
        </fieldset>
        <aside className="wb-basic-previewCol" aria-label="LINEでの見え方">
          <h2 className="wb-basic-previewTitle">LINE での見え方</h2>
          <LinePreview><div><p className="wb-basic-previewBubbleTitle">{title || '（ウェビナー名）'}</p><p className="wb-basic-previewBubbleBody">{description || 'セミナーの案内文がここに出ます。'}<br />▶申込はこちら</p></div></LinePreview>
          <div className="wb-basic-testRow"><Button disabled={!canEdit || saving || testing} onClick={() => setTestConfirm(true)}>テストを送る</Button></div>
          {testResult ? <p className="wb-basic-fieldHelp" role="status">{testResult}</p> : null}
        </aside>
      </div>
      <ConfirmDialog open={testConfirm} title="通知をテスト送信しますか？" description="登録したテスト受信者へ、有効な通知の本文をLINEで送ります。申込者全員には届きません。" confirmLabel="テストを送る" busy={saving || testing} error={error || undefined} onCancel={() => { if (!saving && !testing) setTestConfirm(false) }} onConfirm={() => void runTest()}>
        {dirty ? <p className="text-ink-secondary text-xs">変更した基本設定を保存してから送ります。</p> : null}
      </ConfirmDialog>
    </div>
  )
}
