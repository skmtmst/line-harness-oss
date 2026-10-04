'use client'

/*
 * ★V8「メッセージを作る／編集」（Pencil u5YC6）。
 *
 * 左に積む白いカード：名前とフォルダ／中身（形・本文・差し込む）／本文の中のURL。
 * 右の欄：「送るときの名前」＋届き方（LinePreview の本物のスマホ）。
 * 下の追従バー：キャンセル／下書きを保存／保存して公開。
 *
 * 口（読み込み・差し込み候補・保存の断り方・公開）は v7（edit/page.tsx）と
 * 同じ関数を使う。ここにあるのは置き場と見え方だけ。
 * `?kind=` が資産の種類（リッチメッセージ・クーポン・リサーチ）のときは
 * asset-editor-v8.tsx へ渡す。
 */
import React, { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Link2 } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import { validateFlexContent, type Folder } from '@line-crm/shared'
import SegmentedControl from '@/components/shared/segmented'
import Select from '@/components/shared/select'
import LinePreview from '@/components/shared/line-preview'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import { notifyToast } from '@/components/shared/toast'
import { Field } from '@/components/shared/form-controls'
import FlexPreviewComponent from '@/components/flex-preview'
import { useAccount } from '@/contexts/account-context'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MESSAGE_TEMPLATE_TYPES,
  TemplateInsertControls,
  TemplatePreviewMessage,
  buildTemplatePreview,
  extractMessageUrls,
  type TemplateReferences,
  type TemplateReferenceState,
} from '@/components/templates/message-template-editor'
import EditorV8, { EditorCard } from './editor-v8'
import styles from './editor-v8.module.css'
import { isTemplateDetailData } from './template-detail-data'
import {
  loadTemplateReferences,
  newTemplateEditorState,
  requestTemplateReferences,
  resolveEditorAccountId,
  saveTemplateEdit,
  templateAccountMismatch,
  templateSaveGuard,
  templateUsageEntries,
  validateTemplateSave,
  TemplateAccountNotice,
  TemplateUsageNotice,
  type TemplateAccountBinding,
  type TemplateEditorState,
  type TemplateSaveInput,
} from './edit/edit-core'
import TemplateAssetEditorV8 from './asset-editor-v8'

const EMPTY_REFERENCES = EMPTY_TEMPLATE_REFERENCES

/** 下書きの未保存判定に使う形。保存へ送る項目とそろえる。 */
function draftSnapshot(draft: TemplateEditorState['draft']): string {
  return JSON.stringify(draft)
}

/*
 * 1152 幅の板の印（V8.pen の地図）。板が 1100px を切ったら（画面幅で約 1352px
 * 未満）、作る画面の外枠に 1152 の板 ID を付ける。数える側は印で数える。
 */
function useNarrowBoard() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(max-width: 1351px)')
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return narrow
}

function MessageEditorV8({ id, visual }: { id: string | null; visual: boolean }) {
  const router = useRouter()
  /* 作る画面だけ：1152 幅なら板 `a1k3d`。変える画面は `u5YC6` のまま。 */
  const narrowBoard = useNarrowBoard()
  const designNode = id ? 'u5YC6' : narrowBoard ? 'a1k3d' : 'u5YC6'
  const { accounts, selectedAccountId } = useAccount()
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())

  const [folders, setFolders] = useState<Folder[]>([])
  const [references, setReferences] = useState<TemplateReferences>(EMPTY_REFERENCES)
  const [referenceState, setReferenceState] = useState<TemplateReferenceState>('idle')
  const [saving, setSaving] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editorState, setEditor] = useState<TemplateEditorState>(() => newTemplateEditorState(id, visual))
  /** 保存済み（=離れてよい）下書きの姿。読み込み・保存が済んだ直後に更新する。 */
  const [cleanSnapshot, setCleanSnapshot] = useState(() => draftSnapshot(newTemplateEditorState(id, visual).draft))
  /** 「保存して公開」の使用先確認窓。null の間は閉じている。 */
  const [publishCheck, setPublishCheck] = useState<{ id: string; entries: { key: string; href: string | null; label: string }[] } | null>(null)
  const [publishError, setPublishError] = useState('')

  /* v7 と同じく、URL の id が変わった瞬間に前の中身を描画中に捨てる。 */
  let editor = editorState
  if (editor.requestedId !== id) {
    editor = newTemplateEditorState(id, visual)
    setEditor(editor)
    setCleanSnapshot(draftSnapshot(editor.draft))
  }

  const { name, category, folderId, messageType, messageContent } = editor.draft
  const updateDraft = (patch: Partial<TemplateEditorState['draft']>) =>
    setEditor((prev) => ({ ...prev, draft: { ...prev.draft, ...patch } }))

  const binding: TemplateAccountBinding = {
    templateId: id,
    templateStatus: editor.status,
    templateAccountId: editor.templateAccountId,
    selectedAccountId,
  }
  const editorAccountId = resolveEditorAccountId(binding)
  const accountMismatch = templateAccountMismatch(binding)
  const saveGuard = templateSaveGuard(binding)
  const loadFailed = editor.status === 'failed'
  const loading = Boolean(id) && (editor.status === 'idle' || editor.status === 'loading')
  const accountName = (accountId: string | null) =>
    accounts.find((account) => account.id === accountId)?.name ?? null
  const dirty = !loading && draftSnapshot(editor.draft) !== cleanSnapshot

  useEffect(() => {
    setFolders([])
    if (!editorAccountId) return
    let cancelled = false
    void api.folders.list('template', editorAccountId)
      .then((res) => {
        if (!cancelled && res.success) setFolders(res.data)
      })
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
    void api.templates
      .get(id)
      .then((res) => {
        if (!res.success || !isTemplateDetailData(res.data)) {
          accept((prev) => ({ ...prev, status: 'failed' }))
          return
        }
        accept(() => ({
          requestedId: id,
          status: 'ready',
          templateAccountId: res.data.accountId ?? null,
          usedBy: res.data.usedBy ?? null,
          publishedVersion: res.data.publishedVersion ?? null,
          draft: {
            name: res.data.name,
            category: res.data.category ?? '',
            folderId: res.data.folderId ?? null,
            messageType: res.data.messageType,
            messageContent: res.data.messageContent,
          },
        }))
        // 読み込んだ姿を「保存済み」にする。読み直しで警告が出ないようにする。
        setCleanSnapshot(draftSnapshot({
          name: res.data.name,
          category: res.data.category ?? '',
          folderId: res.data.folderId ?? null,
          messageType: res.data.messageType,
          messageContent: res.data.messageContent,
        }))
      })
      .catch(() => accept((prev) => ({ ...prev, status: 'failed' })))
    return () => { templateGeneration.current += 1 }
  }, [id])

  /* 本文への差し込み（カーソル位置へ入れる）。v7 のエディタと同じ動き。 */
  const contentRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = (token: string) => {
    const element = contentRef.current
    const start = element?.selectionStart ?? messageContent.length
    const end = element?.selectionEnd ?? start
    const next = messageContent.slice(0, start) + token + messageContent.slice(end)
    updateDraft({ messageContent: next })
    if (element) requestAnimationFrame(() => {
      element.focus()
      element.setSelectionRange(start + token.length, start + token.length)
    })
  }

  /** 入力を保存する。できたら保存済みの姿を更新し、テンプレートの id を返す。 */
  const saveNow = async (): Promise<string | null> => {
    const input: TemplateSaveInput = {
      ...binding,
      name,
      category,
      messageType,
      messageContent,
      folderId,
    }
    const blocked = validateTemplateSave(input)
    if (blocked) {
      setError(blocked)
      return null
    }
    setSaving(true)
    setError('')
    try {
      const res = await saveTemplateEdit(input)
      if (!res.ok) {
        setError(res.error)
        return null
      }
      setCleanSnapshot(draftSnapshot(editor.draft))
      return res.id
    } finally {
      setSaving(false)
    }
  }

  /**
   * 保存して公開する（独立審査の決まり：表示中の版で公開、409 は読み直して
   * やり直し）。新規は使用先が無いので確認なしで公開してよい。
   * 既存で使用先があるときは確認窓を出してから公開する。
   */
  const publishSaved = async (templateId: string) => {
    setPublishing(true)
    setPublishError('')
    try {
      const detail = await api.templates.get(templateId)
      if (!detail.success || !isTemplateDetailData(detail.data)) {
        setPublishError('いまの状態を読み込めませんでした。一覧の詳細から公開してください。')
        return
      }
      const entries = detail.data.usedBy ? templateUsageEntries(detail.data.usedBy) : []
      if (entries.length > 0) {
        // 使用先がある：どこへ届くかを見せてから公開する（Pencil cuR8I）。
        setPublishCheck({ id: templateId, entries })
        return
      }
      const ok = await publishNow(templateId, detail.data)
      if (ok) {
        notifyToast('公開しました')
        router.push('/templates')
      }
    } finally {
      setPublishing(false)
    }
  }

  const publishNow = async (templateId: string, detail?: { publishedVersion: number; draftRevision: number }) => {
    const got = detail ? { success: true as const, data: detail } : await api.templates.get(templateId)
    if (!got.success || !got.data) {
      setPublishError('いまの状態を読み込めませんでした。もう一度お試しください。')
      return false
    }
    const current = got.data
    try {
      const res = await api.templates.publish(templateId, {
        expectedVersion: current.publishedVersion ?? 0,
        expectedDraftRevision: current.draftRevision ?? 0,
      })
      if (!res.success) {
        setPublishError(res.error || '公開できませんでした。もう一度お試しください。')
        return false
      }
    } catch (caught) {
      /*
       * 409 = 他の人が先に更新した。状態を読み直してからやり直してもらう
       * （一覧の詳細パネルと同じ扱い）。
       */
      if (caught instanceof ApiError && caught.status === 409) {
        setPublishError('他の人が先に更新したため、公開を止めました。画面を読み直して、もう一度お試しください。')
      } else {
        setPublishError('公開できませんでした。もう一度お試しください。')
      }
      return false
    }
    return true
  }

  const onSaveDraft = async () => {
    const savedId = await saveNow()
    if (savedId) {
      notifyToast('下書きを保存しました')
      router.push('/templates')
    }
  }

  const onPublish = async () => {
    const savedId = await saveNow()
    if (savedId) await publishSaved(savedId)
  }

  if (!canMutateTemplates) {
    return (
      <div className={styles.page}>
        <header className={styles.head}>
          <Link href="/templates" className={styles.back}>テンプレートへ</Link>
        </header>
        <div role="alert" className={styles.card}>
          <p className={styles.cardTitle}>テンプレートの作成・変更はオーナーと管理者だけができます</p>
          <p className={styles.muted}>中身の確認は一覧の行を開くと読めます。</p>
          <Link href="/templates" className="text-action underline text-sm">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  const preview = buildTemplatePreview(messageContent, references)
  const messageUrls = extractMessageUrls(messageContent)
  const flexError = messageType === 'flex' ? validateFlexContent('flex', messageContent) : null
  const publishedVersion = editor.publishedVersion ?? 0

  return (
    <>
      <EditorV8
        title={id ? 'メッセージを編集' : 'メッセージを作る'}
        lead={id
          ? '保存は下書きの保存です。使っている場所へ届けるには「保存して公開」'
          : '保存しただけでは、どこにも送られません'}
        designNode={designNode}
        dirty={dirty}
        dirtySubject="テンプレートの変更"
        saving={saving}
        publishing={publishing}
        saveBlockedReason={loadFailed ? '読み込めませんでした。開き直してください。' : saveGuard}
        status={publishedVersion >= 1 ? `版${publishedVersion}が使われています` : '下書き（まだ誰にも送られません）'}
        onSaveDraft={() => void onSaveDraft()}
        onPublish={() => void onPublish()}
        error={error || publishError || undefined}
        guide={(
          <>
            <section className={styles.card}>
              <div className={styles.cardHead}>
                <h2 className={styles.cardTitle}>送るときの名前</h2>
              </div>
              <p className={styles.muted}>公式のアイコンと表示名で送ります。担当者の名前では送れません。</p>
            </section>
            {id && editor.status === 'ready' && editor.usedBy ? (
              <TemplateUsageNotice usedBy={editor.usedBy} published={publishedVersion >= 1} />
            ) : null}
          </>
        )}
        preview={(
          <LinePreview
            note={messageType === 'flex' ? 'カードの見え方です。' : '差し込み後の見え方（山田 太郎さんの場合）'}
            accountName={accountName(editorAccountId) ?? undefined}
            caption="配信日 10:00"
          >
            {messageType === 'flex' ? (
              flexError ? (
                <div role="alert" className={styles.warn}>
                  <p>{flexError}このままでは保存できません。</p>
                </div>
              ) : !messageContent.trim() ? (
                <p className={styles.muted}>カードの内容を入力すると、ここに表示されます。</p>
              ) : (
                <FlexPreviewComponent content={messageContent} />
              )
            ) : (
              <TemplatePreviewMessage preview={preview} />
            )}
          </LinePreview>
        )}
      >
        {loading ? (
          <section className={styles.card}>
            <p className={styles.muted}>テンプレートを読み込んでいます…</p>
          </section>
        ) : (
          <>
            <EditorCard title="名前とフォルダ" note="一覧に出る名前です。友だちには見えません。">
              <div className={styles.fieldRow}>
                <Field label="テンプレート名" htmlFor="tp8-name" required>
                  <input
                    id="tp8-name"
                    type="text"
                    value={name}
                    onChange={(event) => updateDraft({ name: event.target.value })}
                    placeholder="例：予約前日のご案内"
                    className="border-hairline rounded-control focus-visible:outline-action w-full border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2"
                  />
                </Field>
                <Field label="フォルダ" htmlFor="tp8-folder">
                  <Select
                    id="tp8-folder"
                    aria-label="フォルダ"
                    value={folderId ?? ''}
                    onChange={(value) => updateDraft({ folderId: value || null })}
                    options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]}
                  />
                </Field>
              </div>
            </EditorCard>

            <EditorCard title="中身" note="形を選んで、本文を書きます。">
              <Field label="形" htmlFor="tp8-type">
                <SegmentedControl
                  aria-label="メッセージの形"
                  options={MESSAGE_TEMPLATE_TYPES.map((t) => ({ value: t.value, label: t.label }))}
                  value={messageType}
                  onChange={(value) => updateDraft({ messageType: value })}
                />
              </Field>
              <Field
                label={messageType === 'text' ? '本文' : 'メッセージ内容'}
                htmlFor="tp8-content"
                required
              >
                <textarea
                  id="tp8-content"
                  ref={contentRef}
                  rows={messageType === 'flex' ? 14 : 6}
                  value={messageContent}
                  onChange={(event) => updateDraft({ messageContent: event.target.value })}
                  className={`border-hairline rounded-control focus-visible:outline-action w-full resize-y border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 ${messageType === 'flex' ? 'font-mono text-xs' : ''}`}
                />
                {messageType === 'flex' && flexError ? (
                  <p role="alert" className="text-danger mt-1 text-xs">{flexError}このままでは保存できません。</p>
                ) : null}
                <p className={styles.countRow}>{messageContent.length} / 5,000{messageContent.length > 4500 ? '（超えると複数に分かれて届きます）' : ''}</p>
              </Field>
              <div>
                <p className={styles.guideTerm}>差し込む</p>
                <div className="mt-2">
                  <TemplateInsertControls
                    accountId={editorAccountId}
                    state={referenceState}
                    accountLabel={accountMismatch ? accountName(editorAccountId) : null}
                    targetDate={targetDate}
                    onTargetDateChange={setTargetDate}
                    friendFields={references.friendFields}
                    commonVars={references.commonVars}
                    onInsert={insert}
                  />
                </div>
                <p className={styles.muted}>
                  名前と友だち情報は受け取る人ごと、共通情報と配信日は送る時点の値に置き換わります。
                  回答フォームの答えは、答えを保存した友だち情報から差し込みます。
                </p>
              </div>
              <TemplateAccountNotice
                binding={binding}
                templateAccountLabel={accountName(editor.templateAccountId)}
                selectedAccountLabel={accountName(selectedAccountId)}
              />
              {saveGuard && !loadFailed && !accountMismatch ? (
                <p role="status" className={styles.muted}>{saveGuard}</p>
              ) : null}
            </EditorCard>

            <EditorCard
              title="本文の中のURL"
              note="本文に書いたURLは、送るときに短く書き換えて、押された数を数えます。"
            >
              {messageUrls.length === 0 ? (
                <p className={styles.muted}>本文にURLはありません。</p>
              ) : (
                messageUrls.map((url) => (
                  <div key={url} className={styles.urlRow}>
                    <Link2 size={14} aria-hidden="true" className="shrink-0 text-ink-faint" />
                    <span className={styles.urlText} title={url}>{url}</span>
                    <span className={styles.urlBadge}>短縮して、押された数を数える</span>
                  </div>
                ))
              )}
              {messageUrls.length > 0 ? (
                <p className={styles.muted}>リンクの名前と短縮URLは配信時に自動で付きます。</p>
              ) : null}
            </EditorCard>
          </>
        )}
      </EditorV8>

      <ConfirmDialog
        open={publishCheck !== null}
        title="この内容を公開しますか？"
        description={`このテンプレートは ${publishCheck?.entries.length ?? 0}か所で使われています。公開すると、使っている場所へ新しい内容が届きます。`}
        confirmLabel="公開する"
        busy={publishing}
        error={publishError || undefined}
        designNode="cuR8I"
        onConfirm={async () => {
          if (!publishCheck) return
          setPublishing(true)
          setPublishError('')
          try {
            const ok = await publishNow(publishCheck.id)
            if (ok) {
              setPublishCheck(null)
              notifyToast('公開しました')
              router.push('/templates')
            }
          } finally {
            setPublishing(false)
          }
        }}
        onCancel={() => setPublishCheck(null)}
      >
        <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
          {publishCheck?.entries.map((entry) => (
            <li key={entry.key}>
              {entry.href ? (
                <Link href={entry.href} className="text-action underline">{entry.label}</Link>
              ) : (
                <span className="text-ink-secondary">{entry.label}</span>
              )}
            </li>
          ))}
        </ul>
      </ConfirmDialog>
    </>
  )
}

/*
 * ★V8 テンプレートの作る画面の入口。`?kind=` が資産の3種なら
 * asset-editor-v8.tsx へ、それ以外はメッセージの作る画面へ。
 */
export default function TemplateEditV8() {
  const params = useSearchParams()
  const id = params.get('id')
  const assetKind = params.get('kind')
  const visual = params.get('visual') === '1'

  if (assetKind === 'rich_message' || assetKind === 'coupon' || assetKind === 'research') {
    return <TemplateAssetEditorV8 kind={assetKind} visual={visual} />
  }
  return <MessageEditorV8 id={id} visual={visual} />
}
