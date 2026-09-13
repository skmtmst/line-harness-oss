'use client'

import SelectField from '@/components/shared/select-field'
import React, { Suspense, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import { type Folder } from '@line-crm/shared'
import { Field, inputClass } from '@/components/shared/create-page'
import { useAccount } from '@/contexts/account-context'
import { usePageTitle } from '@/components/shell/page-chrome'
import TemplateAssetEditor from '../template-asset-editor'
import {
  EMPTY_TEMPLATE_REFERENCES,
  MessageTemplateEditor,
  TemplateInsertControls,
  buildTemplatePreview,
  previewDateValue,
  type TemplateReferences,
  type TemplateReferenceState,
} from '@/components/templates/message-template-editor'

interface ReferenceLoaders {
  friendFields: (accountId: string) => ReturnType<typeof api.friendFields.list>
  commonVars: (accountId: string) => ReturnType<typeof api.commonVars.list>
}

async function loadTemplateReferences(
  accountId: string,
  loaders: ReferenceLoaders = {
    friendFields: (id) => api.friendFields.list(id),
    commonVars: (id) => api.commonVars.list(id),
  },
): Promise<TemplateReferences> {
  const [fieldResponse, varResponse] = await Promise.all([
    loaders.friendFields(accountId),
    loaders.commonVars(accountId),
  ])
  if (!fieldResponse.success || !varResponse.success) {
    throw new Error('差し込み項目を読み込めませんでした')
  }
  return {
    friendFields: fieldResponse.data.filter((field) => field.canInsertText !== false),
    commonVars: varResponse.data,
  }
}

const EMPTY_REFERENCES = EMPTY_TEMPLATE_REFERENCES

/**
 * 編集画面が見ている LINE 公式アカウントの組み合わせ。
 *
 * 「上のバーで選んでいるもの」と「開いているテンプレートの所属」は別物。
 * この2つを1つの変数で扱うと、切り替えた瞬間に取り違える。
 */
interface TemplateAccountBinding {
  templateId: string | null
  /**
   * **いま画面にある中身が、その `templateId` のものとして確定しているか。**
   *
   * `ready` 以外は、所属アカウントも本文も、この id のものだと言えない。
   * URL の id を A から B へ替えた直後がまさにそれで、画面には A の本文が
   * 残ったまま送り先だけ B になっている。
   */
  templateStatus: TemplateLoadStatus
  templateAccountId: string | null
  selectedAccountId: string | null
}

type TemplateLoadStatus = 'idle' | 'loading' | 'ready' | 'failed'

const ACCOUNT_MISMATCH_MESSAGE =
  '別のLINE公式アカウントに切り替わっています。上のバーでこのテンプレートのアカウントへ戻すと保存できます。'

const TEMPLATE_LOAD_FAILED_MESSAGE = '読み込めませんでした。開き直してください。'

const TEMPLATE_LOADING_MESSAGE =
  'テンプレートを読み込んでいます。読み終わるまで保存できません。'

/**
 * 差し込み候補を読むアカウント。**既存テンプレートは所属へ固定する。**
 *
 * 上のバーで A から B へ替えても、A のテンプレートを開いている限り
 * 候補は A のまま。替えた先の候補を出すと、A のテンプレートへ B の
 * 項目キーを書き込める。書き込めても A の友だちにその項目は無いので、
 * 配信時に `{{field.…}}` が置き換わらないまま相手へ届く。
 *
 * 取得が終わるまでは `null`。終わる前に選択中アカウントで読むと、
 * 一瞬だけ別アカウントの候補が並び、その隙に選べてしまう。
 */
function resolveEditorAccountId(binding: TemplateAccountBinding): string | null {
  if (!binding.templateId) return binding.selectedAccountId
  if (binding.templateStatus !== 'ready') return null
  // 所属を持たない旧データだけ、選択中アカウントの候補で編集する。
  return binding.templateAccountId ?? binding.selectedAccountId
}

/** 開いているテンプレートの所属と、上のバーの選択が食い違っているか。 */
function templateAccountMismatch(binding: TemplateAccountBinding): boolean {
  if (!binding.templateId || binding.templateStatus !== 'ready') return false
  if (!binding.templateAccountId || !binding.selectedAccountId) return false
  return binding.templateAccountId !== binding.selectedAccountId
}

/**
 * 保存を閉じる理由。**`null` のときだけ保存の口を開ける。**
 *
 * 中身の入力（名前・本文）とは分けている。こちらは「その中身を、その
 * 送り先へ送ってよいか」の話で、押す前から決まる。押してから知らせる
 * のでは、押せてしまう瞬間があるのと同じ。
 */
function templateSaveGuard(binding: TemplateAccountBinding): string | null {
  if (binding.templateId) {
    if (binding.templateStatus === 'failed') return TEMPLATE_LOAD_FAILED_MESSAGE
    /*
     * 取得が終わるまで閉じる。**ここが開いていると、A を読んだあと URL を
     * B へ替えた直後に、A の本文を `PUT /api/templates/B` へ送れる。**
     * 送り先だけ先に切り替わり、中身が追いつくまでの間があるため。
     */
    if (binding.templateStatus !== 'ready') return TEMPLATE_LOADING_MESSAGE
  }
  if (templateAccountMismatch(binding)) return ACCOUNT_MISMATCH_MESSAGE
  return null
}

/**
 * 差し込み候補の取り込み。**遅れて届いた古い応答は捨てる。**
 *
 * A から B へ替えると、A への問い合わせのほうが後に返ることがある。
 * 届いた順に入れると、B を編集しているのに A の候補が並ぶ。
 * 出した順番を持ち、いちばん新しい要求以外は結果を返さない。
 *
 * 捨てたときは `null`、読めなかったときは `'failed'`。
 */
async function requestTemplateReferences(request: {
  load: (accountId: string) => Promise<TemplateReferences>
  accountId: string
  generation: number
  currentGeneration: () => number
}): Promise<TemplateReferences | 'failed' | null> {
  try {
    const references = await request.load(request.accountId)
    return request.generation === request.currentGeneration() ? references : null
  } catch {
    return request.generation === request.currentGeneration() ? 'failed' : null
  }
}

interface TemplateSaveInput extends TemplateAccountBinding {
  name: string
  category: string
  messageType: string
  messageContent: string
  folderId: string | null
}

/**
 * 保存してよいか。**駄目な理由を返す。`null` なら保存してよい。**
 *
 * 所属と選択の食い違いをここで止める。止めないと、B の候補を挿した本文が
 * A のテンプレートとして保存される。保存する口 (`PUT /api/templates/:id`)
 * は所属アカウントを受け取らないので、サーバー側では気づけない。
 */
function validateTemplateSave(input: TemplateSaveInput): string | null {
  const guard = templateSaveGuard(input)
  if (guard) return guard
  if (!input.templateId && !input.selectedAccountId) return '上のバーでLINE公式アカウントを選んでください'
  if (!input.name.trim()) return '名前を入力してください'
  if (!input.messageContent.trim()) return '本文を入力してください'
  return null
}

interface TemplateSaveOps {
  create: typeof api.templates.create
  update: typeof api.templates.update
}

/**
 * 保存する。**断る条件に当たったら、APIを一度も呼ばない。**
 *
 * 画面側でボタンを塞ぐだけだと、状態が入れ替わる途中の押下を拾えない。
 * 送る直前に、送り先と中身が同じテンプレートのものか確かめ直す。
 */
async function saveTemplateEdit(
  input: TemplateSaveInput,
  ops: TemplateSaveOps = { create: api.templates.create, update: api.templates.update },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const blocked = validateTemplateSave(input)
  if (blocked) return { ok: false, error: blocked }

  const payload = {
    name: input.name.trim(),
    category: input.category,
    messageType: input.messageType,
    messageContent: input.messageContent,
    folderId: input.folderId,
  }
  try {
    const res = input.templateId
      ? await ops.update(input.templateId, payload)
      : await ops.create({ accountId: input.selectedAccountId as string, ...payload })
    return res.success ? { ok: true } : { ok: false, error: res.error }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '保存に失敗しました' }
  }
}

/**
 * 所属アカウントと選択中アカウントが食い違っているときの知らせ。
 *
 * 「保存できません」だけでは戻し方が分からない。どのアカウントのものか、
 * 候補は何のままかを一緒に出す。
 */
function TemplateAccountNotice({
  binding,
  templateAccountLabel,
  selectedAccountLabel,
}: {
  binding: TemplateAccountBinding
  templateAccountLabel: string | null
  selectedAccountLabel: string | null
}) {
  if (!templateAccountMismatch(binding)) return null
  return (
    <div role="alert" className="border-hairline rounded-control border bg-canvas-sunken px-3 py-2 text-xs">
      <p className="text-danger font-semibold">{ACCOUNT_MISMATCH_MESSAGE}</p>
      <p className="text-ink-secondary mt-1">
        このテンプレートは「{templateAccountLabel ?? binding.templateAccountId}」のものです。
        いま選んでいるのは「{selectedAccountLabel ?? binding.selectedAccountId}」です。
      </p>
      <p className="text-ink-secondary mt-1">
        差し込み候補は「{templateAccountLabel ?? binding.templateAccountId}」のまま出しています。
      </p>
    </div>
  )
}

/** 編集中の中身。テンプレート1件分の下書き。 */
interface TemplateDraft {
  name: string
  category: string
  folderId: string | null
  messageType: string
  messageContent: string
}

/**
 * 画面が持つ「テンプレート1件分」の状態。
 *
 * **`requestedId` と中身を必ず一緒に動かす。** 別々の `useState` に置くと、
 * URL の id だけ先に変わり、中身が前のテンプレートのまま残る瞬間ができる。
 * その瞬間に保存すると、前のテンプレートの本文が新しい id へ入る。
 */
interface TemplateEditorState {
  requestedId: string | null
  status: TemplateLoadStatus
  templateAccountId: string | null
  draft: TemplateDraft
}

function newTemplateEditorState(templateId: string | null, visual: boolean): TemplateEditorState {
  return {
    requestedId: templateId,
    status: templateId ? 'loading' : 'idle',
    templateAccountId: null,
    draft: {
      name: visual ? '定期便 初回のご案内' : '',
      // category は旧一覧との互換用に保存だけ続ける。分け方は folderId に一本化する。
      category: 'general',
      folderId: null,
      messageType: 'text',
      messageContent: visual
        ? '{{name}}さん、いつもありがとうございます。\n初回のお届け予定はこちらです。\nhttps://example.co.jp/first-delivery'
        : '',
    },
  }
}

function TemplateEditInner() {
  const router = useRouter()
  const { accounts, selectedAccountId } = useAccount()
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
  useEffect(() => {
    let cancelled = false
    void api.folders.list('template')
      .then((res) => {
        if (!cancelled && res.success) setFolders(res.data)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [])

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
        if (!res.success) {
          accept((prev) => ({ ...prev, status: 'failed' }))
          return
        }
        // 所属アカウントと本文は、同じ応答から一度に入れる。片方だけ先に
        // 入れると、その間だけ食い違いの判定が別の答えを出す。
        accept(() => ({
          requestedId: id,
          status: 'ready',
          templateAccountId: res.data.accountId ?? null,
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

  if (assetKind === 'rich_message' || assetKind === 'coupon' || assetKind === 'research') {
    return <TemplateAssetEditor kind={assetKind} visual={visual} />
  }

  return (
    <div aria-label="テンプレート編集">
      <nav data-design="Crumb" className="text-ink-faint mb-2 text-xs">
        <Link href="/templates" className="hover:underline">
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
                <SelectField id="tp-folder" value={folderId ?? ''} onChange={(event) => updateDraft({ folderId: event.target.value || null })} options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
              </Field>
            </>
          )}
          afterType={(
            <TemplateAccountNotice binding={binding} templateAccountLabel={accountName(editor.templateAccountId)} selectedAccountLabel={accountName(selectedAccountId)} />
          )}
          footer={(
            <>
              {(loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error) && <p className="text-danger text-sm">{loadFailed ? TEMPLATE_LOAD_FAILED_MESSAGE : error}</p>}
              {saveGuard && !loadFailed && !accountMismatch && <p role="status" className="text-ink-secondary text-sm">{saveGuard}</p>}
              <div className="flex flex-wrap gap-2">
                <button onClick={save} disabled={saving || loadFailed || saveGuard !== null} title={saveGuard ?? undefined} className="bg-accent-deep text-on-accent hover:brightness-92 rounded-control px-4 py-2 text-sm font-medium transition-colors disabled:opacity-40">{saving ? '保存中...' : '保存'}</button>
                <button disabled title="テスト送信は準備中です" className="border-hairline text-ink-faint rounded-control border px-4 py-2 text-sm font-medium opacity-50">テスト送信</button>
                <Link href="/templates" className="text-ink-secondary bg-canvas-sunken hover:bg-hairline rounded-control px-4 py-2 text-sm font-medium">キャンセル</Link>
              </div>
            </>
          )}
        />
      )}
    </div>
  )
}

function TemplateEditPage() {
  // useSearchParams は Suspense の中でしか使えない（静的書き出しのため）。
  return (
    <Suspense fallback={<div className="text-ink-faint p-6 text-sm">読み込み中...</div>}>
      <TemplateEditInner />
    </Suspense>
  )
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
    buildTemplatePreview,
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
