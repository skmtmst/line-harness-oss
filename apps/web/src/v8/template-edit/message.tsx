'use client'

/*
 * ★V8「メッセージを作る／編集」（絵 u5YC6・1152 は a1k3d・競合は NCbYn）。
 *
 * 左：名前とフォルダ／中身（形・本文・差し込む）／本文の中のURL。
 * 右：送るときの名前／届き方（本物のスマホ）。1152 ではスマホを窓で開く。
 * 下の帯：キャンセル／下書きを保存／保存して公開。
 * 動き（読み込み・保存・公開・409・利用先の確認）は BEHAVIOR.md。
 */
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleAlert, GitCompare, Link2, RotateCcw, Send } from 'lucide-react'
import { validateFlexContent, type Folder } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { useNarrowViewport } from '@/lib/use-narrow-viewport'
import { useUnsavedGuard } from '@/lib/use-unsaved-guard'
import { UnsavedLeaveDialog } from '@/lib/unsaved-leave-dialog'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import Button from '@/components/shared/button'
import Card from '@/components/shared/card'
import Dialog from '@/components/shared/dialog'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import LinePreview, { LinePreviewMessage } from '@/components/shared/line-preview'
import SegmentedControl from '@/components/shared/segmented'
import FolderSelect, { folderById, folderCreator, hostFolderCreate } from '@/components/shared/folder-select'
import { TextField } from '@/components/shared/text-field'
import Toggle from '@/components/shared/toggle'
import { notifyToast } from '@/components/shared/toast'
import FlexPreview from '@/components/flex-preview'
import { buildTemplatePreview, extractMessageUrls } from '@/components/templates/message-template-editor'
import {
  ACCOUNT_MISMATCH_MESSAGE,
  EMPTY_REFERENCES,
  TEMPLATE_LOAD_FAILED_MESSAGE,
  conflictTime,
  describeTemplateDiff,
  draftFromDetail,
  isTemplateDetailData,
  loadTemplateReferences,
  newTemplateEditorState,
  requestTemplateReferences,
  resolveEditorAccountId,
  saveTemplateEdit,
  validateTemplateSave,
  templateAccountMismatch,
  templateSaveGuard,
  templateUsageEntries,
  type TemplateDraft,
  type TemplateEditorState,
  type TemplateReferenceState,
  type TemplateReferences,
} from './core'
import { TemplateEditFrame } from './frame'
import type { TemplateEditHost } from './host'
import { useDraftAutosave } from '@/v8/autosave/use-draft-autosave'
import InsertRow from './insert-row'
import InsertTextField, { type InsertTextFieldHandle } from '@/components/shared/insert-text-field'
import { referenceTokenNames } from '@/components/shared/insert-tokens'
import { loadTemplateExamples } from '@/v8/templates/examples'
import styles from './edit.module.css'

const MESSAGE_TYPES: Array<{ value: string; label: string }> = [
  { value: 'text', label: 'テキスト' },
  { value: 'flex', label: 'カード型' },
  { value: 'image', label: '画像' },
]

const snapshot = (draft: TemplateDraft) => JSON.stringify(draft)

/** 競合の帯（NCbYn）。誰が・いつ・どれを保存したかと、2つの出口。 */
type Conflict = { name: string; at: string; latest: TemplateDraft | null }

/**
 * `host` を渡すと、統括のテンプレートの入口から同じ画面を使う（host.ts）。保存は呼ぶ側、主ボタンは［保存して配る］、
 * 読み込み・自動保存・公開・店の差し込み候補（友だち情報・共通情報）は使わない。
 */
export default function TemplateMessageEditor({ id, visual, example = null, host }: { id: string | null; visual: boolean; example?: string | null; host?: TemplateEditHost }) {
  const router = useRouter()
  const role = useStaffRole()
  // 役割の確認が済むまでは操作を出す（最後の守りはサーバの 403）。staff と分かったら隠す。
  const canMutate = host ? !host.readOnly : role === null || canManageRole(role)
  const narrow = useNarrowViewport(1351)
  const { accounts, selectedAccountId } = useAccount()

  const initialState = (): TemplateEditorState => {
    const fresh = newTemplateEditorState(id, visual)
    return host?.initialMessage ? { ...fresh, draft: { ...fresh.draft, ...host.initialMessage } } : fresh
  }
  const [editorState, setEditor] = useState<TemplateEditorState>(initialState)
  const [clean, setClean] = useState(() => snapshot(initialState().draft))
  const [folders, setFolders] = useState<Folder[]>([])
  const [references, setReferences] = useState<TemplateReferences>(EMPTY_REFERENCES)
  const [referenceState, setReferenceState] = useState<TemplateReferenceState>('idle')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareBusy, setCompareBusy] = useState(false)
  const [compareError, setCompareError] = useState('')
  const [publishCheck, setPublishCheck] = useState<{ id: string; entries: ReturnType<typeof templateUsageEntries> } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  /*
   * 新しく作る画面で自動保存が先に作ったテンプレート（一斉配信と同じく、
   * 最初の自動保存で1件作り、あとは同じ行を上書きする）。URL は変えない
   * （変えると読み込み直しで入力中の欄が揺れる）。
   */
  const [autoCreated, setAutoCreated] = useState<{ id: string; accountId: string | null } | null>(null)

  /* URL の id が変わった瞬間に、前の中身を描画中に捨てる（今の画面と同じ）。 */
  let editor = editorState
  if (editor.requestedId !== id) {
    editor = newTemplateEditorState(id, visual)
    setEditor(editor)
    setClean(snapshot(editor.draft))
    setConflict(null)
    setAutoCreated(null)
  }
  const { name, folderId, messageType, messageContent } = editor.draft
  const updateDraft = (patch: Partial<TemplateDraft>) => setEditor((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }))

  const binding = { templateId: id, templateStatus: editor.status, templateAccountId: editor.templateAccountId, selectedAccountId }
  /* 保存の宛先。新規でも自動保存で作ったあとは、その行への上書きにする。 */
  const saveBinding = !id && autoCreated
    ? { templateId: autoCreated.id, templateStatus: 'ready' as const, templateAccountId: autoCreated.accountId, selectedAccountId }
    : binding
  /* 統括の入口では店のアカウントに結びつけない（差し込み候補・フォルダは店のものを使わない）。 */
  const editorAccountId = host ? null : resolveEditorAccountId(binding)
  const accountMismatch = host ? false : templateAccountMismatch(binding)
  const saveGuard = host ? null : templateSaveGuard(binding)
  const loadFailed = editor.status === 'failed'
  const loading = Boolean(id) && (editor.status === 'idle' || editor.status === 'loading')
  const accountName = (accountId: string | null) => accounts.find((account) => account.id === accountId)?.name ?? null
  const dirty = !loading && snapshot(editor.draft) !== clean
  const title = id || host?.initialMessage ? 'メッセージを編集' : 'メッセージを作る'
  usePageTitle(host ? 'テンプレート' : title)
  const { leaveTarget, confirmLeave, cancelLeave, disarm } = useUnsavedGuard({ dirty, busy: saving || publishing })
  /* 自動保存と手の保存が同時に新規作成へ流れて2件できないよう、送っている途中の保存を待ってから送る。 */
  const inFlightRef = useRef<Promise<unknown> | null>(null)
  const autoCreatedRef = useRef(autoCreated)
  autoCreatedRef.current = autoCreated

  useEffect(() => {
    setFolders([])
    if (!editorAccountId) return
    let cancelled = false
    void api.folders.list('template', editorAccountId)
      .then((res) => { if (!cancelled && res.success) setFolders(res.data) })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [editorAccountId])

  const referenceGeneration = useRef(0)
  useEffect(() => {
    setReferences(EMPTY_REFERENCES)
    const generation = ++referenceGeneration.current
    if (!editorAccountId) {
      setReferenceState('idle')
      return
    }
    setReferenceState('loading')
    void requestTemplateReferences({
      load: loadTemplateReferences,
      accountId: editorAccountId,
      generation,
      currentGeneration: () => referenceGeneration.current,
    }).then((result) => {
      if (result === null) return
      if (result === 'failed') {
        setReferences(EMPTY_REFERENCES)
        setReferenceState('failed')
        return
      }
      setReferences(result)
      setReferenceState('ready')
    })
    return () => { referenceGeneration.current += 1 }
  }, [editorAccountId])

  const templateGeneration = useRef(0)
  useEffect(() => {
    if (!id) return
    const generation = ++templateGeneration.current
    const accept = (next: (prev: TemplateEditorState) => TemplateEditorState) => {
      if (generation !== templateGeneration.current) return
      setEditor((prev) => (prev.requestedId === id ? next(prev) : prev))
    }
    void api.templates.get(id)
      .then((res) => {
        if (!res.success || !isTemplateDetailData(res.data)) {
          accept((prev) => ({ ...prev, status: 'failed' }))
          return
        }
        const draft = draftFromDetail(res.data)
        accept(() => ({
          requestedId: id,
          status: 'ready',
          templateAccountId: res.data.accountId ?? null,
          usedBy: res.data.usedBy ?? null,
          publishedVersion: res.data.publishedVersion ?? null,
          updatedAt: res.data.updatedAt ?? null,
          draft,
        }))
        if (generation === templateGeneration.current) setClean(snapshot(draft))
      })
      .catch(() => accept((prev) => ({ ...prev, status: 'failed' })))
    return () => { templateGeneration.current += 1 }
  }, [id, reloadKey])

  /*
   * 見本から作る（F-5・`?example=<見本の番号>`）：作るときだけ、見本の名前と本文を入れて開く。
   * 入れるのは1回だけ（入れたあとの入力は上書きしない）。保存はしない（保存は利用者が押す）。
   * 見本が読めない・見つからないときは白紙のまま、帯で知らせる。
   */
  const [exampleNote, setExampleNote] = useState('')
  const exampleApplied = useRef<string | null>(null)
  useEffect(() => {
    if (id || !example || exampleApplied.current === example) return
    exampleApplied.current = example
    let cancelled = false
    let settled = false
    loadTemplateExamples()
      .finally(() => { settled = true })
      .then((items) => {
        if (cancelled) return
        const found = items.find((item) => item.id === example)
        if (!found) {
          setExampleNote('見本が見つかりませんでした。白紙から作れます。')
          return
        }
        setEditor((prev) => (prev.requestedId === null
          ? { ...prev, draft: { ...prev.draft, name: found.name, messageType: 'text', messageContent: found.body } }
          : prev))
        setExampleNote('')
      })
      .catch(() => { if (!cancelled) setExampleNote('見本を読み込めませんでした。白紙から作れます。') })
    return () => {
      cancelled = true
      // 読み終わる前に片付けた（開いた直後の二度目の実行）なら、もう一度読めるように戻す。
      if (!settled) exampleApplied.current = null
    }
  }, [id, example])

  /* 差し込みはカーソルの位置へ入れる（今の画面と同じ）。 */
  const contentRef = useRef<InsertTextFieldHandle | HTMLTextAreaElement | null>(null)
  const insert = (token: string) => {
    const element = contentRef.current
    const start = element?.selectionStart ?? messageContent.length
    const end = element?.selectionEnd ?? start
    updateDraft({ messageContent: messageContent.slice(0, start) + token + messageContent.slice(end) })
    if (element) requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + token.length, start + token.length)
    })
  }

  /** 409：最新を1回読んで、帯に「いつ・どれを」出す。入力は捨てない。 */
  const raiseConflict = async (templateId: string) => {
    try {
      const latest = await api.templates.get(templateId)
      if (latest.success && isTemplateDetailData(latest.data)) {
        setConflict({ name: latest.data.name, at: conflictTime(latest.data.updatedAt), latest: draftFromDetail(latest.data) })
        return
      }
    } catch { /* 読めなくても帯は出す */ }
    setConflict({ name: editor.draft.name, at: '', latest: null })
  }

  /**
   * 入力を保存する。できたらテンプレートの id を返す。
   * silent は自動保存：「保存中」の印と赤い帯は出さない（失敗は保存の帯に出る）。
   * 競合（409）は自動でも帯を出す（このまま書くと相手の変更が消えるため）。
   */
  const saveNow = async ({ silent = false }: { silent?: boolean } = {}): Promise<string | null> => {
    if (!silent) {
      setSaving(true)
      setError('')
    }
    while (inFlightRef.current) await inFlightRef.current.catch(() => undefined)
    const sent = editor.draft
    const made = autoCreatedRef.current
    const target = !id && made
      ? { templateId: made.id, templateStatus: 'ready' as const, templateAccountId: made.accountId, selectedAccountId }
      : binding
    const request = saveTemplateEdit({ ...target, ...sent })
    inFlightRef.current = request
    try {
      const res = await request
      if (!res.ok) {
        if (res.conflict && target.templateId) await raiseConflict(target.templateId)
        else if (!silent) setError(res.error)
        return null
      }
      if (!id && !target.templateId) {
        const created = { id: res.id, accountId: selectedAccountId }
        autoCreatedRef.current = created
        setAutoCreated(created)
      }
      setClean(snapshot(sent))
      setConflict(null)
      return res.id
    } finally {
      if (inFlightRef.current === request) inFlightRef.current = null
      if (!silent) setSaving(false)
    }
  }

  /* 入力が止まって2秒で下書きへ静かに保存する（一斉配信と同じ）。閲覧のみは動かさない。 */
  const autosave = useDraftAutosave({
    fingerprint: snapshot(editor.draft),
    dirty,
    active: canMutate && !host,
    enabled: !loading && !conflict && validateTemplateSave({ ...saveBinding, ...editor.draft }) === null,
    paused: leaveTarget !== null || saving || publishing,
    save: async () => (await saveNow({ silent: true })) !== null,
  })

  const leave = () => {
    disarm()
    router.push('/templates')
  }

  const publishNow = async (templateId: string): Promise<boolean> => {
    const got = await api.templates.get(templateId)
    if (!got.success || !isTemplateDetailData(got.data)) {
      setError('いまの状態を読み込めませんでした。もう一度お試しください。')
      return false
    }
    try {
      const res = await api.templates.publish(templateId, {
        expectedVersion: got.data.publishedVersion ?? 0,
        expectedDraftRevision: got.data.draftRevision ?? 0,
      })
      if (!res.success) {
        setError(res.error || '公開できませんでした。もう一度お試しください。')
        return false
      }
      return true
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 409) await raiseConflict(templateId)
      else setError('公開できませんでした。もう一度お試しください。')
      return false
    }
  }

  /* 統括の入口：中身を確かめて呼ぶ側へ渡す（保存・配る・失敗の知らせは呼ぶ側）。 */
  const hostSave = (distribute: boolean) => {
    if (!host) return
    const draft = editor.draft
    if (!draft.name.trim()) { setError('テンプレート名を入力してください。'); return }
    if (!draft.messageContent.trim()) { setError('本文を入力してください。'); return }
    if (draft.messageType === 'flex' && validateFlexContent('flex', draft.messageContent)) { setError('カードの形を直してから保存してください。'); return }
    setError('')
    setClean(snapshot(draft))
    host.onSave({ kind: 'message', name: draft.name.trim(), messageType: draft.messageType, messageContent: draft.messageContent }, distribute)
  }

  const onSaveDraft = async () => {
    if (host) { hostSave(false); return }
    const savedId = await saveNow()
    if (savedId) autosave.markSaved()
    if (savedId) {
      notifyToast('下書きを保存しました')
      leave()
    }
  }

  /* 保存して公開：使っている場所があれば、どこへ届くかを見せてから（cuR8I）。 */
  const onPublish = async () => {
    if (host) { hostSave(true); return }
    const savedId = await saveNow()
    if (!savedId) return
    setPublishing(true)
    try {
      const detail = await api.templates.get(savedId)
      if (!detail.success || !isTemplateDetailData(detail.data)) {
        setError('いまの状態を読み込めませんでした。一覧の詳細から公開してください。')
        return
      }
      const entries = detail.data.usedBy ? templateUsageEntries(detail.data.usedBy) : []
      if (entries.length > 0) {
        setPublishCheck({ id: savedId, entries })
        return
      }
      if (await publishNow(savedId)) {
        notifyToast('公開しました')
        leave()
      }
    } finally {
      setPublishing(false)
    }
  }

  const reloadLatest = () => {
    setConflict(null)
    setCompareOpen(false)
    setCompareError('')
    setError('')
    setReloadKey((key) => key + 1)
  }

  const openCompare = async () => {
    if (!id || compareBusy) return
    setCompareOpen(true)
    if (conflict?.latest) return
    setCompareBusy(true)
    setCompareError('')
    try {
      const detail = await api.templates.get(id)
      if (!detail.success || !isTemplateDetailData(detail.data)) {
        setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
        return
      }
      setConflict((prev) => (prev ? { ...prev, latest: draftFromDetail(detail.data) } : prev))
    } catch {
      setCompareError('最新の内容を取れませんでした。もう一度お試しください。')
    } finally {
      setCompareBusy(false)
    }
  }

  const boardId = id ? (conflict ? 'NCbYn' : 'u5YC6') : narrow ? 'a1k3d' : 'u5YC6'
  const description = host ? host.description : '保存しただけでは、どこにも送られません'

  /* 閲覧のみ：作る・保存の操作は置かず、帯で知らせる。 */
  if (!canMutate) {
    return (
      <TemplateEditFrame
        boardId={boardId}
        title={title}
        description={description}
        band={<p className={styles.readonly} role="status">閲覧のみ：テンプレートの作成・変更はオーナーと管理者だけができます。</p>}
        side={<SenderCard />}
      >
        <Card padding="none" layout="vertical" className={styles.card}>
          <p className={styles.cardNote}>中身の確認は一覧の行を開くと読めます。</p>
          <Link href="/templates" className={styles.back}>一覧へ戻る</Link>
        </Card>
      </TemplateEditFrame>
    )
  }

  const preview = buildTemplatePreview(messageContent, references)
  const tokenNames = referenceTokenNames(references)
  const urls = extractMessageUrls(messageContent)
  const flexError = messageType === 'flex' ? validateFlexContent('flex', messageContent) : null
  const sendName = accountName(editorAccountId) ?? undefined
  const busy = saving || publishing || Boolean(host?.busy)
  const blocked = loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : saveGuard
  const phone = (
    <LinePreview
      note={messageType === 'flex' ? 'カードの見え方です。' : '差し込み後の見え方（山田 太郎さんの場合）'}
      accountName={sendName}
      caption="配信日 10:00"
    >
      {messageType === 'flex' ? (
        flexError ? (
          <p role="alert" className={styles.error}>{flexError}このままでは保存できません。</p>
        ) : !messageContent.trim() ? (
          <p className={styles.hint}>カードの内容を入力すると、ここに表示されます。</p>
        ) : (
          <FlexPreview content={messageContent} />
        )
      ) : (
        <LinePreviewMessage accountName={sendName ?? '公式アカウント'} avatar={(sendName ?? '公').slice(0, 1)} time="10:00">
          {preview.content || '（本文がまだありません）'}
        </LinePreviewMessage>
      )}
      {preview.unresolved.length > 0 ? (
        <p role="alert" className={styles.error}>値を確認できない差し込みがあります：{preview.unresolved.map((key) => `{{${key}}}`).join('、')}</p>
      ) : null}
    </LinePreview>
  )

  return (
    <>
      <TemplateEditFrame
        boardId={boardId}
        title={title}
        description={description}
        band={conflict ? (
          <div className={styles.band} role="alert" data-design-node="NCbYn">
            <CircleAlert size={18} aria-hidden="true" className={styles.bandIcon} />
            <div className={styles.bandText}>
              <p className={styles.bandTitle} title={conflict.name}>
                {`ほかの人が${conflict.at ? ` ${conflict.at} に` : '先に'}テンプレート「${conflict.name}」を保存しました`}
              </p>
              <p className={styles.bandDesc}>あなたが直した所はまだ保存されていません。このまま保存すると、ほかの人の変更が消えます。</p>
            </div>
            <div className={styles.bandActions}>
              <Button type="button" onClick={() => void openCompare()} disabled={compareBusy}>
                <GitCompare size={15} aria-hidden="true" />
                違いを比べる
              </Button>
              <Button type="button" variant="primary" onClick={reloadLatest}>
                <RotateCcw size={15} aria-hidden="true" />
                最新を読み込んで続ける
              </Button>
            </div>
          </div>
        ) : undefined}
        side={(
          <>
            <div className={styles.previewToggle}>
              <Button type="button" onClick={() => setPreviewOpen(true)}>LINEでの見え方を見る</Button>
            </div>
            <SenderCard />
            {id && editor.status === 'ready' && editor.usedBy && templateUsageEntries(editor.usedBy).length > 0 ? <UsageCard usedBy={editor.usedBy} published={(editor.publishedVersion ?? 0) >= 1} /> : null}
            <h2 className={styles.previewHead}>届き方</h2>
            <div className={styles.phone}>{phone}</div>
          </>
        )}
        status={autosave.label ? <span aria-live="polite" data-autosave-status>{autosave.label}</span> : undefined}
        footerActions={(
          <>
            {host ? <Button type="button" onClick={host.onCancel}>キャンセル</Button> : <Button href="/templates">キャンセル</Button>}
            <Button
              type="button"
              onClick={() => void onSaveDraft()}
              disabled={busy || Boolean(blocked)}
              title={blocked ?? undefined}
              busy={saving && !publishing}
              busyLabel="保存中…"
            >
              下書きを保存
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={conflict ? () => void openCompare() : () => void onPublish()}
              disabled={busy || Boolean(blocked)}
              title={blocked ?? undefined}
              busy={publishing || Boolean(host?.busy)}
              busyLabel={host ? '保存中…' : '公開中…'}
            >
              {conflict ? <GitCompare size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}
              {conflict ? '比べてから保存' : host ? host.primaryLabel ?? '保存して配る' : '保存して公開'}
            </Button>
          </>
        )}
      >
        {loading ? (
          <Card padding="none" layout="vertical" className={styles.card}>
            <p className={styles.cardNote} role="status">テンプレートを読み込んでいます…</p>
          </Card>
        ) : (
          <>
            {host?.notice}
            {error || loadFailed ? <p role="alert" className={styles.error}>{loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error}</p> : null}
            {exampleNote && !id ? <p role="status" className={styles.error}>{exampleNote}</p> : null}
            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>名前とフォルダ</h2>
                <p className={styles.cardNote}>一覧に出る名前です。友だちには見えません。</p>
              </div>
              <div className={styles.pair}>
                <div className={`${styles.field} ${styles.grow}`}>
                  <label htmlFor="te-name" className={styles.label}>テンプレート名</label>
                  <TextField id="te-name" value={name} onChange={(event) => updateDraft({ name: event.target.value })} placeholder="例：予約前日のご案内" aria-required="true" />
                </div>
                <div className={`${styles.field} ${styles.folderField}`}>
                  <label htmlFor="te-folder" className={styles.labelSmall}>フォルダ</label>
                  <FolderSelect
                    id="te-folder"
                    aria-label="フォルダ"
                    value={host ? host.folder : folderId ?? ''}
                    onChange={host ? host.onFolderChange : (value) => updateDraft({ folderId: value || null })}
                    folders={host ? host.folders : folders.map(folderById)}
                    colors
                    onCreate={host
                      ? hostFolderCreate(host)
                      : canMutate && editorAccountId
                        ? folderCreator((name, color) => api.folders.create({ kind: 'template', name, color, accountId: editorAccountId }), folderById, (created) => setFolders((current) => [...current, created]))
                        : undefined}
                  />
                </div>
              </div>
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>中身</h2>
              </div>
              <div className={styles.typeRow} title={id ? '作ったあとに種類を変えると、中身の書き方も変える必要があります。' : undefined}>
                <span className={styles.labelSmall}>形</span>
                <SegmentedControl aria-label="メッセージの形" options={MESSAGE_TYPES} value={messageType} onChange={(value) => updateDraft({ messageType: value })} />
              </div>
              <div className={styles.bodyBox}>
                <InsertTextField
                  id="te-content"
                  ref={contentRef}
                  aria-label={messageType === 'text' ? '本文' : 'メッセージ内容'}
                  aria-required="true"
                  className={styles.bodyText}
                  data-kind={messageType}
                  value={messageContent}
                  onValueChange={(next) => updateDraft({ messageContent: next })}
                  tokenNames={tokenNames}
                  placeholder={messageType === 'flex' ? '{"type":"bubble", …}' : '例：{{name}}さん、こんにちは。'}
                />
                <span className={styles.bodySpacer} aria-hidden="true" />
                <InsertRow accountId={editorAccountId} state={referenceState} references={references} length={messageContent.length} onInsert={insert} />
              </div>
              {messageType === 'flex' && flexError && messageContent.trim() ? (
                <p role="alert" className={styles.error}>{flexError}このままでは保存できません。</p>
              ) : null}
              <p className={styles.hint}>
                {messageType === 'flex'
                  ? <>バブルかカルーセルの形のJSONで書きます。カルーセルは <Link href="/templates/carousel">カルーセルの編集</Link> で作れます。</>
                  : '名前と友だち情報は受け取る人ごと、共通情報と配信日は送る時点の値に置き換わります。回答フォームの答えは、答えを保存した友だち情報から差し込みます。'}
                {messageContent.length > 4500 ? ' 約4,500文字を超えると複数のメッセージに分かれて届きます。' : ''}
              </p>
              {referenceState === 'failed' ? <p role="alert" className={styles.error}>差し込み項目を読み込めませんでした。画面を再読み込みしてください。</p> : null}
              {host ? <p className={styles.hint}>統括のテンプレートで差し込めるのは、名前・配信日・その他です（友だち情報・共通情報はアカウントごとに違うため）。</p>
                : !editorAccountId && !loading ? <p className={styles.hint}>LINE公式アカウントを選ぶと、友だち情報と共通情報を選べます。</p> : null}
              {accountMismatch ? (
                <div role="alert" className={styles.readonly}>
                  {ACCOUNT_MISMATCH_MESSAGE}（このテンプレートは「{accountName(editor.templateAccountId) ?? editor.templateAccountId}」のものです。差し込み候補もそのアカウントのまま出しています）
                </div>
              ) : null}
            </Card>

            <Card padding="none" layout="vertical" className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>本文の中のURL</h2>
              </div>
              {urls.length === 0 ? (
                <p className={styles.cardNote}>本文にURLはありません。URLを書くと、送るときに短く書き換えて、押された数を数えます。</p>
              ) : (
                <>
                  {urls.map((url) => (
                    <div key={url} className={styles.urlRow}>
                      <Link2 size={14} aria-hidden="true" className={styles.urlIcon} />
                      <span className={styles.urlText} title={url}>{url}</span>
                      <span className={styles.urlNote}>短縮して、押された数を数える</span>
                      <Toggle checked locked label={`${url}を短縮して数える（いつもオン）`} />
                    </div>
                  ))}
                  <p className={styles.hint}>リンク名（計測に出る名前）と短縮URLは、配信のときに自動で付きます。</p>
                </>
              )}
            </Card>
          </>
        )}
      </TemplateEditFrame>

      <Dialog open={previewOpen} title="LINEでの見え方" cancelLabel="閉じる" onCancel={() => setPreviewOpen(false)}>
        <div className={styles.previewDialog}>{phone}</div>
      </Dialog>

      <ConfirmDialog
        open={compareOpen}
        title="最新の保存と比べる"
        description="あなたの下書きと、ほかの人が保存した最新の内容の違いです。読み込むまでは画面は変わりません。"
        confirmLabel="最新を読み込んで続ける"
        busy={compareBusy}
        error={compareError || undefined}
        onConfirm={reloadLatest}
        onCancel={() => { setCompareOpen(false); setCompareError('') }}
      >
        {conflict?.latest ? (() => {
          const lines = describeTemplateDiff(editor.draft, conflict.latest)
          return lines.length === 0
            ? <p className={styles.cardNote}>違いは見つかりませんでした。そのまま読み込めます。</p>
            : <ul className={styles.diffList}>{lines.map((line) => <li key={line}>・{line}</li>)}</ul>
        })() : null}
      </ConfirmDialog>

      <ConfirmDialog
        open={publishCheck !== null}
        title="この内容を公開しますか？"
        description={`このテンプレートは ${publishCheck?.entries.length ?? 0}か所で使われています。公開すると、使っている場所へ新しい内容が届きます。`}
        confirmLabel="公開する"
        busy={publishing}
        error={error || undefined}
        designNode="cuR8I"
        onConfirm={async () => {
          if (!publishCheck) return
          setPublishing(true)
          setError('')
          try {
            if (await publishNow(publishCheck.id)) {
              setPublishCheck(null)
              notifyToast('公開しました')
              leave()
            }
          } finally {
            setPublishing(false)
          }
        }}
        onCancel={() => setPublishCheck(null)}
      >
        <ul className={styles.sideList}>
          {publishCheck?.entries.map((entry) => (
            <li key={entry.key}>{entry.href ? <Link href={entry.href}>{entry.label}</Link> : entry.label}</li>
          ))}
        </ul>
      </ConfirmDialog>

      <UnsavedLeaveDialog open={leaveTarget !== null} subject="テンプレートの変更" onConfirm={confirmLeave} onCancel={cancelLeave} />
    </>
  )
}

function SenderCard() {
  return (
    <section className={styles.sideCard}>
      <h2 className={styles.sideTitle}>送るときの名前</h2>
      <p className={styles.sideText}>公式のアイコンと表示名で送ります。担当者の名前では送れません。</p>
    </section>
  )
}

/* 変更が使われる場所（IDEA-11）。保存は下書き、利用先へは公開した内容だけが届く。 */
function UsageCard({ usedBy, published }: { usedBy: NonNullable<TemplateEditorState['usedBy']>; published: boolean }) {
  const entries = templateUsageEntries(usedBy)
  return (
    <section className={styles.sideCard} aria-label="このテンプレートの利用先">
      <h2 className={styles.sideTitle}>この変更が使われる場所（{entries.length}か所）</h2>
      {entries.length === 0 ? (
        <p className={styles.sideText}>このテンプレートはまだどこからも呼ばれていません。</p>
      ) : (
        <>
          <p className={styles.sideText}>
            {published
              ? '下書きを保存しただけでは届きません。「保存して公開」で使っている場所へ届きます。'
              : 'まだ公開していません。「保存して公開」で使っている場所へ新しい内容が使われます。'}
          </p>
          <ul className={styles.sideList}>
            {entries.map((entry) => (
              <li key={entry.key}>{entry.href ? <Link href={entry.href}>{entry.label}</Link> : entry.label}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
