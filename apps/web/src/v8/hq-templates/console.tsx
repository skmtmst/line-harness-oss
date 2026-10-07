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
import { ArrowLeft, Check, Copy, Inbox, MoreHorizontal, Pencil, Plus, RotateCw, Search, Send, Trash2 } from 'lucide-react'
import type { HqTemplateFolder } from '@line-crm/shared'
import { usePageCrumbs, usePageTitle } from '@/components/shell/page-chrome'
import { ListPage } from '@/components/templates'
import { PageFrame, PageHeading } from '@/components/templates/page-frame'
import FolderPanel from '@/components/shared/folder-panel'
import ActionMenu, { type ActionMenuItem } from '@/components/shared/action-menu'
import Button from '@/components/shared/button'
import IconButton from '@/components/shared/icon-button'
import Checkbox from '@/components/shared/checkbox'
import ConfirmDialog from '@/components/shared/confirm-dialog'
import Dialog from '@/components/shared/dialog'
import StatusBadge from '@/components/shared/status-badge'
import Notice from '@/components/shared/notice'
import Select from '@/components/shared/select'
import { Th } from '@/components/shared/table'
import { canManageRole, useStaffRole } from '@/lib/staff-role'
import { formatNumber } from '@/lib/format'
import { freshDefinition } from '@/lib/hq-template-authoring'
import { distributedAccountsLine, templateSubLine } from './list-row'
import { clearCreationAttempt, loadCreationAttempt, persistCreationAttempt, sameCreationScope, type CreationAttempt, type CreationScope } from '@/lib/hq-template-create-attempt'
import {
  hqTemplatesApi, type DistributionMode, type DistributionResult, type HqAccount, type HqTemplate, type MessageTemplateDefinition,
  type Preflight, type TemplateDefinition, type TemplateDetail, type TemplateInput, type TemplateType,
} from '@/lib/hq-templates-api'
import {
  choiceKey, contentSummary, definitionError, definitionForName, definitionName, failedStores, referenceCount, resolvedItems,
  uploadedKeysIn, type TemplateMedia,
} from './definition'
import { FolderDot } from '@/components/shared/folder-dot'
import MessageForm from './message-form'
import styles from './console.module.css'

const LABELS: Record<TemplateType, string> = { tag: 'タグ', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }
const PAGE_TITLES: Record<TemplateType, string> = { tag: '友だち属性', template: 'テンプレート', rich_menu: 'リッチメニュー', form: '回答フォーム', scenario: 'シナリオ' }
const CREATE_LABELS: Record<TemplateType, string> = { tag: 'タグを作る', template: 'テンプレートを作る', rich_menu: 'メニューを作る', form: 'フォームを作る', scenario: 'シナリオを作る' }
const EDIT_TITLES: Record<TemplateType, string> = { tag: 'タグのひな形', template: 'メッセージのひな形', rich_menu: 'リッチメニューのひな形', form: '回答フォームのひな形', scenario: 'シナリオのひな形' }
const LIST_DESCRIPTIONS: Record<TemplateType, string> = {
  tag: 'タグのひな形を作り、各 LINE アカウントへ配ります。',
  template: 'メッセージのひな形を作り、各 LINE アカウントへ配ります。友だち属性・リッチメニュー・回答フォームも同じ形です。',
  rich_menu: 'リッチメニューのひな形を作り、各 LINE アカウントへ配ります。',
  scenario: 'シナリオのひな形を作り、停止中の下書きとして各 LINE アカウントへ配ります。',
  form: '回答フォームのひな形を作り、各 LINE アカウントへ配ります。',
}
/** 左の列の「種類」。絵の順（テンプレート・リッチメニュー・回答フォーム・タグ）＋シナリオ。 */
const TYPE_ORDER: TemplateType[] = ['template', 'rich_menu', 'form', 'tag', 'scenario']
const TYPE_COLORS: Record<TemplateType, string | null> = { template: null, rich_menu: 'var(--color-icon-tile-blue)', form: 'var(--color-icon-tile-green)', tag: 'var(--color-icon-tile-orange)', scenario: 'var(--color-icon-tile-purple)' }
/** 種類ごとの正規の住所（左メニューと同じ）。シナリオは専用の住所が無いので旧URLのまま。 */
const TYPE_ROUTES: Record<TemplateType, string> = { template: '/hq/templates', tag: '/hq/friend-attributes', rich_menu: '/hq/rich-menus', form: '/hq/form-submissions', scenario: '/hq/templates?type=scenario' }
/** 1280 などで畳んだ「種類：リッチメニュー」が切れない幅（共通の 150 では「種類：回答フォ…」になる）。 */
const TYPE_PICK_WIDTH = 176
const MODE_LABELS: Record<DistributionMode, string> = { create: '新しく作る', overwrite: '上書き', alias: '別名で作る' }

type Stage = 'list' | 'edit' | 'accounts' | 'duplicates' | 'result'
const errorText = (error: unknown) => error instanceof Error ? error.message : '処理できませんでした。時間をおいて再確認してください。'

/** 一覧の更新日時（絵：9/30 10:12）。読めない値は「—」。 */
function shortDate(value: string): string {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '—'
  const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(time))
  const get = (kind: string) => parts.find((part) => part.type === kind)?.value ?? ''
  return `${get('month')}/${get('day')} ${get('hour')}:${get('minute')}`
}

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

export default function HqTemplatesV8({ type, DefinitionEditor }: { type: TemplateType; DefinitionEditor?: ComponentType<DefinitionEditorProps> }) {
  const staffRole = useStaffRole()
  const canEdit = staffRole === null || canManageRole(staffRole)
  const [stage, setStage] = useState<Stage>('list')
  const [folders, setFolders] = useState<HqTemplateFolder[]>([])
  const [folderLoadFailed, setFolderLoadFailed] = useState(false)
  const [folderId, setFolderId] = useState<string | null>(null)
  const [folderFilter, setFolderFilter] = useState<string>('all')
  const [folderName, setFolderName] = useState('')
  const [folderFormOpen, setFolderFormOpen] = useState(false)
  const [folderEditId, setFolderEditId] = useState<string | null>(null)
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
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
  usePageTitle(stage === 'list' ? PAGE_TITLES[type] : stage === 'edit' ? `${PAGE_TITLES[type]} › ${type === 'template' ? (detail ? 'ひな形を編集' : 'ひな形を作る') : editTitle}` : PAGE_TITLES[type])
  usePageCrumbs([{ label: 'ホーム', href: '/' }])

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
    // R119: 目録だけの失敗で一覧や保存まで止めない。
    void hqTemplatesApi.list().then(
      (rows) => { if (current) { setCatalog(rows); setCatalogFailed(false) } },
      () => { if (current) { setCatalog(null); setCatalogFailed(true) } },
    )
    return () => { current = false }
  }, [type])
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
    loadDetailIntoForm(loaded); setSelected([]); setTextOverrides({}); setSearch(''); setPreflight(null); setChoices({}); setBulkMode(''); setStage(next)
  })
  const startCreate = () => {
    createAttempt.current = null; sessionUploads.current = []
    setDetail(null); setFolderId(folderFilter !== 'all' && folderFilter !== 'none' ? folderFilter : null); setName(''); setDescription(''); setDefinition(freshDefinition(type)); setStage('edit'); setError(''); setConflict(false)
  }
  const save = (distribute: boolean, sourceDefinition = definition, sourceName = name, sourceDescription = description, andAnother = false) => perform(async () => {
    const preparedDefinition = definitionForName(type, sourceDefinition, sourceName.trim(), sourceDescription.trim())
    const validation = !sourceName.trim() ? 'ひな形の名前を入力してください。' : definitionError(type, preparedDefinition, creationScope.current?.tenantId)
    if (validation) throw new Error(validation)
    const input = { type, name: sourceName.trim(), description: sourceDescription.trim(), folderId, definition: preparedDefinition } as TemplateInput
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
    setMessage('ひな形を保存しました。')
    if (continueToAccounts) { setSelected([]); setTextOverrides({}); setSearch(''); setStage('accounts') }
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
  const expiry = preflight ? Date.parse(preflight.expiresAt) : NaN
  const expired = !Number.isFinite(expiry) || expiry <= now
  const resolutions = preflight ? resolvedItems(preflight, choices) : null
  const shownAccounts = accounts.filter((account) => account.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
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
  const shownRows = templates.filter((row) => row.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (folderFilter === 'all' || (row.folder_id ?? 'none') === folderFilter))
  const folderOf = (id: string | null | undefined) => folders.find((folder) => folder.id === id) ?? null
  const summary = contentSummary(type, definition)

  const notices = <>
    {!canEdit && stage === 'list' ? <p className={styles.readonlyBand} role="note">閲覧のみで見ています。変える操作は管理者に頼んでください。</p> : null}
    {error ? <Notice tone="danger" message={error} action={conflict && detail ? <Button disabled={busy} onClick={() => open(detail.template.id, 'edit')}>最新の内容を読み込む</Button> : undefined} /> : null}
    {message ? <Notice tone="success" message={message} onClose={() => setMessage('')} /> : null}
  </>

  /* ───── 一覧（LRc93） ───── */
  if (stage === 'list') {
    const typeCounts = (kind: TemplateType) => catalog ? catalog.filter((row) => row.template_type === kind).length : kind === type ? templates.length : null
    const rowMenu = (row: HqTemplate): ActionMenuItem[] => [
      { id: 'edit', label: '編集', icon: <Pencil size={14} aria-hidden="true" />, onSelect: () => open(row.id, 'edit') },
      { id: 'duplicate', label: '複製', icon: <Copy size={14} aria-hidden="true" />, onSelect: () => void perform(async () => {
        const key = `${row.id}:${row.revision}`
        const requestId = duplicateAttempts.current.get(key) ?? crypto.randomUUID()
        duplicateAttempts.current.set(key, requestId)
        await hqTemplatesApi.duplicate(row.id, `${row.name}のコピー`, row.revision, requestId)
        duplicateAttempts.current.delete(key)
        setTemplates(await hqTemplatesApi.list(type))
        setMessage('ひな形を複製しました。')
      }) },
      { id: 'remove', label: '削除する', icon: <Trash2 size={14} aria-hidden="true" />, tone: 'danger', dividerBefore: true, onSelect: () => setRemove(row) },
    ]
    const createButton = canEdit
      ? <Button variant="primary" disabled={!ready || busy} onClick={startCreate}><Plus size={15} aria-hidden="true" />{CREATE_LABELS[type]}</Button>
      : null
    /* 絵：テンプレートの行は受信箱の印（inbox）、ほかは色付きのフォルダ。 */
    const typeRows = TYPE_ORDER.map((kind) => ({ id: kind, label: LABELS[kind], count: typeCounts(kind), color: TYPE_COLORS[kind], ...(kind === 'template' ? { icon: <Inbox size={15} /> } : {}) }))
    const selectType = (id: string) => { if (id !== type) window.location.assign(TYPE_ROUTES[id as TemplateType] ?? `/hq/templates?type=${id}`) }
    const folderNavRows = [{ id: 'all', label: 'すべて' }, { id: 'none', label: '未分類' }, ...folders.map((folder) => ({ id: folder.id, label: folder.name }))]
    return (
      <ListPage
        boardId="LRc93"
        title={PAGE_TITLES[type]}
        description={LIST_DESCRIPTIONS[type]}
        folderNav={[
          { label: '種類', rows: typeRows, activeId: type, onSelect: selectType, createAction: createButton ?? undefined, width: TYPE_PICK_WIDTH },
          ...(folderLoadFailed ? [] : [{ label: '分類', rows: folderNavRows, activeId: folderFilter, onSelect: setFolderFilter }]),
        ]}
        folders={(
          <div className={styles.rail}>
          <FolderPanel
            heading="種類"
            createAction={createButton ?? <span className={styles.createSpace} aria-hidden="true" />}
            rows={typeRows}
            activeId={type}
            onSelect={selectType}
          >
            <p className={styles.railNote}>配るときは、行の「アカウントへ配る」から。種類ごとに一覧を切り替えます。</p>
          </FolderPanel>
          {/* 絵（LRc93・2026-10-07 足した「分類」）：種類と同じ形の行（すべて＝受信箱・未分類＝開いたフォルダ）と「分類を追加」。 */}
          {folderLoadFailed ? <p role="alert" className={styles.railNote}>分類を読み込めませんでした。ページを再読み込みしてください。</p> : (
            <div className={styles.folderBlock} aria-label="分類（フォルダ）">
              <FolderPanel
                heading="分類"
                rows={[
                  { id: 'all', label: 'すべて', count: null, icon: <Inbox size={15} /> },
                  { id: 'none', label: '未分類', count: null },
                  ...folders.map((folder) => ({
                    id: folder.id, label: folder.name, count: null,
                    ...(canEdit ? {
                      onEdit: () => { setFolderEditId(folder.id); setFolderName(folder.name); setFolderFormOpen(true) },
                      onDelete: () => void perform(async () => {
                        await hqTemplatesApi.folders.remove(folder.id, folder.revision)
                        await reloadFolders(); setTemplates(await hqTemplatesApi.list(type)); setFolderFilter('all')
                        setMessage('分類を外しました。ひな形は未分類に残ります。')
                      }),
                      deleteNote: '分類を外しても、中のひな形は未分類に残ります。',
                    } : {}),
                  })),
                ]}
                activeId={folderFilter}
                onSelect={setFolderFilter}
                onAddFolder={canEdit && !folderFormOpen ? () => { setFolderEditId(null); setFolderName(''); setFolderFormOpen(true) } : undefined}
                addFolderLabel="分類を追加"
              >
                {canEdit && folderFormOpen ? (
                  <span className={styles.folderForm}>
                    <input aria-label="分類の名前" className={styles.input} value={folderName} maxLength={100} disabled={busy} onChange={(event) => setFolderName(event.target.value)} />
                    <Button size="compact" disabled={busy || !folderName.trim()} onClick={() => void perform(async () => {
                      const target = folders.find((folder) => folder.id === folderEditId)
                      if (target) await hqTemplatesApi.folders.update(target.id, folderName.trim(), target.revision)
                      else await hqTemplatesApi.folders.create(folderName.trim())
                      await reloadFolders(); setFolderName(''); setFolderEditId(null); setFolderFormOpen(false)
                    })}>{folderEditId ? '名前を変える' : '追加する'}</Button>
                    <Button size="compact" variant="text" disabled={busy} onClick={() => { setFolderName(''); setFolderEditId(null); setFolderFormOpen(false) }}>やめる</Button>
                  </span>
                ) : null}
              </FolderPanel>
            </div>
          )}
          </div>
        )}
        toolbar={(
          <div className={`${styles.toolbar} ${styles.listToolbar}`}>
            <label className={styles.search}>
              <Search size={14} aria-hidden="true" />
              <input aria-label="ひな形を検索" placeholder="ひな形を探す" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <span className={styles.count}>{`${PAGE_TITLES[type] === '友だち属性' ? 'タグ' : PAGE_TITLES[type]} ${shownRows.length} 件`}</span>
          </div>
        )}
      >
        {notices}
        {!ready ? (
          <p role="status" className={styles.empty}>{busy ? 'ひな形を読み込み中…' : '読み込めませんでした。権限や接続を確認し、ページを再読み込みしてください。'}</p>
        ) : <div className={styles.listArea}>
          <div className={styles.tableBox}>
            <table className={styles.table}>
              <colgroup><col /><col className={styles.colRef} /><col className={styles.colDate} /><col className={styles.colDest} /><col className={styles.colActions} /></colgroup>
              <thead><tr><Th>名前</Th><Th>参照先</Th><Th>更新日時</Th><Th>配布先</Th><Th><span className={styles.srOnly}>操作</span></Th></tr></thead>
              <tbody>
                {shownRows.map((row) => {
                  const folder = folderOf(row.folder_id)
                  return (
                    <tr key={row.id}>
                      <td>
                        <span className={styles.nameLine}>
                          <FolderDot folder={folder ? { name: folder.name } : null} />
                          <span className={styles.name} title={row.name}>{row.name}</span>
                        </span>
                        <span className={styles.sub} title={templateSubLine(row, LABELS[row.template_type])}>{templateSubLine(row, LABELS[row.template_type])}</span>
                      </td>
                      <td><span className={row.reference_summary ? styles.cell : `${styles.cell} ${styles.cellEmpty}`} title={row.reference_summary}>{row.reference_summary || '—'}</span></td>
                      <td><span className={styles.cell}>{shortDate(row.updated_at)}</span></td>
                      <td className={styles.topCell}>
                        {row.distributed_account_count === undefined ? <span className={`${styles.cell} ${styles.cellEmpty}`}>—</span>
                          : row.distributed_account_count ? <>
                            <span className={styles.strong}>{`${row.distributed_account_count} アカウント`}</span>
                            {distributedAccountsLine(row) ? <span className={styles.sub} title={distributedAccountsLine(row) ?? undefined}>{distributedAccountsLine(row)}</span> : null}
                          </>
                          : <span className={styles.strong}>まだ配っていない</span>}
                      </td>
                      <td>
                        <span className={styles.rowActions}>
                          {canEdit ? <>
                            <Button disabled={busy} onClick={() => open(row.id, 'accounts')} aria-label={`${row.name}をアカウントへ配る`}><Send size={15} aria-hidden="true" />アカウントへ配る</Button>
                            <span className={styles.menuBox}>
                              <IconButton title={`${row.name}の操作`} aria-label={`${row.name}の操作`} aria-expanded={openMenuId === row.id} onClick={() => setOpenMenuId((current) => current === row.id ? null : row.id)}>
                                <MoreHorizontal size={16} aria-hidden="true" />
                              </IconButton>
                              <ActionMenu open={openMenuId === row.id} onClose={() => setOpenMenuId(null)} ariaLabel={`${row.name}の操作`} items={rowMenu(row)} />
                            </span>
                          </> : null}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {!shownRows.length && <p className={styles.empty}>{templates.length ? '検索に一致するひな形はありません。' : 'まだひな形がありません。最初のひな形を作成してください。'}</p>}
          </div>
          <p className={styles.tableNote}>行の「…」から 編集・削除。配ったあとに直すと、各アカウントへは新しい版として届きます（配布先の版で確かめられます）。</p>
        </div>}
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
            setTemplates((current) => current.filter((t) => t.id !== remove.id)); setRemove(null); setMessage('ひな形を削除しました。')
          })}
        />
      </ListPage>
    )
  }

  /* ───── 作る・編集（X4JcOf） ───── */
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
                <div className={styles.field}>
                  <span className={styles.label}>フォルダ</span>
                  <Select aria-label="フォルダ" size="full" value={folderId ?? ''} disabled={busy || createUncertain || folderLoadFailed} onChange={(next) => setFolderId(next || null)} options={[{ value: '', label: '未分類' }, ...folders.map((folder) => ({ value: folder.id, label: folder.name }))]} />
                </div>
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
  const rowsForTable = stage === 'accounts' ? shownAccounts : accounts.filter((account) => selected.includes(account.id) || shownAccounts.includes(account))
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
      <PageHeading title={pageTitle} description="1つのアカウントだけ、または複数のアカウントを選んで一括で配れます。一括設定のあと、必要な項目だけアカウントごとに変えられます。" />
      <div className={styles.body}>
        {notices}
        <div className={styles.toolbar}>
          <label className={styles.search} data-size="account">
            <Search size={14} aria-hidden="true" />
            <input aria-label="アカウントを検索" placeholder="アカウント名で探す" value={search} onChange={(event) => setSearch(event.target.value)} />
          </label>
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
        </div>
        <div className={styles.tableBox}>
          <table className={styles.table} data-kind="distribute">
            <colgroup><col className={styles.colCheck} /><col /><col className={styles.colItem} /><col className={styles.colVersion} /><col className={styles.colMode} /></colgroup>
            <thead><tr>
              {/* 絵（meBRB）の頭の1列目は空。まとめて選ぶ箱は置かない（行ごとに選ぶ）。 */}
              <Th><span className={styles.srOnly}>選ぶ</span></Th>
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
                  <tr key={account.id}>
                    <td><Checkbox id={`hq-dist-${account.id}`} aria-label={account.name} checked={on} disabled={busy || stage !== 'accounts'} onCheckedChange={(checked) => setSelected((current) => checked ? [...current, account.id] : current.filter((id) => id !== account.id))} /></td>
                    <td>
                      <label className={styles.nameLabel} htmlFor={`hq-dist-${account.id}`}>
                        <span className={styles.name} title={account.name}>{account.name}</span>
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

function accountName(accounts: HqAccount[], id: string): string {
  return accounts.find((account) => account.id === id)?.name ?? id
}
