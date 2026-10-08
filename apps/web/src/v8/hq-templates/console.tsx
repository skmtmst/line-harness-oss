'use client'

/*
 * ★V8-B 統括のテンプレート（一覧 LRc93・メッセージのひな形を作る X4JcOf・アカウントへ配る meBRB）。
 *
 * 2026-10-07 src/v8 に一から書いた。読み書き・権限・失敗時の扱いは今の画面
 * （app/hq/templates/template-console.tsx）と同じ：一覧・分類（フォルダ）・複製・削除、
 * 新規保存の依頼ID（応答不明は同じ依頼を固定して「前回の保存を再確認」）、配る前の確認
 * （preflight）と重複の配り方、配る（preflightId＝配布番号・応答不達は GET で復元・再POSTしない）、
 * URL の hash からの復元、失敗アカウントだけの再確認。動きの一覧は同じ場所の BEHAVIOR.md。
 *
 * メッセージ（type=template）の作る画面は絵どおりに書き直した（message-form.tsx）。
 * タグ・リッチメニュー・回答フォーム・シナリオのひな形の中身は、入口（app/hq/templates/page.tsx）
 * が今の編集部品を `DefinitionEditor` として渡す（src/v8 から @/app を読まないため）。
 */
import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { ArrowLeft, Check, Plus, RotateCw, Search, Send } from 'lucide-react'
import { templateKind, type HqTemplateFolder, type HqTemplateListStats, type HqTemplateReceivedVersion, type HqTemplateVersionDisplay, type TemplateKind } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import { ListPageBody } from '@/components/templates/list-page'
import { FolderDotName } from '@/components/shared/folder-dot'
import Button from '@/components/shared/button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import StatusBadge from '@/components/shared/status-badge'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import FolderSelect from '@/components/shared/folder-select'
import { Th } from '@/components/shared/table'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { freshDefinition } from '@/lib/hq-template-authoring'
import { clearCreationAttempt, loadCreationAttempt, persistCreationAttempt, sameCreationScope, type CreationAttempt, type CreationScope } from '@/lib/hq-template-create-attempt'
import {
  hqTemplatesApi, type DistributionMode, type DistributionResult, type HqAccount, type HqTemplate, type HqTemplateListItem, type MessageTemplateDefinition,
  type Preflight, type TemplateDefinition, type FormDefinition, type TemplateDetail, type TemplateInput, type TemplateType,
} from '@/lib/hq-templates-api'
import {
  choiceKey, contentSummary, definitionError, definitionForName, definitionName, failedStores, referenceCount, resolvedItems,
  uploadedKeysIn, type TemplateMedia,
} from './definition'
import MessageForm from './message-form'
import TemplateMessageEditor from '@/v8/template-edit/message'
import TemplateAssetEditor from '@/v8/template-edit/asset'
import TemplateRichEditor from '@/v8/template-edit/rich'
import CarouselV8 from '@/v8/templates/carousel'
import QuestionNewV8 from '@/v8/templates/question-new'
import type { TemplateEditHost, TemplateHostContent } from '@/v8/template-edit/host'
import FormEditV8 from '@/v8/form-edit/edit'
import type { FormEditHost } from '@/v8/form-edit/host'
import { hqFormDefinitionToEditor, hqFormEditorToDefinition } from '@/components/forms/hq-form-definition-adapter'
import Card from '@/components/shared/card'
import { japaneseDetailOf } from '@/components/shared/api-error-message'
import type { RichMenuCreateHost } from '@/lib/rich-menu-create-host'
import { HqRichMenuCompatibilityError, hqRichMenuDefinitionFromSeed, hqRichMenuSeedFromDefinition } from '@/lib/hq-rich-menu-create'
import type { RichMenuDefinition } from '@/lib/hq-templates-api'
import HqAccountPicker from './account-picker'
import { accountsInFolder, distributionFolderRows, DistributionFolderPanel, useDistributionFolders, ALL_ACCOUNTS } from './distribution-accounts'
import HqStoreList from './store-list'
import HqTagEditorV8 from './tag-editor'
import HqTemplateDetail, { inUseVersionOf } from './detail'
import styles from './console.module.css'

const PAGE_TITLES: Record<TemplateType, string> = { tag: '友だち属性', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }
/** 一覧の段の住所（上の帯のパンくずの行き先）。シナリオのひな形はテンプレートの住所の中にある。 */
const LIST_HREFS: Record<TemplateType, string> = { tag: '/hq/friend-attributes', template: '/hq/templates', rich_menu: '/hq/rich-menus', form: '/hq/form-submissions', scenario: '/hq/templates?type=scenario' }
const EDIT_TITLES: Record<TemplateType, string> = { tag: 'タグのひな形', template: 'メッセージのひな形', rich_menu: 'リッチメニューのひな形', form: '回答フォームのひな形', scenario: 'シナリオのひな形' }
const MODE_LABELS: Record<DistributionMode, string> = { create: '新しく作る', overwrite: '上書き', alias: '別名で作る' }

type Stage = 'list' | 'detail' | 'edit' | 'accounts' | 'duplicates' | 'result'
const errorText = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。時間をおいて再確認してください。'


/** 種類ごとの中身の編集部品（タグ・リッチメニュー・回答フォーム・シナリオ）。入口が今の部品を渡す。 */
export interface DefinitionEditorProps {
  type: TemplateType
  value: TemplateDefinition
  disabled: boolean
  editing?: boolean
  tenantId?: string
  onChange: (next: TemplateDefinition) => void
  onBusyChange?: (busy: boolean) => void
  onMediaUploaded?: (media: TemplateMedia) => void
  richMenuReferences?: { tags?: Array<{ id: string; name: string }>; templates?: Array<{ id: string; name: string }>; forms?: Array<{ id: string; name: string }> }
  formReferences?: import('@/components/forms/form-refs').FormRefs
  onRichMenuNameChange?: (name: string) => void
  onCanonicalSave?: (definition: Extract<TemplateDefinition, { tag: unknown } | { form: unknown }>, andAnother?: boolean) => void | Promise<void>
  onCanonicalCancel?: () => void
}

export default function HqTemplatesV8({ type, DefinitionEditor, RichMenuCreate }: {
  type: TemplateType
  DefinitionEditor?: ComponentType<DefinitionEditorProps>
  /** 店のリッチメニューの作る画面（入口が渡す。src/v8 は @/app を読まないため）。host 付きで統括のひな形を作る（gobhu〜gQabc）。 */
  RichMenuCreate?: ComponentType<{ host: RichMenuCreateHost }>
}) {
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [stage, setStage] = useState<Stage>('list')
  const [folders, setFolders] = useState<HqTemplateFolder[]>([])
  const [folderLoadFailed, setFolderLoadFailed] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [textOverrides, setTextOverrides] = useState<Record<string, string>>({})
  const [overrideOpen, setOverrideOpen] = useState<string | null>(null)
  const duplicateAttempts = useRef(new Map<string, string>())
  const [templates, setTemplates] = useState<HqTemplate[]>([])
  const [accounts, setAccounts] = useState<HqAccount[]>([])
  const [detail, setDetail] = useState<TemplateDetail | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [definition, setDefinition] = useState<TemplateDefinition>(() => freshDefinition(type))
  const [selected, setSelected] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [accountFolder, setAccountFolder] = useState(ALL_ACCOUNTS)
  const accountFolders = useDistributionFolders(stage === 'accounts' || stage === 'duplicates' || stage === 'result')
  /* テンプレートの6種類（店と同じ上のタブ・API-17）。タブを替えたらその種類だけ読む。 */
  const [kind, setKind] = useState<TemplateKind>('message')
  const [kindRows, setKindRows] = useState<HqTemplate[] | null>(null)
  const [kindCounts, setKindCounts] = useState<Partial<Record<TemplateKind, number>> | null>(null)
  /* 一覧の集計（API-18：今月送った数・新しい版を未配布）。取れなければ null（数の帯は「—」か行から数える）。 */
  const [listStats, setListStats] = useState<HqTemplateListStats | null>(null)
  /* 詳細（pQ4fH）の版の履歴と配った先ごとの版（API-18）。null は読み込み中・読めなかった。 */
  const [versions, setVersions] = useState<HqTemplateVersionDisplay[] | null>(null)
  const [versionsFailed, setVersionsFailed] = useState(false)
  const [received, setReceived] = useState<HqTemplateReceivedVersion[] | null>(null)
  const [preflight, setPreflight] = useState<Preflight | null>(null)
  const [choices, setChoices] = useState<Record<string, DistributionMode>>({})
  const [bulkMode, setBulkMode] = useState<'' | DistributionMode>('')
  const [result, setResult] = useState<DistributionResult | null>(null)
  const [pendingRun, setPendingRun] = useState<string | null>(null)
  /** 配った結果の窓（★V8-B dEvJM）。結果が出たら開く。閉じても同じ画面の進み具合と操作は残る。 */
  const [resultDialogFor, setResultDialogFor] = useState<string | null>(null)
  const [requestBusy, setBusy] = useState(false)
  const [uploadBusy, setUploadBusy] = useState(false)
  const busy = requestBusy || uploadBusy
  const [ready, setReady] = useState(false)
  /* R119: 参照先に選べる別種類の目録。null は未取得か取得失敗（0件とは区別する）。 */
  const [catalog, setCatalog] = useState<HqTemplate[] | null>(null)
  const [catalogFailed, setCatalogFailed] = useState(false)
  const [error, setError] = useState('')
  const [conflict, setConflict] = useState(false)
  const [message, setMessage] = useState('')
  const [remove, setRemove] = useState<HqTemplate | null>(null)
  const [now, setNow] = useState(Date.now())
  /** R561: 連続作成のたびに正規編集部品を掛け直す番号。 */
  const [formKey, setFormKey] = useState(0)
  const lock = useRef(false)
  /** R568: この編集で送ったが、まだ保存内容に残っていない画像の保存先。 */
  const sessionUploads = useRef<string[]>([])
  const createAttempt = useRef<CreationAttempt | null>(null)
  const creationScope = useRef<CreationScope | null>(null)
  const createSettlement = useRef<{ kind: 'saved'; detail: TemplateDetail } | { kind: 'rejected' } | null>(null)
  const [createUncertain, setCreateUncertain] = useState(false)
  const alive = useRef(true)
  /** 保存のあと、そのまま配る前の確認をするアカウント（リッチメニューの作る④）。 */
  const autoCheck = useRef<string[] | null>(null)
  /** リッチメニューの作る④で選んだ配るアカウント。 */
  const [menuTargets, setMenuTargets] = useState<string[]>([])

  const reconcileSessionUploads = (keep: readonly string[]) => {
    const kept = new Set(keep)
    for (const key of sessionUploads.current) if (!kept.has(key)) void hqTemplatesApi.deleteImage(key).catch(() => undefined)
    sessionUploads.current = []
  }
  const noteSessionUpload = (media: { r2Key: string }) => {
    if (!sessionUploads.current.includes(media.r2Key)) sessionUploads.current.push(media.r2Key)
  }

  const editTitle = `${EDIT_TITLES[type]}を${detail ? '編集' : '作る'}`
  /* 絵（meBRB の進み具合・dEvJM の窓の後ろ）：配っている間も結果のあとも題は「アカウントへ配る：名前」のまま。 */
  const pageTitle = stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? editTitle : `アカウントへ配る：${detail?.template.name ?? ''}`
  /* 絵（HfK0O・u5MM7）：店の作る・編集の画面を使うときは、上の帯は「ホーム › テンプレート／回答フォーム」だけ。 */
  /*
   * 一覧の段より先（詳細・作る・配る）は、上の帯のパンくずに一覧（テンプレートなど）を置き、押したら一覧の段へ戻す。
   * 同じ URL のまま段だけ替えるので、リンクではなく段の切り替えで戻す（板の頭の「← テンプレートへ」は
   * 2026-10-08 に無くした。#1625 の「同じ URL へのリンクでは戻れない」もこれで扱う）。
   */
  const toListRef = useRef<() => void>(() => {})
  usePageTitle(stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? editTitle : stage === 'detail' ? (detail?.template.name ?? PAGE_TITLES[type]) : pageTitle)
  usePageCrumbs(stage === 'list'
    ? [{ label: 'ホーム', href: '/' }]
    : [{ label: PAGE_TITLES[type], href: LIST_HREFS[type], onSelect: () => toListRef.current() }])

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])
  useEffect(() => {
    let current = true
    void hqTemplatesApi.folders.list().then((rows) => { if (current) setFolders(rows) }).catch(() => { if (current) setFolderLoadFailed(true) })
    return () => { current = false }
  }, [])
  useEffect(() => {
    let current = true
    setBusy(true)
    void Promise.all([hqTemplatesApi.list(type), hqTemplatesApi.accounts(), hqTemplatesApi.context()]).then(([rows, stores, scope]) => {
      if (!current) return
      const attempt = loadCreationAttempt(window.sessionStorage, scope, type)
      creationScope.current = scope
      if (attempt) {
        createAttempt.current = attempt; setCreateUncertain(true); setDetail(null)
        setName(attempt.input.name); setDescription(attempt.input.description ?? ''); setDefinition(attempt.input.definition); setStage('edit')
      }
      setTemplates(rows); setAccounts(stores); setReady(true)
    }).catch((e) => { if (current) setError(errorText(e)) }).finally(() => { if (current) setBusy(false) })
    void hqTemplatesApi.listStats(type).then((stats) => { if (current) setListStats(stats ?? null) }).catch(() => { if (current) setListStats(null) })
    // R119: 目録だけの失敗で一覧や保存まで止めない。
    void hqTemplatesApi.list().then(
      (rows) => { if (current) { setCatalog(rows); setCatalogFailed(false) } },
      () => { if (current) { setCatalog(null); setCatalogFailed(true) } },
    )
    return () => { current = false }
  }, [type])
  useEffect(() => {
    if (type !== 'template' || stage !== 'list') return
    let current = true
    void hqTemplatesApi.listByKind(kind).then((rows) => { if (current) setKindRows(rows) }).catch(() => { if (current) setKindRows(null) })
    void hqTemplatesApi.kindCounts().then((counts) => { if (current) setKindCounts(counts) }).catch(() => undefined)
    return () => { current = false }
  }, [type, kind, stage])
  /* 詳細・回答フォームの編集を開いたら、版の履歴と配った先ごとの版を読む（API-18）。読めなくても画面は出す。 */
  const detailId = detail?.template.id ?? null
  const detailRevision = detail?.template.revision ?? null
  const loadVersions = (id: string) => {
    setVersions(null); setVersionsFailed(false)
    void hqTemplatesApi.versions(id).then((rows) => { if (alive.current) setVersions(rows) }, () => { if (alive.current) setVersionsFailed(true) })
    void hqTemplatesApi.receivedVersions(id).then((rows) => { if (alive.current) setReceived(rows) }, () => { if (alive.current) setReceived(null) })
  }
  useEffect(() => {
    if (!detailId || (stage !== 'detail' && !(stage === 'edit' && type === 'form'))) return
    loadVersions(detailId)
    // 開いたひな形と版が変わったときだけ読み直す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailId, detailRevision, stage === 'detail' || stage === 'edit'])
  useEffect(() => {
    if (stage !== 'duplicates') return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [stage])

  const perform = async (action: () => Promise<void>) => {
    if (lock.current || !ready) return
    lock.current = true; setBusy(true); setError(''); setConflict(false); setMessage('')
    try { await action() } catch (e) {
      if (alive.current) {
        setError(errorText(e))
        setConflict(Boolean(e && typeof e === 'object' && 'status' in e && e.status === 409))
      }
    } finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  const toList = () => {
    if (createUncertain) return
    reconcileSessionUploads(detail ? uploadedKeysIn(detail.definition) : [])
    createAttempt.current = null; setStage('list'); setSearch(''); setPreflight(null); setChoices({}); setBulkMode(''); setPendingRun(null); setResult(null); setError(''); setConflict(false)
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  toListRef.current = toList
  const reloadCatalog = () => {
    setCatalogFailed(false)
    void hqTemplatesApi.list().then(
      (rows) => { if (alive.current) { setCatalog(rows); setCatalogFailed(false) } },
      () => { if (alive.current) { setCatalog(null); setCatalogFailed(true) } },
    )
  }
  const referenceOptions = (kind: TemplateType) => (catalog ?? []).filter((item) => item.template_type === kind).map((item) => ({ id: item.id, name: item.name }))
  const loadDetailIntoForm = (loaded: TemplateDetail) => {
    if (loaded.template.template_type !== type || loaded.definition.schemaVersion !== 1 || !definitionName(type, loaded.definition)) throw new Error('ひな形の種類または保存内容を確認できません。')
    setFolderId(loaded.template.folder_id ?? null); setDetail(loaded); setName(loaded.template.name); setDescription(loaded.template.description ?? ''); setDefinition(loaded.definition)
  }
  const open = (id: string, next: Stage) => void perform(async () => {
    sessionUploads.current = []
    const loaded = await hqTemplatesApi.get(id)
    if (!alive.current) return
    loadDetailIntoForm(loaded); setSelected([]); setTextOverrides({}); setSearch(''); setAccountFolder(ALL_ACCOUNTS); setPreflight(null); setChoices({}); setBulkMode(''); setStage(next)
  })
  const startCreate = () => {
    createAttempt.current = null; sessionUploads.current = []; setMenuTargets([])
    setDetail(null); setFolderId(folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setStage('edit'); setError(''); setConflict(false)
  }
  const save = (distribute: boolean, sourceDefinition = definition, sourceName = name, sourceDescription = description, andAnother = false, options: { folderId?: string | null; preselect?: string[] } = {}) => perform(async () => {
    const preparedDefinition = definitionForName(type, sourceDefinition, sourceName.trim(), sourceDescription.trim())
    const validation = !sourceName.trim() ? 'ひな形の名前を入力してください。' : definitionError(type, preparedDefinition, creationScope.current?.tenantId)
    if (validation) throw new Error(validation)
    const input = { type, name: sourceName.trim(), description: sourceDescription.trim(), folderId: options.folderId !== undefined ? options.folderId : folderId, definition: preparedDefinition } as TemplateInput
    let saved: TemplateDetail
    let continueToAccounts = distribute
    if (detail) {
      saved = await hqTemplatesApi.update(detail.template.id, { ...input, expectedRevision: detail.template.revision })
    } else {
      const scope = await hqTemplatesApi.context()
      if (!creationScope.current || !sameCreationScope(creationScope.current, scope)) throw new Error('ログイン中の所属先または利用者が変わりました。元のアカウントで再ログインしてから再読み込みしてください。')
      const attempt = createAttempt.current ?? { requestId: crypto.randomUUID(), input, distribute }
      // POST の前に残す。再読み込み・ログインへの移動も結果不明になりうる。
      persistCreationAttempt(window.sessionStorage, scope, type, attempt)
      createAttempt.current = attempt
      continueToAccounts = attempt.distribute
      const retainAttempt = () => {
        setCreateUncertain(true)
        setName(attempt.input.name); setDescription(attempt.input.description ?? ''); setDefinition(attempt.input.definition)
      }
      const clearReceipt = () => {
        try { clearCreationAttempt(window.sessionStorage, scope, type, attempt.requestId) } catch (cause) { retainAttempt(); throw cause }
      }
      if (createSettlement.current?.kind === 'rejected') {
        clearReceipt()
        createSettlement.current = null; createAttempt.current = null; setCreateUncertain(false)
        setMessage('前回の保存は受け付けられていません。内容を確認して保存し直してください。')
        return
      }
      if (createSettlement.current?.kind === 'saved') saved = createSettlement.current.detail
      else {
        try {
          // 応答が失われたら、同じ鍵と同じ中身で送り直す。
          saved = await hqTemplatesApi.create(attempt.input, attempt.requestId)
        } catch (cause) {
          if (!createUncertain && cause && typeof cause === 'object' && 'requestNotApplied' in cause && cause.requestNotApplied === true) {
            createSettlement.current = { kind: 'rejected' }
            clearReceipt()
            createSettlement.current = null; createAttempt.current = null
          } else {
            // 後の拒否は、前の結果不明を打ち消さない。
            retainAttempt()
          }
          throw cause
        }
        createSettlement.current = { kind: 'saved', detail: saved }
      }
      clearReceipt()
      createSettlement.current = null
    }
    if (!alive.current) return
    const isNew = !detail
    loadDetailIntoForm(saved)
    reconcileSessionUploads(uploadedKeysIn(saved.definition))
    createAttempt.current = null
    setCreateUncertain(false)
    setTemplates((current) => [saved.template, ...current.filter((row) => row.id !== saved.template.id)])
    refreshStats()
    setMessage('ひな形を保存しました。')
    if (continueToAccounts) {
      setSelected(options.preselect ?? []); setTextOverrides({}); setSearch('')
      // リッチメニューの作る④で選んだアカウントは、保存のあとそのまま確かめる（配る前の確認）。
      autoCheck.current = options.preselect?.length ? options.preselect : null
      setStage('accounts')
    }
    // R561: 「保存して続けて作る」は新規作成のときだけ、空の新規入力へ戻る。
    else if (andAnother && isNew) { setDetail(null); setFolderId(null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setFormKey((current) => current + 1); setStage('edit') }
    else setStage('list')
  })
  const textMessage = type === 'template' && 'template' in definition && definition.template.messageType === 'text'
  const checkStores = (ids: string[]) => void perform(async () => {
    if (!detail || !ids.length) return
    const overrides = textMessage ? ids.filter((id) => textOverrides[id] !== undefined).map((accountId) => ({ accountId, text: textOverrides[accountId] })) : undefined
    const checked = await (overrides?.length ? hqTemplatesApi.preflight(detail.template.id, ids, overrides) : hqTemplatesApi.preflight(detail.template.id, ids))
    // 選んだ配り先と一致しない確認は、決して実行しない。
    if (checked.stores.length !== ids.length || new Set(checked.stores.map((s) => s.accountId)).size !== ids.length || checked.stores.some((s) => !ids.includes(s.accountId))) throw new Error('配布先を確認できませんでした。もう一度アカウントを選択してください。')
    if (!alive.current) return
    setPendingRun(null); setPreflight(checked); setChoices({}); setBulkMode(''); setSelected(ids); setNow(Date.now()); setStage('duplicates')
  })
  useEffect(() => {
    if (stage !== 'accounts' || !autoCheck.current || !detail) return
    const ids = autoCheck.current
    autoCheck.current = null
    checkStores(ids)
    // 保存して開いた「アカウントへ配る」で一度だけ。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, detail])
  const applyBulk = (mode: '' | DistributionMode) => {
    setBulkMode(mode)
    if (!preflight || busy || !mode) return
    setChoices((current) => {
      const next = { ...current }
      for (const store of preflight.stores) for (const item of store.items) if (item.duplicate && item.allowedModes.includes(mode)) next[choiceKey(store.accountId, item.sourceId)] = mode
      return next
    })
  }
  const chooseForStore = (accountId: string, mode: DistributionMode) => {
    const store = preflight?.stores.find((row) => row.accountId === accountId)
    if (!store) return
    setChoices((current) => {
      const next = { ...current }
      for (const item of store.items) if (item.duplicate && item.allowedModes.includes(mode)) next[choiceKey(accountId, item.sourceId)] = mode
      return next
    })
  }
  const rememberRun = (templateId: string, runId: string) => {
    // ひな形IDと配布番号だけ。中身・認証情報は書かない。
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${new URLSearchParams({ template: templateId, run: runId })}`)
  }
  const run = () => void perform(async () => {
    if (!detail || !preflight || pendingRun) return
    const resolutions = resolvedItems(preflight, choices)
    if (!resolutions || Date.parse(preflight.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(preflight.expiresAt))) throw new Error('確認の有効期限、または未選択の項目を確認してください。')
    setPendingRun(preflight.preflightId); setResult(null); setStage('result'); rememberRun(detail.template.id, preflight.preflightId)
    try {
      const completed = await hqTemplatesApi.distribute(detail.template.id, preflight.preflightId, resolutions)
      if (completed.runId !== preflight.preflightId) throw new Error('配布番号が一致しません。結果を再確認してください。')
      if (alive.current) setResult(completed)
    } catch {
      // 途切れた POST は結果不明。送り直さず、成功・失敗を作らない。
      try {
        const recovered = await hqTemplatesApi.result(detail.template.id, preflight.preflightId)
        if (recovered.runId !== preflight.preflightId) throw new Error('配布番号が一致しません。')
        if (alive.current) setResult(recovered)
      } catch { throw new Error('配布結果をまだ確認できません。再配布せず「結果を再確認」を押してください。') }
    }
  })
  const refreshResult = () => void perform(async () => {
    if (!detail || !pendingRun) return
    const loaded = await hqTemplatesApi.result(detail.template.id, pendingRun)
    if (loaded.runId !== pendingRun) throw new Error('配布番号が一致しません。')
    if (alive.current) setResult(loaded)
  })
  useEffect(() => {
    if (!ready || createAttempt.current) return
    const params = new URLSearchParams(window.location.hash.slice(1))
    const id = params.get('template'), runId = params.get('run')
    if (!id || !runId) return
    void perform(async () => {
      const loaded = await hqTemplatesApi.get(id)
      if (!alive.current) return
      loadDetailIntoForm(loaded); setPendingRun(runId); setStage('result')
      const restored = await hqTemplatesApi.result(id, runId)
      if (restored.runId !== runId) throw new Error('配布番号が一致しません。')
      if (alive.current) setResult(restored)
    })
    // 権限のある一覧・アカウントを読んだあとに一度だけ戻す。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready])

  useEffect(() => {
    if (result && result.status !== 'running') setResultDialogFor(`${result.runId}:${result.status}`)
  }, [result])
  const reloadFolders = async () => setFolders(await hqTemplatesApi.folders.list())
  /* フォルダを選ぶ欄からその場で作る（dLffh）。左の列の「フォルダを追加」と同じ口。色は持たない。 */
  const createFolder = async (folderName: string) => {
    const created = await hqTemplatesApi.folders.create(folderName)
    setFolders((current) => [...current.filter((folder) => folder.id !== created.id), created])
    return { value: created.id, label: created.name }
  }
  const refreshStats = () => { void hqTemplatesApi.listStats(type).then((stats) => { if (alive.current) setListStats(stats ?? null) }).catch(() => undefined) }
  const reloadKind = async () => {
    refreshStats()
    if (type !== 'template') return
    const [rows, counts] = await Promise.all([hqTemplatesApi.listByKind(kind), hqTemplatesApi.kindCounts().catch(() => null)])
    if (!alive.current) return
    setKindRows(rows)
    if (counts) setKindCounts(counts)
  }
  const expiry = preflight ? Date.parse(preflight.expiresAt) : NaN
  const expired = !Number.isFinite(expiry) || expiry <= now
  const resolutions = preflight ? resolvedItems(preflight, choices) : null
  const shownAccounts = accountsInFolder(accounts, accountFolder, accountFolders.membership).filter((account) => account.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  const accountFolderRows = distributionFolderRows({ accounts, ...accountFolders, selected, onChange: setSelected, disabled: busy || stage !== 'accounts' })
  const done = result && result.status !== 'running'
  const failures = result ? failedStores(result) : []
  const successes = result?.stores.filter((store) => store.status === 'succeeded') ?? []
  const validation = definitionError(type, definitionForName(type, definition, name.trim(), description.trim()), creationScope.current?.tenantId)
  const canonicalEditorOwnsSave = type === 'tag' || type === 'form'
  const saveCanonicalDefinition = async (next: TemplateDefinition, andAnother = false) => {
    const nextName = definitionName(type, next)
    const nextDescription = 'tag' in next ? next.tag.description ?? '' : 'form' in next ? next.form.description ?? '' : description
    setDefinition(next); setName(nextName); setDescription(nextDescription)
    await save(false, next, nextName, nextDescription, andAnother)
  }
  const summary = contentSummary(type, definition)

  const notices = <>
    {!canEdit && stage === 'list' ? <p className={styles.readonlyBand} role="note">閲覧のみで見ています。変える操作は管理者に頼んでください。</p> : null}
    {error ? <Notice tone="danger" message={error} action={conflict && detail ? <Button disabled={busy} onClick={() => open(detail.template.id, 'edit')}>最新の内容を読み込む</Button> : undefined} /> : null}
    {message ? <Notice tone="success" message={message} onClose={() => setMessage('')} /> : null}
  </>

  /* ───── 一覧（店の同じ機能の一覧と同じ形・i0Ao0R / wZPua / DzdC3 / noVq4。2026-10-08 オーナー） ───── */
  if (stage === 'list') {
    const listRows = type === 'template' && kindRows ? kindRows : templates
    const duplicateRow = (row: HqTemplate) => void perform(async () => {
      const key = `${row.id}:${row.revision}`
      const requestId = duplicateAttempts.current.get(key) ?? crypto.randomUUID()
      duplicateAttempts.current.set(key, requestId)
      await hqTemplatesApi.duplicate(row.id, `${row.name}のコピー`, row.revision, requestId)
      duplicateAttempts.current.delete(key)
      setTemplates(await hqTemplatesApi.list(type))
      await reloadKind()
      setMessage('ひな形を複製しました。')
    })
    return (
      <HqStoreList
        type={type}
        rows={listRows}
        ready={ready}
        busy={busy}
        canEdit={canEdit}
        accountTotal={accounts.length}
        stats={listStats}
        kind={type === 'template' ? kind : undefined}
        kindCounts={kindCounts}
        onKindChange={type === 'template' ? setKind : undefined}
        folders={folders}
        folderLoadFailed={folderLoadFailed}
        folderFilter={folderFilter}
        onFolderFilter={setFolderFilter}
        onAddFolder={async (folderName) => { await hqTemplatesApi.folders.create(folderName); await reloadFolders() }}
        onRenameFolder={async (folder, folderName) => { await hqTemplatesApi.folders.update(folder.id, folderName, folder.revision); await reloadFolders() }}
        onDeleteFolder={async (folder) => {
          await hqTemplatesApi.folders.remove(folder.id, folder.revision)
          await reloadFolders(); setTemplates(await hqTemplatesApi.list(type)); await reloadKind(); setFolderFilter('all')
          setMessage('フォルダを消しました。ひな形は未分類に残ります。')
        }}
        onCreate={startCreate}
        onEdit={(row) => open(row.id, 'edit')}
        onOpen={type === 'template' ? (row) => open(row.id, 'detail') : undefined}
        onDistribute={(row) => open(row.id, 'accounts')}
        onDuplicate={duplicateRow}
        onRemove={(row) => setRemove(row)}
        notices={notices}
        overlays={(
          <ConfirmDialog
            open={!!remove}
            title="ひな形を削除"
            description={`「${remove?.name ?? ''}」を削除します。配布済みのアカウントデータは残ります。`}
            destructive
            confirmLabel="削除する"
            busy={busy}
            onCancel={() => { if (!busy) setRemove(null) }}
            onConfirm={() => void perform(async () => {
              if (!remove) return
              await hqTemplatesApi.remove(remove.id, remove.revision)
              setTemplates((current) => current.filter((t) => t.id !== remove.id))
              setKindRows((current) => current ? current.filter((t) => t.id !== remove.id) : current)
              setRemove(null); setMessage('ひな形を削除しました。')
            })}
          />
        )}
      />
    )
  }

  /* ───── 詳細（pQ4fH）：店のテンプレートの詳細と同じ形に「配った先」と［アカウントへ配る］ ───── */
  if (stage === 'detail' && detail) {
    const listRow = [...(kindRows ?? []), ...templates].find((item) => item.id === detail.template.id) as HqTemplateListItem | undefined
    return (
      <HqTemplateDetail
        detail={detail}
        row={listRow}
        accounts={accounts}
        folderName={folders.find((folder) => folder.id === detail.template.folder_id)?.name ?? '未分類'}
        canEdit={canEdit}
        busy={busy}
        notices={notices}
        versions={versions}
        versionsError={versionsFailed}
        received={received}
        onReloadVersions={() => loadVersions(detail.template.id)}
        onCompare={(from, to) => hqTemplatesApi.compareVersions(detail.template.id, from, to)}
        onRestore={async (version) => {
          const restored = await hqTemplatesApi.restoreVersion(detail.template.id, version, detail.template.revision)
          if (!alive.current) return
          loadDetailIntoForm(restored)
          setTemplates((current) => current.map((item) => (item.id === restored.template.id ? { ...item, ...restored.template } : item)))
          void reloadKind()
          setMessage(`版${version}の内容で新しい版を作りました。配るまで、配った先は今の版のままです。`)
        }}
        onBack={toList}
        onEdit={() => setStage('edit')}
        onDistribute={() => { setSelected([]); setTextOverrides({}); setSearch(''); setAccountFolder(ALL_ACCOUNTS); setPreflight(null); setChoices({}); setBulkMode(''); setStage('accounts') }}
        onDuplicate={() => void perform(async () => {
          const requestId = crypto.randomUUID()
          await hqTemplatesApi.duplicate(detail.template.id, `${detail.template.name}のコピー`, detail.template.revision, requestId)
          setTemplates(await hqTemplatesApi.list(type)); await reloadKind()
          setMessage('ひな形を複製しました。')
        })}
        onEnterAccount={(accountId) => { setSelectedAccountId(accountId); router.push('/templates') }}
      />
    )
  }

  /*
   * ───── 作る・編集：店のテンプレートの作る画面を使い、下の帯の主ボタンを［保存して配る］にする（B-29・B-36）─────
   * 絵：メッセージ HfK0O・クーポン C3qMCz・リサーチ Fkv3w。保存した中身は統括のひな形（同じ形の payload）にして、
   * ［保存して配る］は保存のあと「アカウントへ配る」（meBRB）へ進む。
   * 前回の保存が結果不明のときは、入力を固定した今の画面（下）で再確認する。
   */
  const editKind: TemplateKind = detail && 'template' in detail.definition ? templateKind(detail.definition) : kind
  const current = ('template' in definition ? definition : freshDefinition('template')) as MessageTemplateDefinition
  /* 編集で中身を店の画面の形に戻せないもの（古い形のカード等）は、空で開いて上書きしないよう今の画面（X4JcOf）で直す。 */
  const editContent = detail && type === 'template' && editKind !== 'message' ? hostContentOf(editKind, name, current) : undefined
  const sharedEditor = type === 'template' && !createUncertain && ['message', 'coupon', 'research', 'carousel', 'question', 'rich_message'].includes(editKind)
    && (!detail || editKind === 'message' || Boolean(editContent))
  if (stage === 'edit' && sharedEditor) {
    const host: TemplateEditHost = {
      backHref: '/hq/templates',
      description: '保存して配ると、選んだアカウントのテンプレートに新しい版として届きます',
      folders: folders.map((folder) => ({ value: folder.id, label: folder.name })),
      folder: folderId ?? '',
      onFolderChange: (value) => setFolderId(value || null),
      createFolder: canEdit ? createFolder : undefined,
      busy,
      notice: notices,
      onSave: (content, distribute) => {
        const next = hostDefinition(current, content)
        setName(content.name); setDefinition(next)
        void save(distribute, next, content.name, description)
      },
      onCancel: toList,
      initialMessage: detail && editKind === 'message' ? { name, messageType: current.template.messageType, messageContent: current.template.messageContent } : undefined,
      /* 編集（B-29）：カルーセル・質問・クーポン・リサーチ・リッチメッセージも店の作る画面で直す。 */
      initialContent: editContent,
      readOnly: !canEdit,
      /* g8d6ai：画像は統括の置き場へ送り5サイズを作る（API-17）。保存されなかった画像は一覧へ戻るときに片付ける（R568）。 */
      uploadRichImage: async (file) => {
        setUploadBusy(true)
        try {
          const uploadedImage = await hqTemplatesApi.uploadRichMessageImage(file)
          for (const media of uploadedImage.media) noteSessionUpload(media)
          return uploadedImage
        } finally {
          if (alive.current) setUploadBusy(false)
        }
      },
    }
    const editorKey = `${editKind}-${detail?.template.id ?? 'new'}-${formKey}`
    if (editKind === 'rich_message') return <TemplateRichEditor key={editorKey} host={host} />
    if (editKind === 'message') return <TemplateMessageEditor key={editorKey} id={null} visual={false} host={host} />
    if (editKind === 'carousel') return <CarouselV8 key={editorKey} host={host} />
    if (editKind === 'question') return <QuestionNewV8 key={editorKey} host={host} />
    return <TemplateAssetEditor key={editorKey} kind={editKind as 'coupon' | 'research'} host={host} />
  }

  /*
   * ───── リッチメニュー：店のリッチメニューの作る画面（①〜④）を使い、④を「配る」（配るアカウント）にする（B-36）─────
   * 絵：① gobhu・② egdGx・③ K0gu1・④ gQabc。手順の間は画面の中に持ち、［下書きを保存］［アカウントへ配る］で一度に保存する。
   * 自由に置いた面・シナリオの参照など、作る画面の形に戻せない古い中身は今の画面（下）で直す。
   */
  const menuSeed = (() => {
    if (type !== 'rich_menu' || !detail || !('richMenu' in detail.definition)) return undefined
    const menu = (detail.definition as RichMenuDefinition).richMenu
    if (menu.pages.some((page) => page.areas.some((area) => area.scenarioId))) return null
    return hqRichMenuSeedFromDefinition(detail.definition as RichMenuDefinition, detail.template.folder_id ?? null)
  })()
  if (stage === 'edit' && type === 'rich_menu' && RichMenuCreate && !createUncertain && menuSeed !== null) {
    const host: RichMenuCreateHost = {
      backHref: '/hq/rich-menus',
      onCancel: toList,
      canOperate: canEdit,
      folders: folders.map((folder) => ({ id: folder.id, name: folder.name })),
      createFolder: canEdit ? async (folderName) => { const created = await createFolder(folderName); return { id: created.value, name: created.label } } : undefined,
      references: { tags: referenceOptions('tag'), templates: referenceOptions('template'), forms: referenceOptions('form') },
      initial: menuSeed,
      uploadImage: async (file, menuSize) => {
        setUploadBusy(true)
        try {
          const media = await hqTemplatesApi.uploadImage(file, 'rich_menu', menuSize === 'large' ? { width: 2500, height: 1686 } : { width: 2500, height: 843 })
          noteSessionUpload(media)
          return { r2Key: media.r2Key }
        } finally {
          if (alive.current) setUploadBusy(false)
        }
      },
      imageUrl: (r2Key) => `${process.env.NEXT_PUBLIC_API_URL ?? ''}/images/${r2Key.split('/').map(encodeURIComponent).join('/')}`,
      distribute: (
        <Card padding="spacious" layout="vertical">
          <HqAccountPicker
            title="配るアカウント"
            allowed={accounts}
            selected={menuTargets}
            onChange={setMenuTargets}
            note="配った先で、既定のメニューにするかを決めます。"
            disabled={busy || !canEdit}
          />
        </Card>
      ),
      distributeSummary: [
        { key: 'accounts', label: '配るアカウント', value: menuTargets.length ? `${menuTargets.length} アカウント` : 'まだ選んでいません' },
        { key: 'state', label: '届き方', value: '下書きとして届く' },
      ],
      selectedCount: menuTargets.length,
      busy,
      notice: notices,
      onSave: (seed, distribute) => {
        let next: RichMenuDefinition
        try {
          next = hqRichMenuDefinitionFromSeed(seed)
        } catch (cause) {
          setError(cause instanceof HqRichMenuCompatibilityError ? cause.reason : japaneseDetailOf(cause) || 'リッチメニューの中身を保存できる形にできませんでした。ボタンの動きと画像を確かめてください。')
          return
        }
        setDefinition(next); setName(seed.name); setFolderId(seed.folderId)
        void save(distribute, next, seed.name, description, false, { folderId: seed.folderId, preselect: distribute ? menuTargets : undefined })
      },
    }
    return <RichMenuCreate key={`menu-${detail?.template.id ?? 'new'}-${formKey}`} host={host} />
  }

  /*
   * ───── 回答フォーム：店の回答フォームの編集画面を使い、右の列に「配った先」、主ボタンを［保存して配る］にする（B-36）─────
   * 絵：中身 u5MM7・答え終わったあと scJcP・受付と見た目 xRPdo・予約ブロック N4T9mO。前回の保存が結果不明のときは下の今の画面で再確認する。
   */
  if (stage === 'edit' && type === 'form' && !createUncertain && 'form' in definition) {
    const value = hqFormDefinitionToEditor(definition)
    const listRow = detail ? templates.find((item) => item.id === detail.template.id) as HqTemplateListItem | undefined : undefined
    const host: FormEditHost = {
      backHref: '/hq/form-submissions',
      initial: { name: value.name, description: value.description, layout: value.layout, onSubmitTagId: value.onSubmitTagId },
      // 配った先で直せる参照先だけ（統括のタグのひな形）。友だち情報・テンプレート・リマインダは店ごとの ID なので選ばせない。
      refs: { tags: referenceOptions('tag'), friendFields: [], scenarios: [], reminders: [], templates: [] },
      accountName: '公式アカウント',
      statusLine: formStatusLine(listRow, versions),
      distributedLine: formDistributedLine(listRow),
      busy,
      notice: notices,
      onSave: (content, distribute) => {
        let next: FormDefinition
        try {
          next = hqFormEditorToDefinition({ ...value, ...content })
        } catch (cause) {
          setError(errorText(cause))
          return
        }
        setDefinition(next); setName(next.form.name); setDescription(next.form.description ?? '')
        void save(distribute, next, next.form.name, next.form.description ?? '')
      },
      onCancel: toList,
      readOnly: !canEdit,
    }
    return <FormEditV8 key={`form-${detail?.template.id ?? 'new'}-${formKey}`} host={host} />
  }

  /* ───── 作る・編集（X4JcOf：前回の保存の再確認・カード型・カルーセル・質問・リッチメッセージ） ───── */
  if (stage === 'edit' && type === 'tag' && 'tag' in definition && !createUncertain) {
    return <HqTagEditorV8 key={formKey} definition={definition} editing={Boolean(detail)} saving={busy} readOnly={!canEdit}
      conflict={conflict} onReloadLatest={detail ? () => { void open(detail.template.id, 'edit') } : undefined}
      error={error} onCancel={toList} onSave={async (next, another) => { await saveCanonicalDefinition(next, another) }} />
  }

  if (stage === 'edit') {
    const uncertainNotice = createUncertain ? <Notice tone="warn" message="前回の保存結果がまだ確定していません。重複を防ぐため入力を固定しています。同じ依頼を再確認し、保存済みならその結果を読み込みます。" /> : null
    const footer = createUncertain
      ? <Button variant="primary" disabled={busy} onClick={() => save(false)}>前回の保存を再確認</Button>
      : canonicalEditorOwnsSave ? null : <>
        <Button disabled={busy} onClick={toList}>キャンセル</Button>
        {type === 'template'
          ? <Button variant="primary" disabled={busy || Boolean(validation)} onClick={() => save(false)}>ひな形を保存</Button>
          : <Button variant="primary" disabled={busy || Boolean(validation)} onClick={() => save(false)}>下書きを保存する</Button>}
        {detail && type !== 'template' ? <Button disabled={busy || Boolean(validation)} onClick={() => save(true)}>保存して配布先を選ぶ</Button> : null}
      </>
    return (
      <PageFrame kind="wizard" boardId="X4JcOf">
        <PageHeading title={type === 'template' ? editTitle : editTitle} description="保存したひな形は、一覧の「アカウントへ配る」で各 LINE アカウントへ配ります。" />
        <div className={styles.body}>
          {notices}
          {type === 'template' && 'template' in definition ? (
            <MessageForm
              key={formKey}
              name={name}
              onNameChange={setName}
              value={definition}
              onChange={(next: MessageTemplateDefinition) => setDefinition(next)}
              folders={folders}
              folderId={folderId}
              onFolderChange={setFolderId}
              onCreateFolder={canEdit ? createFolder : undefined}
              folderLoadFailed={folderLoadFailed}
              disabled={busy || createUncertain || !canEdit}
              catalogFailed={catalogFailed}
              onReloadCatalog={reloadCatalog}
              onBusyChange={setUploadBusy}
              onReceipt={noteSessionUpload}
              notice={uncertainNotice}
            />
          ) : (
            <section className={styles.editPanel} aria-label="ひな形の中身">
              <div className={styles.twoCol}>
                {!canonicalEditorOwnsSave && type !== 'rich_menu' ? (
                  <label className={styles.field}><span className={styles.label}>ひな形の名前</span><input aria-label="ひな形の名前" className={styles.input} value={name} maxLength={200} disabled={busy || createUncertain} onChange={(event) => setName(event.target.value)} /></label>
                ) : null}
                {/* タグは中の「所属フォルダ」で分けるので、上のフォルダは出さない（同じ物が2つに見える・オーナー 10-08）。一覧での分けは「…」の「フォルダへ移す」。 */}
                {type !== 'tag' ? <div className={styles.field}>
                  <span className={styles.label}>フォルダ</span>
                  <FolderSelect aria-label="フォルダ" size="full" value={folderId ?? ''} disabled={busy || createUncertain || folderLoadFailed} onChange={(next) => setFolderId(next || null)} folders={folders.map((folder) => ({ value: folder.id, label: folder.name }))} onCreate={canEdit ? createFolder : undefined} colors={false} />
                </div> : null}
              </div>
              {!canonicalEditorOwnsSave && type !== 'rich_menu' ? (
                <label className={styles.field}><span className={styles.label}>説明</span><textarea className={styles.textarea} value={description} maxLength={2000} rows={2} disabled={busy || createUncertain} onChange={(event) => setDescription(event.target.value)} /></label>
              ) : null}
              {catalogFailed ? <Notice tone="warn" message="参照先の候補を読み込めませんでした。タグ・テンプレート・回答フォームは選べません。" action={<Button onClick={reloadCatalog}>もう一度読み込む</Button>} /> : null}
              {canonicalEditorOwnsSave && createUncertain ? uncertainNotice : DefinitionEditor ? (
                <DefinitionEditor
                  key={formKey}
                  type={type}
                  value={definition}
                  disabled={busy || createUncertain}
                  editing={Boolean(detail)}
                  tenantId={creationScope.current?.tenantId}
                  onChange={setDefinition}
                  onBusyChange={setUploadBusy}
                  onMediaUploaded={noteSessionUpload}
                  onCanonicalCancel={toList}
                  onCanonicalSave={saveCanonicalDefinition}
                  onRichMenuNameChange={setName}
                  richMenuReferences={{ tags: referenceOptions('tag'), templates: referenceOptions('template'), forms: referenceOptions('form') }}
                  formReferences={{ tags: referenceOptions('tag'), friendFields: [], scenarios: [], reminders: [], templates: [] }}
                />
              ) : <p role="alert">この種類のひな形は、ここでは編集できません。</p>}
              {!canonicalEditorOwnsSave ? uncertainNotice : null}
              {!canonicalEditorOwnsSave ? <p className={styles.note}>{`参照先 ${referenceCount(type, definition)}件を含めて配布します。`}</p> : null}
            </section>
          )}
          {footer ? <div className={styles.footer}>{footer}</div> : null}
        </div>
      </PageFrame>
    )
  }

  /* ───── アカウントへ配る（meBRB）：選ぶ → 重複の配り方 → 配る（進み具合） ───── */
  const storeOf = (accountId: string) => preflight?.stores.find((store) => store.accountId === accountId)
  const resultOf = (accountId: string) => result?.stores.find((store) => store.accountId === accountId)
  const storeMode = (accountId: string): DistributionMode | '' => {
    const store = storeOf(accountId)
    if (!store) return ''
    const duplicates = store.items.filter((item) => item.duplicate)
    if (!duplicates.length) return 'create'
    const modes = new Set(duplicates.map((item) => choices[choiceKey(accountId, item.sourceId)] ?? ''))
    return modes.size === 1 ? [...modes][0] as DistributionMode | '' : ''
  }
  const storeVersion = (accountId: string) => {
    const store = storeOf(accountId)
    if (!store) return '—'
    const main = store.items[0]
    /* 絵（meBRB）：ひな形と同じ版が配布先にあれば「版 2（最新）」。 */
    return main?.duplicate ? (main.expectedRevision != null ? `版 ${main.expectedRevision}${detail && main.expectedRevision === detail.template.revision ? '（最新）' : ''}` : '配布済み') : '未配布'
  }
  const rowsForTable = shownAccounts
  const targetIds = stage === 'accounts' ? selected : preflight?.stores.map((store) => store.accountId) ?? selected
  const finished = successes.length + failures.length
  const progressTotal = result?.stores.length ?? targetIds.length
  const progressLabel = (accountId: string) => {
    const store = resultOf(accountId)
    if (!store) return stage === 'result' ? '待っています' : ''
    return store.status === 'succeeded' ? '完了' : failures.includes(store) ? '失敗' : '作成中'
  }
  const shortName = (accountName: string) => accountName.replace(/^然\s*-NEN-\s*/, '')

  return (
    <PageFrame kind="wizard" boardId={stage === 'result' ? 'dEvJM' : 'meBRB'}>
      <PageHeading title={pageTitle} help="1つのアカウントだけ、または複数のアカウントを選んで一括で配れます。一括設定のあと、必要な項目だけアカウントごとに変えられます。" />
      {error || message ? <div className={styles.distributionNotice}>{notices}</div> : null}
      <ListPageBody
        contentInset
        folders={<DistributionFolderPanel rows={accountFolderRows} activeId={accountFolder} onSelect={setAccountFolder} failed={accountFolders.failed} />}
        collapsedFolders={<>
          <Select aria-label="アカウントのフォルダ" value={accountFolder} onChange={setAccountFolder} options={accountFolderRows.map((row) => ({ value: row.id, label: row.label }))} />
          {accountFolderRows.find((row) => row.id === accountFolder)?.trailing}
        </>}
        toolbar={<div className={styles.toolbar}>
          <span className={styles.selectedTools}>
            <strong className={styles.selectedCount}>{`選んだ ${selected.length} アカウント`}</strong>
          <label className={styles.search} data-size="account">
            <Search size={14} aria-hidden="true" />
            <input aria-label="アカウントを検索" placeholder="アカウント名で探す" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
          </span>
          <span className={styles.bulkPick}>
            <Select
              aria-label="一括の配布方法"
              size="full"
              disabled={stage !== 'duplicates' || busy}
              value={bulkMode}
              onChange={(next) => applyBulk(next as '' | DistributionMode)}
              options={[{ value: '', label: '一括の配布方法：選ぶ' }, { value: 'overwrite', label: '一括の配布方法：上書き' }, { value: 'alias', label: '一括の配布方法：別名で作る' }]}
            />
          </span>
        </div>}
      >
        <div className={styles.distributionContent}>
        <div className={styles.tableBox}>
          <table className={styles.table} data-kind="distribute">
            <colgroup><col className={styles.colCheck} /><col /><col className={styles.colItem} /><col className={styles.colVersion} /><col className={styles.colMode} /></colgroup>
            <thead><tr>
              {/* G-4：表示中をまとめて選ぶ。一部選択は横棒。 */}
              <Th><Checkbox aria-label="表示中のアカウントをすべて選ぶ" checked={shownAccounts.length > 0 && shownAccounts.every((account) => selected.includes(account.id))}
                indeterminate={shownAccounts.some((account) => selected.includes(account.id)) && !shownAccounts.every((account) => selected.includes(account.id))}
                disabled={busy || stage !== 'accounts' || shownAccounts.length === 0}
                onCheckedChange={(checked) => setSelected((current) => checked ? [...new Set([...current, ...shownAccounts.map((account) => account.id)])] : current.filter((id) => !shownAccounts.some((account) => account.id === id)))} /></Th>
              <Th>アカウント</Th><Th>項目</Th><Th>配布先の版</Th><Th>配布方法</Th>
            </tr></thead>
            <tbody>
              {rowsForTable.map((account) => {
                const on = selected.includes(account.id)
                const store = storeOf(account.id)
                const extraItems = store?.items.slice(1).filter((item) => item.duplicate) ?? []
                const mode = storeMode(account.id)
                const allowed = store ? [...new Set(store.items.filter((item) => item.duplicate).flatMap((item) => item.allowedModes))] : []
                return [
                  <tr key={account.id} data-selected={on || undefined}>
                    <td><Checkbox id={`hq-dist-${account.id}`} aria-label={account.name} checked={on} disabled={busy || stage !== 'accounts'} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, account.id] : current.filter((id) => id !== account.id))} /></td>
                    <td>
                      <label className={styles.nameLabel} htmlFor={`hq-dist-${account.id}`}>
                        <FolderDotName folder={accountFolders.membership?.get(account.id)?.folder}><span className={styles.name} title={account.name}>{account.name}</span></FolderDotName>
                        <span className={styles.sub}>{on ? (stage === 'result' ? progressLabel(account.id) || '配る' : '配る') : '配らない'}</span>
                      </label>
                    </td>
                    <td>
                      {on ? <span className={styles.cellLine}>
                        <span className={styles.cell}>{`${summary}（${textOverrides[account.id] !== undefined || store?.textOverride !== undefined ? '個別の本文' : '一括と同じ'}）`}</span>
                        {textMessage && stage === 'accounts' ? <Button size="compact" variant="text" disabled={busy} onClick={() => setOverrideOpen(overrideOpen === account.id ? null : account.id)}>本文を変える</Button> : null}
                      </span> : <span className={`${styles.cell} ${styles.cellEmpty}`}>—</span>}
                    </td>
                    <td><span className={on ? styles.cell : `${styles.cell} ${styles.cellEmpty}`}>{on ? storeVersion(account.id) : '—'}</span></td>
                    <td>
                      {!on ? <span className={`${styles.cell} ${styles.cellEmpty}`}>—</span> : !store ? <span className={styles.cell}>確認のあとで選ぶ</span>
                        : allowed.length === 0 ? <span className={styles.modePick}><Select aria-label={`${account.name}の配布方法`} size="full" disabled value="create" onChange={() => undefined} options={[{ value: 'create', label: MODE_LABELS.create }]} /></span>
                        : <span className={styles.modePick}><Select
                          aria-label={`${account.name}の配布方法`}
                          size="full"
                          disabled={busy || stage !== 'duplicates'}
                          value={mode}
                          onChange={(next) => chooseForStore(account.id, next as DistributionMode)}
                          options={[{ value: '', label: '選んでください' }, ...(['overwrite', 'alias'] as const).filter((m) => allowed.includes(m)).map((m) => ({ value: m, label: store.items.some((item) => item.operation === 'reuse') && m === 'overwrite' ? '既存を使う' : MODE_LABELS[m] }))]}
                        /></span>}
                    </td>
                  </tr>,
                  overrideOpen === account.id && on && textMessage && stage === 'accounts' ? (
                    <tr key={`${account.id}-text`} className={styles.subRow}><td /><td colSpan={4}>
                      <label className={styles.field}><span className={styles.label}>{`${account.name}に配る本文`}</span>
                        <textarea aria-label={`${account.name}に配る本文`} className={styles.textarea} disabled={busy} maxLength={5000} value={textOverrides[account.id] ?? ('template' in definition ? definition.template.messageContent : '')} onChange={(event) => setTextOverrides((current) => ({ ...current, [account.id]: event.target.value }))} />
                      </label>
                    </td></tr>
                  ) : null,
                  ...extraItems.map((item) => (
                    <tr key={choiceKey(account.id, item.sourceId)} className={styles.subRow}>
                      <td /><td><span className={styles.sub}>{`参照先：${item.name}`}</span></td>
                      <td><span className={styles.cell}>{item.itemKind === 'folder' ? 'タググループ' : item.itemKind === 'rich_menu' ? 'リッチメニュー' : item.itemKind === 'form' ? '回答フォーム' : item.itemKind === 'media' ? '登録メディア' : item.itemKind === 'template' ? 'テンプレート' : item.itemKind}</span></td>
                      <td><span className={styles.cell}>{item.expectedRevision != null ? `版 ${item.expectedRevision}` : '新規'}</span></td>
                      <td><span className={styles.modePick}><Select aria-label={`${account.name} ${item.name}の配布方法`} size="full" disabled={busy || stage !== 'duplicates'} value={choices[choiceKey(account.id, item.sourceId)] ?? ''} onChange={(next) => setChoices((current) => ({ ...current, [choiceKey(account.id, item.sourceId)]: next as DistributionMode }))} options={[{ value: '', label: '選んでください' }, ...(item.operation === 'reuse' ? ['overwrite'] as const : ['overwrite', 'alias'] as const).filter((m) => item.allowedModes.includes(m)).map((m) => ({ value: m, label: item.operation === 'reuse' && m === 'overwrite' ? '既存を使う' : MODE_LABELS[m] }))]} /></span></td>
                    </tr>
                  )),
                ]
              })}
            </tbody>
          </table>
          {!rowsForTable.length && <p className={styles.empty}>選択できるアカウントがありません。</p>}
        </div>
        {stage === 'duplicates' && expired ? <Notice tone="warn" message="確認の有効期限が切れました。アカウントの現在版をもう一度確認してください。" /> : null}
        {stage === 'result' || stage === 'duplicates' ? (
          <section className={styles.progressPanel} aria-label="配布の進み具合">
            <h2>配布の進み具合</h2>
            <div className={styles.progressRow}>
              <span className={styles.progressTrack} aria-hidden="true"><span className={styles.progressFill} style={{ width: `${progressTotal ? Math.round((finished / progressTotal) * 100) : 0}%` }} /></span>
              <strong>{`${finished} / ${progressTotal}`}</strong>
            </div>
            <p className={styles.note}>{stage === 'duplicates'
              ? '配布直前に版を再確認します。配布先で編集があれば、そのアカウントの変更を取り消します。成功したアカウントは保持され、失敗分だけ再確認できます。'
              : (result ? result.stores.map((store) => `${shortName(store.accountName ?? accountName(accounts, store.accountId))}：${store.status === 'succeeded' ? '完了' : failures.includes(store) ? '失敗' : '作成中'}`).join(' ・ ') : `配布番号：${pendingRun ?? '—'} の結果を確認しています。確認できるまでは再配布しません。`)}</p>
            {result && failures.length ? failures.map((store) => <Notice key={store.accountId} tone="danger" message={`${store.accountName ?? accountName(accounts, store.accountId)}：${store.reason || '配布できませんでした。アカウントの現在版を再確認してください。'}${store.cleanupPending ? '（画像の後片付けを自動で再試行中です）' : ''}`} action={done ? <Button disabled={busy} onClick={() => checkStores([store.accountId])}>このアカウントだけ再確認して配布</Button> : undefined} />) : null}
            {result && done ? <p className={styles.note}>{`新規 ${formatNumber(successes.reduce((sum, s) => sum + s.counts.created, 0))}件・上書き ${formatNumber(successes.reduce((sum, s) => sum + s.counts.overwritten, 0))}件・別名 ${formatNumber(successes.reduce((sum, s) => sum + s.counts.aliased, 0))}件`}</p> : null}
          </section>
        ) : null}
        </div>
      </ListPageBody>
        <div className={styles.footer}>
          {stage === 'accounts' ? <>
            <Button disabled={busy} onClick={toList}>キャンセル</Button>
            <Button aria-label={`${selected.length}アカウントの重複を確認`} variant="primary" disabled={busy || !selected.length} onClick={() => checkStores(selected)}><Check size={15} aria-hidden="true" />{selected.length === 1 ? '選んだ1アカウントを確かめる' : `選んだ${selected.length}アカウントを確かめる`}</Button>
          </> : stage === 'duplicates' && preflight ? <>
            <Button disabled={busy} onClick={() => { setPreflight(null); setStage('accounts') }}><ArrowLeft size={15} aria-hidden="true" />戻る</Button>
            {expired ? <Button disabled={busy} onClick={() => checkStores(selected)}>現在版を再確認</Button> : null}
            <Button variant="primary" disabled={busy || expired || !resolutions || !!pendingRun} onClick={run}><Send size={15} aria-hidden="true" />{`この内容で${preflight.stores.length}アカウントへ配る`}</Button>
          </> : <>
            <Button disabled={busy} onClick={toList}>{done ? 'ひな形一覧へ' : 'キャンセル'}</Button>
            {!done ? <Button variant="primary" disabled><Plus size={15} aria-hidden="true" />{`配っています（${finished}/${progressTotal}）`}</Button> : null}
            {done ? <Button disabled={busy} onClick={refreshResult}>結果を再確認</Button> : <Button disabled={busy} onClick={refreshResult}>結果を再確認</Button>}
            {done && failures.length > 0 ? <Button variant="primary" disabled={busy} onClick={() => checkStores(failures.map((s) => s.accountId))}>{`失敗${failures.length}アカウントを再確認`}</Button> : null}
          </>}
        </div>
      <Dialog
        open={Boolean(result && done && resultDialogFor === `${result.runId}:${result.status}`)}
        designWidth={640}
        designTop={220}
        title={`配った結果：${detail?.template.name ?? ''}`}
        designHeaderPadding="24px 24px 0"
        busy={busy}
        cancelLabel="閉じる"
        onCancel={() => setResultDialogFor(null)}
        {...(failures.length ? {
          confirmLabel: `失敗した ${failures.length} 件をやり直す`,
          confirmIcon: <RotateCw size={15} />,
          onConfirm: () => { setResultDialogFor(null); checkStores(failures.map((s) => s.accountId)) },
        } : {})}
      >
        {result ? <p className={styles.resultSummary}>{`${result.stores.length} アカウントへ配りました。成功 ${successes.length}・失敗 ${failures.length}。${successes.length ? '成功した所はもう使えます。' : ''}`}</p> : null}
        <div className={styles.resultList}>
          {result?.stores.map((store) => {
            const failed = failures.includes(store)
            const name = store.accountName ?? accountName(accounts, store.accountId)
            return (
              <div key={store.accountId} className={styles.resultRow}>
                <span className={styles.resultName} title={name}>{name}</span>
                <span className={styles.resultText}>{failed ? (store.reason || '配布できませんでした。アカウントの現在版を再確認してください。') : resultSentence(store)}</span>
                {store.status === 'succeeded' ? <StatusBadge tone="success" size="compact">成功</StatusBadge>
                  : failed ? <StatusBadge tone="danger" size="compact">失敗</StatusBadge>
                  : <StatusBadge tone="neutral" size="compact">作成中</StatusBadge>}
              </div>
            )
          })}
        </div>
        {failures.length ? <p className={styles.resultBand}>{`失敗した ${failures.length} 件だけやり直せます。各行の理由を直してから、やり直してください。`}</p> : null}
      </Dialog>
    </PageFrame>
  )
}

/** 配った結果の1行の文（dEvJM）。成功したアカウントで何をしたか。 */
function resultSentence(store: DistributionResult['stores'][number]): string {
  if (store.status !== 'succeeded') return '配っています'
  if (store.counts.aliased > 0) return store.createdName ? `同じ名前があったため「${store.createdName}」で作りました` : '同じ名前があったため、別名で作りました'
  if (store.counts.overwritten > 0) return '上書きしました'
  if (store.counts.created > 0) return '新しく作りました'
  if ((store.counts.reused ?? 0) > 0) return '今あるものを使いました'
  return '配りました'
}

/**
 * 回答フォームの題の下の1行（u5MM7）。いまの版がまだ配った先に届いていなければ、配った版との違いを出す（API-18 の版の履歴）。
 */
export function formStatusLine(row: HqTemplateListItem | undefined, versions?: readonly HqTemplateVersionDisplay[] | null): string {
  if (!row) return '下書き・まだ配っていません（保存して配ると、選んだアカウントへ届きます）'
  if ((row.distributed_account_count ?? 0) === 0) return '下書き・まだ配っていません（保存して配ると、選んだアカウントへ届きます）'
  const current = versions?.find((version) => version.is_current)
  const inUse = inUseVersionOf(versions ?? null)
  if (current && inUse && current.version !== inUse.version) return `下書き・配った版${inUse.version}と違うところがあります（保存して配ると、配った先へ新しい版として届きます）`
  return '下書き（保存して配ると、配った先へ新しい版として届きます）'
}

/** 右の列「配った先」の文（u5MM7）。名前は API-14 の最大3件と、ほかの数。 */
export function formDistributedLine(row: HqTemplateListItem | undefined): string {
  const count = row?.distributed_account_count ?? 0
  if (!row || count === 0) return 'まだどのアカウントにも配っていません。保存して配ると、各アカウントでは回答フォームとして使えます。'
  const names = (row.distributed_account_names ?? []).map((name) => name.replace(/^然\s*-NEN-\s*/, ''))
  const more = row.distributed_account_more ?? 0
  const list = names.length ? `（${names.join('・')}${more > 0 ? `・ほか${more}` : ''}）` : ''
  return `配った先：${count} アカウント${list}。各アカウントでは回答フォームとして使えます。`
}

function accountName(accounts: HqAccount[], id: string): string {
  return accounts.find((account) => account.id === id)?.name ?? id
}

/** 保存してある統括のひな形を、店の作る画面へ渡す中身（保存と同じ形）に戻す。読めなければ undefined（空から）。 */
export function hostContentOf(kind: TemplateKind, name: string, definition: MessageTemplateDefinition): TemplateHostContent | undefined {
  const asset = definition.asset
  if ((kind === 'coupon' || kind === 'research' || kind === 'rich_message') && asset?.kind === kind) {
    const payload = asset.payload as Record<string, unknown>
    return kind === 'rich_message' ? { kind, name, payload, media: [...definition.media] } : { kind, name, payload }
  }
  if (kind === 'question' && definition.template.questionJson) {
    try {
      return { kind, name, question: JSON.parse(definition.template.questionJson) as Record<string, unknown>, messageContent: definition.template.messageContent }
    } catch { return undefined }
  }
  if (kind === 'carousel' && definition.template.messageType === 'carousel') {
    return { kind, name, messageContent: definition.template.messageContent, tapLimitMode: definition.template.carouselTapLimitMode, tapLimitText: definition.template.carouselTapLimitText }
  }
  return undefined
}

/** 店の作る画面が組み立てた中身を、統括のひな形（メッセージ）の形にする。カード型の部品（card）は本文で書き直したので外す。 */
export function hostDefinition(current: MessageTemplateDefinition, content: TemplateHostContent): MessageTemplateDefinition {
  const base = { ...current, template: { ...current.template, name: content.name } }
  const { card: _card, asset: _asset, ...rest } = base
  void _card; void _asset
  if (content.kind === 'message') {
    return { ...rest, template: { ...rest.template, messageType: content.messageType as MessageTemplateDefinition['template']['messageType'], messageContent: content.messageContent, questionJson: null } }
  }
  if (content.kind === 'question') {
    return { ...rest, template: { ...rest.template, messageType: 'text', messageContent: content.messageContent, questionJson: JSON.stringify(content.question), questionStatus: 'published' } }
  }
  if (content.kind === 'rich_message') {
    return { ...rest, media: content.media, asset: { kind: 'rich_message', payload: content.payload as never }, template: { ...rest.template, messageType: 'text', messageContent: '', questionJson: null } }
  }
  if (content.kind === 'carousel') {
    return { ...rest, template: { ...rest.template, messageType: 'carousel', messageContent: content.messageContent, carouselActionsJson: null, carouselTapLimitMode: content.tapLimitMode, carouselTapLimitText: content.tapLimitText, questionJson: null } }
  }
  return { ...rest, asset: { kind: content.kind, payload: content.payload as never }, template: { ...rest.template, messageType: 'text', messageContent: '', questionJson: null } }
}
