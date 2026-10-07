'use client'

import Select from '@/components/shared/select'
import React, { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { isOwnerOrAdmin } from '@/lib/staff-capability'
import type { Folder } from '@line-crm/shared'
import { Field, inputClass } from '@/components/shared/create-page'
import Button from '@/components/shared/button'
import StickyBar from '@/components/shared/sticky-bar'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import { useAdminTheme } from '@/lib/use-admin-theme'
import TemplateEditV8New from '@/v8/template-edit/edit'
import TemplateAssetEditor from '../template-asset-editor'
import { isTemplateDetailData } from '../template-detail-data'
import {
  ACCOUNT_MISMATCH_MESSAGE,
  TEMPLATE_LOAD_FAILED_MESSAGE,
  TEMPLATE_LOADING_MESSAGE,
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
  type TemplateDraft,
  type TemplateEditorState,
  type TemplateSaveInput,
} from './edit-core'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MessageTemplateEditor,
  TemplateInsertControls,
  buildTemplatePreview,
  extractMessageUrls,
  previewDateValue,
  type TemplateReferences,
  type TemplateReferenceState,
} from '@/components/templates/message-template-editor'

const EMPTY_REFERENCES = EMPTY_TEMPLATE_REFERENCES

function TemplateEditInner() {
  const router = useRouter()
  const { accounts, selectedAccountId } = useAccount()
  /*
   * N-144: 作成・編集APIは requireRole('owner','admin') で閉じている。
   * staff が URL 直打ちで来てもフォームを出さず、保存まで辿り着けない
   * ようにする。一覧の閲覧は /templates に残る。
   */
  const [canMutateTemplates] = useState(() =>
    typeof window === 'undefined' ? true : isOwnerOrAdmin())
  const params = useSearchParams()
  const id = params.get('id')
  const assetKind = params.get('kind')
  const visual = params.get('visual') === '1'
  usePageTitle(id ? 'メッセージを編集' : 'メッセージを作る')

  const [folders, setFolders] = useState<Folder[]>([])
  const [references, setReferences] = useState<TemplateReferences>(EMPTY_REFERENCES)
  const [referenceState, setReferenceState] = useState<TemplateReferenceState>('idle')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editorState, setEditor] = useState<TemplateEditorState>(() => newTemplateEditorState(id, visual))

  /*
   * URL の id が変わった瞬間に、前のテンプレートの中身を捨てる。
   *
   * **`useEffect` で捨てるのでは遅い。** 効果が動くまでの1回の描画で
   * 「本文は A・所属は A・送り先は B」という組み合わせが画面に出てしまい、
   * そこで保存すると A の本文が `PUT /api/templates/B` へ流れる。
   * 描画の途中で捨てれば、その組み合わせは一度も現れない。
   * （描画中の `setState` は React が認めている「props に合わせて状態を
   *  直す」書き方。この描画は捨てられ、すぐ新しい状態で描き直される。）
   */
  let editor = editorState
  if (editor.requestedId !== id) {
    editor = newTemplateEditorState(id, visual)
    setEditor(editor)
  }

  const { name, category, folderId, messageType, messageContent } = editor.draft
  const updateDraft = (patch: Partial<TemplateDraft>) =>
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
  // 読み込めていない本文のまま保存すると、空で上書きする危険がある。
  const loadFailed = editor.status === 'failed'
  const loading = Boolean(id) && (editor.status === 'idle' || editor.status === 'loading')
  const accountName = (accountId: string | null) =>
    accounts.find((account) => account.id === accountId)?.name ?? null

  // 置き場の選択肢。category 文字列とは別に folderId で保存する。
  // フォルダはアカウント単位（N-147）。テンプレートの所属アカウントで絞る。
  useEffect(() => {
    // 読み替えるまで前のアカウントの帯を残さない（他の編集画面と同じ）。
    setFolders([])
    if (!editorAccountId) {
      return
    }
    let cancelled = false
    void api.folders.list('template', editorAccountId)
      .then((res) => {
        if (!cancelled && res.success) setFolders(res.data)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [editorAccountId])

  /*
   * 出した順番。片付けのたびに1つ進めるので、画面から離れたあとの応答も、
   * アカウントを替える前に出した応答も、いちばん新しい要求と一致しない。
   */
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

  /*
   * 取得の世代。id を替えるたびに1つ進める。片付けでも進めるので、
   * 前の id への応答も、画面を離れたあとの応答も、現世代と一致しない。
   */
  const templateGeneration = useRef(0)

  useEffect(() => {
    if (!id) return
    const generation = ++templateGeneration.current
    /** 現世代で、いまも同じ id を開いているときだけ書き込む。 */
    const accept = (next: (prev: TemplateEditorState) => TemplateEditorState) => {
      if (generation !== templateGeneration.current) return
      setEditor((prev) => (prev.requestedId === id ? next(prev) : prev))
    }
    void api.templates
      .get(id)
      .then((res) => {
        // D007: success:true でも形が違う応答は「読み込めませんでした」へ。
        if (!res.success || !isTemplateDetailData(res.data)) {
          accept((prev) => ({ ...prev, status: 'failed' }))
          return
        }
        // 所属アカウントと本文は、同じ応答から一度に入れる。片方だけ先に
        // 入れると、その間だけ食い違いの判定が別の答えを出す。
        accept(() => ({
          requestedId: id,
          status: 'ready',
          templateAccountId: res.data.accountId ?? null,
          // 利用先も同じ応答に入っている。保存の手前に出す分も一緒に持つ。
          usedBy: res.data.usedBy ?? null,
          // R237: 公開・未公開で利用先への反映説明を分ける。
          publishedVersion: res.data.publishedVersion ?? null,
          draft: {
            name: res.data.name,
            category: res.data.category ?? '',
            folderId: res.data.folderId ?? null,
            messageType: res.data.messageType,
            messageContent: res.data.messageContent,
          },
        }))
      })
      .catch(() => accept((prev) => ({ ...prev, status: 'failed' })))
    return () => { templateGeneration.current += 1 }
  }, [id])

  const save = async () => {
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
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await saveTemplateEdit(input)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.push('/templates')
    } finally {
      setSaving(false)
    }
  }

  if (!canMutateTemplates) {
    return (
      <div aria-label="テンプレート編集">
        <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
          <Link href="/templates" className="underline">
            テンプレート
          </Link>
        </nav>
        <div role="alert" className="bg-canvas rounded-card border-hairline border p-8 text-sm">
          <p className="font-bold text-ink">テンプレートの作成・変更はオーナーと管理者だけができます</p>
          <p className="text-ink-secondary mt-1">中身の確認は一覧の行を開くと読めます。</p>
          <Link href="/templates" className="text-action underline mt-3 inline-block text-sm">一覧へ戻る</Link>
        </div>
      </div>
    )
  }

  if (assetKind === 'rich_message' || assetKind === 'coupon' || assetKind === 'research') {
    return <TemplateAssetEditor kind={assetKind} visual={visual} />
  }

  return (
    <div aria-label="テンプレート編集">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="underline">
          テンプレート
        </Link>
        <span className="mx-1.5">/</span>
        <span>{name || (id ? '編集' : '作成')}</span>
      </nav>

      {loading ? (
        <div className="bg-canvas rounded-card border-hairline text-ink-faint border p-8 text-center text-sm">
          読み込み中...
        </div>
      ) : (
        <>
        <MessageTemplateEditor
          value={{ messageType, messageContent }}
          onChange={(next) => updateDraft(next)}
          targetDate={targetDate}
          onTargetDateChange={setTargetDate}
          references={references}
          referenceState={referenceState}
          referenceAccountId={editorAccountId}
          referenceAccountLabel={accountMismatch ? accountName(editorAccountId) : null}
          typeNote={id ? '作ったあとに種類を変えると、中身の書き方も変える必要があります。' : undefined}
          carouselHref="/templates/carousel"
          beforeType={(
            <>
              <Field label="テンプレート名" htmlFor="tp-name" required>
                <input id="tp-name" type="text" value={name} onChange={(event) => updateDraft({ name: event.target.value })} className={inputClass} />
              </Field>
              <Field label="置き場" htmlFor="tp-folder" note="一覧のフォルダ分けと絞り込みに使います。">
                <Select aria-label="置き場" id="tp-folder" value={folderId ?? ''} onChange={(value) => updateDraft({ folderId: value || null })} options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
              </Field>
            </>
          )}
          afterType={(
            <TemplateAccountNotice binding={binding} templateAccountLabel={accountName(editor.templateAccountId)} selectedAccountLabel={accountName(selectedAccountId)} />
          )}
          footer={(
            <>
              {/*
                IDEA-11: 変更の利用先を保存の手前に出す。
                新規作成（id なし）や未取得では出さない。
              */}
              {id && editor.status === 'ready' && editor.usedBy ? (
                <TemplateUsageNotice
                  usedBy={editor.usedBy}
                  published={(editor.publishedVersion ?? 0) >= 1}
                />
              ) : null}
              {(loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error) && <p className="text-danger text-sm">{loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error}</p>}
              {saveGuard && !loadFailed && !accountMismatch && <p role="status" className="text-ink-secondary text-sm">{saveGuard}</p>}
              {/*
                ★V7: 保存・実行は下の固定バーにしか置かない。本文の最後に置くと、
                長い画面で「どこで保存されるのか」が分からなくなる。
                理由の文（利用先・保存できない理由）は手前に残す。
              */}
            </>
          )}
        />
        <StickyBar
          actions={(
            <>
              <Button href="/templates">キャンセル</Button>
              <Button type="button" variant="primary" onClick={save} disabled={saving || loadFailed || saveGuard !== null} title={saveGuard ?? undefined} busy={saving} busyLabel="保存中...">保存する
              </Button>
            </>
          )}
        />
        </>
      )}
    </div>
  )
}

function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditThemed />
    </Suspense>
  )
}

/*
 * ★V8: data-theme="v8" のときだけ新しい作る画面（edit-v8.tsx）を出す。
 * v7 の TemplateEditInner は見た目も動きもそのまま残す。
 */
function TemplateEditThemed() {
  const theme = useAdminTheme()
  if (theme !== 'v8') return <TemplateEditInner />
  /* メッセージ・リッチメッセージ（EFV8l）・クーポン・リサーチは src/v8 の新しい画面。 */
  return <TemplateEditV8New />
}

/*
 * 試験から触れる口。**画面を組み立て直さずに、実際に動く部品を呼ぶ。**
 * ここに出すのは、画面本体がそのまま使っている関数と部品だけ。
 */
const TemplateEditPageWithTestSupport = Object.assign(TemplateEditPage, {
  __testing: {
    ACCOUNT_MISMATCH_MESSAGE,
    TEMPLATE_LOADING_MESSAGE,
    TEMPLATE_LOAD_FAILED_MESSAGE,
    TemplateAccountNotice,
    TemplateEditInner,
    TemplateInsertControls,
    TemplateUsageNotice,
    templateUsageEntries,
    buildTemplatePreview,
    extractMessageUrls,
    isTemplateDetailData,
    loadTemplateReferences,
    previewDateValue,
    requestTemplateReferences,
    resolveEditorAccountId,
    saveTemplateEdit,
    templateAccountMismatch,
    templateSaveGuard,
    validateTemplateSave,
  },
})

export default TemplateEditPageWithTestSupport
